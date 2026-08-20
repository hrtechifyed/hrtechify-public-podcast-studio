import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audio = await readFile(new URL("../packages/audio/src/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../database/migrations/0007_editorial_edit_approval.sql", import.meta.url), "utf8");
const store = await readFile(new URL("../apps/worker/src/editorial-edits.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../apps/worker/src/editorial-edits-api.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../apps/worker/src/schema-readiness.ts", import.meta.url), "utf8");
const index = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");
const approvalUi = await readFile(new URL("../apps/web/src/EditorialApprovalPanel.tsx", import.meta.url), "utf8");
const episodeUi = await readFile(new URL("../apps/web/src/EpisodeList.tsx", import.meta.url), "utf8");

test("one shared audio contract defines every editorial proposal kind and requires approval", () => {
  assert.match(audio, /SPEECH_EDIT_KINDS/);
  for (const kind of [
    "unusual_pause",
    "false_start",
    "repeated_speech",
    "fumble",
    "spoken_content_removal",
  ]) {
    assert.match(audio, new RegExp(`"${kind}"`));
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.match(audio, /approvalRequired: true/);
  assert.match(audio, /ORIGINAL_RECORDING_IS_IMMUTABLE = true/);
  assert.match(store, /SPEECH_EDIT_KINDS/);
});

test("analysis and decision history are append-only and latest analysis is deterministic", () => {
  assert.match(migration, /sequence INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(migration, /idx_edit_analysis_one_active_per_episode/);
  assert.match(migration, /WHERE status = 'analyzing'/);
  assert.match(migration, /episode_edit_decisions/);
  assert.match(store, /INSERT INTO episode_edit_decisions/);
  assert.doesNotMatch(store, /UPDATE episode_edit_decisions/);
  assert.doesNotMatch(store, /DELETE FROM episode_edit_decisions/);
  assert.match(store, /ORDER BY sequence DESC/);
  assert.match(store, /MAX\(d2\.sequence\)/);
});

test("partial or failed analysis runs cannot become user-visible proposals", () => {
  assert.match(store, /status = 'completed'/);
  assert.match(store, /latestCompletedRunId/);
  assert.match(store, /p\.analysis_run_id = \?/);
  assert.match(store, /status = 'failed'/);
  assert.match(store, /episode_source_not_immutable/);
  assert.match(store, /edit_analysis_source_mismatch/);
});

test("proposal ranges and confidence are validated before persistence", () => {
  assert.match(store, /Number\.isSafeInteger\(input\.startMs\)/);
  assert.match(store, /Number\.isSafeInteger\(input\.endMs\)/);
  assert.match(store, /input\.endMs <= input\.startMs/);
  assert.match(store, /confidence < 0 \|\| confidence > 1/);
  assert.match(store, /too_many_edit_proposals/);
  assert.match(migration, /CHECK \(end_ms > start_ms\)/);
  assert.match(migration, /confidence >= 0 AND confidence <= 1/);
});

test("browser API can read proposals and record decisions but cannot fabricate proposals", () => {
  assert.match(api, /edit-proposals/);
  assert.match(api, /request\.method !== "GET"/);
  assert.match(api, /request\.method !== "POST"/);
  assert.match(api, /recordEditorialDecision/);
  assert.doesNotMatch(api, /completeEditorialAnalysisRun/);
  assert.doesNotMatch(api, /createEditorialAnalysisRun/);
  assert.match(api, /requireVerifiedIdentity/);
  assert.match(api, /getEpisodeForUser\(db, identity\.userId, episodeId\)/);
});

test("editorial routes are schema-gated and run before the generic episode handler", () => {
  assert.match(schema, /EDITORIAL_APPROVAL_TABLES/);
  assert.match(schema, /episode_edit_analysis_runs/);
  assert.match(schema, /episode_edit_proposals/);
  assert.match(schema, /episode_edit_decisions/);
  assert.match(api, /editorial_approval_schema_not_ready/);
  const editorialPosition = index.indexOf("handleEditorialEditsApi(request, url, env)");
  const episodePosition = index.indexOf("handleEpisodeApi(request, url, env)");
  assert.ok(editorialPosition >= 0 && episodePosition > editorialPosition);
});

test("every proposal has explicit Apply in final edit and Keep Original controls", () => {
  assert.match(approvalUi, /Apply in final edit/);
  assert.match(approvalUi, /Keep Original/);
  assert.match(approvalUi, /body: JSON\.stringify\(\{ decision \}\)/);
  assert.match(approvalUi, /proposal\.decision === "apply"/);
  assert.match(approvalUi, /proposal\.decision === "keep_original"/);
  assert.match(approvalUi, /Current decision:/);
  assert.match(episodeUi, /<EditorialApprovalPanel/);
});

test("approval UI explicitly promises that decisions never overwrite the immutable source", () => {
  assert.match(approvalUi, /proposal only/);
  assert.match(approvalUi, /later derived edit/);
  assert.match(approvalUi, /Neither decision overwrites, trims or replaces your immutable source recording/);
  assert.match(approvalUi, /The original source remains unchanged/);
  assert.doesNotMatch(approvalUi, /delete original|overwrite original/i);
});

test("all decided proposals advance only to render confirmation and approved plan filters Apply decisions", () => {
  assert.match(store, /unresolved/);
  assert.match(store, /NOT EXISTS/);
  assert.match(store, /status = 'awaiting_render_confirmation'/);
  assert.match(store, /status = 'awaiting_edit_approval'/);
  assert.match(store, /listApprovedEditorialEdits/);
  assert.match(store, /proposal\.decision === "apply"/);
  assert.doesNotMatch(store, /status = 'rendering'.*recordEditorialDecision/s);
});
