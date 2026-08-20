import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_CREDIT, PLATFORM_CREDIT_POSITION } from "../packages/shared/src/index";
import { getSafeTemplateManifest } from "../packages/templates/src/index";
import {
  normalizeApprovedEditRanges,
  parseStoredRenderPlan,
  type RenderJobRow,
} from "../apps/worker/src/render-jobs";

const jobRow = (technicalPlanJson: string): RenderJobRow => ({
  sequence: 1,
  id: "job-1",
  user_id: "user-1",
  show_id: "show-1",
  episode_id: "episode-1",
  workflow_instance_id: "render-job-1",
  status: "queued",
  source_provider: "google-drive",
  source_storage_connection_id: "connection-1",
  source_file_id: "source-1",
  cleanup_profile_version: "podcast-cleanup-v1",
  approved_edits_json: "[]",
  technical_plan_json: technicalPlanJson,
  derived_file_id: null,
  derived_file_name: null,
  derived_mime_type: null,
  derived_size_bytes: null,
  failure_code: null,
  created_at: "2026-08-20T00:00:00.000Z",
  started_at: null,
  completed_at: null,
  updated_at: "2026-08-20T00:00:00.000Z",
});

test("approved ranges are sorted and overlapping or touching ranges are merged", () => {
  const result = normalizeApprovedEditRanges([
    { id: "b", kind: "fumble", startMs: 2000, endMs: 2500 },
    { id: "a", kind: "false_start", startMs: 1000, endMs: 2100 },
    { id: "c", kind: "repeated_speech", startMs: 2500, endMs: 2800 },
    { id: "d", kind: "unusual_pause", startMs: 5000, endMs: 6000 },
  ]);
  assert.deepEqual(result, [
    {
      startMs: 1000,
      endMs: 2800,
      proposalIds: ["a", "b", "c"],
      kinds: ["false_start", "fumble", "repeated_speech"],
    },
    {
      startMs: 5000,
      endMs: 6000,
      proposalIds: ["d"],
      kinds: ["unusual_pause"],
    },
  ]);
});

test("invalid approved ranges are rejected before a render plan can be persisted", () => {
  assert.throws(
    () => normalizeApprovedEditRanges([
      { id: "x", kind: "fumble", startMs: 1000, endMs: 1000 },
    ]),
    /render_approved_edit_invalid/,
  );
  assert.throws(
    () => normalizeApprovedEditRanges([
      { id: "x", kind: "fumble", startMs: -1, endMs: 100 },
    ]),
    /render_approved_edit_invalid/,
  );
});

test("stored v2 render plan must match immutable source, publication snapshot and fixed output contracts", () => {
  const template = getSafeTemplateManifest("hrtechify-studio-dark", 1);
  const valid = {
    version: "render-plan-v2",
    sourceFileId: "source-1",
    sourceImmutable: true,
    analysisRunId: "analysis-1",
    cleanup: {
      profileVersion: "podcast-cleanup-v1",
      sourceImmutable: true,
      targetIntegratedLoudnessLkfs: -16,
      loudnessToleranceDb: 1,
      maxTruePeakDbfs: -1,
      preserveWords: true,
      preserveTiming: true,
      preservePitch: true,
      preserveSpeakingSpeed: true,
      adjustments: [],
    },
    approvedEdits: [],
    publication: {
      template,
      captionsEnabled: true,
      display: {
        showName: "The HRTechify Show",
        episodeName: "HRPodcast",
        hostName: "HRTechify",
      },
      platformCredit: {
        text: PLATFORM_CREDIT,
        required: true,
        removable: false,
        position: PLATFORM_CREDIT_POSITION,
      },
      outputs: {
        captions: { role: "final-captions-vtt", mimeType: "text/vtt", extension: "vtt" },
        mp3: { role: "final-podcast-mp3", mimeType: "audio/mpeg", extension: "mp3" },
        mp4: { role: "final-podcast-mp4", mimeType: "video/mp4", extension: "mp4" },
      },
    },
    output: {
      role: "derived-technical-master",
      mimeType: "audio/flac",
      extension: "flac",
    },
  };
  const parsed = parseStoredRenderPlan(jobRow(JSON.stringify(valid)));
  assert.equal(parsed.sourceFileId, "source-1");
  assert.equal(parsed.output.mimeType, "audio/flac");
  assert.equal(parsed.publication.platformCredit.text, PLATFORM_CREDIT);

  assert.throws(
    () => parseStoredRenderPlan(jobRow(JSON.stringify({ ...valid, sourceFileId: "other" }))),
    /render_plan_corrupt/,
  );
  assert.throws(
    () => parseStoredRenderPlan(jobRow(JSON.stringify({
      ...valid,
      output: { ...valid.output, mimeType: "audio/mpeg" },
    }))),
    /render_plan_corrupt/,
  );
  assert.throws(
    () => parseStoredRenderPlan(jobRow(JSON.stringify({ ...valid, version: "render-plan-v1" }))),
    /render_plan_corrupt/,
  );
});
