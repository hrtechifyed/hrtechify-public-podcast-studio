import {
  createTechnicalCleanupPlan,
  type SpeechEditKind,
  type TechnicalCleanupPlan,
} from "@hrtechify/audio";
import type { D1DatabaseLike } from "./db";
import { listLatestEditorialProposals } from "./editorial-edits";
import type { EpisodeRow } from "./episodes";

export type RenderJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface NormalizedApprovedEdit {
  startMs: number;
  endMs: number;
  proposalIds: string[];
  kinds: SpeechEditKind[];
}

export interface DerivedRenderPlan {
  version: "render-plan-v1";
  sourceFileId: string;
  sourceImmutable: true;
  cleanup: TechnicalCleanupPlan;
  approvedEdits: NormalizedApprovedEdit[];
  output: {
    role: "derived-technical-master";
    mimeType: "audio/flac";
    extension: "flac";
  };
}

export interface RenderJobRow {
  sequence: number;
  id: string;
  user_id: string;
  show_id: string;
  episode_id: string;
  workflow_instance_id: string;
  status: RenderJobStatus;
  source_provider: "google-drive" | "dropbox";
  source_storage_connection_id: string;
  source_file_id: string;
  cleanup_profile_version: string;
  approved_edits_json: string;
  technical_plan_json: string;
  derived_file_id: string | null;
  derived_file_name: string | null;
  derived_mime_type: string | null;
  derived_size_bytes: number | null;
  failure_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

const renderJobSelect = `
  SELECT sequence, id, user_id, show_id, episode_id, workflow_instance_id, status,
         source_provider, source_storage_connection_id, source_file_id,
         cleanup_profile_version, approved_edits_json, technical_plan_json,
         derived_file_id, derived_file_name, derived_mime_type, derived_size_bytes,
         failure_code, created_at, started_at, completed_at, updated_at
  FROM episode_render_jobs`;

const uniqueKinds = (values: SpeechEditKind[]) => [...new Set(values)];

export const normalizeApprovedEditRanges = (
  input: Array<{
    id: string;
    kind: SpeechEditKind;
    startMs: number;
    endMs: number;
  }>,
): NormalizedApprovedEdit[] => {
  const sorted = input
    .map((item) => ({ ...item }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));

  const output: NormalizedApprovedEdit[] = [];
  for (const item of sorted) {
    if (
      !item.id ||
      !Number.isSafeInteger(item.startMs) ||
      !Number.isSafeInteger(item.endMs) ||
      item.startMs < 0 ||
      item.endMs <= item.startMs
    ) {
      throw new Error("render_approved_edit_invalid");
    }
    const previous = output[output.length - 1];
    if (previous && item.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, item.endMs);
      previous.proposalIds.push(item.id);
      previous.kinds = uniqueKinds([...previous.kinds, item.kind]);
      continue;
    }
    output.push({
      startMs: item.startMs,
      endMs: item.endMs,
      proposalIds: [item.id],
      kinds: [item.kind],
    });
  }
  if (output.length > 500) throw new Error("render_too_many_edit_ranges");
  return output;
};

export const buildDerivedRenderPlan = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
): Promise<DerivedRenderPlan> => {
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  if (episode.status !== "awaiting_render_confirmation") {
    throw new Error("episode_not_ready_for_render");
  }
  if (episode.source_immutable !== 1 || !episode.source_file_id) {
    throw new Error("render_requires_immutable_source");
  }

  const proposals = await listLatestEditorialProposals(db, userId, episode.id);
  const unresolved = proposals.filter((proposal) => !proposal.decision);
  if (unresolved.length > 0) throw new Error("render_edit_decisions_incomplete");

  const approvedEdits = normalizeApprovedEditRanges(
    proposals
      .filter((proposal) => proposal.decision === "apply")
      .map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        startMs: proposal.start_ms,
        endMs: proposal.end_ms,
      })),
  );
  const cleanup = createTechnicalCleanupPlan(true);

  return {
    version: "render-plan-v1",
    sourceFileId: episode.source_file_id,
    sourceImmutable: true,
    cleanup,
    approvedEdits,
    output: {
      role: "derived-technical-master",
      mimeType: "audio/flac",
      extension: "flac",
    },
  };
};

