/**
 * The scoring core: what the rubric contains, which criteria a given call is
 * even eligible for, and the arithmetic that turns verdicts into a number.
 *
 * This module imports NOTHING. `lib/scoring.ts` uses it on the server, and the
 * browser imports it through the `@` alias so a reviewer's override can
 * recompute a score without a round trip. Adding an import here — especially
 * `@google/genai` — would drag the Gemini SDK into the client bundle.
 *
 * Three rules hold this design together, and breaking any of them turns
 * adaptive scoring into a way to game the score:
 *
 *  1. Scope is a function of facts about the CALL, never of a verdict about
 *     the producer. Two producers on structurally identical calls face an
 *     identical in-scope set, so attempting can never score below not
 *     attempting.
 *  2. Call length never licenses an N/A. Only stage-not-reached does, and only
 *     when the CUSTOMER ended the call. Length feeds exactly one criterion —
 *     Mike's own "keep call over 10 minutes".
 *  3. Code may raise the detected stage, never lower it. A model that
 *     under-reports how far a call got is corrected by the transcript; one
 *     that over-reports only makes grading stricter.
 */

export type CriterionStatus = "met" | "partial" | "missed" | "na";

export type Stage =
  | "no_contact"
  | "contact"
  | "discovery"
  | "quote_built"
  | "presented"
  | "close_attempted"
  | "bound";

/** Ordered so `>=` comparisons express "got at least this far". */
export const STAGE_RANK: Record<Stage, number> = {
  no_contact: 0,
  contact: 1,
  discovery: 2,
  quote_built: 3,
  presented: 4,
  close_attempted: 5,
  bound: 6,
};

export type StopAttribution =
  | "completed"
  | "customer_refused"
  | "customer_unavailable"
  | "customer_disqualified"
  | "callback_scheduled"
  | "producer_ended"
  | "unclear";

/**
 * The only attributions that buy amnesty. `producer_ended` and `unclear` do
 * not: weight for stages the call never reached is conserved and charged at
 * zero, so quitting early is never cheaper than trying and failing.
 */
const CUSTOMER_STOPPED: StopAttribution[] = [
  "completed",
  "customer_refused",
  "customer_unavailable",
  "customer_disqualified",
  "callback_scheduled",
];

export type Direction = "outbound" | "inbound";
export type LinesQuoted = "auto" | "home" | "bundle" | "none";
export type Outcome = "bound" | "quoted_not_closed" | "no_quote" | "not_applicable";
export type ObjectionsRaised = "none" | "one" | "multiple";
/** Which side of the price the objections landed on — they are graded differently. */
export type ObjectionPhase = "none" | "pre_quote" | "post_quote" | "both";

export type LeadType =
  | "internet"
  | "mailer"
  | "winback"
  | "requote"
  | "cross_sell"
  | "inbound_call"
  | "unknown";

/** Everything pass 1 establishes about the call, before anything is graded. */
export interface CallFacts {
  is_sales_call: boolean;
  direction: Direction;
  lead_type: LeadType;
  lines_quoted: LinesQuoted;
  outcome: Outcome;
  furthest_stage: Stage;
  stop_attribution: StopAttribution;
  objections_raised: ObjectionsRaised;
  objection_phase: ObjectionPhase;
  price_stated: boolean;
  producer_speaker_label: string;
}

/** Facts measured from the transcript itself. No model involved. */
export interface TranscriptMeasures {
  /** null when the transcript carries no [HH:MM:SS] stamps. */
  elapsedSeconds: number | null;
  wordCount: number;
  turnCount: number;
  /** Percent of words spoken by the producer, or null if speakers are unlabelled. */
  producerTalkShare: number | null;
  /** A dollar figure in the last 40% of the call — a price presentation, not education. */
  moneyLate: boolean;
  hasTimestamps: boolean;
  hasSpeakerLabels: boolean;
}

export const SECTION_ORDER = [
  "Opening & Call Purpose",
  "Information Gathering & Verification",
  "Rapport Building",
  "Quoting Process",
  "Coverage Review: Auto",
  "Coverage Review: Home",
  "Closing",
  "Objection Handling Technique",
] as const;

export type SectionName = (typeof SECTION_ORDER)[number];

/**
 * Section weights, combined into the overall score. Sums to 100 when every
 * section applies; `recomputeScores` renormalizes when they do not.
 */
export const sectionWeights: Record<SectionName, number> = {
  "Opening & Call Purpose": 10,
  "Information Gathering & Verification": 10,
  "Rapport Building": 10,
  "Quoting Process": 10,
  "Coverage Review: Auto": 15,
  "Coverage Review: Home": 10,
  Closing: 20,
  "Objection Handling Technique": 15,
};

