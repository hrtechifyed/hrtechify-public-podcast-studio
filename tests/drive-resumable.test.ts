import assert from "node:assert/strict";
import test from "node:test";
import {
  createResumableUploadToken,
  MAX_RESUMABLE_CHUNK_BYTES,
  nextOffsetFromGoogleRange,
  parseResumableContentRange,
  parseResumableUploadStartBody,
  readResumableUploadToken,
  RESUMABLE_CHUNK_GRANULARITY_BYTES,
  RESUMABLE_UPLOAD_TOKEN_TTL_MS,
  ResumableUploadValidationError,
} from "../apps/worker/src/drive-resumable";

const TWO_MIB = 2 * 1024 * 1024;

const validStart = () => ({
  showId: "show-1",
  connectionId: "drive-1",
  fileName: "episode.webm",
  mimeType: "video/webm",
  totalBytes: TWO_MIB,
});

const expectValidationError = async (
  operation: () => unknown | Promise<unknown>,
  code: string,
) => {
  await assert.rejects(async () => operation(), (error: unknown) => {
    assert.ok(error instanceof ResumableUploadValidationError);
    assert.equal(error.code, code);
    return true;
  });
};

test("accepts a supported large recording and normalizes MIME type", () => {
  const parsed = parseResumableUploadStartBody({ ...validStart(), mimeType: "VIDEO/WEBM" });
  assert.equal(parsed.mimeType, "video/webm");
  assert.equal(parsed.totalBytes, TWO_MIB);
});

test("rejects small-file-sized requests, unsafe names, and unsupported MIME types", () => {
  assert.throws(
    () => parseResumableUploadStartBody({ ...validStart(), totalBytes: 1024 }),
    (error: unknown) => error instanceof ResumableUploadValidationError && error.code === "resumable_total_bytes_invalid",
  );
  assert.throws(
    () => parseResumableUploadStartBody({ ...validStart(), fileName: "../episode.webm" }),
    (error: unknown) => error instanceof ResumableUploadValidationError && error.code === "file_name_invalid",
  );
  assert.throws(
    () => parseResumableUploadStartBody({ ...validStart(), mimeType: "text/html" }),
    (error: unknown) => error instanceof ResumableUploadValidationError && error.code === "mime_type_not_allowed",
  );
});

test("opaque upload token is user-bound and round-trips only for that user", async () => {
  const secret = "test-secret";
  const now = Date.now();
  const sessionUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test123";
  const token = await createResumableUploadToken(
    { ...validStart(), sessionUrl },
    secret,
    "user-1",
    now,
  );

  assert.doesNotMatch(token, /googleapis|upload_id|show-1|drive-1/);
  const payload = await readResumableUploadToken(token, secret, "user-1");
  assert.equal(payload.showId, "show-1");
  assert.equal(payload.connectionId, "drive-1");
  assert.equal(payload.sessionUrl, sessionUrl);
  assert.equal(payload.expiresAt, now + RESUMABLE_UPLOAD_TOKEN_TTL_MS);

  await expectValidationError(
    () => readResumableUploadToken(token, secret, "user-2"),
    "resumable_upload_token_invalid",
  );
});

test("expired upload token cannot resume a stale session", async () => {
  const now = Date.now() - RESUMABLE_UPLOAD_TOKEN_TTL_MS - 1000;
  const token = await createResumableUploadToken(
    {
      ...validStart(),
      sessionUrl: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=expired",
    },
    "test-secret",
    "user-1",
    now,
  );

  await expectValidationError(
    () => readResumableUploadToken(token, "test-secret", "user-1"),
    "resumable_upload_token_expired",
  );
});

test("rejects a non-Google resumable session before encrypting it", async () => {
  await expectValidationError(
    () => createResumableUploadToken(
      { ...validStart(), sessionUrl: "https://example.com/upload/drive/v3/files?upload_id=stolen" },
      "test-secret",
      "user-1",
    ),
    "resumable_session_invalid",
  );
});

test("validates an aligned intermediate chunk", () => {
  const parsed = parseResumableContentRange(
    `bytes 0-${RESUMABLE_CHUNK_GRANULARITY_BYTES - 1}/${TWO_MIB}`,
    String(RESUMABLE_CHUNK_GRANULARITY_BYTES),
    TWO_MIB,
  );
  assert.equal(parsed.start, 0);
  assert.equal(parsed.length, RESUMABLE_CHUNK_GRANULARITY_BYTES);
  assert.equal(parsed.isFinal, false);
});

test("allows a non-aligned final chunk", () => {
  const total = RESUMABLE_CHUNK_GRANULARITY_BYTES * 2 + 12345;
  const start = RESUMABLE_CHUNK_GRANULARITY_BYTES * 2;
  const parsed = parseResumableContentRange(
    `bytes ${start}-${total - 1}/${total}`,
    String(total - start),
    total,
  );
  assert.equal(parsed.isFinal, true);
  assert.equal(parsed.length, 12345);
});

test("rejects range/length/total mismatches and misaligned intermediate chunks", () => {
  const expectSync = (operation: () => unknown, code: string) => {
    assert.throws(operation, (error: unknown) =>
      error instanceof ResumableUploadValidationError && error.code === code,
    );
  };

  expectSync(
    () => parseResumableContentRange("bytes 0-262143/2097152", "262143", TWO_MIB),
    "content_length_mismatch",
  );
  expectSync(
    () => parseResumableContentRange("bytes 0-262143/2097153", "262144", TWO_MIB),
    "content_range_invalid",
  );
  expectSync(
    () => parseResumableContentRange("bytes 1-262144/2097152", "262144", TWO_MIB),
    "resumable_chunk_alignment_invalid",
  );
});

test("rejects chunks above the Worker-side 8 MiB ceiling", () => {
  const length = MAX_RESUMABLE_CHUNK_BYTES + RESUMABLE_CHUNK_GRANULARITY_BYTES;
  const total = length + RESUMABLE_CHUNK_GRANULARITY_BYTES;
  assert.throws(
    () => parseResumableContentRange(`bytes 0-${length - 1}/${total}`, String(length), total),
    (error: unknown) => error instanceof ResumableUploadValidationError && error.code === "resumable_chunk_too_large",
  );
});

test("derives resume offset only from a valid Google committed Range header", () => {
  assert.equal(nextOffsetFromGoogleRange("bytes=0-262143"), 262144);
  assert.equal(nextOffsetFromGoogleRange(null), null);
  assert.equal(nextOffsetFromGoogleRange("bytes=10-20"), null);
  assert.equal(nextOffsetFromGoogleRange("garbage"), null);
});
