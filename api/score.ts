import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rejectUnauthorized } from "../lib/auth";
import { rejectWrongMethod, requireEnv } from "../lib/http";
import { createGeminiClient } from "../lib/gemini";
import {
  recomputeScores,
  runScoringPass,
  ScoringOutputError,
  type CallContext,
} from "../lib/scoring";

/**
 * Pass 2 of the pipeline. The model grades each criterion; its own numeric
 * scores are then thrown away and recomputed here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectWrongMethod(req, res, "POST")) return;
  if (rejectUnauthorized(req, res)) return;

  const apiKey = requireEnv("GEMINI_API_KEY", res);
  if (!apiKey) return;

  const body = req.body as
    | {
        transcript?: unknown;
        context?: CallContext;
        producer?: unknown;
        lead_type?: unknown;
      }
    | undefined;

  const transcript = body?.transcript;
  const context = body?.context;
  const producer = typeof body?.producer === "string" ? body.producer : undefined;
  const leadType = typeof body?.lead_type === "string" ? body.lead_type : undefined;

  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    res.status(400).json({ error: "No transcript generated or provided" });
    return;
  }
  if (!context || typeof context !== "object") {
    res.status(400).json({ error: "Missing call context" });
    return;
  }

  try {
    const ai = createGeminiClient(apiKey);

    let scoreData;
    try {
      scoreData = await runScoringPass(ai, transcript, context, producer, leadType);
    } catch (error) {
      if (error instanceof ScoringOutputError) {
        res.status(502).json({ error: error.message });
        return;
      }
      throw error;
    }

    if (scoreData.error) {
      res.status(400).json({ error: scoreData.error });
      return;
    }

    if (!scoreData.sections || !Array.isArray(scoreData.sections)) {
      throw new Error("Invalid response format from AI: missing sections array.");
    }

    recomputeScores(scoreData);

    res.status(200).json({
      meta: {
        producer: producer || "Unknown",
        date: new Date().toISOString(),
        call_type: `${context.direction} / ${leadType || context.lead_type || "unknown"} / ${context.lines_quoted}`,
        outcome: context.outcome,
      },
      ...scoreData,
      transcript,
    });
  } catch (error: any) {
    console.error("Scoring error:", error);
    res.status(500).json({ error: error.message || "An error occurred during scoring" });
  }
}
