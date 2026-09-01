import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rejectUnauthorized } from "../lib/auth.js";
import { rejectWrongMethod, requireEnv } from "../lib/http.js";
import { createGeminiClient } from "../lib/gemini.js";
import { runContextPass, ScoringOutputError } from "../lib/scoring.js";
import { measureTranscript } from "../lib/rubric.js";

/**
 * Pass 1 of the pipeline. Split out from scoring so each Gemini call gets
 * its own function budget instead of sharing one.
 *
 * This pass establishes facts about the call — including how far it got and
 * who ended it — which is what lets pass 2 grade only the criteria the call
 * was actually eligible for.
 *
 * If this isn't a gradeable sales call the pipeline stops here and refuses.
 */

/** Below this there is nothing to grade, and a scorecard would be invented. */
const MIN_WORDS = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectWrongMethod(req, res, "POST")) return;
  if (rejectUnauthorized(req, res)) return;

  const apiKey = requireEnv("GEMINI_API_KEY", res);
  if (!apiKey) return;

  const transcript = (req.body as { transcript?: unknown } | undefined)?.transcript;
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    res.status(400).json({ error: "No transcript generated or provided" });
    return;
  }

  const measures = measureTranscript(transcript);
  if (measures.wordCount < MIN_WORDS) {
    res.status(200).json({
      red_flags: ["transcript_too_short"],
      error: `That transcript is only ${measures.wordCount} words. There is not enough of a call here to score.`,
    });
    return;
  }

  const ai = createGeminiClient(apiKey);

  let context;
  try {
    context = await runContextPass(ai, transcript);
  } catch (error: any) {
    console.error("Context pass error:", error);
    res.status(error instanceof ScoringOutputError ? 502 : 500).json({
      error:
        error instanceof ScoringOutputError
          ? error.message
          : "Failed to parse context pass from AI.",
    });
    return;
  }

  if (!context.is_sales_call) {
    res.status(200).json({
      red_flags: ["non_sales_call_detected"],
      error: "This does not appear to be a sales call. Refusing to score.",
    });
    return;
  }

  if (context.furthest_stage === "no_contact") {
    res.status(200).json({
      red_flags: ["no_contact"],
      error:
        "Nobody engaged on this call — it reads as a voicemail, wrong number or immediate hang-up. There is nothing to grade.",
    });
    return;
  }

  res.status(200).json({ context });
}
