import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDriveMultipartUpload,
  MAX_SMALL_DRIVE_UPLOAD_BYTES,
  parseSmallDriveUploadBody,
  SmallDriveUploadValidationError,
} from "../apps/worker/src/drive-upload";

const validBody = () => ({
  showId: "show-1",
  connectionId: "drive-1",
  folder: "brand-assets",
  fileName: "logo.png",
  mimeType: "image/png",
  contentBase64: "AQIDBA==",
});

const expectValidationError = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SmallDriveUploadValidationError);
    assert.equal(error.code, code);
    return true;
  });
};

test("parses an allowed small upload", () => {
  const parsed = parseSmallDriveUploadBody(validBody());
  assert.equal(parsed.showId, "show-1");
  assert.equal(parsed.connectionId, "drive-1");
  assert.equal(parsed.folder, "brand-assets");
  assert.equal(parsed.fileName, "logo.png");
  assert.equal(parsed.mimeType, "image/png");
  assert.deepEqual([...parsed.bytes], [1, 2, 3, 4]);
});

test("rejects path-like or control-character filenames", () => {
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), fileName: "../secret.png" }),
    "file_name_invalid",
  );
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), fileName: "folder\\secret.png" }),
    "file_name_invalid",
  );
});

test("rejects executable browser content types", () => {
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), mimeType: "text/html" }),
    "mime_type_not_allowed",
  );
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), mimeType: "application/javascript" }),
    "mime_type_not_allowed",
  );
});

test("rejects malformed base64", () => {
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), contentBase64: "%%%=" }),
    "content_base64_invalid",
  );
});

test("rejects empty content", () => {
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), contentBase64: "" }),
    "content_base64_required",
  );
});

test("rejects files larger than the small-upload ceiling before Drive I/O", () => {
  const tooLarge = Buffer.alloc(MAX_SMALL_DRIVE_UPLOAD_BYTES + 1, 1).toString("base64");
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), contentBase64: tooLarge }),
    "file_too_large",
  );
});

test("rejects unsupported target folders", () => {
  expectValidationError(
    () => parseSmallDriveUploadBody({ ...validBody(), folder: "templates" }),
    "drive_folder_invalid",
  );
});

test("builds Drive multipart/related payload without changing binary bytes", async () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const boundary = "hrtechify_test_boundary_123";
  const { body, contentType } = buildDriveMultipartUpload({
    boundary,
    metadata: {
      name: "sample.bin",
      parents: ["parent-1"],
      appProperties: { showId: "show-1" },
    },
    mimeType: "application/octet-stream",
    bytes,
  });

  assert.equal(contentType, `multipart/related; boundary=${boundary}`);
  const payload = new Uint8Array(await body.arrayBuffer());
  const marker = new TextEncoder().encode("\r\n--hrtechify_test_boundary_123--\r\n");
  const binaryStartText = new TextEncoder().encode("Content-Type: application/octet-stream\r\n\r\n");

  const findSequence = (haystack: Uint8Array, needle: Uint8Array) => {
    for (let i = 0; i <= haystack.length - needle.length; i += 1) {
      let matches = true;
      for (let j = 0; j < needle.length; j += 1) {
        if (haystack[i + j] !== needle[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return i;
    }
    return -1;
  };

  const headerIndex = findSequence(payload, binaryStartText);
  const endIndex = findSequence(payload, marker);
  assert.ok(headerIndex >= 0);
  assert.ok(endIndex > headerIndex);
  const binaryStart = headerIndex + binaryStartText.length;
  assert.deepEqual([...payload.slice(binaryStart, binaryStart + bytes.length)], [...bytes]);
});
