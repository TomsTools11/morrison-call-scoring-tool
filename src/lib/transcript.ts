/**
 * Turns an uploaded transcript file into the plain-text form the rubric prompt
 * expects. Everything happens in the browser — only the extracted text is ever
 * sent to the server, so call transcripts are never stored anywhere.
 */

export const ACCEPTED_EXTENSIONS = [
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".vtt",
  ".srt",
  ".json",
];

/** Comfortably past a 90-minute call (~100KB) while staying under the 4.5MB body cap. */
const MAX_TEXT_BYTES = 3 * 1024 * 1024;

export class TranscriptFileError extends Error {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function secondsToStamp(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Seconds (or a HH:MM:SS.mmm string) to a padded HH:MM:SS stamp.
 *
 * `divisor` converts a numeric offset to seconds and is decided once for the
 * whole file by `numericDivisor` — deciding it per row, as this used to, meant
 * a millisecond export stamped everything under ten seconds as *seconds*, so
 * the first minute of a call landed hours into the future and the stamps ran
 * backwards. Several criteria are order-sensitive, so that misgraded calls.
 */
function normalizeTimestamp(value: string | number | undefined, divisor = 1): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    return secondsToStamp(value / divisor);
  }

  const text = String(value).trim().replace(",", ".");
  const clock = text.split(".")[0];
  const parts = clock.split(":");
  // An absolute datetime ("2026-08-31T14:03:22Z") also splits into three
  // parts, and passing it through breaks the [HH:MM:SS] contract the rubric
  // prompt and every duration measurement depend on.
  const stamp =
    parts.length === 3
      ? parts.map((p) => p.padStart(2, "0")).join(":")
      : parts.length === 2
        ? `00:${parts.map((p) => p.padStart(2, "0")).join(":")}`
        : "";
  return /^\d{2}:\d{2}:\d{2}$/.test(stamp) ? stamp : "";
}

/**
 * Transcript JSON stores offsets in seconds or milliseconds with nothing to
 * say which. Decide once per file from the largest value: a call whose last
 * cue is past 10,000 is not 2.7 hours long, it is in milliseconds.
 */
function numericDivisor(values: unknown[]): number {
  const numbers = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numbers.length === 0) return 1;
  return Math.max(...numbers) > 10000 ? 1000 : 1;
}

interface Cue {
  timestamp: string;
  /** Kept so the rendered transcript can carry a true end-of-call stamp. */
  end?: string;
  speaker: string;
  text: string;
}

/** Appended so call duration is the real end, not the start of the last turn. */
export const END_MARKER = "--- end of call ---";

/** Consecutive cues from the same speaker read as one turn, and cost far fewer tokens. */
function renderCues(cues: Cue[]): string {
  const named = dropPhantomSpeakers(cues);
  const merged: Cue[] = [];
  for (const cue of named) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker && previous.speaker === cue.speaker) {
      previous.text = `${previous.text} ${cue.text}`.trim();
      // Merging keeps the first stamp, so without this the turn's end time is
      // lost and a long monologue drags the measured duration backwards.
      if (cue.end) previous.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }

  const lines = merged.map((cue) => {
    const stamp = cue.timestamp ? `[${cue.timestamp}] ` : "";
    const who = cue.speaker ? `${cue.speaker}: ` : "";
    return `${stamp}${who}${cue.text}`.trim();
  });

  const finalEnd = [...merged].reverse().find((c) => c.end)?.end;
  if (finalEnd) lines.push(`[${finalEnd}] ${END_MARKER}`);

  return lines.join("\n");
}

/**
 * The inline speaker match below is greedy enough to fire on an ordinary
 * mid-sentence colon — "Just to confirm: is there anything…" becomes a speaker
 * named "Just to confirm". That splits the producer's most script-perfect
 * turns onto a phantom third party, which is exactly where role attribution
 * and talk share matter most. A real label recurs; a clause does not.
 */
function dropPhantomSpeakers(cues: Cue[]): Cue[] {
  const counts = new Map<string, number>();
  for (const cue of cues) {
    if (cue.speaker) counts.set(cue.speaker, (counts.get(cue.speaker) ?? 0) + 1);
  }
  return cues.map((cue) =>
    cue.speaker && (counts.get(cue.speaker) ?? 0) < 2
      ? { ...cue, speaker: "", text: `${cue.speaker}: ${cue.text}` }
      : cue,
  );
}

/**
 * WebVTT and SubRip share a shape: an optional cue id, a `start --> end` line,
 * then the caption text. Only the start time is worth keeping.
 */
