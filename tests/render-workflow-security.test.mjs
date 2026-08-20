import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("database/migrations/0008_render_jobs.sql");
const jobs = read("apps/worker/src/render-jobs.ts");
const api = read("apps/worker/src/render-api.ts");
const workflow = read("apps/worker/src/render-workflow.ts");
const container = read("apps/worker/src/render-container.ts");
const drive = read("apps/worker/src/google-drive-derived.ts");
const index = read("apps/worker/src/index.ts");
const wrangler = read("apps/worker/wrangler.jsonc");
const dockerfile = read("apps/worker/Dockerfile.render");
const ui = read("apps/web/src/RenderTechnicalMasterPanel.tsx");
const privacy = read("apps/web/src/PrivacyPage.tsx");

test("render jobs are append-only snapshots with only one active job per episode", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS episode_render_jobs/);
  assert.match(migration, /workflow_instance_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /idx_render_jobs_one_active_per_episode/);
  assert.match(migration, /WHERE status IN \('queued', 'processing'\)/);
  assert.match(jobs, /technical_plan_json/);
  assert.match(jobs, /approved_edits_json/);
  assert.match(jobs, /sourceImmutable: true/);
});

test("render plan comes from stored approval decisions and fixed technical policy", () => {
  assert.match(jobs, /listLatestEditorialProposals/);
  assert.match(jobs, /proposal\.decision === "apply"/);
  assert.match(jobs, /render_edit_decisions_incomplete/);
  assert.match(jobs, /createTechnicalCleanupPlan\(true\)/);
  assert.doesNotMatch(api, /approvedEdits/);
  assert.doesNotMatch(api, /technicalPlan/);
  assert.doesNotMatch(api, /ffmpeg/i);
});

test("render API is authenticated schema-gated and routed before generic Episode API", () => {
  assert.match(api, /requireVerifiedIdentity/);
  assert.match(api, /getEpisodeForUser\(db, identity\.userId, episodeId\)/);
  assert.match(api, /isRenderJobSchemaReady/);
  assert.match(api, /env\.RENDER_WORKFLOW\.create/);
  const renderPosition = index.indexOf("handleRenderApi(request, url, env)");
  const episodePosition = index.indexOf("handleEpisodeApi(request, url, env)");
  assert.ok(renderPosition >= 0 && episodePosition > renderPosition);
});

test("render source is bounded before container disk use and reverified against the episode snapshot", () => {
  assert.match(workflow, /MAX_RENDER_SOURCE_BYTES = 1024 \* 1024 \* 1024/);
  assert.match(workflow, /episode\.source_size_bytes > MAX_RENDER_SOURCE_BYTES/);
  assert.match(workflow, /render_source_too_large/);
  assert.match(workflow, /sourceMetadata\.sizeBytes !== episode\.source_size_bytes/);
  assert.match(workflow, /render_source_not_immutable_original/);
});

test("FFmpeg container has no public internet and uses direct fixed executable arguments", () => {
  const config = JSON.parse(wrangler);
  assert.equal(config.containers[0].class_name, "PodcastRenderContainer");
  assert.equal(config.containers[0].instance_type, "basic");
  assert.equal(config.containers[0].max_instances, 2);
  assert.equal(config.workflows[0].class_name, "PodcastRenderWorkflow");
  assert.match(container, /enableInternet = false/);
  assert.match(container, /this\.start\(\{ enableInternet: false \}\)/);
  assert.match(container, /this\.requireRuntime\(\)\.exec\(\["tee", path\]/);
  assert.match(container, /"ffmpeg"/);
  assert.doesNotMatch(container, /atempo=/);
  assert.doesNotMatch(container, /asetrate=/);
  assert.doesNotMatch(container, /rubberband=/);
  assert.match(dockerfile, /apk add --no-cache ffmpeg/);
});

test("container verifies timing and performs two-pass loudness and peak normalization", () => {
  assert.match(container, /sourceDurationMs/);
  assert.match(container, /approvedRemovedDurationMs/);
  assert.match(container, /render_timing_integrity_failed/);
  assert.match(container, /print_format=json/);
  assert.match(container, /measured_I=/);
  assert.match(container, /linear=true/);
  assert.match(container, /LOUDNESS_TARGET = -16/);
  assert.match(container, /TRUE_PEAK_TARGET = -1/);
});

test("Drive derived output is immutable idempotent and tied to exact source and render job", () => {
  assert.match(drive, /findGoogleDriveDerivedRenderOutput/);
  assert.match(drive, /assetKind: "derived-technical-master"/);
  assert.match(drive, /immutable: "true"/);
  assert.match(drive, /sourceFileId: input\.sourceFileId/);
  assert.match(drive, /renderJobId: input\.renderJobId/);
  assert.match(drive, /const existing = await findGoogleDriveDerivedRenderOutput/);
  assert.match(drive, /content-range.*bytes 0-/s);
  assert.match(workflow, /assetKind !== "original-recording"/);
  assert.match(workflow, /immutable !== "true"/);
});

test("Google credentials stay in Worker code and are never supplied to the render container", () => {
  assert.doesNotMatch(container, /GOOGLE_DRIVE_CLIENT/);
  assert.doesNotMatch(container, /TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(container, /googleapis\.com/);
  assert.match(workflow, /createGoogleDriveSession/);
  assert.match(workflow, /uploadGoogleDriveDerivedRenderStream/);
  assert.match(privacy, /Google OAuth credentials and Google Drive resumable-upload URLs are never passed into the container/);
});

test("UI requires explicit render confirmation and sends no processing plan from the browser", () => {
  assert.match(ui, /Create final MP3 \+ MP4/);
  assert.match(ui, /method: "POST"/);
  assert.doesNotMatch(ui, /body: JSON\.stringify/);
  assert.match(ui, /Only edit ranges you explicitly marked/);
  assert.match(ui, /original recording is never overwritten or replaced/);
});
