/**
 * The measurement side of the scoring tool.
 *
 * Two jobs, because there are two different questions about accuracy:
 *
 *   npm run eval -- --transcript path/to/call.txt [--runs 5]
 *     Scores the same transcript N times and reports the spread. With
 *     `temperature: 0` this should be flat; any drift is the number to watch.
 *
 *   npm run eval -- --labels path/to/labelled-set.json
 *     Compares the tool against human verdicts — the file the scorecard's
 *     "Export labelled set" button produces once Mike or his sales manager has
 *     reviewed some calls. Reports per-criterion agreement, adjacent
 *     agreement, section MAE and a grade-band confusion matrix.
 *
 * The variance job needs GEMINI_API_KEY. The agreement job is offline: the
 * export carries the call facts and the transcript measurements, so every
 * scorecard in it can be rebuilt without another model call.
 */
import { readFile } from "node:fs/promises";
import { createGeminiClient } from "../lib/gemini.js";
import { runContextPass, runScoringPass } from "../lib/scoring.js";
import {
  applicabilityFor,
  assembleScorecard,
  measureTranscript,
  recomputeScores,
  RUBRIC_BY_ID,
  SECTION_ORDER,
  type CallFacts,
  type CriterionStatus,
  type RawVerdict,
  type TranscriptMeasures,
} from "../lib/rubric.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const STATUS_RANK: Record<CriterionStatus, number> = { missed: 0, partial: 1, met: 2, na: -1 };

async function variance(path: string, runs: number) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for the variance run.");

  const transcript = await readFile(path, "utf8");
  const ai = createGeminiClient(apiKey);

  const scores: number[] = [];
  const perCriterion = new Map<string, CriterionStatus[]>();

  for (let run = 1; run <= runs; run++) {
    const facts = await runContextPass(ai, transcript);
    const measures = measureTranscript(transcript, facts.producer_speaker_label);
    const plan = applicabilityFor(facts, measures);
    const raw = await runScoringPass(ai, transcript, plan, "Eval");
    const { sections } = assembleScorecard(plan, raw.verdicts);
    const totals = recomputeScores(sections, plan.amnesty);

    scores.push(totals.overallScore ?? 0);
    for (const c of sections.flatMap((s) => s.criteria)) {
      if (!perCriterion.has(c.id)) perCriterion.set(c.id, []);
      perCriterion.get(c.id)!.push(c.status);
    }
    console.log(
      `run ${run}/${runs}: ${totals.overallScore ?? "not scored"} (${totals.gradeBand}), ` +
        `${totals.scoredWeight} of 100 weight scored`,
    );
  }

  const spread = Math.max(...scores) - Math.min(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`\nscores: ${scores.join(", ")}`);
  console.log(`mean ${mean.toFixed(1)} · spread ${spread} points`);

  const flipped = [...perCriterion.entries()].filter(
    ([, statuses]) => new Set(statuses).size > 1,
  );
  console.log(`\n${flipped.length} of ${perCriterion.size} criteria flipped across runs`);
  for (const [id, statuses] of flipped) {
    console.log(`  ${id.padEnd(24)} ${statuses.join(" ")}`);
  }
  if (spread > 3) {
    console.log("\nA spread above a few points means the score is not reproducible. Investigate.");
  }
}

interface LabelledEntry {
  id: string;
  producer?: string;
  facts?: CallFacts;
  measures?: TranscriptMeasures;
  machine: Record<string, CriterionStatus>;
  human: Record<string, CriterionStatus>;
}

function rescore(
  facts: CallFacts,
  measures: TranscriptMeasures,
  verdictMap: Record<string, CriterionStatus>,
) {
  const plan = applicabilityFor(facts, measures);
  const verdicts: RawVerdict[] = Object.entries(verdictMap).map(([id, status]) => ({ id, status }));
  const { sections } = assembleScorecard(plan, verdicts);
  return { sections, totals: recomputeScores(sections, plan.amnesty) };
}

async function agreement(path: string) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  const entries: LabelledEntry[] = payload.entries ?? [];
  if (entries.length === 0) {
    console.log("No reviewed scorecards in that export. Correct some verdicts first.");
    return;
  }

  let exact = 0;
  let adjacent = 0;
  let compared = 0;
  const byCriterion = new Map<string, { agree: number; total: number }>();
  const bands = new Map<string, number>();
  const sectionError = new Map<string, number[]>();

  for (const entry of entries) {
    // The human verdict set is the machine's, with the reviewer's corrections
    // laid over it — a reviewer only touches what they disagreed with.
    const human = { ...entry.machine, ...entry.human };

    for (const [id, machineStatus] of Object.entries(entry.machine)) {
      if (!RUBRIC_BY_ID[id]) continue;
      const humanStatus = human[id];
      compared++;
      const hit = machineStatus === humanStatus;
      if (hit) exact++;
      if (hit || Math.abs(STATUS_RANK[machineStatus] - STATUS_RANK[humanStatus]) === 1) adjacent++;

      const row = byCriterion.get(id) ?? { agree: 0, total: 0 };
      row.total++;
      if (hit) row.agree++;
      byCriterion.set(id, row);
    }

    if (!entry.facts || !entry.measures) continue;
    const m = rescore(entry.facts, entry.measures, entry.machine);
    const h = rescore(entry.facts, entry.measures, human);
    bands.set(
      `${m.totals.gradeBand} -> ${h.totals.gradeBand}`,
      (bands.get(`${m.totals.gradeBand} -> ${h.totals.gradeBand}`) ?? 0) + 1,
    );
    for (const name of SECTION_ORDER) {
      const ms = m.sections.find((s) => s.name === name)!;
      const hs = h.sections.find((s) => s.name === name)!;
      if (ms.maxScore === 0 || hs.maxScore === 0) continue;
      const delta = Math.abs(ms.score / ms.maxScore - hs.score / hs.maxScore) * 100;
      sectionError.set(name, [...(sectionError.get(name) ?? []), delta]);
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  console.log(`${entries.length} reviewed scorecards · ${compared} criterion verdicts compared\n`);
  console.log(`exact agreement    ${pct(exact, compared)}`);
  console.log(`within one grade   ${pct(adjacent, compared)}`);

  console.log("\nsection percentage MAE (machine vs reviewer):");
  for (const name of SECTION_ORDER) {
    const errs = sectionError.get(name);
    if (!errs?.length) continue;
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(`  ${name.padEnd(38)} ${mae.toFixed(1)} points (n=${errs.length})`);
  }

  console.log("\ngrade band, machine -> reviewer:");
  for (const [transition, n] of [...bands].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${transition.padEnd(34)} ${n}`);
  }

  const worst = [...byCriterion.entries()]
    .filter(([, r]) => r.total >= 2)
    .map(([id, r]) => ({ id, rate: r.agree / r.total, total: r.total }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 10);
  console.log("\nlowest-agreement criteria — these are the ones to reword or re-anchor:");
  for (const row of worst) {
    console.log(`  ${row.id.padEnd(24)} ${(row.rate * 100).toFixed(0)}% (n=${row.total})`);
  }
}

const transcriptPath = arg("transcript");
const labelsPath = arg("labels");

if (transcriptPath) {
  await variance(transcriptPath, Number(arg("runs") ?? 5));
} else if (labelsPath) {
  await agreement(labelsPath);
} else {
  console.log(
    [
      "Usage:",
      "  npm run eval -- --transcript path/to/call.txt [--runs 5]   measure run-to-run variance",
      "  npm run eval -- --labels path/to/labelled-set.json         measure agreement with reviewers",
    ].join("\n"),
  );
}
