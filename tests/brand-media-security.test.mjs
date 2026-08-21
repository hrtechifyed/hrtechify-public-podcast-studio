import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/brand-media-api.ts", import.meta.url), "utf8");
const transportSource = await readFile(new URL("../apps/worker/src/google-drive-resumable.ts", import.meta.url), "utf8");
const listSource = await readFile(new URL("../apps/worker/src/google-drive-brand-media.ts", import.meta.url), "utf8");
const recordingSecuritySource = await readFile(new URL("./drive-resumable-security.test.mjs", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");

test("intro/outro API has explicit list, start, chunk and status methods", () => {
  assert.match(apiSource, /MEDIA_LIST_PATH/);
  assert.match(apiSource, /START_PATH/);
  assert.match(apiSource, /CHUNK_PATH/);
  assert.match(apiSource, /STATUS_PATH/);
  assert.match(apiSource, /isList && request\.method !== "GET"/);
  assert.match(apiSource, /isStart && request\.method !== "POST"/);
  assert.match(apiSource, /isChunk && request\.method !== "PUT"/);
  assert.match(apiSource, /isStatus && request\.method !== "POST"/);
});

test("brand media tokens are user-bound and API never returns provider session URLs", () => {
  assert.match(apiSource, /createBrandMediaUploadToken/);
  assert.match(apiSource, /readBrandMediaUploadToken/);
  assert.match(apiSource, /createDropboxBrandToken/);
  assert.match(apiSource, /readDropboxBrandToken/);
  assert.match(apiSource, /x-hrtechify-brand-upload-token/);
  assert.match(apiSource, /return json\(\{ uploadToken, nextOffset: 0, provider: "google-drive" \}, 201\)/);
  assert.match(apiSource, /provider: "dropbox"/);
  assert.doesNotMatch(apiSource, /return json\(\{\s*sessionUrl/);
  assert.doesNotMatch(apiSource, /authorization: `Bearer/);
});

test("every brand media operation is tenant and assigned-storage scoped", () => {
  assert.match(apiSource, /requireVerifiedIdentity\(request, env\)/);
  assert.match(apiSource, /getShowForUser\(db, userId, showId\)/);
  assert.match(apiSource, /getStorageConnectionForUser\(db, userId, connectionId\)/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
});

test("Google Drive intro/outro originals are created in Brand Assets as immutable originals", () => {
  assert.match(transportSource, /startGoogleDriveBrandMediaResumableUpload/);
  assert.match(transportSource, /parents: \[workspace\.folders\.brandAssets\]/);
  assert.match(transportSource, /folder: "brand-assets"/);
  assert.match(transportSource, /assetKind: input\.assetKind/);
  assert.match(transportSource, /original: "true"/);
  assert.match(transportSource, /immutable: "true"/);
});

test("original recording resumable implementation remains explicitly Episodes/original-recording", () => {
  assert.match(transportSource, /parents: \[workspace\.folders\.episodes\]/);
  assert.match(transportSource, /assetKind: "original-recording"/);
  assert.match(recordingSecuritySource, /original recording is created as immutable in the Episodes folder/);
});

test("chunk bytes and final Google Drive metadata are reverified", () => {
  const googleBranch = apiSource.indexOf("const payload = await readBrandMediaUploadToken");
  const rangeIndex = apiSource.indexOf("parseResumableContentRange(", googleBranch);
  const bufferIndex = apiSource.indexOf("await request.arrayBuffer()", googleBranch);
  const uploadIndex = apiSource.indexOf("uploadGoogleDriveResumableChunk(", googleBranch);
  assert.ok(googleBranch >= 0 && rangeIndex > googleBranch && bufferIndex > rangeIndex && uploadIndex > bufferIndex);
  assert.match(apiSource, /chunkBody\.byteLength !== parsedRange\.length/);
  assert.match(apiSource, /file\.appProperties\.assetKind !== input\.assetKind/);
  assert.match(apiSource, /file\.appProperties\.original !== "true"/);
  assert.match(apiSource, /file\.appProperties\.immutable !== "true"/);
  assert.match(apiSource, /file\.sizeBytes !== input\.expectedTotalBytes/);
});

test("Google Drive media listing stays show-scoped and filters intro/outro originals only", () => {
  assert.match(listSource, /key='showId' and value=/);
  assert.match(listSource, /key='folder' and value='brand-assets'/);
  assert.match(listSource, /key='original' and value='true'/);
  assert.match(listSource, /kind !== "show-intro-original" && kind !== "show-outro-original"/);
});

test("brand media handler executes before generic branding handler", () => {
  const handlerSection = indexSource.slice(indexSource.indexOf("const handlers = ["));
  const mediaIndex = handlerSection.indexOf("handleBrandMediaApi,");
  const brandIndex = handlerSection.indexOf("handleBrandAssetsApi,");
  assert.ok(mediaIndex >= 0 && brandIndex >= 0 && mediaIndex < brandIndex);
});
