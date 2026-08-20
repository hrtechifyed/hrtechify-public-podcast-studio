import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/drive-file-api.ts", import.meta.url), "utf8");
const transportSource = await readFile(new URL("../apps/worker/src/google-drive-resumable.ts", import.meta.url), "utf8");
const policySource = await readFile(new URL("../apps/worker/src/drive-resumable.ts", import.meta.url), "utf8");

test("resumable start/chunk/status have explicit methods and do not fall through to file-read routes", () => {
  assert.match(apiSource, /RESUMABLE_START_PATH/);
  assert.match(apiSource, /RESUMABLE_CHUNK_PATH/);
  assert.match(apiSource, /RESUMABLE_STATUS_PATH/);
  assert.match(apiSource, /isResumableStart && request\.method !== "POST"/);
  assert.match(apiSource, /isResumableChunk && request\.method !== "PUT"/);
  assert.match(apiSource, /isResumableStatus && request\.method !== "POST"/);
  assert.match(apiSource, /isSmallUpload \|\| isResumableRoute \? null : parseDriveFileReadRoute/);
});

test("Google session URL is encrypted into a user-bound opaque upload token", () => {
  assert.match(apiSource, /createResumableUploadToken/);
  assert.match(policySource, /`drive-resumable:\$\{userId\}`/);
  assert.match(policySource, /encryptStorageToken/);
  assert.match(policySource, /decryptStorageToken/);
  assert.match(apiSource, /UPLOAD_TOKEN_HEADER = "x-hrtechify-upload-token"/);
});

test("every chunk and status request rechecks show-to-Drive assignment", () => {
  assert.match(apiSource, /readResumableUploadToken/);
  assert.match(apiSource, /payload\.showId/);
  assert.match(apiSource, /payload\.connectionId/);
  assert.match(apiSource, /loadAssignedDriveContext/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
});

test("chunk size is validated before body buffering and actual bytes are checked before Google", () => {
  const rangeIndex = apiSource.indexOf("parseResumableContentRange(");
  const bufferIndex = apiSource.indexOf("await request.arrayBuffer()");
  const uploadIndex = apiSource.indexOf("uploadGoogleDriveResumableChunk(");
  assert.ok(rangeIndex >= 0);
  assert.ok(bufferIndex > rangeIndex);
  assert.ok(uploadIndex > bufferIndex);
  assert.match(apiSource, /chunkBody\.byteLength !== parsedRange\.length/);
  assert.match(transportSource, /input\.body\.byteLength !== input\.contentLength/);
});

test("original recording is created as immutable in the Episodes folder and completion is reverified", () => {
  assert.match(transportSource, /parents: \[workspace\.folders\.episodes\]/);
  assert.match(transportSource, /assetKind: "original-recording"/);
  assert.match(transportSource, /immutable: "true"/);
  assert.match(apiSource, /drive\.getOwnedFile\(show\.id, show\.name, result\.file\.id\)/);
  assert.match(apiSource, /verified\.sizeBytes !== expectedTotalBytes/);
});

test("Google bearer and resumable URL stay server-side", () => {
  assert.match(transportSource, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(transportSource, /response\.headers\.get\("location"\)/);
  assert.doesNotMatch(apiSource, /authorization: `Bearer/);
  assert.doesNotMatch(apiSource, /refresh_token_encrypted/);
});

test("retryable Google failures and expired sessions have explicit error codes", () => {
  assert.match(transportSource, /google_drive_resumable_retryable/);
  assert.match(transportSource, /google_drive_resumable_session_expired/);
  assert.match(policySource, /resumable_upload_token_expired/);
  assert.match(apiSource, /nextOffset/);
});
