import type {
  CallFacts,
  CriterionStatus,
  ScoredCriterion,
  ScoredSection,
  TranscriptMeasures,
} from "@/lib/rubric";

export type { CallFacts, CriterionStatus, ScoredCriterion, ScoredSection, TranscriptMeasures };

/**
 * The `/api/score` response. The section and criterion shapes are imported
 * from `lib/rubric` rather than re-declared, so the server's output and the
 * frontend's expectation cannot drift apart the way they used to.
 */
export interface ScorecardResponse {
  meta: {
    producer: string;
    /** When the transcript was scored, not when the call happened. */
    date: string;
    call_type: string;
    outcome: string;
    stage?: string;
    endedBy?: string;
    scoringVersion?: number;
  };
  strengths: string[];
  priorities: {
    whatHappened: string;
    scriptLine: string;
    timestamp: string;
  }[];
  sections: ScoredSection[];
  /** null when nothing on the call was gradeable. */
  overallScore: number | null;
  gradeBand: string;
  /** How much of the 100-point rubric actually counted for this call. */
  scoredWeight?: number;
  /** True when the customer ended the call, so unreached stages were forgiven. */
  amnesty?: boolean;
  metrics: {
    duration: string;
    talkShare: string;
    pace: string;
  };
  facts?: CallFacts;
  /** Kept so a reviewed scorecard can be re-scored offline by the eval harness. */
  measures?: TranscriptMeasures;
  red_flags?: string[];
  error?: string;
  transcript?: string;
}

/** One saved scorecard, kept in localStorage so the history screen has data. */
export interface HistoryEntry {
  id: string;
  savedAt: string;
  scorecard: ScorecardResponse;
  /** Reviewer corrections, kept separately from the machine verdicts. */
  overrides?: Record<string, CriterionStatus>;
  reviewedAt?: string;
}

export type Screen = "history" | "form" | "analyzing" | "scorecard" | "refused";
