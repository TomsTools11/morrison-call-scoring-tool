import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicabilityFor,
  applyStageFloor,
  bandFor,
  measureTranscript,
  RUBRIC,
  sectionWeights,
  SECTION_ORDER,
  verifyTimestamps,
} from "../lib/rubric.js";
import { facts, FULL_CALL, gradeAll, idsIn, score, scopeOf, SHORT_REFUSAL } from "./helpers.js";

test("the rubric table is internally consistent", () => {
  const ids = RUBRIC.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "criterion ids must be unique");
  for (const c of RUBRIC) {
    assert.ok(SECTION_ORDER.includes(c.section), `${c.id} names an unknown section`);
    assert.ok(c.units > 0, `${c.id} has no weight`);
  }
  const total = Object.values(sectionWeights).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
  for (const section of SECTION_ORDER) {
    assert.ok(idsIn(section).length > 0, `${section} has no criteria`);
  }
});

/* ------------------------------------------------------------------ *
 * The headline behaviour: adapt to the call, without rewarding a quitter
 * ------------------------------------------------------------------ */

test("a short call the customer ended is not docked for stages it never reached", () => {
  const { totals, sections } = gradeAll(SHORT_REFUSAL, facts(), "met");

  assert.equal(totals.gradeBand, "On System");
  assert.equal(totals.overallScore, 100);
  assert.ok(
    totals.scoredWeight < 50,
    `only the reachable sections should count, got ${totals.scoredWeight}`,
  );

  const closing = sections.find((s) => s.name === "Closing")!;
  assert.equal(closing.state, "not_reached");
  assert.equal(closing.weight, 0);
  assert.equal(closing.forfeitedWeight, 0, "an amnestied section is not charged");
});

test("the same call, ended by the producer, is charged the full rubric", () => {
  const customerEnded = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "customer_refused" }), "met");
  const producerQuit = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "producer_ended" }), "met");

  assert.equal(producerQuit.totals.scoredWeight, 100, "no weight is forgiven when the producer quits");
  assert.ok(
    producerQuit.totals.overallScore! < customerEnded.totals.overallScore!,
    "quitting must never score better than being refused",
  );

  // "Keep the call over 10 minutes" is still live — the producer ended a
  // 90-second call, so it is a real miss — but the nine quote-dependent
  // criteria are charged at zero rather than forgiven.
  const closing = producerQuit.sections.find((s) => s.name === "Closing")!;
  assert.equal(closing.weight + closing.forfeitedWeight, 20);
  assert.ok(closing.forfeitedWeight > 15);
});

test("attempting the call and failing beats never attempting it", () => {
  // The gaming case the whole design exists to prevent: an agent who hangs up
  // at the first "no" must not outscore one who works the objection and loses.
  const tried = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "customer_refused" }), "met");
  const quit = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "producer_ended" }), "missed");

  assert.ok(
    quit.totals.overallScore! < tried.totals.overallScore!,
    `quitting scored ${quit.totals.overallScore}, trying scored ${tried.totals.overallScore}`,
  );
  assert.equal(quit.totals.gradeBand, "Off Script");
});

test("call length alone never forgives anything", () => {
  // Identical short transcripts. The only difference is who ended the call.
  const short = measureTranscript(SHORT_REFUSAL);
  assert.ok(short.elapsedSeconds !== null && short.elapsedSeconds < 120);

  const forgiven = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "customer_refused" }), "met");
  const charged = gradeAll(SHORT_REFUSAL, facts({ stop_attribution: "unclear" }), "met");

  assert.ok(forgiven.totals.scoredWeight < charged.totals.scoredWeight);
  assert.equal(charged.totals.scoredWeight, 100);
});

test("reaching the close and not attempting it caps the band and raises a flag", () => {
  const { plan, totals, sections } = score(
    FULL_CALL,
    facts({
      lines_quoted: "bundle",
      outcome: "quoted_not_closed",
      furthest_stage: "presented",
      price_stated: true,
      stop_attribution: "completed",
      objection_phase: "post_quote",
    }),
    [],
  );

  assert.equal(scopeOf(plan, "close.attempt"), "in_scope");
  const attempt = sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!;
  assert.equal(attempt.status, "missed");
  assert.ok(totals.flags.includes("no_close_attempted"));
  assert.notEqual(totals.gradeBand, "On System");
});