export interface CriterionSpec {
  id: string;
  section: SectionName;
  name: string;
  /**
   * Relative weight inside its section. The three end-of-call asks are 1/3
   * each because Mike's checklist carries them as a single box —
   * "Ask about additional needs: Life, Reviews, SPP".
   */
  units: number;
  /** The call must have reached at least this stage for the criterion to apply. */
  minStage: Stage;
  /**
   * Structural N/A: nothing the producer could have changed — line of
   * business, call direction, a bound outcome, no objection raised.
   */
  structuralNa?: (f: CallFacts, m: TranscriptMeasures) => string | null;
  /** Graded in code from measured facts; never sent to the model. */
  codeGrade?: (f: CallFacts, m: TranscriptMeasures) => CriterionStatus;
  /** What the producer should have done — shown to the model as the standard. */
  standard?: string;
}

const isAuto = (f: CallFacts) => f.lines_quoted === "auto" || f.lines_quoted === "bundle";
const isHome = (f: CallFacts) => f.lines_quoted === "home" || f.lines_quoted === "bundle";
const objectedPreQuote = (f: CallFacts) =>
  f.objection_phase === "pre_quote" || f.objection_phase === "both";
const objectedPostQuote = (f: CallFacts) =>
  f.objection_phase === "post_quote" || f.objection_phase === "both";

/**
 * The rubric, one row per criterion, keyed by a stable id. Every downstream
 * count — how many criteria a section declares, which are in scope, what the
 * prompt asks for — is derived from this table rather than hardcoded, so the
 * table is the single place a rubric change lands.
 */
