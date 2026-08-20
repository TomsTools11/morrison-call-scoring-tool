# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **npm** (`package-lock.json` is the only lockfile). The repo
previously used bun; bun is not installed on the dev machine, and a stale
`bun.lock` would have broken Vercel builds after the dependency change.

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server | `npm run dev` — `vercel dev`, needs the Vercel CLI plus a one-time `vercel link` |
| Typecheck | `npm run lint` — this is `tsc --noEmit`, not ESLint |
| Build | `npm run build` — `vite build` |
| Preview build | `npm run preview` |

There are no tests and no test runner in this project. Verification is
typecheck, build, and driving the UI in a browser.

`vercel dev` is the only way to run the API routes locally, because they are
Vercel functions rather than an Express server. `vite dev` serves the frontend
alone and every `/api/*` call will 404.

Copy `.env.example` → `.env.local`. Required: `GEMINI_API_KEY` and
`APP_PASSCODE` (falls back to `goal123` in dev). That is the whole list — there
is no storage and no transcription service to configure.

`metadata.json` is left over from the Google AI Studio applet deployment. It is
inert on Vercel; delete it if that deployment path is retired.

## Architecture

Single-page React 19 frontend (`src/`, no router) talking to Vercel serverless
functions in `api/`. Auth is a shared passcode sent with every request
(`x-passcode` header) and checked by `lib/auth.ts`; `/api/verify-passcode` only
gates the UI.

### The pipeline

Input is always text: either a pasted transcript or an uploaded transcript file
that the browser parses locally. Nothing is uploaded or stored — only extracted
text is sent, in a JSON body.

1. `POST /api/context` — Gemini pass 1. If `is_sales_call` is false the pipeline
   stops here and refuses to score.
2. `POST /api/score` — Gemini pass 2, then the recompute.

The two passes are separate functions so each gets its own duration budget; one
request holding both would risk the function limit on a long transcript.

**Latency is high and variable.** Measured against a 3-minute sample call, the
scoring pass ran 15s, 16s, 26s, 49s and 105s across five identical requests —
model variance, not retries. `maxDuration` is set to 300 in `vercel.json` for
both Gemini routes to stay clear of that tail. If a deploy rejects 300, the
plan caps lower and the value has to come down; expect occasional timeouts if
it does.

**`maxOutputTokens` is a combined thinking + output budget** on this model, and
that is not obvious. At the original 8192, a long reasoning pass would consume
the budget and the JSON came back truncated on roughly one run in three. It is
now 32768 with an explicit `thinkingBudget` of 4096. The response schema also
omits every field `recomputeScores` derives (`overallScore`, `gradeBand`,
per-section `score`/`maxScore`) so no output budget is spent on discarded
values, and `sections` carries `minItems: "8"` so a shallow answer fails the
schema instead of silently under-grading the call.

Audio upload was removed along with AssemblyAI and Vercel Blob. `src/lib/transcript.ts`
replaced it: it reads `.txt`, `.md`, `.vtt`, `.srt` and `.json` in the browser and
normalizes them to the `[HH:MM:SS] Speaker: text` form the rubric prompt expects.
VTT/SRT keep their start timestamps and merge consecutive same-speaker cues, which
is what keeps the evidence timestamps in the scorecard populated. Adding a format
means adding a branch there and an entry in `ACCEPTED_EXTENSIONS`.

### Scoring

**The model's own numeric scores are discarded.** `recomputeScores` in
`lib/scoring.ts` recomputes everything: `met`=2, `partial`=1, `missed`=0, `na`
excluded from the denominator; section percentages are combined using the
hardcoded `sectionWeights` map; `gradeBand` comes from the 90/75/60 thresholds.
Changing how calls are scored means editing that arithmetic and the weights map
— not the prompt.

The rubric itself lives inline in the scoring prompt string in `lib/scoring.ts`.

The Gemini model is pinned to `gemini-3.6-flash` inside
`generateContentWithRetry` (`lib/gemini.ts`), which overwrites `config.model` on
every call — setting `model` at a call site has no effect. That helper retries
only 503/429/UNAVAILABLE with exponential backoff.

Output size is a real constraint: the scoring prompt instructs the model to keep
every string under 10 words because truncated JSON breaks the parse. See the
token-budget note under **The pipeline** for the limits that enforce this, and
`SCORING_ATTEMPTS` in `lib/scoring.ts` for the one retry that covers the
remaining non-deterministic truncations.

**Section names are canonicalized before the weight lookup.** The rubric lists
sections with qualifiers — "Coverage Review: Auto (Auto only)" — and the model
echoes the qualifier back in the name. That name misses `sectionWeights` and
silently takes the default weight of 10, so Coverage Review: Auto counted for 10
instead of 15 on every score the tool produced before this was caught.
`canonicalSectionName` strips the trailing parenthetical; leave it in place if
you touch the weights map or the rubric text.

### Frontend

`ScorecardResponse` in `src/types.ts` mirrors the `/api/score` response shape by
hand. Changing the server's response schema requires updating that interface,
and vice versa.

Styling is plain CSS: GOAL design-system tokens in `src/index.css` plus React
inline styles carrying literal design-system values. Tailwind and shadcn were
removed with the redesign — the GOAL design system is expressed in literal
values, so there was nothing for them to do. Hover and focus states that inline
styles cannot express live as `.goal-*` classes in `src/index.css`.

Call history is persisted to `localStorage` (`src/lib/history.ts`). It is
per-browser: two people scoring calls on different machines do not see each
other's runs. Moving to shared history means adding a real datastore.

Grade-band pills key off the bands the server emits — `On System`, `Solid`,
`Needs Work`, `Off Script` — matched case-insensitively in `src/lib/format.ts`.

The `@` path alias resolves to the **repo root**, not `src/` (in both
`tsconfig.json` and `vite.config.ts`). API routes under `api/` use relative
imports instead, because Vercel's function bundler traces relative paths rather
than tsconfig aliases.

**Relative imports in `api/` and `lib/` must carry an explicit `.js` extension.**
`package.json` sets `"type": "module"`, so Vercel ships those functions as ESM,
and Node's ESM loader will not resolve `../lib/auth` — only `../lib/auth.js`
(TypeScript maps the `.js` back to the `.ts` source). This bit once already: it
cannot reproduce under `vite dev` or `tsx`, which both resolve extensionless
specifiers, so it only appeared as `ERR_MODULE_NOT_FOUND` and a 500 in
production. `tsconfig.server.json` uses `nodenext` resolution to turn it into a
compile error, and `npm run build` runs that check before Vite so a bad import
fails the deploy instead of reaching production. Two tsconfigs exist for this
reason: the root one covers `src/` under bundler resolution, the server one
covers `api/` and `lib/`.

## Constraints

- Do not modify the `DISABLE_HMR` handling in `vite.config.ts` — file watching is
  intentionally disabled there to prevent flickering during agent edits.
- In any content this repo produces or displays, Mike Morrison is the only person
  who may be named. Refer to all other agency staff by role (e.g. "the
  producer"), not by name. Producer names typed in at runtime are user data and
  pass through untouched.
