import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audio = await readFile(new URL("../packages/audio/src/index.ts", import.meta.url), "utf8");
const summary = await readFile(new URL("../apps/web/src/TechnicalCleanupSummary.tsx", import.meta.url), "utf8");
const episodes = await readFile(new URL("../apps/web/src/EpisodeList.tsx", import.meta.url), "utf8");

test("technical cleanup profile is declarative and contains no arbitrary processing command surface", () => {
  assert.match(audio, /PODCAST_TECHNICAL_CLEANUP_PROFILE_V1/);
  assert.match(audio, /targetIntegratedLoudnessLkfs: -16/);
  assert.match(audio, /loudnessToleranceDb: 1/);
  assert.match(audio, /maxTruePeakDbfs: -1/);
  assert.doesNotMatch(audio, /ffmpeg|filter_complex|shellCommand|commandArgs|exec\(/i);
});

test("automatic technical processing is restricted to known signal adjustments", () => {
  for (const adjustment of [
    "noise_control",
    "hum_control",
    "click_reduction",
    "de_essing",
    "plosive_control",
    "level_balancing",
    "compression",
    "peak_protection",
  ]) {
    assert.match(audio, new RegExp(`"${adjustment}"`));
  }
  assert.match(audio, /maxStrength: "gentle"/);
  assert.match(audio, /condition: "when_detected"/);
  assert.match(audio, /condition: "always"/);
});

test("technical cleanup and editorial speech edits remain separate contracts", () => {
  const technicalPosition = audio.indexOf("TECHNICAL_ADJUSTMENTS");
  const speechPosition = audio.indexOf("SPEECH_EDIT_KINDS");
  assert.ok(technicalPosition >= 0 && speechPosition > technicalPosition);
  assert.match(audio, /approvalRequired: true/);
  assert.doesNotMatch(audio.slice(technicalPosition, speechPosition), /unusual_pause|false_start|repeated_speech|fumble|spoken_content_removal/);
});

test("cleanup policy makes all preservation guarantees explicit", () => {
  assert.match(audio, /preserveWords: true/);
  assert.match(audio, /preserveTiming: true/);
  assert.match(audio, /preservePitch: true/);
  assert.match(audio, /preserveSpeakingSpeed: true/);
  assert.match(audio, /technical_cleanup_requires_immutable_source/);
});

test("Episode UI states the profile is for a later derived copy and does not alter the original", () => {
  assert.match(episodes, /TechnicalCleanupSummary/);
  assert.match(summary, /Professional cleanup on a derived copy only/);
  assert.match(summary, /preserve every word, timing, pitch and speaking speed/);
  assert.match(summary, /Editorial cuts remain separate/);
  assert.match(summary, /does not modify the original recording/);
  assert.match(summary, /processing engine will apply this policy only to a later derived render/);
});
