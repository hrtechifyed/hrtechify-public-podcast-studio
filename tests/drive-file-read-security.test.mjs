import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/drive-file-api.ts", import.meta.url), "utf8");
const driveSource = await readFile(new URL("../apps/worker/src/google-drive.ts", import.meta.url), "utf8");

test("metadata and download reuse tenant-scoped show and Drive assignment checks", () => {
  assert.match(apiSource, /loadAssignedDriveContext/);
  assert.match(apiSource, /getShowForUser\(db, userId, showId\)/);
  assert.match(apiSource, /getStorageConnectionForUser\(db, userId, connectionId\)/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
});

test("file ownership checks include app markers and expected physical parent", () => {
  assert.match(driveSource, /isOwnedShowAsset\(file, showId, expectedParentId\)/);
  assert.match(driveSource, /workspace\.folders\.brandAssets/);
  assert.match(driveSource, /workspace\.folders\.episodes/);
  assert.match(driveSource, /google_drive_file_not_found/);
});

test("download uses Drive alt=media server-side and never returns the bearer token", () => {
  assert.match(driveSource, /url\.searchParams\.set\("alt", "media"\)/);
  assert.match(driveSource, /authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(apiSource, /accessToken/);
  assert.doesNotMatch(apiSource, /refresh_token_encrypted/);
});

test("downloads require Drive permission and defensive response headers", () => {
  assert.match(driveSource, /canDownloadOwnedAsset\(file\)/);
  assert.match(driveSource, /google_drive_file_not_downloadable/);
  assert.match(apiSource, /"content-disposition": attachmentContentDisposition/);
  assert.match(apiSource, /"x-content-type-options": "nosniff"/);
  assert.match(apiSource, /"cache-control": "no-store"/);
});

test("metadata exposes the Drive open URL without proxying credentials", () => {
  assert.match(apiSource, /openUrl: file\.webViewLink/);
  assert.doesNotMatch(apiSource, /authorization:/);
});