export const RUBRIC: CriterionSpec[] = [
  // 1. Opening & Call Purpose
  {
    id: "open.greeting",
    section: "Opening & Call Purpose",
    name: "Proper greeting delivered",
    units: 1,
    minStage: "contact",
    standard: "Producer states their own name and the agency in the first turn.",
  },
  {
    id: "open.purpose",
    section: "Opening & Call Purpose",
    name: "Confirm purpose of call",
    units: 1,
    minStage: "contact",
    standard: "Producer says why they are calling and ties it to the lead source.",
  },
  {
    id: "open.talkpath",
    section: "Opening & Call Purpose",
    name: "Follow correct talk path for lead type",
    units: 1,
    minStage: "contact",
    structuralNa: (f) =>
      f.direction === "inbound" ? "Inbound call — the intro talk paths are outbound scripts." : null,
    standard:
      "Producer runs the intro script matching the lead type and closes it by confirming a detail (address, vehicle).",
  },
  {
    id: "open.overcome",
    section: "Opening & Call Purpose",
    name: "Attempt to overcome opening objections",
    units: 1,
    // Never stage-gated: this is one of the criteria that catches a producer
    // who let the call die at the intro, so it has to survive when the
    // quote-dependent sections drop out.
    minStage: "no_contact",
    structuralNa: (f) => {
      if (f.direction === "inbound") return "Inbound call — no outbound gatekeeping objection to overcome.";
      if (!objectedPreQuote(f)) return "The customer raised no objection before the quote.";
      return null;
    },
    standard: "Producer works the objection rather than accepting it and ending the call.",
  },

  // 2. Information Gathering & Verification
  {
    id: "info.interest",
    section: "Information Gathering & Verification",
    name: "Confirm customer interest",
    units: 1,
    minStage: "contact",
    standard: "Producer establishes the customer wants a quote before gathering details.",
  },
  {
    id: "info.verify",
    section: "Information Gathering & Verification",
    name: "Verify drivers, occupants, addresses",
    units: 1,
    minStage: "discovery",
  },
  {
    id: "info.salvage",
    section: "Information Gathering & Verification",
    name: "Ask about salvage vehicles",
    units: 1,
    minStage: "discovery",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
  },
  {
    id: "info.other_lines",
    section: "Information Gathering & Verification",
    name: "Identify other lines of business",
    units: 1,
    minStage: "discovery",
  },
  {
    id: "info.cross_sell",
    section: "Information Gathering & Verification",
    name: "Explore cross-sell opportunities",
    units: 1,
    minStage: "discovery",
  },

  // 3. Rapport Building
  {
    id: "rapport.build",
    section: "Rapport Building",
    name: "Build rapport throughout the conversation",
    units: 1,
    minStage: "contact",
  },
  {
    id: "rapport.encourage",
    section: "Rapport Building",
    name: "Encourage the customer to talk",
    units: 1,
    minStage: "contact",
    standard: "Open questions and space to answer, rather than a monologue.",
  },
  {
    id: "rapport.engagement",
    section: "Rapport Building",
    name: "Maintain strong engagement",
    units: 1,
    minStage: "contact",
  },

  // 4. Quoting Process
  {
    id: "quote.accuracy",
    section: "Quoting Process",
    name: "Enter all information correctly",
    units: 1,
    minStage: "quote_built",
    standard:
      "Judge only from what is audible: information read back to the customer, or corrections the customer makes. If the transcript shows neither, this is partial at best, never met.",
  },
  {
    id: "quote.thorough",
    section: "Quoting Process",
    name: "Build the quote thoroughly",
    units: 1,
    minStage: "quote_built",
  },
  {
    id: "quote.doublecheck",
    section: "Quoting Process",
    name: "Double-check before presenting",
    units: 1,
    minStage: "quote_built",
    standard: "Producer recaps or confirms the details back before presenting a number.",
  },

  // 5. Coverage Review: Auto
  {
    id: "auto.liability_first",
    section: "Coverage Review: Auto",
    name: "Lead with the liability talk path",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
  },
  {
    id: "auto.probe_current",
    section: "Coverage Review: Auto",
    name: "Probe what coverage they believe they have",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard:
      "\"What kind of coverages do you believe you have right now?\" and, on \"full coverage\", the reframe that nobody has broken down what that means.",
  },
  {
    id: "auto.explain_limits",
    section: "Coverage Review: Auto",
    name: "Explain current limits in plain terms",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard:
      "Walks the per-person / per-accident split concretely — what is covered and what comes out of pocket.",
  },
  {
    id: "auto.reframe_risk",
    section: "Coverage Review: Auto",
    name: "Reframe the risk with real numbers",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard: "Cites the $75,000–$80,000 average bodily injury claim as the benchmark.",
  },
  {
    id: "auto.match_assets",
    section: "Coverage Review: Auto",
    name: "Match coverage to assets",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard:
      "Totals home and vehicle values and recommends liability at least equal to them.",
  },
  {
    id: "auto.start_250_500",
    section: "Coverage Review: Auto",
    name: "Open the recommendation at 250/500",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard:
      "250/500 is the floor the recommendation starts from. Raising it to match assets satisfies this criterion — it does not violate it.",
  },
  {
    id: "auto.stories",
    section: "Coverage Review: Auto",
    name: "Use stories to encourage higher limits",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
  },
  {
    id: "auto.umbrella",
    section: "Coverage Review: Auto",
    name: "Offer an umbrella policy",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
  },
  {
    id: "auto.upsell",
    section: "Coverage Review: Auto",
    name: "Attempt to upsell higher limits",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
  },
  {
    id: "auto.hold_price",
    section: "Coverage Review: Auto",
    name: "Hold the price to the end",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isAuto(f) ? null : "No auto line on this call."),
    standard:
      "\"We'll look at the price at the end and make adjustments if needed\" — coverage conversation first, number last.",
  },

  // 6. Coverage Review: Home
  {
    id: "home.review_all",
    section: "Coverage Review: Home",
    name: "Review all home coverages",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isHome(f) ? null : "No home line on this call."),
  },
  {
    id: "home.gaps",
    section: "Coverage Review: Home",
    name: "Identify coverage gaps",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isHome(f) ? null : "No home line on this call."),
  },
  {
    id: "home.savings",
    section: "Coverage Review: Home",
    name: "Present money-saving opportunities",
    units: 1,
    minStage: "quote_built",
    structuralNa: (f) => (isHome(f) ? null : "No home line on this call."),
  },

  // 7. Closing
  {
    id: "close.payment_mode",
    section: "Closing",
    name: "Confirm pay-in-full vs monthly before quoting price",
    units: 1,
    // Mike puts this question BEFORE the number, so it is gated at quote_built,
    // not at presented.
    minStage: "quote_built",
    standard:
      "\"Are you wanting to pay in full on these policies today, or are you wanting to pay monthly?\" — asked before any price, so two numbers are quoted instead of four.",
  },
  {
    id: "close.assumptive",
    section: "Closing",
    name: "Use the assumptive close",
    units: 1,
    minStage: "quote_built",
    standard:
      "Thanks them for the walkthrough, then moves straight to payment as a settled matter — no permission question.",
  },
  {
    id: "close.escrow",
    section: "Closing",
    name: "Correct escrow / no-escrow path",
    units: 1,
    minStage: "presented",
    structuralNa: (f) => (isHome(f) ? null : "No home line on this call."),
    standard:
      "Escrow: asks for the loan number and mortgage company. No escrow: quotes both premiums and asks for the card.",
  },
  {
    id: "close.payment_ask",
    section: "Closing",
    name: "Direct payment ask with autopay setup",
    units: 1,
    minStage: "presented",
    standard:
      "Asks for the card for the first payment AND for bank account and routing to secure the EZ-Pay discount.",
  },
  {
    id: "close.attempt",
    section: "Closing",
    name: "Attempt to close the sale",
    units: 1,
    minStage: "presented",
  },
  {
    id: "close.two_nos",
    section: "Closing",
    name: "Get at least two no's before ending",
    units: 1,
    minStage: "presented",
    structuralNa: (f) => {
      if (f.outcome === "bound") return "The customer bought — there was no no to work through.";
      if (f.stop_attribution === "callback_scheduled")
        return "A follow-up was scheduled rather than the call being lost.";
      return null;
    },
  },
  {
    id: "close.button_up",
    section: "Closing",
    name: "Button up the quote",
    units: 1,
    minStage: "presented",
    structuralNa: (f) =>
      f.outcome === "bound" ? "The customer bought — there is no open quote to chase." : null,
    standard:
      "Asks the customer to answer either way so the producer is not chasing a ghost.",
  },
  {
    id: "close.referrals",
    section: "Closing",
    name: "Ask for referrals",
    units: 1,
    minStage: "presented",
  },
  // Mike's checklist carries Life, Reviews and SPP as one box, so the three
  // split criteria are a third of a unit each rather than three full ones.
  {
    id: "close.life",
    section: "Closing",
    name: "Life insurance referral",
    units: 1 / 3,
    minStage: "presented",
    standard:
      "All three steps: uncover the gap (who covers you outside work, what happens if the job goes), bridge to the life advisor, and set a specific appointment offering two times.",
  },
  {
    id: "close.review",
    section: "Closing",
    name: "Google review ask",
    units: 1 / 3,
    minStage: "presented",
  },
  {
    id: "close.additional",
    section: "Closing",
    name: "Additional needs ask",
    units: 1 / 3,
    minStage: "presented",
  },
  {
    id: "close.over_ten_min",
    section: "Closing",
    name: "Keep the call over 10 minutes",
    units: 1,
    minStage: "contact",
    structuralNa: (f, m) => {
      if (!m.hasTimestamps) return "The transcript carries no timestamps, so length cannot be measured.";
      if (
        STAGE_RANK[f.furthest_stage] < STAGE_RANK.discovery &&
        CUSTOMER_STOPPED.includes(f.stop_attribution)
      ) {
        return "The customer ended the call at the intro.";
      }
      return null;
    },
    codeGrade: (_f, m) => (m.elapsedSeconds !== null && m.elapsedSeconds >= 600 ? "met" : "missed"),
  },

  // 8. Objection Handling Technique — pre-quote mechanics
  {
    id: "obj.no_permission",
    section: "Objection Handling Technique",
    name: "Never end an objection asking permission",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPreQuote(f) ? null : "No objection was raised before the quote."),
    standard:
      "No \"Fair?\", no \"Would you be opposed?\", no \"Can I?\" at the end of a handled objection.",
  },
  {
    id: "obj.assume_confirm",
    section: "Objection Handling Technique",
    name: "Assume the close and confirm two details",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPreQuote(f) ? null : "No objection was raised before the quote."),
    standard:
      "After handling, moves straight into confirming two discovery details — address, vehicle, drivers, household count.",
  },
  {
    id: "obj.rotate",
    section: "Objection Handling Technique",
    name: "Rotate the confirm pair",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => {
      if (!objectedPreQuote(f)) return "No objection was raised before the quote.";
      if (f.objections_raised !== "multiple")
        return "Only one objection — there is no second pair to rotate to.";
      return null;
    },
    standard: "The same two details are never confirmed twice in one call.",
  },
  {
    id: "obj.diagnose",
    section: "Objection Handling Technique",
    name: "Diagnose, don't defend",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (f.objection_phase === "none" ? "No objection was raised on this call." : null),
    standard: "Asks a control question to find the real concern instead of arguing the point.",
  },

  // 8. Objection Handling Technique — post-quote sequence
  {
    id: "obj.acknowledge",
    section: "Objection Handling Technique",
    name: "Acknowledge the objection",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPostQuote(f) ? null : "No objection was raised after the quote."),
    standard: "\"I completely understand\" — empathy before anything else.",
  },
  {
    id: "obj.verify",
    section: "Objection Handling Technique",
    name: "Verify the objection is not a smokescreen",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPostQuote(f) ? null : "No objection was raised after the quote."),
    standard:
      "\"Is there anything about this policy that is concerning you? Price, coverages?\" — before rebutting.",
  },
  {
    id: "obj.rebut",
    section: "Objection Handling Technique",
    name: "Deliver the rebuttal for the real objection",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPostQuote(f) ? null : "No objection was raised after the quote."),
  },
  {
    id: "obj.return_close",
    section: "Objection Handling Technique",
    name: "Return to the close after handling",
    units: 1,
    minStage: "no_contact",
    structuralNa: (f) => (objectedPostQuote(f) ? null : "No objection was raised after the quote."),
    standard: "Ends on the card ask — \"I'm ready when you are\" — not on a question.",
  },
];

