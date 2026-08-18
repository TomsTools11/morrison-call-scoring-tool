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
      status: "met" | "partial" | "missed" | "na";
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
