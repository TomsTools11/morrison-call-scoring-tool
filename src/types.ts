export type CriterionStatus = "met" | "partial" | "missed" | "na";

export interface ScorecardResponse {
  meta: {
    producer: string;
    date: string;
    call_type: string;
    outcome: string;
  };
  strengths: string[];
  priorities: {
    whatHappened: string;
    scriptLine: string;
    timestamp: string;
  }[];
  sections: {
    name: string;
    score: number;
    maxScore: number;
    criteria: {
      name: string;
      status: CriterionStatus;
      evidence: string;
      timestamp: string;
      note: string;
    }[];
  }[];
  overallScore: number;
  gradeBand: string;
  metrics: {
    duration: string;
    talkShare: string;
    pace: string;
  };
  red_flags?: string[];
  error?: string;
  transcript?: string;
}

/** The context pass result, carried from `/api/context` into `/api/score`. */
export interface CallContext {
  is_sales_call: boolean;
  direction: string;
  lead_type: string;
  lines_quoted: string;
  outcome: string;
}

/** One saved scorecard, kept in localStorage so the history screen has data. */
export interface HistoryEntry {
  id: string;
  savedAt: string;
  scorecard: ScorecardResponse;
}

export type Screen = "history" | "form" | "analyzing" | "scorecard" | "refused";
