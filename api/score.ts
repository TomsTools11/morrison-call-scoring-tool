import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rejectUnauthorized } from "../lib/auth.js";
import { rejectWrongMethod, requireEnv } from "../lib/http.js";
import { createGeminiClient } from "../lib/gemini.js";
import { runScoringPass, ScoringOutputError } from "../lib/scoring.js";
import {
  applicabilityFor,
  assembleScorecard,
  crossCheckContext,
  measureTranscript,
  recomputeScores,
  verifyEvidence,
  verifyTimestamps,
  type CallFacts,
} from "../lib/rubric.js";

/**
 * Pass 2 of the pipeline.
 *
 * The order matters: applicability is decided here, in code, from pass 1's
 * facts and measurements taken off the transcript. Only then is the model
 * asked to grade, and only about the criteria that survived. Its numbers are
 * never used — `recomputeScores` derives all of them.
 */

/** Bumped whenever the rubric, weights or applicability rules change. */
const SCORING_VERSION = 2;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectWrongMethod(req, res, "POST")) return;
  if (rejectUnauthorized(req, res)) return;

  const apiKey = requireEnv("GEMINI_API_KEY", res);
  if (!apiKey) return;

  const body = req.body as
    | { transcript?: unknown; context?: CallFacts; producer?: unknown; lead_type?: unknown }
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

    // The dropdown overrides pass 1's lead type. Direction has to move with
    // it, or an "Inbound" override produces a card headed "outbound / inbound"
    // while every direction-based gate still treats the call as outbound.
    const facts: CallFacts = {
      ...context,
      lead_type: (leadType || context.lead_type) as CallFacts["lead_type"],
      direction: leadType === "inbound_call" ? "inbound" : context.direction,
    };

    const measures = measureTranscript(transcript, facts.producer_speaker_label);
    const plan = applicabilityFor(facts, measures);

    let raw;
    try {
      raw = await runScoringPass(ai, transcript, plan, producer);
    } catch (error) {
      if (error instanceof ScoringOutputError) {
        res.status(502).json({ error: error.message });
        return;
      }
      throw error;
    }

    const { sections, flags } = assembleScorecard(plan, raw.verdicts);
    const evidenceFlags = verifyEvidence(sections, transcript);
    const timestampFlags = verifyTimestamps(sections, measures);
    const conflictFlags = crossCheckContext(sections, plan.facts);
    const totals = recomputeScores(sections, plan.amnesty);

    res.status(200).json({
      meta: {
        producer: producer || "Unknown",
        date: new Date().toISOString(),
        call_type: `${plan.facts.direction} / ${plan.facts.lead_type} / ${plan.facts.lines_quoted}`,
        outcome: plan.facts.outcome,
        stage: plan.effectiveStage,
        endedBy: plan.facts.stop_attribution,
        scoringVersion: SCORING_VERSION,
      },
      sections,
      overallScore: totals.overallScore,
      gradeBand: totals.gradeBand,
      scoredWeight: totals.scoredWeight,
      amnesty: plan.amnesty,
      strengths: raw.strengths,
      priorities: raw.priorities,
      red_flags: [...raw.red_flags, ...totals.flags],
      diagnostics: [...flags, ...evidenceFlags, ...timestampFlags, ...conflictFlags],
      metrics: {
        duration: formatDuration(measures.elapsedSeconds),
        talkShare:
          measures.producerTalkShare === null ? "" : `${measures.producerTalkShare}% producer`,
        pace: formatPace(measures),
      },
      facts: plan.facts,
      measures,
      transcript,
    });
  } catch (error: any) {
    console.error("Scoring error:", error);
    res.status(500).json({ error: error.message || "An error occurred during scoring" });
  }
}

/** Measured, not guessed — the model used to invent this string. */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const mm = Math.floor(seconds / 60);
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatPace(m: { elapsedSeconds: number | null; wordCount: number }): string {
  if (m.elapsedSeconds === null || m.elapsedSeconds < 30) return "";
  return `${Math.round(m.wordCount / (m.elapsedSeconds / 60))} wpm`;
}
