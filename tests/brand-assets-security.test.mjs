import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/brand-assets-api.ts", import.meta.url), "utf8");
const driveSource = await readFile(new URL("../apps/worker/src/google-drive-branding.ts", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");

test("branding API requires authenticated tenant-scoped show and storage lookups", () => {
  assert.match(apiSource, /requireVerifiedIdentity\(request, env\)/);
  assert.match(apiSource, /getShowForUser\(db, userId, showId\)/);
  assert.match(apiSource, /getStorageConnectionForUser\(db, userId, connectionId\)/);
  assert.match(apiSource, /show\.status !== "active"/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
});

test("actual body bytes are validated before either provider upload", () => {
  const validateIndex = apiSource.indexOf("validateBrandAssetBody(bytes, upload.contentLength)");
  const driveUploadIndex = apiSource.indexOf("asset = await uploadOriginalBrandAsset");
  const dropboxUploadIndex = apiSource.indexOf("asset = await session.uploadSmallAsset");
  assert.ok(validateIndex >= 0);
  assert.ok(driveUploadIndex > validateIndex);
  assert.ok(dropboxUploadIndex > validateIndex);
});

test("Google Drive brand originals are stored only in the selected show Brand Assets folder", () => {
  assert.match(driveSource, /parents: \[workspace\.folders\.brandAssets\]/);
  assert.match(driveSource, /showId: input\.showId/);
  assert.match(driveSource, /folder: "brand-assets"/);
});

test("Google Drive brand originals are immutable append-only assets", () => {
  assert.match(driveSource, /original: "true"/);
  assert.match(driveSource, /immutable: "true"/);
  assert.match(driveSource, /method: "POST"/);
  assert.doesNotMatch(driveSource, /method: "PATCH"/);
  assert.doesNotMatch(driveSource, /method: "DELETE"/);
});

test("Google Drive asset listing is show-scoped and only returns supported original kinds", () => {
  assert.match(driveSource, /key='showId' and value='/);
  assert.match(driveSource, /key='folder' and value='brand-assets'/);
  assert.match(driveSource, /file\.assetKind === "show-logo-original"/);
  assert.match(driveSource, /file\.assetKind === "profile-photo-original"/);
});

test("branding API is routed before generic protected handlers", () => {
  const handlerSection = indexSource.slice(indexSource.indexOf("const handlers = ["));
  const brandIndex = handlerSection.indexOf("handleBrandAssetsApi,");
  const protectedIndex = handlerSection.indexOf("handleProtectedApi,");
  assert.ok(brandIndex >= 0);
  assert.ok(protectedIndex >= 0);
  assert.ok(brandIndex < protectedIndex);
});

test("branding responses never serialize storage OAuth credentials", () => {
  assert.doesNotMatch(apiSource, /refresh_token_encrypted/);
  assert.doesNotMatch(apiSource, /accessToken/);
  assert.doesNotMatch(apiSource, /sessionUrl/);
  assert.match(apiSource, /provider: connection\.provider/);
});
