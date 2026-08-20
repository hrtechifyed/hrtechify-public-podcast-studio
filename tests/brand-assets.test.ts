import assert from "node:assert/strict";
import test from "node:test";
import {
  BrandAssetValidationError,
  MAX_BRAND_ASSET_BYTES,
  parseBrandAssetUploadInput,
  validateBrandAssetBody,
} from "../apps/worker/src/brand-assets";

const validInput = () => ({
  showId: "show-1",
  connectionId: "drive-1",
  assetKind: "show-logo-original",
  fileName: "logo.png",
  mimeType: "image/png",
  contentLength: 4,
});

const expectError = (fn: () => unknown, code: string, status = 400) => {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof BrandAssetValidationError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
};

test("accepts original show logo and profile photo inputs", () => {
  const logo = parseBrandAssetUploadInput(validInput());
  assert.equal(logo.assetKind, "show-logo-original");
  assert.equal(logo.mimeType, "image/png");

  const profile = parseBrandAssetUploadInput({
    ...validInput(),
    assetKind: "profile-photo-original",
    fileName: "profile.webp",
    mimeType: "image/webp",
  });
  assert.equal(profile.assetKind, "profile-photo-original");
});

test("rejects unsafe filenames and unsupported image types", () => {
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), fileName: "../logo.png" }),
    "file_name_invalid",
  );
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), mimeType: "image/svg+xml" }),
    "brand_asset_mime_type_not_allowed",
  );
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), mimeType: "text/html" }),
    "brand_asset_mime_type_not_allowed",
  );
});

test("rejects unknown asset kinds", () => {
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), assetKind: "show-logo-processed" }),
    "brand_asset_kind_invalid",
  );
});

test("rejects missing, non-integer, zero and oversized declared sizes", () => {
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), contentLength: null }),
    "content_length_required",
  );
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), contentLength: 1.5 }),
    "content_length_required",
  );
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), contentLength: 0 }),
    "content_length_required",
  );
  expectError(
    () => parseBrandAssetUploadInput({ ...validInput(), contentLength: MAX_BRAND_ASSET_BYTES + 1 }),
    "brand_asset_too_large",
    413,
  );
});

test("actual bytes must match declared size", () => {
  assert.deepEqual(
    [...validateBrandAssetBody(new Uint8Array([1, 2, 3, 4]), 4)],
    [1, 2, 3, 4],
  );
  expectError(
    () => validateBrandAssetBody(new Uint8Array([1, 2, 3]), 4),
    "content_length_mismatch",
  );
  expectError(
    () => validateBrandAssetBody(new Uint8Array(), 0),
    "brand_asset_empty",
  );
  expectError(
    () => validateBrandAssetBody(new Uint8Array(MAX_BRAND_ASSET_BYTES + 1), MAX_BRAND_ASSET_BYTES),
    "brand_asset_too_large",
    413,
  );
});
