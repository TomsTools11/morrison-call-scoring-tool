import express from "express";
import path from "path";
import multer from "multer";
import { AssemblyAI } from "assemblyai";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";

// Initialize express app
const app = express();
const PORT = 3000;

// Setup multer for in-memory file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware for parsing JSON and urlencoded data
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Passcode validation middleware
const checkPasscode = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const passcode = req.headers["x-passcode"] || req.body.passcode;
  const expectedPasscode = process.env.APP_PASSCODE || "goal123"; // Fallback for dev if not set
  if (passcode !== expectedPasscode) {
    res.status(401).json({ error: "Unauthorized: Invalid passcode" });
    return;
  }
  next();
};

app.post("/api/verify-passcode", (req, res) => {
  const passcode = req.body.passcode;
  const expectedPasscode = process.env.APP_PASSCODE || "goal123";
  if (passcode === expectedPasscode) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Scoring Endpoint
app.post("/api/score", upload.single("file"), checkPasscode, async (req, res) => {
  try {
    const { producer, lead_type, transcript: textTranscript } = req.body;
    
    let finalTranscript = textTranscript;

    // Phase 1: Transcription with AssemblyAI
    if (req.file) {
      if (!process.env.ASSEMBLYAI_API_KEY) {
        return res.status(500).json({ error: "ASSEMBLYAI_API_KEY not configured" });
      }
      
      const client = new AssemblyAI({
        apiKey: process.env.ASSEMBLYAI_API_KEY,
      });

      // AssemblyAI API accepts a buffer through a custom file upload
      // Upload the file first
      const uploadResponse = await client.files.upload(req.file.buffer);
      
      // Request transcription
      const transcriptRequest = await client.transcripts.transcribe({
        audio: uploadResponse,
        speaker_labels: true,
        redact_pii: true,
        redact_pii_policies: [
          "credit_card_number",
          "credit_card_cvv",
          "credit_card_expiration",
          "banking_information",
          "social_security_number"
        ],
        redact_pii_sub: "hash"
      });
      
      if (transcriptRequest.status === "error") {
        throw new Error("Transcription failed: " + transcriptRequest.error);
      }

      // Convert to a structured transcript string
      if (transcriptRequest.utterances) {
        finalTranscript = transcriptRequest.utterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join("\n");
      } else {
        finalTranscript = transcriptRequest.text;
      }
    }

    if (!finalTranscript || finalTranscript.trim().length === 0) {
      return res.status(400).json({ error: "No transcript generated or provided" });
    }

    // Phase 2: Scoring with Gemini
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' }
      }
    });

    // Retry helper for Gemini API calls
    const generateContentWithRetry = async (aiClient: any, config: any, maxRetries = 3) => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          // Use gemini-3.6-flash which is the standard reliable model
          config.model = "gemini-3.6-flash"; 
          return await aiClient.models.generateContent(config);
        } catch (error: any) {
          lastError = error;
          console.error(`Gemini API Error (Attempt ${i + 1}/${maxRetries}):`, error.message);
          
          // Only retry on 503 or 429 errors
          if (error.message && (error.message.includes("503") || error.message.includes("429") || error.message.includes("UNAVAILABLE"))) {
            // Exponential backoff: 2s, 4s, 8s
            const waitTime = Math.pow(2, i + 1) * 1000; 
            console.log(`Waiting ${waitTime}ms before retrying...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          // Don't retry other errors (like 400 Bad Request)
          throw error;
        }
      }
      throw lastError;
    };

    // 1st Pass: Context Pass
    const contextPrompt = `
Analyze this transcript of an insurance sales call and extract context:
Is it a sales call? (true/false)
Direction: outbound or inbound
Lead Type: internet, mailer, winback, requote, cross_sell, inbound_call, unknown
Lines Quoted: auto, home, bundle, none
Outcome: bound, quoted_not_closed, no_quote, not_applicable

Transcript:
${finalTranscript}
`;

    const contextResponse = await generateContentWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: contextPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_sales_call: { type: Type.BOOLEAN },
            direction: { type: Type.STRING },
            lead_type: { type: Type.STRING },
            lines_quoted: { type: Type.STRING },
            outcome: { type: Type.STRING }
          },
          required: ["is_sales_call", "direction", "lead_type", "lines_quoted", "outcome"]
        }
      }
    });
    
    let contextData;
    try {
      contextData = JSON.parse(contextResponse.text);
    } catch(e) {
      return res.status(500).json({ error: "Failed to parse context pass from AI." });
    }

    if (!contextData.is_sales_call) {
      return res.json({
        red_flags: ["non_sales_call_detected"],
        error: "This does not appear to be a sales call. Refusing to score."
      });
    }

    // 2nd Pass: Scoring Pass
    // In a real implementation we would load rubric.v1.json and validate heavily
    // But here we construct a solid prompt based on the rubric specification.
    
    // We will ask the model to grade the call.
    const scoringPrompt = `
You are grading an insurance sales call for Mike Morrison Insurance Agency against their "Filtered Quotes / RPM" rubric.
Here is the call context:
Producer: ${producer || "Unknown"}
Lead Type: ${lead_type || contextData.lead_type || "Unknown"}
Direction: ${contextData.direction}
Lines Quoted: ${contextData.lines_quoted}
Outcome: ${contextData.outcome}

Review the transcript and grade the call on the following criteria. For each, return met (2), partial (1), missed (0), or na (not applicable). N/A if it does not apply based on the context. Provide verbatim evidence quotes for met/partial.

Sections & Criteria:
1. Opening & Call Purpose
- Proper greeting delivered (name and agency)
- Confirm purpose of call
- Outbound: follow correct talk path for lead type
- Outbound: attempt to overcome objections
2. Information Gathering & Verification
- Confirm customer interest
- Verify drivers, occupants, addresses
- Ask about salvage vehicles (Auto only)
- Identify other lines
- Explore cross-sell
3. Rapport Building
- Build rapport
- Encourage customer to talk
- Maintain engagement
4. Quoting Process
- Enter all info correctly
- Build quote thoroughly
- Double-check before presenting
5. Coverage Review: Auto (Auto only)
- Lead with liability talk path
- Explain current limits
- Reframe risk with real numbers ($75k-$80k)
- Match coverage to assets
- Start at 250/500 limits
- Use stories
- Offer umbrella
- Attempt to upsell
- Hold price to the end
6. Coverage Review: Home (Home only)
- Review all home coverages
- Identify coverage gaps
- Present money-saving opportunities
7. Closing
- Use assumptive close
- Correct escrow/no-escrow path (Home only)
- Direct payment ask with autopay setup
- Attempt to close the sale
- Get at least two no's before ending (N/A if Bound)
- Ask for referrals
- Life insurance ask
- Google review ask
- Additional needs ask
- Button up the quote (N/A if Bound)
8. Objection Handling Technique (N/A if no objections)
- Never end objection asking permission
- Assume close and confirm two details
- Rotate confirm pair
- Diagnose, don't defend

Also compute top 2 strengths and top 3 coaching priorities. Include a red_flags array for any severe violations like clear coverage misstatements or payment card data spoken.

IMPORTANT: Keep all descriptions, evidence strings, and notes extremely brief (under 10 words) so the JSON output does not get truncated!

Transcript:
${finalTranscript}
`;

    const scoringResponse = await generateContentWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: scoringPrompt,
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            strengths: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            priorities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  whatHappened: { type: Type.STRING },
                  scriptLine: { type: Type.STRING },
                  timestamp: { type: Type.STRING }
                }
              }
            },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  maxScore: { type: Type.NUMBER },
                  criteria: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        status: { type: Type.STRING, description: "met, partial, missed, or na" },
                        evidence: { type: Type.STRING },
                        timestamp: { type: Type.STRING },
                        note: { type: Type.STRING }
                      }
                    }
                  }
                }
              }
            },
            red_flags: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            overallScore: { type: Type.NUMBER },
            gradeBand: { type: Type.STRING, description: "On System, Solid, Needs Work, Off Script" },
            metrics: {
              type: Type.OBJECT,
              properties: {
                duration: { type: Type.STRING },
                talkShare: { type: Type.STRING },
                pace: { type: Type.STRING }
              }
            }
          }
        }
      }
    });

    let scoreData;
    try {
      scoreData = JSON.parse(scoringResponse.text);
    } catch (e: any) {
      console.error("Failed to parse scoring JSON, response may have been truncated:", scoringResponse.text?.substring(0, 500) + "...");
      return res.status(500).json({ error: "The AI generated a response that was too long or invalid. Please try analyzing a shorter segment of the transcript." });
    }

    if (scoreData.error) {
      return res.status(400).json({ error: scoreData.error });
    }

    if (!scoreData.sections || !Array.isArray(scoreData.sections)) {
      throw new Error("Invalid response format from AI: missing sections array.");
    }

    const sectionWeights: Record<string, number> = {
      "Opening & Call Purpose": 10,
      "Information Gathering & Verification": 10,
      "Rapport Building": 10,
      "Quoting Process": 10,
      "Coverage Review: Auto": 15,
      "Coverage Review: Home": 10,
      "Closing": 20,
      "Objection Handling Technique": 15
    };

    let totalWeight = 0;
    let earnedWeight = 0;

    scoreData.sections.forEach((sec: any) => {
      let secMaxPoints = 0;
      let secEarnedPoints = 0;

      if (Array.isArray(sec.criteria)) {
        sec.criteria.forEach((c: any) => {
          const status = c.status?.toLowerCase();
          if (status === "met") {
            secMaxPoints += 2;
            secEarnedPoints += 2;
          } else if (status === "partial") {
            secMaxPoints += 2;
            secEarnedPoints += 1;
          } else if (status === "missed") {
            secMaxPoints += 2;
          }
        });
      } else {
        sec.criteria = [];
      }

      sec.maxScore = secMaxPoints;
      sec.score = secEarnedPoints;

      if (secMaxPoints > 0) {
        const weight = sectionWeights[sec.name] || 10;
        totalWeight += weight;
        earnedWeight += (secEarnedPoints / secMaxPoints) * weight;
      }
    });

    scoreData.strengths = Array.isArray(scoreData.strengths) ? scoreData.strengths : [];
    scoreData.priorities = Array.isArray(scoreData.priorities) ? scoreData.priorities : [];
    scoreData.red_flags = Array.isArray(scoreData.red_flags) ? scoreData.red_flags : [];
    scoreData.overallScore = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
    
    if (scoreData.overallScore >= 90) scoreData.gradeBand = "On System";
    else if (scoreData.overallScore >= 75) scoreData.gradeBand = "Solid";
    else if (scoreData.overallScore >= 60) scoreData.gradeBand = "Needs Work";
    else scoreData.gradeBand = "Off Script";

    // Return the response
    res.json({
      meta: {
        producer: producer || "Unknown",
        date: new Date().toISOString(),
        call_type: `${contextData.direction} / ${lead_type || contextData.lead_type || 'unknown'} / ${contextData.lines_quoted}`,
        outcome: contextData.outcome
      },
      ...scoreData,
      transcript: finalTranscript
    });

  } catch (error: any) {
    console.error("Scoring error:", error);
    res.status(500).json({ error: error.message || "An error occurred during scoring" });
  }
});

// Vite integration for development and production
if (process.env.NODE_ENV !== "production") {
  // Try to use Vite dynamically only in dev
  import("vite").then(async ({ createServer: createViteServer }) => {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error("Vite failed to initialize:", err);
  });
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}
