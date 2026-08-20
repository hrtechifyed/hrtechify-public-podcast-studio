import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeEditorialProposals,
  detectImmediateRepeatedSpeech,
  detectLongPauses,
  mapSemanticCandidatesToProposals,
  normalizeWhisperWords,
  type TimedWord,
} from "../apps/worker/src/editorial-analysis";

const words = (values: Array<[string, number, number]>): TimedWord[] =>
  values.map(([word, startMs, endMs], index) => ({
    index,
    word,
    normalized: word.toLowerCase().replace(/[^a-z0-9']/g, ""),
    startMs,
    endMs,
  }));

test("normalizes valid Whisper word timestamps and rejects malformed or backwards entries", () => {
  const result = normalizeWhisperWords([
    { word: " Hello ", start: 0.1, end: 0.4 },
    { word: "broken", start: 0.3, end: 0.5 },
    { word: "world!", start: 0.6, end: 0.9 },
    { word: "bad", start: Number.NaN, end: 1.1 },
    { word: "zero", start: 1.2, end: 1.2 },
  ]);
  assert.deepEqual(result.map((word) => [word.word, word.normalized, word.startMs, word.endMs]), [
    ["Hello", "hello", 100, 400],
    ["world!", "world", 600, 900],
  ]);
  assert.deepEqual(result.map((word) => word.index), [0, 1]);
});

test("detects only long internal pauses between timed words", () => {
  const result = detectLongPauses(words([
    ["before", 100, 500],
    ["after", 3400, 3800],
    ["normal", 4100, 4500],
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "unusual_pause");
  assert.equal(result[0].startMs, 500);
  assert.equal(result[0].endMs, 3400);
  assert.equal(result[0].confidence, 0.99);
});

test("detects immediate repeated multi-word speech but ignores a single repeated emphasis word", () => {
  const repeated = detectImmediateRepeatedSpeech(words([
    ["we", 0, 180],
    ["should", 200, 500],
    ["we", 540, 720],
    ["should", 740, 1040],
    ["begin", 1080, 1400],
  ]));
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].kind, "repeated_speech");
  assert.equal(repeated[0].startMs, 0);
  assert.equal(repeated[0].endMs, 500);

  const emphasis = detectImmediateRepeatedSpeech(words([
    ["very", 0, 180],
    ["very", 200, 380],
    ["important", 420, 800],
    ["today", 850, 1100],
  ]));
  assert.equal(emphasis.length, 0);
});

test("semantic candidate mapping accepts only bounded high-confidence approved detector kinds", () => {
  const timed = words([
    ["I", 0, 100],
    ["mean", 120, 400],
    ["we", 430, 600],
    ["should", 620, 900],
  ]);
  const result = mapSemanticCandidatesToProposals(timed, [
    { kind: "false_start", startWord: 0, endWord: 1, confidence: 0.93, explanation: "Clear self-correction." },
    { kind: "spoken_content_removal", startWord: 2, endWord: 3, confidence: 1, explanation: "Remove content." },
    { kind: "fumble", startWord: 1, endWord: 2, confidence: 0.5, explanation: "Uncertain." },
    { kind: "repeated_speech", startWord: -1, endWord: 1, confidence: 0.99, explanation: "Out of bounds." },
  ], 0, 3);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    kind: "false_start",
    startMs: 0,
    endMs: 400,
    explanation: "Clear self-correction.",
    confidence: 0.93,
  });
});

test("deduplication removes strongly overlapping proposals of the same kind but preserves distinct kinds", () => {
  const result = dedupeEditorialProposals([
    { kind: "repeated_speech", startMs: 100, endMs: 800, explanation: "deterministic", confidence: 0.98 },
    { kind: "repeated_speech", startMs: 120, endMs: 780, explanation: "semantic", confidence: 0.92 },
    { kind: "false_start", startMs: 120, endMs: 780, explanation: "different kind", confidence: 0.9 },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.kind), ["repeated_speech", "false_start"]);
});
