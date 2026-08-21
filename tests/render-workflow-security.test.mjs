import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("database/migrations/0008_render_jobs.sql");
const jobs = read("apps/worker/src/render-jobs.ts");
const api = read("apps/worker/src/render-api.ts");
const publish = read("apps/worker/src/storage-publish-artifacts.ts");
const storage = read("apps/worker/src/studio-storage.ts");
const index = read("apps/worker/src/index.ts");
const wrangler = read("apps/worker/wrangler.jsonc");
const browserRenderer = read("apps/web/src/browser-renderer.ts");
const ui = read("apps/web/src/RenderTechnicalMasterPanel.tsx");
const privacy = read("apps/web/src/PrivacyPage.tsx");
const workerPackage = read("apps/worker/package.json");

test("render jobs remain append-only snapshots with only one active job per episode", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS episode_render_jobs/);
  assert.match(migration, /workflow_instance_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /idx_render_jobs_one_active_per_episode/);
  assert.match(migration, /WHERE status IN \('queued', 'processing'\)/);
  assert.match(jobs, /technical_plan_json/);
  assert.match(jobs, /approved_edits_json/);
  assert.match(jobs, /sourceImmutable: true/);
});

test("render plan still comes only from stored approval decisions and fixed technical policy", () => {
  assert.match(jobs, /listLatestEditorialProposals/);
  assert.match(jobs, /proposal\.decision === "apply"/);
  assert.match(jobs, /render_edit_decisions_incomplete/);
  assert.match(jobs, /createTechnicalCleanupPlan\(true\)/);
  assert.match(jobs, /getSafeTemplateManifest/);
  assert.match(jobs, /platformCredit:[\s\S]*required: true[\s\S]*removable: false/);
  assert.doesNotMatch(api, /body\.approvedEdits|body\.technicalPlan|body\.filterGraph|body\.command/);
});

test("zero-bill deployment has no paid Container Workflow Durable Object or Media binding", () => {
  const config = JSON.parse(wrangler);
  assert.equal(config.containers, undefined);
  assert.equal(config.workflows, undefined);
  assert.equal(config.durable_objects, undefined);
  assert.equal(config.media, undefined);
  assert.doesNotMatch(workerPackage, /@cloudflare\/containers/);
  assert.doesNotMatch(index, /PodcastRenderContainer|PodcastRenderWorkflow/);
});

test("render API is authenticated schema-gated and routed before generic Episode API", () => {
  assert.match(api, /requireVerifiedIdentity/);
  assert.match(api, /getEpisodeForUser\(db, identity\.userId, episodeId\)/);
  assert.match(api, /isRenderJobSchemaReady/);
  assert.match(api, /processingMode: "local-browser"/);
  assert.match(api, /zeroBillMode: true/);
  const renderPosition = index.indexOf("handleRenderApi,");
  const episodePosition = index.indexOf("handleEpisodeApi,");
  assert.ok(renderPosition >= 0 && episodePosition > renderPosition);
});

test("browser manifest is tied to the exact immutable source and assigned provider", () => {
  assert.match(api, /episode\.source_immutable !== 1/);
  assert.match(api, /episode\.source_file_id !== job\.source_file_id/);
  assert.match(api, /episode\.source_storage_connection_id !== connection\.id/);
  assert.match(api, /episode\.source_provider !== connection\.provider/);
  assert.match(api, /show\.storage_connection_id !== connection\.id/);
  assert.match(api, /downloadUrl\(connection, show, episode\.source_file_id\)/);
  assert.match(api, /caption-word-timings/);
});

test("browser renderer applies only approved cuts and fixed preservation rules", () => {
  assert.match(browserRenderer, /manifest\.plan\.approvedEdits/);
  assert.match(browserRenderer, /validateCuts/);
  assert.match(browserRenderer, /preserveWords !== true/);
  assert.match(browserRenderer, /preserveTiming !== true/);
  assert.match(browserRenderer, /preservePitch !== true/);
  assert.match(browserRenderer, /preserveSpeakingSpeed !== true/);
  assert.match(browserRenderer, /loudnorm=I=\$\{manifest\.plan\.cleanup\.targetIntegratedLoudnessLkfs\}:TP=\$\{manifest\.plan\.cleanup\.maxTruePeakDbfs\}/);
  assert.doesNotMatch(browserRenderer, /atempo=/);
  assert.doesNotMatch(browserRenderer, /asetrate=/);
  assert.doesNotMatch(browserRenderer, /rubberband=/);
});

test("local renderer creates fixed FLAC WebVTT MP3 and H264 AAC MP4 outputs", () => {
  assert.match(browserRenderer, /"technical\.flac"/);
  assert.match(browserRenderer, /buildWebVtt/);
  assert.match(browserRenderer, /libmp3lame/);
  assert.match(browserRenderer, /"-b:a", "192k"/);
  assert.match(browserRenderer, /libx264/);
  assert.match(browserRenderer, /"yuv420p"/);
  assert.match(browserRenderer, /"aac"/);
  assert.match(browserRenderer, /1920:1080/);
  assert.match(browserRenderer, /platformCredit\.text/);
});

test("browser-created output upload is a fixed allowlist and is reverified before completion", () => {
  assert.match(api, /derived-technical-master/);
  assert.match(api, /final-captions-vtt/);
  assert.match(api, /final-podcast-mp3/);
  assert.match(api, /final-podcast-mp4/);
  assert.match(api, /contentType !== spec\.mimeType/);
  assert.match(api, /totalBytes > spec\.maxBytes/);
  assert.match(api, /render_outputs_incomplete/);
  assert.match(api, /technical\.mimeType !== "audio\/flac"/);
  assert.match(api, /mp3\.mimeType !== "audio\/mpeg"/);
  assert.match(api, /mp4\.mimeType !== "video\/mp4"/);
  assert.match(publish, /immutable: true/);
  assert.match(publish, /renderJobId/);
});

test("provider OAuth credentials stay server-side while browser uses same-origin file routes", () => {
  assert.match(storage, /requireDropboxAssetRecord/);
  assert.doesNotMatch(api, /refresh_token_encrypted|GOOGLE_DRIVE_CLIENT_SECRET|DROPBOX_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(browserRenderer, /refresh_token|GOOGLE_DRIVE_CLIENT|DROPBOX_CLIENT|TOKEN_ENCRYPTION_KEY/);
  assert.match(browserRenderer, /fetch\(asset\.downloadUrl, \{ credentials: "same-origin"/);
  assert.match(privacy, /Provider refresh tokens remain server-side and are never exposed to browser JavaScript/);
});

test("generation requires the explicit on-device performance notice before processing", () => {
  assert.match(ui, /Generation happens on this device/);
  assert.match(ui, /Final processing will run on your computer, not on HRTechify&apos;s servers/);
  assert.match(ui, /Speed depends on your computer, available memory and browser/);
  assert.match(ui, /Keep this tab open until it finishes/);
  assert.match(ui, /Continue generation/);
  assert.match(ui, /Cancel/);
  assert.match(ui, /Create final MP3 \+ MP4/);
  assert.match(ui, /Only edit ranges you explicitly marked/);
  assert.match(ui, /original recording is never overwritten or replaced/);
});
