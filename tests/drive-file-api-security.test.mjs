import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/drive-file-api.ts", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");

test("Drive file API requires authenticated identity and tenant-scoped lookups", () => {
  assert.match(apiSource, /requireVerifiedIdentity\(request, env\)/);
  assert.match(apiSource, /getShowForUser\(db, identity\.userId, input\.showId\)/);
  assert.match(apiSource, /getStorageConnectionForUser\(db, identity\.userId, input\.connectionId\)/);
});

test("Drive file API rejects inactive shows and wrong storage assignment", () => {
  assert.match(apiSource, /show\.status !== "active"/);
  assert.match(apiSource, /show_storage_connection_required/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
  assert.match(apiSource, /show_storage_connection_mismatch/);
});

test("Drive file API only exposes the explicit small-file POST route", () => {
  assert.match(apiSource, /\/api\/storage\/google-drive\/files\/small/);
  assert.match(apiSource, /request\.method !== "POST"/);
});

test("Drive file API is routed before the generic storage handler", () => {
  const driveFileIndex = indexSource.indexOf("handleDriveFileApi");
  const storageIndex = indexSource.indexOf("handleStorageApi");
  assert.ok(driveFileIndex >= 0);
  assert.ok(storageIndex >= 0);
  assert.ok(driveFileIndex < storageIndex);
});

test("upload response does not serialize refresh tokens or access tokens", () => {
  assert.doesNotMatch(apiSource, /refresh_token_encrypted/);
  assert.doesNotMatch(apiSource, /accessToken/);
  assert.match(apiSource, /provider: "google-drive"/);
});
