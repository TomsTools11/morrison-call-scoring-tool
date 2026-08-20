# Morrison Call Scoring — Vercel rebuild + GOAL redesign

Date: 2026-08-20
Status: approved

## Goal

Replace the single Express process with Vercel serverless functions, and
replace the dark/gold UI with the GOAL design-system interface defined in
`Morrison Call Scoring - GOAL.dc.html` (Claude Design project
`362605ce-2aa6-4311-8dd2-6a3c5d9865cc`).

## Constraints that shaped the design

Vercel functions cap request bodies at 4.5 MB, so the existing multipart
upload of a 90-minute recording cannot reach an API route. Function
duration is also bounded, so a single request cannot hold transcription
and both Gemini passes.

The pipeline is therefore split into five short calls that the browser
drives, with the long-running work happening inside AssemblyAI rather
than inside a function.

## API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/verify-passcode` | POST | Gate the UI. |
| `/api/upload` | POST | Vercel Blob `handleUpload` route. Passcode checked in `onBeforeGenerateToken`. |
| `/api/transcribe` | POST | Mint a short-lived signed GET URL for the private blob, start the AssemblyAI job, return its id. |
| `/api/transcribe-status` | GET | Poll AssemblyAI. Deletes the blob once the job reaches a terminal state. |
| `/api/context` | POST | Gemini pass 1 — is this a sales call, direction, lead type, lines, outcome. |
| `/api/score` | POST | Gemini pass 2 — grade each criterion, then recompute scores server-side. |

Audio never passes through a function: the browser uploads straight to
Blob, and AssemblyAI pulls from a signed URL.

Known gap: the blob is deleted when a poll reaches a terminal status or
when the submit fails. If the browser dies mid-poll — tab closed, network
dropped — the recording is orphaned in Blob storage until someone removes
it. Closing that would need a scheduled sweep or an upload-completed
webhook.

## Scoring behaviour: unchanged

`lib/scoring.ts` and `lib/gemini.ts` carry the current behaviour over
verbatim — the `gemini-3.6-flash` pin inside `generateContentWithRetry`,
the 503/429 backoff, the rubric prompt, the `sectionWeights` map, the
met=2 / partial=1 / missed=0 / na-excluded arithmetic, and the 90/75/60
grade bands. Per CLAUDE.md this recompute *is* the scoring, so it is
ported rather than rewritten.

## Frontend

Five screens from the design: sign in, call history, score a new call,
analyzing, scorecard. Plain CSS with the GOAL tokens from
`colors_and_type.css`; Tailwind and shadcn are removed because the design
is expressed entirely in literal design-system values.

History is persisted to `localStorage` — per browser, not shared across
the team. This is a deliberate v1 limitation.

## Additions the design did not cover

The live API can return states the design has no treatment for. Each gets
a minimal on-brand treatment: a red-flags banner, the non-sales-call
refusal card, an empty call-history state, and inline form errors.

## Corrections applied

- The server emits grade bands `On System` / `Solid` / `Needs Work` /
  `Off Script`; the design's palette map keys were `On system` /
  `Off system`. Band styling keys off the server's values, matched
  case-insensitively.
- `metrics.talkShare` is a free-form model string, so the talk-share bar
  parses a leading percentage and falls back to plain text.
- The design hardcoded producer names in mock data and a placeholder.
  CLAUDE.md restricts names in repo content to Mike Morrison, so those
  became role-based. Runtime-entered names are user data and pass
  through untouched.

## Not ported

`support.js` and `_ds_bundle.js` are the Claude Design editor runtime,
not application code. Only `colors_and_type.css` tokens and the three
images come across.

## Verification

No test runner exists in this repo. Verification is `tsc --noEmit`,
`vite build`, and driving all five screens under `vercel dev`. The
Blob to AssemblyAI path cannot be exercised without live credentials.

---

## Amendment — 2026-08-20: audio upload removed

Audio upload was dropped in favour of transcript file upload. This
supersedes the upload / transcribe / transcribe-status routes described
above, along with the Blob orphaning gap — there is no longer anything to
orphan.

**Removed:** `api/upload.ts`, `api/transcribe.ts`,
`api/transcribe-status.ts`, the `@vercel/blob` and `assemblyai`
dependencies, and the `BLOB_READ_WRITE_TOKEN` / `ASSEMBLYAI_API_KEY`
environment variables. `date-fns` went too, having become unused during
the redesign.

**Added:** `src/lib/transcript.ts`. It reads `.txt`, `.md`, `.vtt`,
`.srt` and `.json` **in the browser** and normalizes them to
`[HH:MM:SS] Speaker: text`. VTT/SRT keep their start timestamps and merge
consecutive same-speaker cues; the JSON branch recognizes the shapes the
common transcript tools export. Guards: 3MB cap, extension allow-list,
and a control-character check for files that are text by extension but
binary in fact.

**Consequences.** Nothing is uploaded or stored server-side any more —
only extracted text is sent, so the PII-deletion concern that shaped the
original design no longer applies. The pipeline is two routes. Deploying
needs only `GEMINI_API_KEY` and `APP_PASSCODE`. The client bundle dropped
from 337KB to 241KB.

Transcripts without timestamps (a plain `.txt`) produce empty evidence
timestamps, which the scorecard already renders as "—".
