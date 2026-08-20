import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAND_MEDIA_TOKEN_TTL_MS,
  BrandMediaValidationError,
  createBrandMediaUploadToken,
  MAX_BRAND_MEDIA_BYTES,
  parseBrandMediaStartBody,
  readBrandMediaUploadToken,
} from "../apps/worker/src/brand-media-resumable";

const valid = () => ({
  showId: "show-1",
  connectionId: "drive-1",
  assetKind: "show-intro-original",
  fileName: "intro.webm",
  mimeType: "video/webm",
  totalBytes: 4 * 1024 * 1024,
});

const expectCode = async (fn: () => unknown | Promise<unknown>, code: string) => {
  await assert.rejects(Promise.resolve().then(fn), (error: unknown) => {
    assert.ok(error instanceof BrandMediaValidationError);
    assert.equal(error.code, code);
    return true;
  });
};

test("accepts supported intro and outro audio/video media", () => {
  assert.equal(parseBrandMediaStartBody(valid()).assetKind, "show-intro-original");
  assert.equal(parseBrandMediaStartBody({
    ...valid(),
    assetKind: "show-outro-original",
    fileName: "outro.mp3",
    mimeType: "audio/mpeg",
  }).assetKind, "show-outro-original");
});

test("rejects unsafe file names, unsupported MIME and unknown asset kinds", () => {
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), fileName: "../intro.webm" }), BrandMediaValidationError);
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), mimeType: "text/html" }), BrandMediaValidationError);
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), assetKind: "original-recording" }), BrandMediaValidationError);
});

test("requires positive bounded integer total size", () => {
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), totalBytes: 0 }), BrandMediaValidationError);
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), totalBytes: 1.5 }), BrandMediaValidationError);
  assert.throws(() => parseBrandMediaStartBody({ ...valid(), totalBytes: MAX_BRAND_MEDIA_BYTES + 1 }), BrandMediaValidationError);
});

test("opaque upload token round-trips only for the same user", async () => {
  const token = await createBrandMediaUploadToken(
    { ...valid(), sessionUrl: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc" },
    "test-secret",
    "user-1",
  );
  const payload = await readBrandMediaUploadToken(token, "test-secret", "user-1");
  assert.equal(payload.assetKind, "show-intro-original");
  assert.equal(payload.totalBytes, valid().totalBytes);
  await expectCode(() => readBrandMediaUploadToken(token, "test-secret", "user-2"), "brand_media_upload_token_invalid");
});

test("expired upload token is rejected", async () => {
  const token = await createBrandMediaUploadToken(
    { ...valid(), sessionUrl: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc" },
    "test-secret",
    "user-1",
    Date.now() - BRAND_MEDIA_TOKEN_TTL_MS - 1000,
  );
  await expectCode(() => readBrandMediaUploadToken(token, "test-secret", "user-1"), "brand_media_upload_token_expired");
});

test("non-Google resumable session URL is rejected", async () => {
  await expectCode(
    () => createBrandMediaUploadToken({ ...valid(), sessionUrl: "https://evil.example/upload" }, "test-secret", "user-1"),
    "brand_media_upload_token_invalid",
  );
});
