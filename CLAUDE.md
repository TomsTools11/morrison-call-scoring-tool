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

| Test | `npm test` — `tsx --test tests/*.test.ts`, no API calls, ~1s |
| Eval | `npm run eval` — hits Gemini; see **Measuring accuracy** below |

`npm test` covers the scoring core: which criteria a given call shape is
eligible for, and the arithmetic over the verdicts. It is pure, so it runs
without a key and without a server. Anything touching the model, the API routes
or the UI is still verified by typecheck, build and a browser.

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

Pass 1 does more than classify the call. It also establishes `furthest_stage`,
`stop_attribution`, `objection_phase` and `price_stated`, which are what the
applicability layer gates on. Every field is an enum and every field is
required, so a partial answer fails loudly instead of silently defaulting a
gate that decides what gets graded.

**Latency is high and variable.** Measured against a 3-minute sample call, the
scoring pass ran 15s, 16s, 26s, 49s and 105s across five identical requests —
model variance, not retries. `maxDuration` is set to 300 in `vercel.json` for
both Gemini routes to stay clear of that tail. If a deploy rejects 300, the
plan caps lower and the value has to come down; expect occasional timeouts if
it does.

**Sampling is pinned to `temperature: 0` in `generateContentWithRetry`.** This
is a scoring tool; the same transcript has to produce the same score. At the
default temperature it did not, and two identical requests could land in
different grade bands with nothing to explain the difference to the producer.

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

Three things in that file change *scores*, not just display, because several
criteria are order-sensitive ("hold price to the end", "lead with liability"):

- **The seconds-vs-milliseconds unit is decided once per file**, by
  `numericDivisor`. Deciding it per row treated anything under 10,000 as
  seconds, so a millisecond export stamped its first ten seconds hours into the
  future and the timestamps ran backwards.
- **`normalizeTimestamp` ends with a `HH:MM:SS` format guard.** An absolute
  datetime also splits into three colon-separated parts, and passing it through
  broke the `[HH:MM:SS]` contract every measurement depends on.
- **`dropPhantomSpeakers` requires a speaker label to recur.** The inline
  speaker match otherwise fires on an ordinary mid-sentence colon — Mike's own
  "Just to confirm: is there anything…" became a speaker named "Just to
  confirm", splitting the producer's most script-perfect turns onto a phantom
  third party.

The merged transcript ends with an `[HH:MM:SS] --- end of call ---` marker, so
duration is the real end of the call rather than the start of the last turn.
`measureTranscript` in `lib/rubric.ts` reads it and skips its words.

**Duration, talk share and pace are computed, not asked of the model.** They
used to be free-text model output rendered as measured numbers.

### Scoring

The scoring core lives in **`lib/rubric.ts`**, and that file **imports
nothing**. The browser pulls it in through the `@` alias so a reviewer's
override recomputes the score locally, running exactly the function the API
route runs. Adding an import there — `@google/genai` above all — drags the
Gemini SDK into the client bundle.

`lib/scoring.ts` holds the prompts, the response schemas and the Gemini calls.
It imports `lib/rubric.ts`, never the reverse.

**`RUBRIC` is the single source of truth.** One row per criterion with a stable
id, its section, its weight in units, the minimum call stage it requires, and a
predicate for when it structurally does not apply. Every downstream count —
what the prompt asks for, what a section declares, what the arithmetic divides
by — is derived from that table. Changing how calls are graded means editing
`RUBRIC` and `sectionWeights`, not the prompt.

**The scorecard is built from the plan, not from the model's reply.** The model
returns a flat array of `{id, status, evidence}` and `assembleScorecard` merges
it into the canonical section structure by id. That removes a whole class of
defects at once: a dropped criterion can no longer shrink a section's
denominator, an invented or duplicated section cannot take a default weight,
and section names cannot drift out of the weight map. An in-scope criterion the
model omits scores as a miss; an in-scope criterion it marks `na` is demoted to
a miss and flagged. Both would otherwise raise the score.

