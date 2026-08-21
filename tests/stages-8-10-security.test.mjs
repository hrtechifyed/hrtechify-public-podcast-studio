import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("database/migrations/0009_publish_preferences.sql");
const analysis = read("apps/worker/src/editorial-analysis.ts");
const artifactDrive = read("apps/worker/src/google-drive-publish-artifacts.ts");
const artifactStorage = read("apps/worker/src/storage-publish-artifacts.ts");
const preferences = read("apps/worker/src/publish-preferences.ts");
const preferencesApi = read("apps/worker/src/publish-preferences-api.ts");
const jobs = read("apps/worker/src/render-jobs.ts");
const renderApi = read("apps/worker/src/render-api.ts");
const browserRenderer = read("apps/web/src/browser-renderer.ts");
const templates = read("packages/templates/src/index.ts");
const renderer = read("packages/renderer/src/index.ts");
const ui = read("apps/web/src/RenderTechnicalMasterPanel.tsx");
const preferenceUi = read("apps/web/src/PublishPreferencesPanel.tsx");
const privacy = read("apps/web/src/PrivacyPage.tsx");
const index = read("apps/worker/src/index.ts");
const wrangler = read("apps/worker/wrangler.jsonc");

test("Stage 8 stores exact caption timing and source WebVTT in user storage, not transcript text in D1", () => {
  assert.match(analysis, /createCaptionTimingDocument/);
  assert.match(analysis, /buildWebVtt\(exactWords\)/);
  assert.match(analysis, /assetKind: "caption-word-timings"/);
  assert.match(analysis, /assetKind: "source-captions-vtt"/);
  assert.match(analysis, /analysisRunId/);
  assert.doesNotMatch(migration, /transcript/i);
  assert.match(privacy, /D1 does not store transcript text/);
});

test("caption artifacts and final outputs remain immutable source-bound and retry-idempotent", () => {
  assert.match(artifactDrive, /immutable: "true"/);
  assert.match(artifactDrive, /sourceFileId: input\.sourceFileId/);
  assert.match(artifactDrive, /analysisRunId/);
  assert.match(artifactDrive, /renderJobId/);
  assert.match(artifactDrive, /findGoogleDriveEpisodePublishArtifact/);
  assert.match(artifactDrive, /const existing = await findGoogleDriveEpisodePublishArtifact/);
  assert.match(artifactStorage, /findEpisodePublishArtifact/);
  assert.match(artifactStorage, /immutable: true/);
  assert.match(artifactStorage, /renderJobId/);
});

test("final caption timing uses only approved cuts and is offset by intro duration on-device", () => {
  assert.match(renderer, /transformCaptionWordsForApprovedCuts/);
  assert.match(browserRenderer, /transformCaptionWordsForApprovedCuts\(timing\.words, cuts, introDurationMs\)/);
  assert.match(browserRenderer, /const cuts = validateCuts\(manifest\.plan\.approvedEdits, sourceDurationMs\)/);
  assert.match(browserRenderer, /const vtt = buildWebVtt\(words\)/);
  assert.match(renderApi, /final-captions-vtt/);
});

test("Stage 9 stores only curated template identity and caption preference", () => {
  assert.match(migration, /template_id TEXT NOT NULL/);
  assert.match(migration, /template_version INTEGER NOT NULL/);
  assert.match(migration, /captions_enabled INTEGER NOT NULL/);
  assert.doesNotMatch(migration, /ffmpeg|filter|shell|command|font_file|codec/i);
  assert.match(preferences, /getSafeTemplateManifest/);
  assert.match(preferencesApi, /templateId: body\.templateId/);
  assert.match(preferencesApi, /captionsEnabled: body\.captionsEnabled/);
  assert.doesNotMatch(preferencesApi, /ffmpeg|filterGraph|shell|codec/i);
});

test("curated templates hardwire mandatory non-removable HRTechify credit", () => {
  assert.match(templates, /Powered by HRTechify|PLATFORM_CREDIT/);
  assert.match(templates, /required: true/);
  assert.match(templates, /removable: false/);
  assert.match(templates, /position: PLATFORM_CREDIT_POSITION/);
  assert.match(jobs, /platformCredit/);
  assert.match(browserRenderer, /platformCredit\.required !== true/);
  assert.match(browserRenderer, /platformCredit\.removable !== false/);
  assert.match(browserRenderer, /platformCredit\.text/);
});