export const RUBRIC_BY_ID: Record<string, CriterionSpec> = Object.fromEntries(
  RUBRIC.map((c) => [c.id, c]),
);

/* ------------------------------------------------------------------ *
 * Transcript measurement — facts derived in code, never asked of the model
 * ------------------------------------------------------------------ */

const STAMP = /^\[(\d{2}):(\d{2}):(\d{2})\]\s*/;
/** The transcript parser appends this so duration is the real end of the call. */
const END_MARKER = "--- end of call ---";
const SPEAKER = /^([^:]{1,40}):\s*/;
const MONEY = /\$\s?\d[\d,]*/;

interface Turn {
  seconds: number | null;
  speaker: string;
  words: number;
  offset: number;
}

/**
 * Reads the `[HH:MM:SS] Speaker: text` form `src/lib/transcript.ts` produces.
 * Everything here is a fact about the recording, so it belongs in code rather
 * than in a model that has been observed to invent durations.
 */
export function measureTranscript(
  transcript: string,
  producerLabel?: string,
): TranscriptMeasures {
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean);
  const turns: Turn[] = [];
  let offset = 0;

  for (const line of lines) {
    let rest = line;
    let seconds: number | null = null;

    const stamp = rest.match(STAMP);
    if (stamp) {
      seconds = Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]);
      rest = rest.slice(stamp[0].length);
    }

    if (rest.trim() === END_MARKER) {
      // Carries a timestamp but no speech: it must move the duration without
      // inflating the word count or the turn count.
      turns.push({ seconds, speaker: "", words: 0, offset: offset++ });
      continue;
    }

    let speaker = "";
    const who = rest.match(SPEAKER);
    if (who) {
      speaker = who[1].trim();
      rest = rest.slice(who[0].length);
    }

    turns.push({
      seconds,
      speaker,
      words: rest.split(/\s+/).filter(Boolean).length,
      offset: offset++,
    });
  }

  const stamped = turns.map((t) => t.seconds).filter((s): s is number => s !== null);
  const hasTimestamps = stamped.length >= 2;
  const elapsedSeconds = hasTimestamps
    ? Math.max(...stamped) - Math.min(...stamped)
    : null;

  const labels = new Set(turns.map((t) => t.speaker).filter(Boolean));
  const hasSpeakerLabels = labels.size >= 2;

  let producerTalkShare: number | null = null;
  if (hasSpeakerLabels) {
    const target = resolveProducerLabel(labels, producerLabel);
    if (target) {
      const total = turns.reduce((n, t) => n + t.words, 0);
      const mine = turns
        .filter((t) => t.speaker.toLowerCase() === target.toLowerCase())
        .reduce((n, t) => n + t.words, 0);
      if (total > 0) producerTalkShare = Math.round((mine / total) * 100);
    }
  }

  const moneyLate = hasMoneyLate(lines, turns, elapsedSeconds);

  return {
    elapsedSeconds,
    wordCount: turns.reduce((n, t) => n + t.words, 0),
    turnCount: turns.length,
    producerTalkShare,
    moneyLate,
    hasTimestamps,
    hasSpeakerLabels,
  };
}

