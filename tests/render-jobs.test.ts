import assert from "node:assert/strict";
import test from "node:test";
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

test("stored render plan must match immutable source, cleanup version and FLAC output contract", () => {
  const valid = {
    version: "render-plan-v1",
    sourceFileId: "source-1",
    sourceImmutable: true,
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
    output: {
      role: "derived-technical-master",
      mimeType: "audio/flac",
      extension: "flac",
    },
  };
  const parsed = parseStoredRenderPlan(jobRow(JSON.stringify(valid)));
  assert.equal(parsed.sourceFileId, "source-1");
  assert.equal(parsed.output.mimeType, "audio/flac");

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
});
