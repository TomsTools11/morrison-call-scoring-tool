import assert from "node:assert/strict";
import { test } from "node:test";
import { readTranscriptFile } from "../src/lib/transcript.js";
import { measureTranscript } from "../lib/rubric.js";

const asFile = (name: string, body: string) => new File([body], name, { type: "text/plain" });

test("millisecond offsets are decided once per file, not per row", async () => {
  // The per-row heuristic treated anything under 10,000 as seconds, so the
  // first ten seconds of a millisecond export landed hours into the future and
  // the stamps ran backwards — which misgrades every order-sensitive criterion.
  const body = JSON.stringify([
    { start: 3500, speaker: "Agent", text: "Hi, this is Blayton with Allstate." },
    { start: 12000, speaker: "Customer", text: "Hello." },
    { start: 605000, speaker: "Agent", text: "Thanks for your time today." },
  ]);
  const { text } = await readTranscriptFile(asFile("call.json", body));

  assert.match(text, /^\[00:00:03\] Agent:/);
  assert.match(text, /\[00:00:12\] Customer:/);
  assert.match(text, /\[00:10:05\] Agent:/);

  const stamps = [...text.matchAll(/\[(\d{2}):(\d{2}):(\d{2})\]/g)].map(
    (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
  );
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b), "timestamps must run forwards");
});

test("second offsets are still read as seconds", async () => {
  const body = JSON.stringify([
    { start: 0, speaker: "Agent", text: "Morning." },
    { start: 65, speaker: "Customer", text: "Hi there." },
  ]);
  const { text } = await readTranscriptFile(asFile("call.json", body));
  assert.match(text, /\[00:01:05\] Customer:/);
});

test("an absolute datetime does not leak through as a timestamp", async () => {
  // "2026-08-31T14:03:22Z" also splits into three colon-separated parts, and
  // passing it through breaks the [HH:MM:SS] form every measurement reads.
  const body = JSON.stringify([
    { timestamp: "2026-08-31T14:03:22Z", speaker: "Agent", text: "Hi there." },
  ]);
  const { text } = await readTranscriptFile(asFile("call.json", body));
  assert.equal(text, "Agent: Hi there.");
  assert.doesNotMatch(text, /2026-08-31/);
});

test("a mid-sentence colon does not invent a speaker", async () => {
  // Mike's own script lines are full of these — "Just to confirm: is there
  // anything about this policy that is concerning you?" — and a phantom label
  // splits the producer's most script-perfect turns onto a third party.
  const body = [
    "Agent: Just to confirm: is there anything about this policy that is concerning you?",
    "Customer: Not really.",
    "Agent: Here's the thing: to send you an accurate number I need a couple of details.",
    "Customer: Okay.",
  ].join("\n");
  const { text } = await readTranscriptFile(asFile("call.txt", body));
  assert.doesNotMatch(text, /^Just to confirm:/m);
  assert.doesNotMatch(text, /^Here's the thing:/m);
});

test("VTT keeps start times and closes with the real end of the call", async () => {
  const body = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:04.000",
    "<v Agent>Hi, this is Blayton with Allstate.",
    "",
    "00:00:04.500 --> 00:00:09.000",
    "<v Agent>I'm following up on the quote you requested.",
    "",
    "00:11:00.000 --> 00:11:45.000",
    "<v Customer>Sounds good to me.",
  ].join("\n");
  const { text } = await readTranscriptFile(asFile("call.vtt", body));

  assert.match(text, /^\[00:00:01\] Agent: Hi, this is Blayton with Allstate\. I'm following up/);
  assert.match(text, /\[00:11:45\] --- end of call ---$/);

  // Without the end marker the measured duration stops at the START of the
  // last turn, which shortens exactly the calls that ran long.
  const measures = measureTranscript(text, "Agent");
  assert.equal(measures.elapsedSeconds, 704);
  assert.equal(measures.hasTimestamps, true);
});

test("SRT comma decimals and cue ids parse", async () => {
  const body = ["1", "00:00:02,000 --> 00:00:05,000", "Agent: Good morning."].join("\n");
  const { text } = await readTranscriptFile(asFile("call.srt", body));
  assert.match(text, /\[00:00:02\] Agent: Good morning\./);
});

test("talk share is measured from the speaker labels, not guessed", async () => {
  const body = [
    "[00:00:00] Agent: one two three four five six seven eight nine ten",
    "[00:00:20] Customer: one two three four five",
    "[00:05:00] Agent: one two three four five",
  ].join("\n");
  const measures = measureTranscript(body, "Agent");
  assert.equal(measures.producerTalkShare, 75);
  assert.equal(measures.hasSpeakerLabels, true);
});

test("an untimestamped transcript reports no duration rather than inventing one", () => {
  const measures = measureTranscript("Agent: Hello.\nCustomer: Hi.");
  assert.equal(measures.elapsedSeconds, null);
  assert.equal(measures.hasTimestamps, false);
});
