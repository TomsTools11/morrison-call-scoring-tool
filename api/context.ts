import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rejectUnauthorized } from "../lib/auth";
import { rejectWrongMethod, requireEnv } from "../lib/http";
import { createGeminiClient } from "../lib/gemini";
import { runContextPass } from "../lib/scoring";

/**
 * Pass 1 of the pipeline. Split out from scoring so each Gemini call gets
 * its own function budget instead of sharing one.
 *
 * If this isn't a sales call the pipeline stops here and refuses to score.
 */
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

  const ai = createGeminiClient(apiKey);

  let context;
  try {
    context = await runContextPass(ai, transcript);
  } catch (error: any) {
    console.error("Context pass error:", error);
    res.status(500).json({ error: "Failed to parse context pass from AI." });
    return;
  }

  if (!context.is_sales_call) {
    res.status(200).json({
      red_flags: ["non_sales_call_detected"],
      error: "This does not appear to be a sales call. Refusing to score.",
    });
    return;
  }

  res.status(200).json({ context });
}
