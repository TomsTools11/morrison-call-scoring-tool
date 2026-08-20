import { Type } from "@google/genai";
import { generateContentWithRetry } from "./gemini";

/**
 * `maxOutputTokens` is a combined budget for thinking *and* output on this
 * model. At the old 8192 a long reasoning pass would eat the budget and the
 * JSON came back truncated on roughly one run in three. A real scorecard is
 * ~2k output tokens, so this leaves generous headroom for both.
 */
const MAX_OUTPUT_TOKENS = 32768;

/** Bounds how much of that budget reasoning can claim, and caps latency with it. */
const THINKING_BUDGET = 4096;

/** Truncation is non-deterministic, so one clean retry recovers most of it. */
const SCORING_ATTEMPTS = 2;

/** Raised when the model could not produce a usable scorecard. */
export class ScoringOutputError extends Error {}

export interface CallContext {
  is_sales_call: boolean;
  direction: string;
  lead_type: string;
  lines_quoted: string;
  outcome: string;
}

/**
 * Section weights used to combine per-section percentages into the overall
 * score. Changing how calls are scored means editing this map and the
 * arithmetic in `recomputeScores` — not the prompt.
 */
export const sectionWeights: Record<string, number> = {
  "Opening & Call Purpose": 10,
  "Information Gathering & Verification": 10,
  "Rapport Building": 10,
  "Quoting Process": 10,
  "Coverage Review: Auto": 15,
  "Coverage Review: Home": 10,
  "Closing": 20,
  "Objection Handling Technique": 15,
};

const contextResponseSchema = {
  type: Type.OBJECT,
  properties: {
    is_sales_call: { type: Type.BOOLEAN },
    direction: { type: Type.STRING },
    lead_type: { type: Type.STRING },
    lines_quoted: { type: Type.STRING },
    outcome: { type: Type.STRING },
  },
  required: ["is_sales_call", "direction", "lead_type", "lines_quoted", "outcome"],
};

const scoringResponseSchema = {
  type: Type.OBJECT,
  properties: {
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    priorities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          whatHappened: { type: Type.STRING },
          scriptLine: { type: Type.STRING },
          timestamp: { type: Type.STRING },
        },
      },
    },
    sections: {
      type: Type.ARRAY,
      // All eight rubric sections must come back — inapplicable ones are
      // reported with `na` criteria, never omitted. Without this the model
      // sometimes returns a handful of sections, which parses fine and
      // silently under-grades the call.
      minItems: "8",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          criteria: {
            type: Type.ARRAY,
            minItems: "1",
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                status: { type: Type.STRING, description: "met, partial, missed, or na" },
                evidence: { type: Type.STRING },
                timestamp: { type: Type.STRING },
                note: { type: Type.STRING },
              },
              required: ["name", "status"],
            },
          },
        },
        required: ["name", "criteria"],
      },
    },
    red_flags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    // `overallScore`, `gradeBand`, and the per-section score/maxScore are
    // deliberately absent: recomputeScores derives all of them, so asking the
    // model for them only spends output tokens on values we throw away.
    metrics: {
      type: Type.OBJECT,
      properties: {
        duration: { type: Type.STRING },
        talkShare: { type: Type.STRING },
        pace: { type: Type.STRING },
      },
    },
  },
  required: ["sections", "strengths", "priorities", "metrics"],
};

/** Pass 1 — establish what kind of call this is before grading anything. */
export async function runContextPass(
  ai: any,
  transcript: string,
): Promise<CallContext> {
  const contextPrompt = `
Analyze this transcript of an insurance sales call and extract context:
Is it a sales call? (true/false)
Direction: outbound or inbound
Lead Type: internet, mailer, winback, requote, cross_sell, inbound_call, unknown
Lines Quoted: auto, home, bundle, none
Outcome: bound, quoted_not_closed, no_quote, not_applicable

Transcript:
${transcript}
`;

  const contextResponse = await generateContentWithRetry(ai, {
    model: "gemini-3.6-flash",
    contents: contextPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: contextResponseSchema,
    },
  });

  return JSON.parse(contextResponse.text);
}

/** Pass 2 — grade every rubric criterion, with verbatim evidence. */
export async function runScoringPass(
  ai: any,
  transcript: string,
  context: CallContext,
  producer: string | undefined,
  leadType: string | undefined,
): Promise<any> {
  const scoringPrompt = `
You are grading an insurance sales call for Mike Morrison Insurance Agency against their "Filtered Quotes / RPM" rubric.
Here is the call context:
Producer: ${producer || "Unknown"}
Lead Type: ${leadType || context.lead_type || "Unknown"}
Direction: ${context.direction}
Lines Quoted: ${context.lines_quoted}
Outcome: ${context.outcome}

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
${transcript}
`;

  let lastFailure = "";

  for (let attempt = 1; attempt <= SCORING_ATTEMPTS; attempt++) {
    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: scoringPrompt,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        responseMimeType: "application/json",
        responseSchema: scoringResponseSchema,
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      lastFailure = "the model ran out of output budget";
      console.error(`Scoring attempt ${attempt}/${SCORING_ATTEMPTS}: hit MAX_TOKENS.`);
      continue;
    }

    try {
      return JSON.parse(response.text);
    } catch {
      lastFailure = "the model returned invalid JSON";
      console.error(
        `Scoring attempt ${attempt}/${SCORING_ATTEMPTS}: unparseable response:`,
        response.text?.substring(0, 300) + "...",
      );
    }
  }

  throw new ScoringOutputError(
    `Scoring failed after ${SCORING_ATTEMPTS} attempts because ${lastFailure}. Try a shorter transcript.`,
  );
}

/**
 * The rubric lists several sections with a qualifier — "Coverage Review: Auto
 * (Auto only)", "Objection Handling Technique (N/A if no objections)" — and the
 * model echoes the qualifier back as part of the section name. Left alone, that
 * name misses `sectionWeights` and silently takes the default weight, so
 * Coverage Review: Auto would count for 10 instead of 15.
 */
function canonicalSectionName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
}

/**
 * The model's own numeric scores are discarded. Everything below is
 * recomputed here: met=2, partial=1, missed=0, na excluded from the
 * denominator; section percentages are combined using `sectionWeights`;
 * the grade band comes from the 90/75/60 thresholds.
 */
export function recomputeScores(scoreData: any): void {
  let totalWeight = 0;
  let earnedWeight = 0;

  scoreData.sections.forEach((sec: any) => {
    sec.name = canonicalSectionName(sec.name) || sec.name;
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
}
