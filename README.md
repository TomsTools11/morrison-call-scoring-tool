# Morrison Call Scoring

Scores insurance sales calls for Mike Morrison Insurance Agency against the
agency's "Filtered Quotes / RPM" rubric and returns a coaching scorecard:
per-criterion grades with verbatim evidence, two strengths, and the three
highest-value fixes for the next call.

Paste a transcript or upload one (`.txt`, `.md`, `.vtt`, `.srt`, `.json`).
Uploaded files are parsed in the browser — only the extracted text is sent, and
nothing is stored server-side.

## Stack

React 19 + Vite frontend, Vercel serverless functions, Gemini for grading.
Styling is the GOAL design system as plain CSS tokens.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # vercel dev — needs the Vercel CLI and `vercel link`
```

| Command | What it does |
|---|---|
| `npm run dev` | `vercel dev` — frontend plus the real API routes |
| `npm run lint` | typechecks the app, the server functions and the tests |
| `npm test` | the scoring core — pure, no API key, about a second |
| `npm run build` | `vite build`, behind the server typecheck |
| `npm run eval` | measures scoring variance and agreement (see below) |

`vite dev` alone will serve the UI but every `/api/*` call 404s, because the
API is Vercel functions rather than a standalone server.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes | Both Gemini passes — context detection and rubric grading |
| `APP_PASSCODE` | yes | The shared passcode gating the app and every API route |

Set both in the Vercel project's Environment Variables (Production, Preview and
Development), and locally in `.env.local`. `APP_PASSCODE` falls back to
`goal123` in development if unset — set it explicitly before deploying.

## Deploying

Vercel auto-detects the Vite framework preset. `vercel.json` sets the build
command, output directory, the SPA rewrite, and a 300-second `maxDuration` on
the two Gemini routes.

That duration matters: Gemini latency on the scoring pass is variable, measured
between 15 and 105 seconds on a three-minute transcript. If a deploy rejects
`maxDuration: 300`, the plan's ceiling is lower and the value must come down —
expect occasional timeouts on the slow tail if so.

## How scoring works

Two serverless functions, split so each Gemini call gets its own duration
budget:

1. `POST /api/context` — establishes what kind of call this is and, crucially,
   **how far it got**: the stage it reached, who ended it, whether a price was
   ever stated, and whether the customer objected. A call with nothing to grade
   stops here and is refused rather than scored.
2. `POST /api/score` — decides in code which criteria this call was eligible
   for, asks the model to grade only those, then discards the model's numbers
   and recomputes the score itself.

That recompute is the scoring: `met`=2, `partial`=1, `missed`=0, weighted per
criterion, section percentages combined through a fixed weights map, and the
grade band from the 90 / 75 / 60 thresholds. Changing how calls are scored
means editing the `RUBRIC` table and `sectionWeights` in `lib/rubric.ts` — not
the prompt.

### Scoring adapts to the call

A call that never warranted a closing attempt is not docked for not closing.
Criteria belonging to stages the call never reached drop out of the denominator
when the **customer** ended the call — and are charged at zero when the
**producer** did. Call length never forgives anything on its own; only the
stage reached does. That asymmetry is deliberate: without it, an agent who
hangs up at the first "no" would outscore one who works the objection and
loses.

Every N/A on a scorecard carries a written reason, and the header says how much
of the 100-point rubric actually counted.

### Measuring accuracy

`npm test` proves the applicability rules and the arithmetic — including the
case that an agent who tries and fails always outscores one who never tries.

There is no set of human-scored calls yet. When there is, it accumulates for
free: correcting a verdict on a scorecard recomputes the score live and records
the correction next to the machine's, and **Export reviewed calls** on the
history screen writes them out for `npm run eval -- --labels <file>`, which
reports per-criterion agreement, section error and a grade-band confusion
matrix. `npm run eval -- --transcript <file>` measures run-to-run variance
against the live API.

Call history is kept in `localStorage`, so it is per-browser and not shared
across machines. Transcripts are not stored — only the scorecard.

`CLAUDE.md` carries the fuller architecture notes, including the token-budget
and section-weight constraints that are easy to reintroduce by accident.