**`red_flags` and `diagnostics` are different things.** `red_flags` are
findings about the *call* — a coverage misstatement, a close that was reached
and not attempted — and render in a red banner. `diagnostics` are what the
scoring pipeline noticed about its own run: a verdict that did not come back,
an N/A demoted, a quote that could not be verified, a timestamp dropped. They
render as muted "Scoring notes" under the card. Putting the second set in the
first banner made a dropped verdict look as alarming as a coverage
misstatement; keep them separate.

**The model's own numeric scores are discarded.** `recomputeScores` derives
everything: `met`=2, `partial`=1, `missed`=0, weighted by each criterion's
units; section percentages combined through `sectionWeights`; the band from
`GRADE_BANDS`, applied to the **rounded** score so the number and the pill
cannot disagree. A call with nothing gradeable returns `null` and
`"Not Scored"`, never `0` and `"Off Script"`.

#### Adaptivity — read this before touching `applicabilityFor` or `recomputeScores`

Scoring adapts to how far a call actually got, so a call that never warranted a
close is not docked for not closing. Three invariants make that safe rather
than exploitable, and breaking any one of them turns the feature into a way to
game the score:

1. **Scope is a function of facts about the CALL, never of a verdict about the
   producer.** Stage, line of business, direction, whether the customer
   objected, measured duration. Two producers on structurally identical calls
   face an identical in-scope set, so attempting can never score below not
   attempting.
2. **Call length never licenses an N/A.** There is deliberately no length term
   in the amnesty condition. Only *stage not reached* excuses anything, and
   only when the **customer** ended the call. Length feeds exactly one thing:
   Mike's own "keep call over 10 minutes" criterion, graded in code.
3. **Code may raise the detected stage, never lower it** (`applyStageFloor`).
   A model that under-reports how far a call got is corrected by the
   transcript; one that over-reports only makes grading stricter. Every failure
   direction is "too harsh", never "silently forgiven".

Two kinds of exclusion, which deliberately do not share arithmetic:

- **Structural N/A** — line of business, direction, a bound outcome, no
  objection raised. Nothing the producer could have changed, so the weight
  renormalizes away.
- **Stage not reached** — the weight renormalizes away when the customer
  stopped the call (`CUSTOMER_STOPPED`), and is **conserved and charged at
  zero** when the producer did, or when it is unclear.

Stage is evaluated **before** structural N/A. Without that ordering, a call
that never quoted would mark Coverage Auto "line not quoted" — structural, and
so free — instead of "not reached", which is charged when the producer stalled
the call. That ordering is worth 15 weight on every no-quote call.

`normalizeFacts` forces `objection_phase` to at least `pre_quote` on a call
that died at the intro. A customer who hangs up there has by definition
objected, and without this the model can report "no objections" on a brush-off,
drop the 15-weight Objection Handling section, and hand the producer who quit a
far better score than they earned.

`tests/rubric.test.ts` encodes all of this. The load-bearing case is
*"attempting the call and failing beats never attempting it"* — if that ever
goes red, the adaptivity is broken regardless of what else passes.

#### Timestamps on a miss

