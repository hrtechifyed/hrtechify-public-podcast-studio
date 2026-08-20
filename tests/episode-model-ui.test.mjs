import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../database/migrations/0006_episode_model.sql", import.meta.url), "utf8");
const episodes = await readFile(new URL("../apps/worker/src/episodes.ts", import.meta.url), "utf8");
const episodeApi = await readFile(new URL("../apps/worker/src/episode-api.ts", import.meta.url), "utf8");
const driveApi = await readFile(new URL("../apps/worker/src/drive-file-api.ts", import.meta.url), "utf8");
const schemaReadiness = await readFile(new URL("../apps/worker/src/schema-readiness.ts", import.meta.url), "utf8");
const workerIndex = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");
const episodeList = await readFile(new URL("../apps/web/src/EpisodeList.tsx", import.meta.url), "utf8");
const mediaPanel = await readFile(new URL("../apps/web/src/ShowBrandMediaPanel.tsx", import.meta.url), "utf8");

test("episode migration preserves the full controlled lifecycle and immutable source identity", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS episodes/);
  for (const status of [
    "draft",
    "source_ready",
    "analyzing",
    "awaiting_edit_approval",
    "awaiting_render_confirmation",
    "rendering",
    "completed",
    "failed",
    "cancelled",
  ]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /source_immutable INTEGER NOT NULL DEFAULT 1 CHECK \(source_immutable = 1\)/);
  assert.match(migration, /UNIQUE \(show_id, source_provider, source_file_id\)/);
});

test("episode creation accepts only a verified immutable show-scoped original and is idempotent by provider", () => {
  assert.match(episodes, /file\.appProperties\.assetKind !== "original-recording"/);
  assert.match(episodes, /file\.appProperties\.immutable !== "true"/);
  assert.match(episodes, /file\.appProperties\.showId !== show\.id/);
  assert.match(episodes, /file\.appProperties\.folder !== "episodes"/);
  assert.match(episodes, /show\.user_id !== userId \|\| connection\.user_id !== userId/);
  assert.match(episodes, /show\.storage_connection_id !== connection\.id/);
  assert.match(episodes, /INSERT OR IGNORE INTO episodes/);
  assert.match(episodes, /source_provider = \? AND source_file_id = \?/);
});

test("verified Drive completion keeps storage success separate from episode tracking availability", () => {
  assert.match(driveApi, /verifyCompletedOriginalRecording/);
  assert.match(driveApi, /isEpisodeSchemaReady\(db\)/);
  assert.match(driveApi, /ensureEpisodeFromVerifiedOriginal/);
  assert.match(driveApi, /episodeTracking: "registered" \| "schema_not_ready" \| "registration_failed"/);
  assert.match(driveApi, /complete: true/);
  assert.match(driveApi, /file: result\.file/);
  assert.match(driveApi, /episodeTracking,/);
  assert.match(driveApi, /episode: episode/);
});

test("episode API is authenticated, schema-gated and show-scoped", () => {
  assert.match(schemaReadiness, /EPISODE_TABLES = \["episodes"\]/);
  assert.match(episodeApi, /requireVerifiedIdentity/);
  assert.match(episodeApi, /isEpisodeSchemaReady\(db\)/);
  assert.match(episodeApi, /episode_schema_not_ready/);
  assert.match(episodeApi, /getShowForUser\(db, identity\.userId, showId\)/);
  assert.match(episodeApi, /listEpisodesForShow\(db, identity\.userId, show\.id\)/);
  assert.match(episodeApi, /updateEpisodeTitleForUser\(db, identity\.userId, episodeId, body\.title\)/);
  assert.match(workerIndex, /handleEpisodeApi/);
});

test("show workspace surfaces episode records and title edits never imply editing the source file", () => {
  assert.match(mediaPanel, /import \{ EpisodeList \}/);
  assert.match(mediaPanel, /<EpisodeList showId=\{showId\} showName=\{showName\} \/>/);
  assert.match(episodeList, /Verified original recordings/);
  assert.match(episodeList, /Refresh episodes/);
  assert.match(episodeList, /Original saved/);
  assert.match(episodeList, /immutable .* original/);
  assert.match(episodeList, /Changing an episode title changes Studio metadata only/);
  assert.match(episodeList, /never renames, edits or replaces the immutable original file/);
  assert.match(episodeList, /✎ Edit title/);
});