/* ------------------------------------------------------------------ *
 * Applicability rules, one call shape at a time
 * ------------------------------------------------------------------ */

test("a home-only call is not graded on auto coverage", () => {
  const { plan } = score(FULL_CALL, facts({ lines_quoted: "home", furthest_stage: "presented", price_stated: true }), []);
  for (const id of idsIn("Coverage Review: Auto")) {
    assert.equal(scopeOf(plan, id), "not_applicable", `${id} should not apply`);
  }
  assert.equal(scopeOf(plan, "home.review_all"), "in_scope");
  assert.equal(scopeOf(plan, "info.salvage"), "not_applicable");
});

test("an auto-only call is not graded on home coverage or the escrow path", () => {
  const { plan } = score(FULL_CALL, facts({ lines_quoted: "auto", furthest_stage: "presented", price_stated: true }), []);
  for (const id of idsIn("Coverage Review: Home")) {
    assert.equal(scopeOf(plan, id), "not_applicable");
  }
  assert.equal(scopeOf(plan, "close.escrow"), "not_applicable");
  assert.equal(scopeOf(plan, "auto.liability_first"), "in_scope");
});

test("an inbound call is not graded on the outbound intro scripts", () => {
  const { plan } = score(FULL_CALL, facts({ direction: "inbound", lead_type: "inbound_call" }), []);
  assert.equal(scopeOf(plan, "open.talkpath"), "not_applicable");
  assert.equal(scopeOf(plan, "open.overcome"), "not_applicable");
  assert.equal(scopeOf(plan, "open.greeting"), "in_scope");
});

test("a bound call is not asked for two no's or a buttoned-up quote", () => {
  const { plan } = score(
    FULL_CALL,
    facts({ lines_quoted: "bundle", outcome: "bound", furthest_stage: "bound", price_stated: true }),
    [],
  );
  assert.equal(scopeOf(plan, "close.two_nos"), "not_applicable");
  assert.equal(scopeOf(plan, "close.button_up"), "not_applicable");
  assert.equal(scopeOf(plan, "close.attempt"), "in_scope");
});

test("objection handling is graded by phase, and rotation needs more than one objection", () => {
  const pre = score(FULL_CALL, facts({ objection_phase: "pre_quote", objections_raised: "one" }), []).plan;
  assert.equal(scopeOf(pre, "obj.assume_confirm"), "in_scope");
  assert.equal(scopeOf(pre, "obj.rotate"), "not_applicable");
  assert.equal(scopeOf(pre, "obj.acknowledge"), "not_applicable");

  const post = score(
    FULL_CALL,
    facts({ objection_phase: "post_quote", furthest_stage: "presented", price_stated: true, lines_quoted: "bundle" }),
    [],
  ).plan;
  assert.equal(scopeOf(post, "obj.acknowledge"), "in_scope");
  assert.equal(scopeOf(post, "obj.verify"), "in_scope");
  assert.equal(scopeOf(post, "obj.assume_confirm"), "not_applicable");

  const multi = score(FULL_CALL, facts({ objection_phase: "both", objections_raised: "multiple" }), []).plan;
  assert.equal(scopeOf(multi, "obj.rotate"), "in_scope");
});

test("a call with no objections is not graded on objection handling at all", () => {
  const { plan, sections } = score(
    FULL_CALL,
    facts({
      objection_phase: "none",
      objections_raised: "none",
      outcome: "bound",
      furthest_stage: "bound",
      lines_quoted: "bundle",
      price_stated: true,
      stop_attribution: "completed",
    }),
    [],
  );
  for (const id of idsIn("Objection Handling Technique")) {
    assert.equal(scopeOf(plan, id), "not_applicable");
  }
  const section = sections.find((s) => s.name === "Objection Handling Technique")!;
  assert.equal(section.state, "not_applicable");
  assert.equal(section.weight, 0);
  assert.equal(section.forfeitedWeight, 0);
});

