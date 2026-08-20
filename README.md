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
| `npm run lint` | `tsc --noEmit` |
| `npm run build` | `vite build` |

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

1. `POST /api/context` — establishes whether this is a sales call, its
   direction, lead type, lines quoted, and outcome. A non-sales call stops here
   and is refused rather than scored.
2. `POST /api/score` — grades every rubric criterion, then the server discards
   the model's own numbers and recomputes the score itself.

That recompute is the scoring: `met`=2, `partial`=1, `missed`=0, `na` excluded
from the denominator, section percentages combined through a fixed weights map,
and the grade band from the 90 / 75 / 60 thresholds. Changing how calls are
scored means editing that arithmetic in `lib/scoring.ts` — not the prompt.

Call history is kept in `localStorage`, so it is per-browser and not shared
across machines.

`CLAUDE.md` carries the fuller architecture notes, including the token-budget
and section-weight constraints that are easy to reintroduce by accident.
