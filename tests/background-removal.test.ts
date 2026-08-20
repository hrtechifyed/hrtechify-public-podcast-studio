import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBackgroundRemovedCandidate,
  backgroundRemovedFileName,
  BackgroundRemovalValidationError,
  candidateKindFor,
  parseCandidatePreviewPath,
  sourceBrandAssetKind,
} from "../apps/worker/src/background-removal";

const source = () => ({
  id: "source_1",
  name: "My Logo.jpg",
  mimeType: "image/jpeg",
  appProperties: {
    assetKind: "show-logo-original",
    original: "true",
    immutable: "true",
    folder: "brand-assets",
  },
});

const expectCode = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof BackgroundRemovalValidationError);
    assert.equal(error.code, code);
    return true;
  });
};

test("only immutable original logo/profile images are valid sources", () => {
  assert.equal(sourceBrandAssetKind(source()), "show-logo-original");
  assert.equal(sourceBrandAssetKind({
    ...source(),
    appProperties: { ...source().appProperties, assetKind: "profile-photo-original" },
  }), "profile-photo-original");

  expectCode(() => sourceBrandAssetKind({
    ...source(),
    appProperties: { ...source().appProperties, original: "false" },
  }), "background_source_not_original");
  expectCode(() => sourceBrandAssetKind({
    ...source(),
    appProperties: { ...source().appProperties, assetKind: "show-logo-background-removed-candidate" },
  }), "background_source_not_original");
  expectCode(() => sourceBrandAssetKind({ ...source(), mimeType: "image/svg+xml" }), "background_source_mime_not_supported");
});

test("candidate kind follows the source brand role", () => {
  assert.equal(candidateKindFor("show-logo-original"), "show-logo-background-removed-candidate");
  assert.equal(candidateKindFor("profile-photo-original"), "profile-photo-background-removed-candidate");
});

test("derived filename is safe and always PNG", () => {
  assert.equal(backgroundRemovedFileName("My Logo.jpg"), "My Logo.background-removed.png");
  assert.equal(backgroundRemovedFileName("folder\\logo.png"), "folder_logo.background-removed.png");
  assert.doesNotMatch(backgroundRemovedFileName("bad\r\nname.webp"), /\r|\n|\\|\//);
});

test("candidate preview requires immutable background-removal markers", () => {
  const candidate = {
    id: "candidate_1",
    name: "logo.background-removed.png",
    mimeType: "image/png",
    appProperties: {
      assetKind: "show-logo-background-removed-candidate",
      derived: "true",
      candidate: "true",
      immutable: "true",
      folder: "brand-assets",
      transformation: "background-removal-v1",
      sourceAssetId: "source_1",
    },
  };
  assert.equal(assertBackgroundRemovedCandidate(candidate), "show-logo-background-removed-candidate");
  expectCode(() => assertBackgroundRemovedCandidate({
    ...candidate,
    appProperties: { ...candidate.appProperties, sourceAssetId: "" },
  }), "background_candidate_not_found");
  expectCode(() => assertBackgroundRemovedCandidate({ ...candidate, mimeType: "image/jpeg" }), "background_candidate_not_found");
});

test("candidate preview route rejects path traversal and malformed IDs", () => {
  assert.equal(
    parseCandidatePreviewPath("/api/branding/background-removal/candidates/abc_DEF-123/preview"),
    "abc_DEF-123",
  );
  assert.equal(parseCandidatePreviewPath("/api/branding/background-removal/candidates/a%2Fb/preview"), null);
  assert.equal(parseCandidatePreviewPath("/api/branding/background-removal/candidates/../preview"), null);
});
