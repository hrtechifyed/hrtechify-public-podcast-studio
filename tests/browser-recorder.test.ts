import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRmsAndPeak,
  classifyRecordingSignal,
  recordingExtensionForMimeType,
} from "../packages/recorder/src/browser";

test("classifies quiet healthy and clipping microphone levels", () => {
  assert.equal(classifyRecordingSignal(0.001, 0.01), "quiet");
  assert.equal(classifyRecordingSignal(0.1, 0.5), "good");
  assert.equal(classifyRecordingSignal(0.2, 0.99), "clipping");
});

test("calculates RMS and peak from time-domain samples", () => {
  const result = calculateRmsAndPeak(new Float32Array([0.5, -0.5, 0.25, -0.25]));
  assert.ok(result.rms > 0.39 && result.rms < 0.40);
  assert.equal(result.peak, 0.5);
  assert.deepEqual(calculateRmsAndPeak(new Float32Array()), { rms: 0, peak: 0 });
});

test("uses familiar file extensions for supported recording formats", () => {
  assert.equal(recordingExtensionForMimeType("audio/webm;codecs=opus"), "webm");
  assert.equal(recordingExtensionForMimeType("audio/mp4"), "m4a");
  assert.equal(recordingExtensionForMimeType("audio/wav"), "wav");
  assert.equal(recordingExtensionForMimeType("audio/mpeg"), "mp3");
});
