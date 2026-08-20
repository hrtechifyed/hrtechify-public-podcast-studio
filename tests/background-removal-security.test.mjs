import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/background-removal-api.ts", import.meta.url), "utf8");
const driveSource = await readFile(new URL("../apps/worker/src/google-drive-branding.ts", import.meta.url), "utf8");
const configSource = await readFile(new URL("../apps/worker/wrangler.jsonc", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");

test("Cloudflare Images is bound without a new secret", () => {
  assert.match(configSource, /"images"\s*:\s*\{/);
  assert.match(configSource, /"binding"\s*:\s*"IMAGES"/);
  assert.doesNotMatch(configSource, /IMAGES_API_KEY|AI_API_KEY/);
});

test("background removal uses foreground segmentation and PNG output", () => {
  assert.match(apiSource, /\.transform\(\{ segment: "foreground" \}\)/);
  assert.match(apiSource, /\.output\(\{ format: "image\/png" \}\)/);
  assert.match(apiSource, /images_binding_not_configured/);
});

test("source and candidate access stay tenant and show scoped", () => {
  assert.match(apiSource, /requireVerifiedIdentity\(request, env\)/);
  assert.match(apiSource, /getShowForUser\(db, userId, showId\)/);
  assert.match(apiSource, /getStorageConnectionForUser\(db, userId, connectionId\)/);
  assert.match(apiSource, /show\.storage_connection_id !== connection\.id/);
  assert.match(apiSource, /drive\.getOwnedFile\(show\.id, show\.name, sourceAssetId\)/);
  assert.match(apiSource, /drive\.getOwnedFile\(show\.id, show\.name, candidatePreviewId\)/);
});

test("derived candidate is append-only and points back to source", () => {
  assert.match(driveSource, /candidate: "true"/);
  assert.match(driveSource, /derived: "true"/);
  assert.match(driveSource, /sourceAssetId: input\.sourceAssetId/);
  assert.match(driveSource, /transformation: "background-removal-v1"/);
  assert.match(driveSource, /immutable: "true"/);
  assert.doesNotMatch(driveSource, /method: "DELETE"/);
});

test("candidate preview is inline, no-store and nosniff", () => {
  assert.match(apiSource, /"content-type": "image\/png"/);
  assert.match(apiSource, /"cache-control": "no-store"/);
  assert.match(apiSource, /"x-content-type-options": "nosniff"/);
  assert.match(apiSource, /"content-disposition": "inline"/);
});

test("background-removal handler runs before generic branding handler", () => {
  const backgroundIndex = indexSource.indexOf("handleBackgroundRemovalApi");
  const brandIndex = indexSource.indexOf("handleBrandAssetsApi");
  assert.ok(backgroundIndex >= 0);
  assert.ok(brandIndex >= 0);
  assert.ok(backgroundIndex < brandIndex);
});

test("no Drive or Cloudflare credentials are returned to browser", () => {
  assert.doesNotMatch(apiSource, /refresh_token_encrypted/);
  assert.doesNotMatch(apiSource, /accessToken/);
  assert.doesNotMatch(apiSource, /sessionUrl/);
});