test("render plan snapshots exact analysis curated template text captions and fixed outputs server-side", () => {
  assert.match(jobs, /version: "render-plan-v2"/);
  assert.match(jobs, /analysisRunId/);
  assert.match(jobs, /template/);
  assert.match(jobs, /captionsEnabled/);
  assert.match(jobs, /showName: show\.name/);
  assert.match(jobs, /episodeName: episode\.title/);
  assert.match(jobs, /hostName: show\.host_display_name/);
  assert.match(jobs, /final-podcast-mp3/);
  assert.match(jobs, /final-podcast-mp4/);
  assert.match(jobs, /final-captions-vtt/);
  assert.doesNotMatch(renderApi, /body\.templateId|body\.approvedEdits|body\.cleanup|body\.command/);
});

test("Stage 10 creates fixed MP3 and MP4 outputs on the user's device without paid rendering bindings", () => {
  const config = JSON.parse(wrangler);
  assert.equal(config.containers, undefined);
  assert.equal(config.workflows, undefined);
  assert.equal(config.media, undefined);
  assert.match(browserRenderer, /@ffmpeg\/ffmpeg/);
  assert.match(browserRenderer, /libmp3lame/);
  assert.match(browserRenderer, /"-b:a", "192k"/);
  assert.match(browserRenderer, /libx264/);
  assert.match(browserRenderer, /"yuv420p"/);
  assert.match(browserRenderer, /"aac"/);
  assert.doesNotMatch(browserRenderer, /googleapis\.com|dropboxapi\.com|GOOGLE_DRIVE_CLIENT|DROPBOX_CLIENT|TOKEN_ENCRYPTION_KEY/);
});

test("intro and outro remain immutable optional inputs selected server-side", () => {
  assert.match(renderApi, /listStudioBrandMedia/);
  assert.match(renderApi, /show-intro-original/);
  assert.match(renderApi, /show-outro-original/);
  assert.match(renderApi, /selectLatestBrandMedia/);
  assert.match(renderApi, /mediaAsset\(intro\)/);
  assert.match(renderApi, /mediaAsset\(outro\)/);
  assert.doesNotMatch(browserRenderer, /delete.*intro|delete.*outro/i);
});

test("job completes only after technical master WebVTT MP3 and MP4 are found and verified", () => {
  assert.match(renderApi, /findEpisodePublishArtifact[\s\S]*derived-technical-master/);
  assert.match(renderApi, /findEpisodePublishArtifact[\s\S]*final-captions-vtt/);
  assert.match(renderApi, /findEpisodePublishArtifact[\s\S]*final-podcast-mp3/);
  assert.match(renderApi, /findEpisodePublishArtifact[\s\S]*final-podcast-mp4/);
  assert.match(renderApi, /render_outputs_incomplete/);
  const incomplete = renderApi.indexOf("render_outputs_incomplete");
  const complete = renderApi.indexOf("completeRenderJob(db, job.id)");
  assert.ok(incomplete >= 0 && complete > incomplete);
});

test("UI exposes curated template choice and final outputs while server owns the render plan", () => {
  assert.match(preferenceUi, /Save final-publish settings/);
  assert.match(preferenceUi, /templateId, captionsEnabled/);
  assert.match(preferenceUi, /Powered by HRTechify/);
  assert.match(ui, /Create final MP3 \+ MP4/);
  assert.match(ui, /WebVTT captions/);
  assert.match(ui, /Final MP3/);
  assert.match(ui, /Final MP4/);
  assert.match(ui, /Generation happens on this device/);
  assert.doesNotMatch(ui, /approvedEdits:\s*|technicalPlan:\s*|filterGraph:\s*|command:\s*/);
});

test("publish preference route executes before render and generic Episode handlers", () => {
  const handlerSection = index.slice(index.indexOf("const handlers = ["));
  const prefPosition = handlerSection.indexOf("handlePublishPreferencesApi,");
  const renderPosition = handlerSection.indexOf("handleRenderApi,");
  const episodePosition = handlerSection.indexOf("handleEpisodeApi,");
  assert.ok(prefPosition >= 0 && renderPosition > prefPosition && episodePosition > renderPosition);
});

test("privacy page discloses persistent caption timing safe templates immutable outputs and on-device processing", () => {
  assert.match(privacy, /Exact recognized word tokens\/timestamps/);
  assert.match(privacy, /curated declarative templates/);
  assert.match(privacy, /downloadable WebVTT caption file/);
  assert.match(privacy, /technical master, WebVTT captions, MP3 and MP4/);
  assert.match(privacy, /Final podcast generation runs on your device/);
  assert.match(privacy, /paid Cloudflare Container/);
  assert.match(privacy, /Powered by HRTechify|PLATFORM_CREDIT/);
});
