import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recorder = await readFile(new URL("../packages/recorder/src/browser.ts", import.meta.url), "utf8");
const panel = await readFile(new URL("../apps/web/src/RecorderPanel.tsx", import.meta.url), "utf8");
const mediaPanel = await readFile(new URL("../apps/web/src/ShowBrandMediaPanel.tsx", import.meta.url), "utf8");
const resumable = await readFile(new URL("../apps/worker/src/drive-resumable.ts", import.meta.url), "utf8");
const driveApi = await readFile(new URL("../apps/worker/src/drive-file-api.ts", import.meta.url), "utf8");
const driveGoogle = await readFile(new URL("../apps/worker/src/google-drive-resumable.ts", import.meta.url), "utf8");

test("recorder prefers WebM Opus and captures microphone audio with MediaRecorder", () => {
  assert.match(recorder, /audio\/webm;codecs=opus/);
  assert.match(recorder, /MediaRecorder\.isTypeSupported/);
  assert.match(panel, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(panel, /new MediaRecorder\(stream/);
  assert.match(panel, /recorder\.start\(1000\)/);
  assert.match(panel, /video: false/);
});

test("recorder exposes microphone selection, input meter, quiet and clipping feedback", () => {
  assert.match(panel, /enumerateDevices\(\)/);
  assert.match(panel, /device\.kind === "audioinput"/);
  assert.match(panel, /Microphone/);
  assert.match(panel, /getFloatTimeDomainData/);
  assert.match(recorder, /peak >= 0\.985/);
  assert.match(recorder, /rms < 0\.018/);
  assert.match(panel, /Too loud — clipping risk/);
  assert.match(panel, /Input is very quiet/);
});

test("recording supports pause resume and stop without silently editing audio", () => {
  assert.match(panel, /recorder\.pause\(\)/);
  assert.match(panel, /recorder\.resume\(\)/);
  assert.match(panel, /recorder\.stop\(\)/);
  assert.match(panel, /No spoken content has been changed/);
  assert.doesNotMatch(panel, /transcrib|remove words|trim silence/i);
});

test("every recorded chunk is persisted in IndexedDB for crash recovery", () => {
  assert.match(recorder, /indexedDB\.open/);
  assert.match(recorder, /SESSION_STORE = "sessions"/);
  assert.match(recorder, /CHUNK_STORE = "chunks"/);
  assert.match(panel, /appendRecordingChunk\(sessionId, index, event\.data\)/);
  assert.match(panel, /pendingChunkWritesRef/);
  assert.match(panel, /listRecoverableRecordingSessions/);
  assert.match(panel, /rebuildRecordingBlob/);
  assert.match(panel, /Locally recoverable recordings/);
  assert.match(panel, />Recover</);
});

test("new episode name comes from show preferences and remains editable", () => {
  assert.match(panel, /\/api\/shows\/\$\{encodeURIComponent\(showId\)\}\/preferences/);
  assert.match(panel, /defaultEpisodeName/);
  assert.match(panel, /useState\("HRPodcast"\)/);
  assert.match(panel, /Episode name/);
  assert.match(panel, /maxLength=\{160\}/);
});

test("record here and upload recording share immutable original Drive storage", () => {
  assert.match(panel, /Record here/);
  assert.match(panel, /Upload recording/);
  assert.match(panel, /\/api\/storage\/google-drive\/files\/resumable\/start/);
  assert.match(panel, /\/api\/storage\/google-drive\/files\/resumable\/chunk/);
  assert.match(panel, /\/api\/storage\/google-drive\/files\/resumable\/status/);
  assert.match(panel, /x-hrtechify-upload-token/);
  assert.match(driveGoogle, /assetKind: "original-recording"/);
  assert.match(driveGoogle, /immutable: "true"/);
  assert.match(driveApi, /verified\.appProperties\.assetKind !== "original-recording"/);
  assert.match(driveApi, /verified\.appProperties\.immutable !== "true"/);
});

test("short recordings also use the immutable original-recording path", () => {
  assert.doesNotMatch(resumable, /MAX_SMALL_DRIVE_UPLOAD_BYTES/);
  assert.match(resumable, /totalBytes <= 0/);
  assert.match(resumable, /audio\/webm/);
});

test("recorder upload recovery is bounded and checks server-confirmed offset", () => {
  assert.match(panel, /recoveryAttempts >= 3/);
  assert.match(panel, /recoveryAttempts < 3/);
  assert.match(panel, /readStatus/);
  assert.match(panel, /nextOffset/);
  assert.match(panel, /content-range/);
  assert.match(panel, /chunkGranularityBytes/);
});

test("recorder is surfaced inside each Drive-backed show workspace", () => {
  assert.match(mediaPanel, /import \{ RecorderPanel \}/);
  assert.match(mediaPanel, /<RecorderPanel showId=\{showId\} showName=\{showName\} connectionId=\{connectionId\} \/>/);
});