export const createDerivedRenderJob = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
) => {
  const plan = await buildDerivedRenderPlan(db, userId, episode);
  const id = crypto.randomUUID();
  const workflowInstanceId = `render-${id}`;
  await db
    .prepare(
      `INSERT INTO episode_render_jobs (
         id, user_id, show_id, episode_id, workflow_instance_id, status,
         source_provider, source_storage_connection_id, source_file_id,
         cleanup_profile_version, approved_edits_json, technical_plan_json
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      episode.show_id,
      episode.id,
      workflowInstanceId,
      episode.source_provider,
      episode.source_storage_connection_id,
      episode.source_file_id,
      plan.cleanup.profileVersion,
      JSON.stringify(plan.approvedEdits),
      JSON.stringify(plan),
    )
    .run();

  const job = await getRenderJobForUser(db, userId, id);
  if (!job) throw new Error("render_job_create_failed");
  return { job, plan };
};

export const getRenderJobForUser = async (
  db: D1DatabaseLike,
  userId: string,
  jobId: string,
) =>
  db
    .prepare(`${renderJobSelect} WHERE id = ? AND user_id = ?`)
    .bind(jobId, userId)
    .first<RenderJobRow>();

export const getRenderJobById = async (db: D1DatabaseLike, jobId: string) =>
  db
    .prepare(`${renderJobSelect} WHERE id = ?`)
    .bind(jobId)
    .first<RenderJobRow>();

export const getLatestRenderJobForEpisode = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
) =>
  db
    .prepare(
      `${renderJobSelect}
       WHERE user_id = ? AND episode_id = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .bind(userId, episodeId)
    .first<RenderJobRow>();

export const markRenderJobProcessing = async (db: D1DatabaseLike, jobId: string) => {
  await db
    .prepare(
      `UPDATE episode_render_jobs
       SET status = 'processing', started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(jobId)
    .run();
  return getRenderJobById(db, jobId);
};

export const completeRenderJob = async (
  db: D1DatabaseLike,
  jobId: string,
  file: { id: string; name: string; mimeType: string; sizeBytes: number },
) => {
  if (!file.id || !file.name || file.mimeType !== "audio/flac" || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) {
    throw new Error("render_output_metadata_invalid");
  }
  await db
    .prepare(
      `UPDATE episode_render_jobs
       SET status = 'completed', derived_file_id = ?, derived_file_name = ?,
           derived_mime_type = ?, derived_size_bytes = ?, failure_code = NULL,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status IN ('queued', 'processing')`,
    )
    .bind(file.id, file.name, file.mimeType, file.sizeBytes, jobId)
    .run();
  return getRenderJobById(db, jobId);
};

export const failRenderJob = async (
  db: D1DatabaseLike,
  jobId: string,
  failureCode: string,
) => {
  const cleaned = failureCode.trim().slice(0, 120) || "render_failed";
  await db
    .prepare(
      `UPDATE episode_render_jobs
       SET status = 'failed', failure_code = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status IN ('queued', 'processing')`,
    )
    .bind(cleaned, jobId)
    .run();
  return getRenderJobById(db, jobId);
};

export const parseStoredRenderPlan = (job: RenderJobRow): DerivedRenderPlan => {
  let value: unknown;
  try {
    value = JSON.parse(job.technical_plan_json);
  } catch {
    throw new Error("render_plan_corrupt");
  }
  if (!value || typeof value !== "object") throw new Error("render_plan_corrupt");
  const plan = value as DerivedRenderPlan;
  if (
    plan.version !== "render-plan-v1" ||
    plan.sourceFileId !== job.source_file_id ||
    plan.sourceImmutable !== true ||
    plan.cleanup?.profileVersion !== job.cleanup_profile_version ||
    plan.output?.role !== "derived-technical-master" ||
    plan.output?.mimeType !== "audio/flac" ||
    plan.output?.extension !== "flac" ||
    !Array.isArray(plan.approvedEdits)
  ) {
    throw new Error("render_plan_corrupt");
  }
  return plan;
};