/**
 * A dollar figure early in the call is the asset script's education — $25,000
 * limits, a $75,000 average claim — not a price. Only a late one is evidence
 * that a premium was actually presented, which is what raises the call's stage
 * to `presented` and puts the Closing section in scope.
 *
 * "Late" is measured against the clock where there is one, and against word
 * position otherwise. Line index is not a usable proxy: one monologue turn can
 * be longer than the rest of the call put together.
 */
function hasMoneyLate(lines: string[], turns: Turn[], elapsedSeconds: number | null): boolean {
  if (elapsedSeconds !== null && elapsedSeconds > 0) {
    const stamps = turns.map((t) => t.seconds).filter((x): x is number => x !== null);
    const cutoff = Math.min(...stamps) + elapsedSeconds * 0.6;
    let current: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (turns[i]?.seconds !== null) current = turns[i].seconds;
      if (current !== null && current >= cutoff && MONEY.test(lines[i])) return true;
    }
    return false;
  }

  const total = turns.reduce((n, t) => n + t.words, 0);
  if (total === 0) return false;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    seen += turns[i]?.words ?? 0;
    if (seen >= total * 0.6 && MONEY.test(lines[i])) return true;
  }
  return false;
}

function resolveProducerLabel(labels: Set<string>, hint?: string): string | null {
  const all = [...labels];
  if (hint) {
    const exact = all.find((l) => l.toLowerCase() === hint.toLowerCase());
    if (exact) return exact;
    const loose = all.find(
      (l) => l.toLowerCase().includes(hint.toLowerCase()) || hint.toLowerCase().includes(l.toLowerCase()),
    );
    if (loose) return loose;
  }
  return all.find((l) => /agent|producer|rep/i.test(l)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Applicability — which criteria this call is eligible for
 * ------------------------------------------------------------------ */

export type CriterionScope = "in_scope" | "not_applicable" | "not_reached";

export interface PlannedCriterion {
  id: string;
  section: SectionName;
  name: string;
  units: number;
  scope: CriterionScope;
  reason: string;
  standard?: string;
  codeStatus?: CriterionStatus;
}

export interface ScoringPlan {
  criteria: PlannedCriterion[];
  amnesty: boolean;
  effectiveStage: Stage;
  facts: CallFacts;
  measures: TranscriptMeasures;
}

const STAGE_LABEL: Record<Stage, string> = {
  no_contact: "no contact was made",
  contact: "the call did not get past the intro",
  discovery: "the call did not get past discovery",
  quote_built: "no quote was built",
  presented: "no price was presented",
  close_attempted: "no close was attempted",
  bound: "the sale was not bound",
};

/**
 * Raises the model's stage estimate to whatever the transcript can prove.
 * Upward only: correcting an understated stage makes grading stricter, and
 * there is no path here that forgives anything.
 */
export function applyStageFloor(facts: CallFacts, m: TranscriptMeasures): Stage {
  let floor = STAGE_RANK.no_contact;

  if (m.turnCount >= 2) floor = Math.max(floor, STAGE_RANK.contact);
  if (m.wordCount >= 250) floor = Math.max(floor, STAGE_RANK.discovery);
  if (facts.lines_quoted !== "none") floor = Math.max(floor, STAGE_RANK.quote_built);
  if (facts.lines_quoted !== "none" && (m.moneyLate || facts.price_stated)) {
    floor = Math.max(floor, STAGE_RANK.presented);
  }
  if (facts.outcome === "bound") floor = Math.max(floor, STAGE_RANK.bound);

  const rank = Math.max(STAGE_RANK[facts.furthest_stage] ?? 0, floor);
  return (Object.keys(STAGE_RANK) as Stage[]).find((s) => STAGE_RANK[s] === rank) ?? "no_contact";
}

/**
 * A customer who ends the call at the intro has, by definition, objected.
 * Without this the model can report `objection_phase: "none"` on a brush-off,
 * drop the whole 15-weight Objection Handling section, and hand the producer
 * who quit a far better score than they earned.
 */
function normalizeFacts(facts: CallFacts, stage: Stage): CallFacts {
  if (
    STAGE_RANK[stage] < STAGE_RANK.discovery &&
    facts.stop_attribution !== "customer_unavailable" &&
    facts.stop_attribution !== "completed" &&
    facts.objection_phase === "none"
  ) {
    return {
      ...facts,
      objection_phase: "pre_quote",
      objections_raised: facts.objections_raised === "none" ? "one" : facts.objections_raised,
    };
  }
  return facts;
}

export function applicabilityFor(rawFacts: CallFacts, measures: TranscriptMeasures): ScoringPlan {
  const effectiveStage = applyStageFloor(rawFacts, measures);
  const facts = normalizeFacts(rawFacts, effectiveStage);

  const criteria: PlannedCriterion[] = RUBRIC.map((spec) => {
    const base = {
      id: spec.id,
      section: spec.section,
      name: spec.name,
      units: spec.units,
      standard: spec.standard,
    };

    // Stage is evaluated FIRST. Without this ordering a call that never
    // quoted would mark Coverage Auto "line not quoted" — structural, and so
    // renormalized away for free — instead of "not reached", which is charged
    // when the producer is the one who stalled the call.
    if (STAGE_RANK[effectiveStage] < STAGE_RANK[spec.minStage]) {
      return {
        ...base,
        scope: "not_reached" as const,
        reason: `Not reached — ${STAGE_LABEL[spec.minStage]}.`,
      };
    }

    const structural = spec.structuralNa?.(facts, measures) ?? null;
    if (structural) {
      return { ...base, scope: "not_applicable" as const, reason: structural };
    }

    return {
      ...base,
      scope: "in_scope" as const,
      reason: "",
      codeStatus: spec.codeGrade?.(facts, measures),
    };
  });

  return {
    criteria,
    amnesty: CUSTOMER_STOPPED.includes(facts.stop_attribution),
    effectiveStage,
    facts,
    measures,
  };
}

/* ------------------------------------------------------------------ *
 * Assembly and arithmetic
 * ------------------------------------------------------------------ */

export type SectionState = "graded" | "not_applicable" | "not_reached" | "not_attempted";

export interface ScoredCriterion {
  id: string;
  name: string;
  status: CriterionStatus;
  scope: CriterionScope;
  /** Code-written explanation for an N/A, so a reviewer can audit it. */
  reason: string;
  evidence: string;
  timestamp: string;
  note: string;
  units: number;
  /** Set when a reviewer changed this verdict by hand. */
  overridden?: boolean;
  /** The verdict the model produced, kept alongside an override. */
  machineStatus?: CriterionStatus;
}

export interface ScoredSection {
  name: SectionName;
  criteria: ScoredCriterion[];
  score: number;
  maxScore: number;
  state: SectionState;
  stateReason: string;
  /** Weight this section contributed to the denominator. */
  weight: number;
  /** Weight charged at zero because the producer stalled the call. */
  forfeitedWeight: number;
}

export interface RawVerdict {
  id?: string;
  status?: string;
  evidence?: string;
  timestamp?: string;
  note?: string;
}

const POINTS: Record<CriterionStatus, number> = { met: 2, partial: 1, missed: 0, na: 0 };

/** Calibration lives here — moving a band is a one-line change. */
export const GRADE_BANDS: { min: number; band: string }[] = [
  { min: 90, band: "On System" },
  { min: 75, band: "Solid" },
  { min: 60, band: "Needs Work" },
  { min: 0, band: "Off Script" },
];

export function bandFor(score: number): string {
  return GRADE_BANDS.find((b) => score >= b.min)?.band ?? "Off Script";
}

function parseStatus(raw: unknown): CriterionStatus | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (key === "met" || key === "partial" || key === "missed" || key === "na") return key;
  return null;
}

/**
 * Builds the scorecard from the PLAN, merging the model's verdicts in by id.
 * Doing it this way rather than trusting the model's own section structure
 * removes a whole class of defects at once: a dropped criterion can no longer
 * shrink a section's denominator, an invented or duplicated section cannot
 * take a default weight, and section names cannot drift out of the weight map.
 */
export function assembleScorecard(
  plan: ScoringPlan,
  verdicts: RawVerdict[],
): { sections: ScoredSection[]; flags: string[] } {
  const byId = new Map<string, RawVerdict>();
  for (const v of verdicts) {
    if (v && typeof v.id === "string") byId.set(v.id, v);
  }

  const flags: string[] = [];
  const scored: ScoredCriterion[] = plan.criteria.map((planned) => {
    const shell = {
      id: planned.id,
      name: planned.name,
      scope: planned.scope,
      reason: planned.reason,
      units: planned.units,
    };

    if (planned.scope !== "in_scope") {
      return { ...shell, status: "na" as const, evidence: "", timestamp: "", note: "" };
    }

    if (planned.codeStatus) {
      return {
        ...shell,
        status: planned.codeStatus,
        evidence: "",
        timestamp: "",
        note: "Measured from the transcript.",
      };
    }

    const raw = byId.get(planned.id);
    const status = parseStatus(raw?.status);

    if (!raw || status === null) {
      // The criterion was in scope and the model did not grade it. Scoring it
      // as a miss is the only safe reading: the alternative is that omitting
      // criteria under output-budget pressure quietly raises the score.
      flags.push(`ungraded:${planned.id}`);
      return {
        ...shell,
        status: "missed" as const,
        evidence: "",
        timestamp: "",
        note: "The model did not return a verdict for this criterion.",
      };
    }

    if (status === "na") {
      // Code already established this criterion applies to this call, so an
      // N/A here would be the model renormalizing weight away on its own.
      flags.push(`na_demoted:${planned.id}`);
      return {
        ...shell,
        status: "missed" as const,
        evidence: raw.evidence ?? "",
        timestamp: raw.timestamp ?? "",
        note: "Marked not applicable by the model, but this call reached the stage where it applies.",
      };
    }

    return {
      ...shell,
      status,
      evidence: raw.evidence ?? "",
      timestamp: raw.timestamp ?? "",
      note: raw.note ?? "",
    };
  });

  const sections: ScoredSection[] = SECTION_ORDER.map((name) => ({
    name,
    criteria: scored.filter((c) => RUBRIC_BY_ID[c.id]?.section === name),
    score: 0,
    maxScore: 0,
    state: "graded" as SectionState,
    stateReason: "",
    weight: 0,
    forfeitedWeight: 0,
  }));

  return { sections, flags };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface RecomputeResult {
  overallScore: number | null;
  gradeBand: string;
  /** Weight that actually counted, out of 100. Shown to explain an adaptive score. */
  scoredWeight: number;
  flags: string[];
}

/**
 * Recomputes every number on the card from the criterion verdicts. The model's
 * own arithmetic is never used.
 *
 * Two kinds of exclusion, deliberately not sharing arithmetic:
 *
 *  - Structural N/A — line of business, direction, a bound outcome, no
 *    objection raised. Nothing the producer could have changed, so the weight
 *    renormalizes away.
 *  - Stage not reached — the call never got far enough. The weight
 *    renormalizes away when the CUSTOMER stopped the call, and is conserved
 *    and charged at zero when the producer did, or when it is unclear.
 *
 * That conditional is the whole adaptivity feature. Without it, marking things
 * N/A is strictly cheaper than missing them and a producer who never attempts
 * the close outscores one who attempts it and fails.
 */
export function recomputeScores(sections: ScoredSection[], amnesty: boolean): RecomputeResult {
  let totalWeight = 0;
  let earnedWeight = 0;
  const flags: string[] = [];

  for (const section of sections) {
    const base = sectionWeights[section.name];
    if (base === undefined) throw new Error(`Unknown rubric section: ${section.name}`);

    const units = (scope: CriterionScope) =>
      section.criteria.filter((c) => c.scope === scope).reduce((n, c) => n + c.units, 0);

    const applicable = units("in_scope");
    const notReached = units("not_reached");
    const denominator = applicable + notReached;

    let maxPoints = 0;
    let earnedPoints = 0;
    for (const c of section.criteria) {
      if (c.scope !== "in_scope") continue;
      maxPoints += c.units * 2;
      earnedPoints += c.units * POINTS[c.status];
    }

    section.score = round1(earnedPoints);
    section.maxScore = round1(maxPoints);

    const live = denominator > 0 ? (base * applicable) / denominator : 0;
    const forfeited = denominator > 0 ? (base * notReached) / denominator : 0;

    section.weight = round1(live);
    section.forfeitedWeight = round1(amnesty ? 0 : forfeited);

    if (applicable > 0) {
      section.state = "graded";
      section.stateReason = "";
    } else if (notReached > 0) {
      section.state = amnesty ? "not_reached" : "not_attempted";
      section.stateReason =
        section.criteria.find((c) => c.scope === "not_reached")?.reason ?? "Not reached.";
      if (!amnesty) {
        section.stateReason += " The producer ended the call, so this still counts against the score.";
      }
    } else {
      section.state = "not_applicable";
      section.stateReason =
        section.criteria.find((c) => c.scope === "not_applicable")?.reason ?? "Did not apply.";
    }

    totalWeight += live;
    earnedWeight += maxPoints > 0 ? (earnedPoints / maxPoints) * live : 0;
    if (!amnesty) totalWeight += forfeited;
  }

  if (totalWeight <= 0) {
    return { overallScore: null, gradeBand: "Not Scored", scoredWeight: 0, flags };
  }

  // Round before banding. Banding the unrounded value against a rounded
  // display puts an "89.6 -> 90" card next to a "Solid" pill.
  const score = Math.round((earnedWeight / totalWeight) * 100);

  const closeAttempt = sections
    .flatMap((s) => s.criteria)
    .find((c) => c.id === "close.attempt");
  const skippedLiveClose =
    closeAttempt?.scope === "in_scope" && closeAttempt.status === "missed";
  if (skippedLiveClose) flags.push("no_close_attempted");

  let band = bandFor(score);
  // A producer who reached the close and did not attempt it cannot be "On
  // System", whatever the rest of the call looked like.
  if (skippedLiveClose && band === "On System") band = "Solid";

  return { overallScore: score, gradeBand: band, scoredWeight: round1(totalWeight), flags };
}

/* ------------------------------------------------------------------ *
 * Post-hoc checks
 * ------------------------------------------------------------------ */

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * A quote the model calls verbatim should appear in the transcript. The two
 * are in the same request at the same moment and were never compared, so a
 * fabricated quote could back a full-credit verdict with nothing behind it.
 */
export function verifyEvidence(sections: ScoredSection[], transcript: string): string[] {
  const haystack = normalize(transcript);
  const flags: string[] = [];

  for (const section of sections) {
    for (const c of section.criteria) {
      if (c.scope !== "in_scope" || !c.evidence) continue;
      const needle = normalize(c.evidence);
      if (needle.length < 12) continue;
      if (!haystack.includes(needle)) {
        c.note = c.note
          ? `${c.note} (Evidence quote not found verbatim in the transcript.)`
          : "Evidence quote not found verbatim in the transcript.";
        flags.push(`unverified_evidence:${c.id}`);
      }
    }
  }
  return flags;
}

/**
 * Pass 1's outcome drives which criteria applied, and is then printed on the
 * card as if it were a finding. When it contradicts the grading below it, the
 * reviewer needs to see that rather than have to spot it.
 */
export function crossCheckContext(sections: ScoredSection[], facts: CallFacts): string[] {
  const flags: string[] = [];
  const all = sections.flatMap((s) => s.criteria);
  const at = (id: string) => all.find((c) => c.id === id);

  const attempt = at("close.attempt");
  if (facts.outcome === "bound" && attempt?.scope === "in_scope" && attempt.status === "missed") {
    flags.push("context_conflict:outcome says bound but no close was attempted");
  }

  if (facts.outcome === "no_quote") {
    const graded = all.filter(
      (c) => c.scope === "in_scope" && c.id.startsWith("auto.") && c.status !== "missed",
    );
    if (graded.length > 0) {
      flags.push("context_conflict:outcome says no quote but coverage review was graded");
    }
  }

  return flags;
}