test("a customer who hangs up at the intro is treated as having objected", () => {
  // Otherwise the model can report "no objections" on a brush-off, drop the
  // 15-weight section, and hand the producer who quit a far better score.
  const { plan } = score(
    SHORT_REFUSAL,
    facts({ objection_phase: "none", objections_raised: "none", stop_attribution: "producer_ended" }),
    [],
  );
  assert.equal(plan.facts.objection_phase, "pre_quote");
  assert.equal(scopeOf(plan, "obj.no_permission"), "in_scope");
});

/* ------------------------------------------------------------------ *
 * Stage floor
 * ------------------------------------------------------------------ */

test("the stage floor only ever raises the model's estimate", () => {
  const measures = measureTranscript(FULL_CALL);
  const understated = applyStageFloor(
    facts({ furthest_stage: "contact", lines_quoted: "bundle", price_stated: true }),
    measures,
  );
  assert.equal(understated, "presented", "the transcript proves a price was presented");

  const overstated = applyStageFloor(facts({ furthest_stage: "bound", lines_quoted: "none" }), measures);
  assert.equal(overstated, "bound", "code must not walk a stage back down");
});

test("early dollar amounts are education, not a price presentation", () => {
  // The asset script quotes $25,000 limits and a $75,000 average claim as
  // teaching material. Only a late figure is evidence of a premium.
  const educationOnly = [
    "[00:00:00] Agent: Right now you're sitting at $25,000 per person in bodily injury liability.",
    ...Array.from({ length: 12 }, (_, i) => `[00:0${i}:30] Customer: Okay, that makes sense to me now.`),
  ].join("\n");
  assert.equal(measureTranscript(educationOnly).moneyLate, false);
  assert.equal(measureTranscript(FULL_CALL).moneyLate, true);
});

/* ------------------------------------------------------------------ *
 * Verdict handling — the ways a model response used to inflate a score
 * ------------------------------------------------------------------ */

const presentedBundle = facts({
  lines_quoted: "bundle",
  outcome: "quoted_not_closed",
  furthest_stage: "presented",
  price_stated: true,
  stop_attribution: "completed",
});

test("an omitted verdict scores as a miss instead of shrinking the denominator", () => {
  const { sections, flags } = score(FULL_CALL, presentedBundle, [
    { id: "close.attempt", status: "met" },
  ]);
  const closing = sections.find((s) => s.name === "Closing")!;
  assert.ok(closing.criteria.length > 1, "every rubric criterion is present regardless of the response");
  assert.ok(flags.some((f) => f.startsWith("ungraded:")));
  assert.ok(closing.score < closing.maxScore);
});

test("an unrecognised status is a miss, not a silent exclusion", () => {
  const { sections, flags } = score(FULL_CALL, presentedBundle, [
    { id: "close.attempt", status: "Met (2)" },
  ]);
  const attempt = sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!;
  assert.equal(attempt.status, "missed");
  assert.ok(flags.includes("ungraded:close.attempt"));
});

test("an in-scope criterion the model marks N/A is demoted to a miss", () => {
  const { sections, flags } = score(FULL_CALL, presentedBundle, [
    { id: "close.attempt", status: "na" },
  ]);
  const attempt = sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!;
  assert.equal(attempt.status, "missed");
  assert.ok(flags.includes("na_demoted:close.attempt"));
});

test("a duplicated or invented section cannot take a weight", () => {
  const { sections } = score(FULL_CALL, presentedBundle, [
    { id: "not.a.real.criterion", status: "met" },
    { id: "close.attempt", status: "met" },
  ]);
  assert.deepEqual(
    sections.map((s) => s.name),
    [...SECTION_ORDER],
  );
});

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

test("a call with nothing gradeable is reported as not scored, never as zero", () => {
  const { totals } = score(
    "[00:00:00] Agent: Hi, this is Blayton with Allstate calling about your quote request.",
    facts({
      furthest_stage: "no_contact",
      objection_phase: "none",
      objections_raised: "none",
      stop_attribution: "customer_unavailable",
    }),
    [],
  );
  assert.equal(totals.overallScore, null);
  assert.equal(totals.gradeBand, "Not Scored");
});

