import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("database/migrations/0009_publish_preferences.sql");
const analysis = read("apps/worker/src/editorial-analysis.ts");
const artifactDrive = read("apps/worker/src/google-drive-publish-artifacts.ts");
const preferences = read("apps/worker/src/publish-preferences.ts");
const preferencesApi = read("apps/worker/src/publish-preferences-api.ts");
const jobs = read("apps/worker/src/render-jobs.ts");
const workflow = read("apps/worker/src/render-workflow.ts");
const container = read("apps/worker/src/render-container.ts");
const templates = read("packages/templates/src/index.ts");
const renderer = read("packages/renderer/src/index.ts");
const ui = read("apps/web/src/RenderTechnicalMasterPanel.tsx");
const preferenceUi = read("apps/web/src/PublishPreferencesPanel.tsx");
const privacy = read("apps/web/src/PrivacyPage.tsx");
const index = read("apps/worker/src/index.ts");


test("Stage 8 stores exact caption timing and source WebVTT in user Drive, not transcript text in D1", () => {
  assert.match(analysis, /createCaptionTimingDocument/);
  assert.match(analysis, /buildWebVtt\(exactWords\)/);
  assert.match(analysis, /assetKind: "caption-word-timings"/);
  assert.match(analysis, /assetKind: "source-captions-vtt"/);
  assert.match(analysis, /analysisRunId/);
  assert.doesNotMatch(migration, /transcript/i);
  assert.match(privacy, /D1 does not store the transcript text/);
});

test("caption artifacts and final outputs are immutable, source-bound and retry-idempotent", () => {
  assert.match(artifactDrive, /immutable: "true"/);
  assert.match(artifactDrive, /sourceFileId: input\.sourceFileId/);
  assert.match(artifactDrive, /analysisRunId/);
  assert.match(artifactDrive, /renderJobId/);
  assert.match(artifactDrive, /findGoogleDriveEpisodePublishArtifact/);
  assert.match(artifactDrive, /const existing = await findGoogleDriveEpisodePublishArtifact/);
  assert.match(workflow, /existingCaptions/);
  assert.match(workflow, /existingMp3/);
  assert.match(workflow, /existingMp4/);
});

test("final caption timing uses only approved cuts and is offset by intro duration", () => {
  assert.match(renderer, /transformCaptionWordsForApprovedCuts/);
  assert.match(workflow, /plan\.approvedEdits\.map/);
  assert.match(workflow, /intro\.durationMs/);
  assert.match(workflow, /const finalVtt = buildWebVtt\(transformedWords\)/);
  assert.match(workflow, /final-captions-vtt/);
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
  assert.match(container, /CREDIT_TEXT_PATH/);
  assert.match(container, /x=w-tw-48:y=h-th-36/);
});

test("render plan snapshots exact analysis, curated template, text, captions and fixed outputs server-side", () => {
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
});

test("Stage 10 creates fixed MP3 and MP4 outputs in the no-internet container", () => {
  assert.match(container, /enableInternet = false/);
  assert.match(container, /libmp3lame/);
  assert.match(container, /"-b:a", "192k"/);
  assert.match(container, /libx264/);
  assert.match(container, /"-pix_fmt", "yuv420p"/);
  assert.match(container, /"-c:a", "aac"/);
  assert.match(container, /render_final_timing_integrity_failed/);
  assert.doesNotMatch(container, /googleapis\.com|GOOGLE_DRIVE_CLIENT|TOKEN_ENCRYPTION_KEY/);
});

test("intro and outro are immutable optional inputs and are never overwritten", () => {
  assert.match(workflow, /listStudioBrandMedia/);
  assert.match(workflow, /show-intro-original/);
  assert.match(workflow, /show-outro-original/);
  assert.match(workflow, /appProperties\.original !== "true"/);
  assert.match(workflow, /appProperties\.immutable !== "true"/);
  assert.match(workflow, /loadBrandMedia\("intro"/);
  assert.match(workflow, /loadBrandMedia\("outro"/);
});

test("job completes only after final WebVTT MP3 and MP4 are verified", () => {
  const uploadCaptions = workflow.indexOf("final-captions-vtt");
  const uploadMp3 = workflow.indexOf("final-podcast-mp3");
  const uploadMp4 = workflow.indexOf("final-podcast-mp4");
  const complete = workflow.lastIndexOf("completeRenderJob(db, job.id)");
  assert.ok(uploadCaptions >= 0 && uploadMp3 > uploadCaptions && uploadMp4 > uploadMp3 && complete > uploadMp4);
  assert.match(workflow, /mp3\.mimeType !== "audio\/mpeg"/);
  assert.match(workflow, /mp4\.mimeType !== "video\/mp4"/);
});

test("UI exposes curated template choice and final Drive outputs without sending a render plan", () => {
  assert.match(preferenceUi, /Save final-publish settings/);
  assert.match(preferenceUi, /templateId, captionsEnabled/);
  assert.match(preferenceUi, /Powered by HRTechify/);
  assert.match(ui, /Create final MP3 \+ MP4/);
  assert.match(ui, /WebVTT captions/);
  assert.match(ui, /Final MP3/);
  assert.match(ui, /Final MP4/);
  assert.match(ui, /method: "POST"/);
  assert.doesNotMatch(ui, /body: JSON\.stringify/);
});

test("publish preference route executes before render and generic Episode handlers", () => {
  const handlerSection = index.slice(index.indexOf("const handlers = ["));
  const prefPosition = handlerSection.indexOf("handlePublishPreferencesApi,");
  const renderPosition = handlerSection.indexOf("handleRenderApi,");
  const episodePosition = handlerSection.indexOf("handleEpisodeApi,");
  assert.ok(prefPosition >= 0 && renderPosition > prefPosition && episodePosition > renderPosition);
});

test("privacy page discloses persistent Drive caption timing, safe templates and immutable final outputs", () => {
  assert.match(privacy, /exact recognized word tokens and their timestamps/);
  assert.match(privacy, /curated declarative templates/);
  assert.match(privacy, /downloadable WebVTT caption file/);
  assert.match(privacy, /separate final MP3, final MP4 and final WebVTT/);
  assert.match(privacy, /public internet access disabled/);
  assert.match(privacy, /PLATFORM_CREDIT/);
});