function parseCueFormat(raw: string): string {
  const blocks = raw.replace(/\r/g, "").split(/\n\s*\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const timing = lines[timingIndex].split("-->");
    const timestamp = normalizeTimestamp(timing[0].trim());
    const end = normalizeTimestamp((timing[1] ?? "").trim().split(/\s+/)[0]);
    const body = lines.slice(timingIndex + 1).join(" ").trim();
    if (!body) continue;

    // WebVTT voice spans carry the speaker: <v Agent>text</v>
    let speaker = "";
    let text = body;
    const voice = text.match(/<v(?:\.[^\s>]+)*\s+([^>]+)>/i);
    if (voice) {
      speaker = voice[1].trim();
      text = text.replace(voice[0], "");
    }
    text = text.replace(/<\/?[^>]+>/g, "").trim();

    // Otherwise many exports prefix the line with the speaker themselves.
    if (!speaker) {
      const inline = text.match(INLINE_SPEAKER);
      if (inline) {
        speaker = inline[1].trim();
        text = inline[2].trim();
      }
    }

    if (text) cues.push({ timestamp, end, speaker, text });
  }

  if (cues.length === 0) {
    throw new TranscriptFileError("No caption lines found in that file.");
  }
  return renderCues(cues);
}

const SPEAKER_KEYS = ["speaker", "speaker_label", "speakerName", "speaker_name", "name", "role"];
const TEXT_KEYS = ["text", "content", "transcript", "utterance", "value", "message"];
const START_KEYS = ["start", "start_time", "startTime", "timestamp", "offset", "time", "begin"];
const END_KEYS = ["end", "end_time", "endTime", "stop", "finish"];

/**
 * A speaker label is a name, not a clause: at most three words and no trailing
 * punctuation.
 */
const INLINE_SPEAKER = /^([A-Za-z][\w.'-]*(?: [\w.'-]+){0,2}):\s+(.*)$/;

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function rowsToCues(rows: unknown[]): Cue[] | null {
  const objects = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const divisor = numericDivisor([
    ...objects.map((r) => pick(r, START_KEYS)),
    ...objects.map((r) => pick(r, END_KEYS)),
  ]);

  const cues: Cue[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      if (row.trim()) cues.push({ timestamp: "", speaker: "", text: row.trim() });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const text = pick(record, TEXT_KEYS);
    if (typeof text !== "string" || !text.trim()) continue;
    const speaker = pick(record, SPEAKER_KEYS);
    cues.push({
      timestamp: normalizeTimestamp(
        pick(record, START_KEYS) as string | number | undefined,
        divisor,
      ),
      end: normalizeTimestamp(pick(record, END_KEYS) as string | number | undefined, divisor),
      speaker: typeof speaker === "string" ? speaker : speaker === undefined ? "" : String(speaker),
      text: text.trim(),
    });
  }
  return cues.length > 0 ? cues : null;
}

/** Handles the transcript JSON shapes the common tools export. */
function parseJson(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TranscriptFileError("That file isn't valid JSON.");
  }

  if (Array.isArray(parsed)) {
    const cues = rowsToCues(parsed);
    if (cues) return renderCues(cues);
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["utterances", "segments", "results", "messages", "turns", "transcript"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        const cues = rowsToCues(value);
        if (cues) return renderCues(cues);
      }
    }
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  }

  throw new TranscriptFileError("Couldn't find transcript lines in that JSON.");
}

/** Binary files read as text produce NULs and stray control characters. */
function looksBinary(raw: string): boolean {
  const sample = raw.slice(0, 2000);
  if (sample.indexOf("\u0000") !== -1) return true;
  const control = sample
    .replace(/[\t\n\r]/g, "")
    .match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
  return (control?.length ?? 0) > sample.length * 0.02;
}

export interface ParsedTranscript {
  text: string;
  wordCount: number;
}

export async function readTranscriptFile(file: File): Promise<ParsedTranscript> {
  if (file.size > MAX_TEXT_BYTES) {
    throw new TranscriptFileError("That file is too large. Transcripts should be under 3MB.");
  }

  const extension = extensionOf(file.name);
  if (extension && !ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new TranscriptFileError(
      `${extension} files aren't supported. Use ${ACCEPTED_EXTENSIONS.join(", ")}.`,
    );
  }

  const raw = await file.text();
  if (!raw.trim()) throw new TranscriptFileError("That file is empty.");
  if (looksBinary(raw)) {
    throw new TranscriptFileError("That looks like a binary file, not a transcript.");
  }

  let text: string;
  if (extension === ".vtt" || extension === ".srt") {
    text = parseCueFormat(raw);
  } else if (extension === ".json") {
    text = parseJson(raw);
  } else {
    text = raw.trim();
  }

  if (!text.trim()) throw new TranscriptFileError("No readable text in that file.");

  return { text, wordCount: text.split(/\s+/).filter(Boolean).length };
}
