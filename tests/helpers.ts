import {
  applicabilityFor,
  assembleScorecard,
  measureTranscript,
  recomputeScores,
  RUBRIC,
  type CallFacts,
  type CriterionStatus,
  type RawVerdict,
} from "../lib/rubric.js";

export const baseFacts: CallFacts = {
  is_sales_call: true,
  direction: "outbound",
  lead_type: "internet",
  lines_quoted: "none",
  outcome: "no_quote",
  furthest_stage: "contact",
  stop_attribution: "customer_refused",
  objections_raised: "one",
  objection_phase: "pre_quote",
  price_stated: false,
  producer_speaker_label: "Agent",
};

export const facts = (overrides: Partial<CallFacts> = {}): CallFacts => ({
  ...baseFacts,
  ...overrides,
});

/** Grades every in-scope criterion the same way, so a test can isolate the arithmetic. */
export function gradeAll(transcript: string, f: CallFacts, status: CriterionStatus = "met") {
  const measures = measureTranscript(transcript, f.producer_speaker_label);
  const plan = applicabilityFor(f, measures);
  const verdicts: RawVerdict[] = plan.criteria
    .filter((c) => c.scope === "in_scope" && !c.codeStatus)
    .map((c) => ({ id: c.id, status, evidence: "", timestamp: "", note: "" }));
  return score(transcript, f, verdicts);
}

export function score(transcript: string, f: CallFacts, verdicts: RawVerdict[]) {
  const measures = measureTranscript(transcript, f.producer_speaker_label);
  const plan = applicabilityFor(f, measures);
  const { sections, flags } = assembleScorecard(plan, verdicts);
  const totals = recomputeScores(sections, plan.amnesty);
  return { plan, sections, flags, totals, measures };
}

export const scopeOf = (plan: { criteria: { id: string; scope: string }[] }, id: string) =>
  plan.criteria.find((c) => c.id === id)?.scope;

export const idsIn = (section: string) =>
  RUBRIC.filter((c) => c.section === section).map((c) => c.id);

/**
 * A 90-second outbound call: correct intro, one refusal, one sanctioned
 * rebuttal, the customer hangs up. The call every producer has ten of a day,
 * and the one the old scoring punished hardest.
 */
export const SHORT_REFUSAL = `[00:00:00] Agent: Hi, this is Blayton with Allstate. I'm following up on the home and auto quote you requested online. I've got your information pulled up. I just need to confirm I have the correct address at 123 Main Street?
[00:00:12] Customer: I'm not interested.
[00:00:15] Agent: Totally fair, I hear that all the time. Most people say it right up until they realize I can do one of two things for them: save them money, or catch a gap in their coverage that could cost them hundreds of thousands out of pocket on a claim. Good news is I've already got most of your info pulled up, I just need to confirm a couple things to finish the quote. You're still in the Accord?
[00:00:38] Customer: No, really, I'm all set. Please take me off your list.
[00:00:44] Agent: Understood, I appreciate your time. Have a good one.
[00:01:31] --- end of call ---`;

/** Long enough to clear the 250-word discovery floor, with a price late in the call. */
export const FULL_CALL = [
  "[00:00:00] Agent: Hi, this is Blayton with Allstate, following up on the home and auto quote you requested online.",
  `[00:00:20] Customer: ${"Sure, that works for me and I have some time to go through it right now. ".repeat(12)}`,
  `[00:02:00] Agent: ${"Let me walk you through the liability coverage and what it actually pays. ".repeat(20)}`,
  "[00:14:00] Agent: The home price is going to be $1,240 and the auto premium is going to be $186 a month.",
  "[00:15:20] Customer: Let me think about it.",
  "[00:16:00] Agent: I completely understand. All I need is your debit or credit card and I'm ready when you are.",
  "[00:18:40] --- end of call ---",
].join("\n");
