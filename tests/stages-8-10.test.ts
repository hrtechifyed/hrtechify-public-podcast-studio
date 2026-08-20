import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebVtt,
  createCaptionTimingDocument,
  parseCaptionTimingDocument,
  transformCaptionWordsForApprovedCuts,
} from "../packages/renderer/src/index.ts";
import {
  DEFAULT_TEMPLATE_ID,
  getSafeTemplateManifest,
  SAFE_TEMPLATE_MANIFESTS,
} from "../packages/templates/src/index.ts";

const words = [
  { word: "This", startMs: 0, endMs: 300 },
  { word: "is", startMs: 350, endMs: 500 },
  { word: "a", startMs: 550, endMs: 650 },
  { word: "false", startMs: 700, endMs: 1000 },
  { word: "start", startMs: 1050, endMs: 1350 },
  { word: "clean", startMs: 1900, endMs: 2200 },
  { word: "sentence.", startMs: 2250, endMs: 2750 },
];

test("approved cuts remove only overlapping caption words and preserve exact remaining tokens", () => {
  const transformed = transformCaptionWordsForApprovedCuts(
    words,
    [{ startMs: 700, endMs: 1350 }],
  );
  assert.deepEqual(
    transformed.map((word) => word.word),
    ["This", "is", "a", "clean", "sentence."],
  );
  assert.equal(transformed[3].startMs, 1250);
  assert.equal(transformed[4].endMs, 2100);
});

test("caption timing is shifted by the intro duration after approved cuts", () => {
  const transformed = transformCaptionWordsForApprovedCuts(
    words,
    [{ startMs: 700, endMs: 1350 }],
    7500,
  );
  assert.equal(transformed[0].startMs, 7500);
  assert.equal(transformed[3].startMs, 8750);
  assert.equal(transformed[4].endMs, 9600);
});

test("WebVTT is generated from exact words with valid cue timestamps", () => {
  const vtt = buildWebVtt(words, { maxWordsPerCue: 4, maxCueDurationMs: 3000 });
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:00\.000 --> 00:00:01\.000/);
  assert.match(vtt, /This is a false/);
  assert.match(vtt, /start clean sentence\./);
});

test("caption timing documents are source and analysis-run bound", () => {
  const document = createCaptionTimingDocument({
    episodeId: "episode-1",
    sourceFileId: "source-1",
    analysisRunId: "analysis-1",
    words,
  });
  assert.equal(document.version, "hrtechify-caption-words-v1");
  assert.deepEqual(parseCaptionTimingDocument(JSON.parse(JSON.stringify(document))), document);
  assert.throws(
    () => parseCaptionTimingDocument({ ...document, sourceFileId: "" }),
    /caption_timing_document_invalid/,
  );
});

test("safe templates are curated fixed manifests with mandatory HRTechify credit", () => {
  assert.equal(SAFE_TEMPLATE_MANIFESTS.length, 3);
  assert.equal(DEFAULT_TEMPLATE_ID, "hrtechify-studio-dark");
  for (const manifest of SAFE_TEMPLATE_MANIFESTS) {
    assert.equal(manifest.canvas.width, 1920);
    assert.equal(manifest.canvas.height, 1080);
    assert.equal(manifest.canvas.fps, 30);
    assert.equal(manifest.platformCredit.text, "Powered by HRTechify");
    assert.equal(manifest.platformCredit.required, true);
    assert.equal(manifest.platformCredit.removable, false);
    assert.equal(manifest.platformCredit.position, "bottom-right");
  }
});

test("unknown or user-invented template IDs are rejected", () => {
  assert.equal(getSafeTemplateManifest("hrtechify-clean-light").name, "Clean Light");
  assert.throws(() => getSafeTemplateManifest("../../custom-ffmpeg"), /template_id_not_allowed/);
  assert.throws(() => getSafeTemplateManifest("hrtechify-clean-light", 2), /template_version_not_allowed/);
});
