import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mediaSource = await readFile(new URL("../apps/web/src/ShowBrandMediaPanel.tsx", import.meta.url), "utf8");
const brandingSource = await readFile(new URL("../apps/web/src/ShowBrandingPanel.tsx", import.meta.url), "utf8");

test("intro and outro controls are integrated into the show branding workspace", () => {
  assert.match(brandingSource, /ShowBrandMediaPanel/);
  assert.match(brandingSource, /showId=\{showId\}/);
  assert.match(brandingSource, /connectionId=\{connectionId\}/);
});

test("brand media UI exposes intro and outro immutable-original kinds", () => {
  assert.match(mediaSource, /show-intro-original/);
  assert.match(mediaSource, /show-outro-original/);
  assert.match(mediaSource, /Previous originals remain unchanged/);
});

test("brand media UI supports audio, MP4 and WebM without base64", () => {
  assert.match(mediaSource, /audio\/mpeg/);
  assert.match(mediaSource, /audio\/wav/);
  assert.match(mediaSource, /audio\/webm/);
  assert.match(mediaSource, /video\/webm/);
  assert.match(mediaSource, /video\/mp4/);
  assert.doesNotMatch(mediaSource, /base64/);
});

test("resumable UI uses protected token, bounded chunks and exact content range", () => {
  assert.match(mediaSource, /CHUNK_BYTES = 8 \* 1024 \* 1024/);
  assert.match(mediaSource, /x-hrtechify-brand-upload-token/);
  assert.match(mediaSource, /content-range/);
  assert.match(mediaSource, /file\.slice\(offset, endExclusive/);
  assert.doesNotMatch(mediaSource, /googleapis\.com\/upload/);
});

test("ambiguous upload failures query server-confirmed resume position", () => {
  assert.match(mediaSource, /queryResumeOffset/);
  assert.match(mediaSource, /resumable\/status/);
  assert.match(mediaSource, /catch \{/);
  assert.match(mediaSource, /offset = await queryResumeOffset\(uploadToken\)/);
});

test("upload requests stay scoped to the selected show and Drive connection", () => {
  assert.match(mediaSource, /showId,/);
  assert.match(mediaSource, /connectionId,/);
  assert.match(mediaSource, /credentials: "same-origin"/);
});

test("upload progress is visible to the user", () => {
  assert.match(mediaSource, /setProgress/);
  assert.match(mediaSource, /<progress max=\{100\} value=\{progress\}/);
  assert.match(mediaSource, /Uploading… \$\{progress\}%/);
});
