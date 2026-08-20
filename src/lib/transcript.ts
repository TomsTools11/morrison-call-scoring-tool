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

/** Seconds (or a HH:MM:SS.mmm string) to a padded HH:MM:SS stamp. */
function normalizeTimestamp(value: string | number | undefined): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    // Transcript JSON commonly stores milliseconds; anything huge is not seconds.
    const totalSeconds = Math.floor(value > 10000 ? value / 1000 : value);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  const text = String(value).trim().replace(",", ".");
  const clock = text.split(".")[0];
  const parts = clock.split(":");
  if (parts.length === 3) return parts.map((p) => p.padStart(2, "0")).join(":");
  if (parts.length === 2) return `00:${parts.map((p) => p.padStart(2, "0")).join(":")}`;
  return "";
}

interface Cue {
  timestamp: string;
  speaker: string;
  text: string;
}

/** Consecutive cues from the same speaker read as one turn, and cost far fewer tokens. */
function renderCues(cues: Cue[]): string {
  const merged: Cue[] = [];
  for (const cue of cues) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker && previous.speaker === cue.speaker) {
      previous.text = `${previous.text} ${cue.text}`.trim();
    } else {
      merged.push({ ...cue });
    }
  }

  return merged
    .map((cue) => {
      const stamp = cue.timestamp ? `[${cue.timestamp}] ` : "";
      const who = cue.speaker ? `${cue.speaker}: ` : "";
      return `${stamp}${who}${cue.text}`.trim();
    })
    .join("\n");
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

    const timestamp = normalizeTimestamp(lines[timingIndex].split("-->")[0].trim());
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
      const inline = text.match(/^([A-Za-z][\w .'-]{0,40}?):\s+(.*)$/);
      if (inline) {
        speaker = inline[1].trim();
        text = inline[2].trim();
      }
    }

    if (text) cues.push({ timestamp, speaker, text });
  }

  if (cues.length === 0) {
    throw new TranscriptFileError("No caption lines found in that file.");
  }
  return renderCues(cues);
}

const SPEAKER_KEYS = ["speaker", "speaker_label", "speakerName", "speaker_name", "name", "role"];
const TEXT_KEYS = ["text", "content", "transcript", "utterance", "value", "message"];
const START_KEYS = ["start", "start_time", "startTime", "timestamp", "offset", "time", "begin"];

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function rowsToCues(rows: unknown[]): Cue[] | null {
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
      timestamp: normalizeTimestamp(pick(record, START_KEYS) as string | number | undefined),
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
