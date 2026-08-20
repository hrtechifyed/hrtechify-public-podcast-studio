import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const analysis = await readFile(new URL("../apps/worker/src/editorial-analysis.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../apps/worker/src/editorial-edits-api.ts", import.meta.url), "utf8");
const db = await readFile(new URL("../apps/worker/src/db.ts", import.meta.url), "utf8");
const storage = await readFile(new URL("../apps/worker/src/studio-storage.ts", import.meta.url), "utf8");
const wrangler = await readFile(new URL("../apps/worker/wrangler.jsonc", import.meta.url), "utf8");
const approvalUi = await readFile(new URL("../apps/web/src/EditorialApprovalPanel.tsx", import.meta.url), "utf8");
const privacy = await readFile(new URL("../apps/web/src/PrivacyPage.tsx", import.meta.url), "utf8");

test("Workers AI and Media bindings are configured without adding secrets", () => {
  assert.match(wrangler, /"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/s);
  assert.match(wrangler, /"media"\s*:\s*\{\s*"binding"\s*:\s*"MEDIA"/s);
  assert.match(db, /AI\?: AiBindingLike/);
  assert.match(db, /MEDIA\?: MediaBindingLike/);
  assert.doesNotMatch(wrangler, /CLOUDFLARE_API_TOKEN|AI_API_KEY|MEDIA_API_KEY/);
});

test("analysis is tied to the exact tenant-owned immutable Episode source across providers", () => {
  assert.match(analysis, /getShowForUser\(db, userId, episode\.show_id\)/);
  assert.match(analysis, /getStorageConnectionForUser\(db, userId, episode\.source_storage_connection_id\)/);
  assert.match(analysis, /createStudioStorageSession\(env, db, userId, connection\)/);
  assert.match(analysis, /downloadOwnedFile\(show\.id, show\.name, episode\.source_file_id\)/);
  assert.match(analysis, /download\.file\.provider !== episode\.source_provider/);
  assert.match(analysis, /assetKind !== "original-recording"/);
  assert.match(analysis, /immutable !== "true"/);
  assert.match(analysis, /show\.storage_connection_id !== connection\.id/);
  assert.match(storage, /requireDropboxAssetRecord/);
});

test("inline transcription is memory-bounded before Workers AI input is built", () => {
  assert.match(analysis, /MAX_INLINE_TRANSCRIPTION_BYTES = 10 \* 1024 \* 1024/);
  assert.match(analysis, /total > MAX_INLINE_TRANSCRIPTION_BYTES/);
  assert.match(analysis, /analysis_source_too_large_for_inline_worker/);
  assert.match(analysis, /reader\.cancel/);
  assert.match(analysis, /Array\.from\(bytes\)/);
});

test("Whisper timing output is validated before detectors use it", () => {
  assert.match(analysis, /@cf\/openai\/whisper/);
  assert.match(analysis, /normalizeWhisperWords/);
  assert.match(analysis, /Number\.isFinite\(item\.start\)/);
  assert.match(analysis, /Number\.isFinite\(item\.end\)/);
  assert.match(analysis, /endMs <= startMs/);
  assert.match(analysis, /startMs < previousEndMs/);
  assert.match(analysis, /analysis_transcript_timestamps_missing/);
});

test("video analysis extracts audio through Media Transformations and never returns transformed media", () => {
  assert.match(analysis, /env\.MEDIA\.input\(body\)\.output\(\{ mode: "audio" \}\)\.response\(\)/);
  assert.match(analysis, /mimeType\.startsWith\("video\/"\)/);
  assert.doesNotMatch(api, /audioBytes|transformedMedia|transcriptText/);
});

test("detectors are conservative and never create general spoken-content-removal proposals", () => {
  assert.match(analysis, /LONG_PAUSE_THRESHOLD_MS = 2500/);
  assert.match(analysis, /detectImmediateRepeatedSpeech/);
  assert.match(analysis, /\["false_start", "repeated_speech", "fumble"\]/);
  assert.match(analysis, /SEMANTIC_CONFIDENCE_THRESHOLD = 0\.86/);
  assert.doesNotMatch(analysis, /kind:\s*"spoken_content_removal"/);
  assert.match(analysis, /Never propose general content removal/);
  assert.match(analysis, /accent, dialect, grammar choice/);
});

test("semantic output is JSON-schema constrained and then independently validated server-side", () => {
  assert.match(analysis, /response_format: \{ type: "json_schema", json_schema: semanticSchema \}/);
  assert.match(analysis, /temperature: 0/);
  assert.match(analysis, /Number\.isSafeInteger/);
  assert.match(analysis, /candidate\.confidence < SEMANTIC_CONFIDENCE_THRESHOLD/);
  assert.match(analysis, /startWord < allowedStart/);
  assert.match(analysis, /endWord > allowedEnd/);
});

test("Analyze endpoint invokes only the server-owned analyzer and returns proposals, not edited media", () => {
  assert.match(api, /\/api\\\/episodes\\\/\(\[\^\/\]\+\)\\\/analyze/);
  assert.match(api, /runEditorialAnalysis\(env, db, identity\.userId, episode\)/);
  assert.match(api, /request\.method !== "POST"/);
  assert.match(api, /listLatestEditorialProposals/);
  assert.doesNotMatch(api, /completeEditorialAnalysisRun/);
  assert.doesNotMatch(api, /createEditorialAnalysisRun/);
  assert.doesNotMatch(api, /render|ffmpeg|trim|deleteFile/i);
});

test("approval UI makes analysis explicit and preserves the existing approval barrier", () => {
  assert.match(approvalUi, /Analyze original recording/);
  assert.match(approvalUi, /\/api\/episodes\/\$\{encodeURIComponent\(episodeId\)\}\/analyze/);
  assert.match(approvalUi, /Transcribing the immutable original and looking for clear edit candidates/);
  assert.match(approvalUi, /Apply in final edit/);
  assert.match(approvalUi, /Keep Original/);
  assert.match(approvalUi, /does not edit the file/);
  assert.match(approvalUi, /Neither decision overwrites, trims or replaces/);
});

test("privacy page discloses Workers AI analysis and storage-persisted caption timing", () => {
  assert.match(privacy, /Podcast transcription, captions and edit analysis/);
  assert.match(privacy, /Analyze original recording/);
  assert.match(privacy, /Cloudflare Workers AI/);
  assert.match(privacy, /Cloudflare Media Transformations/);
  assert.match(privacy, /D1 does not store the transcript text/);
  assert.match(privacy, /exact recognized word tokens\/timestamps/);
  assert.match(privacy, /saved as separate immutable files in the episode&apos;s assigned storage/);
  assert.match(privacy, /unrelated to Gmail/);
});