test("the grade band is derived from the rounded score the card shows", () => {
  assert.equal(bandFor(90), "On System");
  assert.equal(bandFor(89), "Solid");
  assert.equal(bandFor(75), "Solid");
  assert.equal(bandFor(59), "Off Script");
});

test("the ten-minute criterion is measured, not asked of the model", () => {
  const long = applicabilityFor(
    { ...presentedBundle },
    measureTranscript(FULL_CALL),
  ).criteria.find((c) => c.id === "close.over_ten_min")!;
  assert.equal(long.codeStatus, "met");

  const short = applicabilityFor(
    { ...presentedBundle },
    measureTranscript(SHORT_REFUSAL),
  ).criteria.find((c) => c.id === "close.over_ten_min")!;
  assert.equal(short.codeStatus, "missed");

  const unstamped = applicabilityFor(
    { ...presentedBundle },
    measureTranscript("Agent: hello there\nCustomer: hi"),
  ).criteria.find((c) => c.id === "close.over_ten_min")!;
  assert.equal(unstamped.scope, "not_applicable");
});

/* ------------------------------------------------------------------ *
 * Timestamps on a miss — where the step should have happened
 * ------------------------------------------------------------------ */

test("a missed criterion keeps the moment the window was open", () => {
  const { sections } = score(FULL_CALL, presentedBundle, [
    {
      id: "close.attempt",
      status: "missed",
      timestamp: "00:15:20",
      evidence: "Let me think about it.",
      note: "The close should have followed here.",
    },
  ]);
  const attempt = sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!;
  assert.equal(attempt.status, "missed");
  assert.equal(attempt.timestamp, "00:15:20");
  assert.equal(attempt.evidence, "Let me think about it.");
});

test("a timestamp outside the call is dropped rather than shown", () => {
  // The model is being asked where something SHOULD have happened, with no
  // quote anchoring the answer — an invented but plausible time is the obvious
  // failure mode, and a reviewer who scrubs to it loses trust in all of them.
  const measures = measureTranscript(FULL_CALL);
  const { sections } = score(FULL_CALL, presentedBundle, [
    { id: "close.attempt", status: "missed", timestamp: "01:47:00" },
    { id: "close.referrals", status: "missed", timestamp: "not a time" },
    { id: "close.payment_ask", status: "missed", timestamp: "00:15:20" },
  ]);
  const at = (id: string) => sections.flatMap((s) => s.criteria).find((c) => c.id === id)!;

  const diagnostics = verifyTimestamps(sections, measures);
  assert.equal(at("close.attempt").timestamp, "", "beyond the end of the call");
  assert.equal(at("close.referrals").timestamp, "", "not a clock at all");
  assert.equal(at("close.payment_ask").timestamp, "00:15:20", "a real moment survives");
  assert.ok(diagnostics.includes("invalid_timestamp:close.attempt"));
  assert.ok(diagnostics.includes("invalid_timestamp:close.referrals"));
});

test("every timestamp is dropped when the transcript has no clock", () => {
  const plain = "Agent: Hello there.\nCustomer: Hi.";
  const { sections } = score(plain, presentedBundle, [
    { id: "close.attempt", status: "missed", timestamp: "00:04:00" },
  ]);
  verifyTimestamps(sections, measureTranscript(plain));
  const attempt = sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!;
  assert.equal(attempt.timestamp, "");
});

test("the call's clock bounds are measured, not assumed to start at zero", () => {
  const late = ["[00:10:00] Agent: Hello.", "[00:12:30] Customer: Hi."].join("\n");
  const m = measureTranscript(late);
  assert.equal(m.firstStampSeconds, 600);
  assert.equal(m.lastStampSeconds, 750);
  assert.equal(m.elapsedSeconds, 150);

  // A stamp before the call started is as invalid as one after it ends.
  const { sections } = score(late, presentedBundle, [
    { id: "close.attempt", status: "missed", timestamp: "00:02:00" },
  ]);
  verifyTimestamps(sections, m);
  assert.equal(sections.flatMap((s) => s.criteria).find((c) => c.id === "close.attempt")!.timestamp, "");
});