A `missed` verdict carries the moment the step **should** have happened:
`timestamp` is that moment and `evidence` is the short verbatim line that
opened the window — usually what the customer had just said. On a `met` or
`partial` verdict the same two fields mean the opposite thing: proof the
behavior happened. `ScorecardDetail` labels the quote block by status ("The
window was here" vs "Heard on the call") because the two read identically
otherwise, and a producer would take a missed-criterion quote as evidence that
something happened.

`verifyTimestamps` drops any stamp that is not `HH:MM:SS` or falls outside the
call's measured clock bounds. This matters more here than on a met verdict: the
model is being asked where something *should* have happened, with no quote
anchoring the answer, so a plausible invented time is the obvious failure mode
— and a reviewer who scrubs a recording to a time that does not exist stops
trusting every other timestamp on the card.

#### The rubric text

Roughly a third of the criteria name a behavior whose standard exists only in
Mike's documents — "follow the correct talk path", "rotate the confirm pair",
"never end an objection asking permission". The `SCRIPTS` block in
`lib/scoring.ts` carries that text into the prompt; without it the model grades
those criteria from generic sales knowledge instead of this agency's system.
The per-criterion `standard` field on a `RUBRIC` row does the same job at a
finer grain.

Two details there are easy to get wrong and were wrong before:

- **Asking for the customer's card is the correct close on this system**, not a
  red flag. The rubric previously flagged it, so every successful close earned
  a red flag.
- **"Start at 250/500" and "match coverage to assets" are sequential, not
  contradictory.** 250/500 is where the recommendation opens; raising it to
  asset value satisfies the criterion rather than violating it.

The Gemini model is pinned to `gemini-3.6-flash` inside
`generateContentWithRetry` (`lib/gemini.ts`), which overwrites `config.model`
on every call — setting `model` at a call site has no effect. That helper
retries only 503/429/UNAVAILABLE with exponential backoff.

### Measuring accuracy

There is no golden set yet. The harness is built so there can be one without
extra work: a reviewer correcting a verdict on the scorecard recomputes the
score live and stores the correction alongside the machine verdict, and
**Export reviewed calls** on the history screen writes them out in the shape
`npm run eval -- --labels` reads. The export carries the call facts and the
transcript measurements, so every scorecard in it can be re-scored offline
without another model call.

`npm run eval -- --transcript path [--runs 5]` measures run-to-run variance
against the live API. With `temperature: 0` the spread should be flat; anything
above a few points means the score is not reproducible and is worth chasing
before trusting any other number.

Calibrating the 90/75/60 thresholds against real calls is then: run the
labelled set, read the band confusion matrix, edit `GRADE_BANDS`.

### Frontend

`ScorecardResponse` in `src/types.ts` imports its section and criterion shapes
from `lib/rubric.ts` rather than re-declaring them, so the server's output and
the frontend's expectation cannot drift apart. The envelope around them — meta,
metrics, strengths, priorities — is still mirrored by hand against
`api/score.ts`.

Sections carry a `state` (`graded`, `not_applicable`, `not_reached`,
`not_attempted`) and a code-written `stateReason`, and criteria carry a
`reason` for every N/A. Those three non-graded states used to render
identically as a bare em-dash while meaning completely different things to the
person being coached, so keep them distinguishable in any UI change.

Styling is plain CSS: GOAL design-system tokens in `src/index.css` plus React
inline styles carrying literal design-system values. Tailwind and shadcn were
removed with the redesign — the GOAL design system is expressed in literal
values, so there was nothing for them to do. Hover and focus states that inline
styles cannot express live as `.goal-*` classes in `src/index.css`.

Call history is persisted to `localStorage` (`src/lib/history.ts`). It is
per-browser: two people scoring calls on different machines do not see each
other's runs. Moving to shared history means adding a real datastore.

**The transcript is stripped before storage.** It is by far the largest field —
a 40-minute call is ~50KB of text against ~4KB of verdicts — and it is what
pushed the store over quota. A quota failure discards the whole write, so the
scorecard the user had just produced would silently vanish from history; the
failure is now surfaced in the UI rather than logged to the console. The
transcript stays on the in-memory card and in the per-call JSON export.

Grade-band pills key off the bands the server emits — `On System`, `Solid`,
`Needs Work`, `Off Script`, plus `Not Scored` — matched case-insensitively in
`src/lib/format.ts`.

`ScorecardDetail` renders collapsed sections and evidence panels with the
`hidden` attribute rather than omitting them, so the print stylesheet can
reveal them. A printed scorecard previously dropped every clean section and
every evidence quote, which is most of the point of handing one to a producer.

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
