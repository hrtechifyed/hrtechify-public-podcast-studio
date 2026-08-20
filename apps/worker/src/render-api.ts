import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { getEpisodeForUser } from "./episodes";
import { findGoogleDriveEpisodePublishArtifact } from "./google-drive-publish-artifacts";
import {
  createDerivedRenderJob,
  failRenderJob,
  getLatestRenderJobForEpisode,
  parseStoredRenderPlan,
  type RenderJobRow,
} from "./render-jobs";
import {
  isEditorialApprovalSchemaReady,
  isEpisodeSchemaReady,
  isPublishPreferenceSchemaReady,
  isRenderJobSchemaReady,
} from "./schema-readiness";
import { getShowForUser } from "./shows";
import { getStorageConnectionForUser } from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const approvedRangeCount = (job: RenderJobRow) => {
  try {
    const value = JSON.parse(job.approved_edits_json) as unknown;
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
};

const publicationSummary = (job: RenderJobRow) => {
  try {
    const plan = parseStoredRenderPlan(job);
    return {
      template: {
        id: plan.publication.template.id,
        name: plan.publication.template.name,
        version: plan.publication.template.version,
      },
      captionsEnabled: plan.publication.captionsEnabled,
      platformCredit: plan.publication.platformCredit.text,
    };
  } catch {
    return null;
  }
};

interface FinalOutputSummary {
  captions: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
  mp3: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
  mp4: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
}

const findFinalOutputs = async (
  env: WorkerEnv,
  userId: string,
  job: RenderJobRow,
): Promise<FinalOutputSummary | null> => {
  if (job.source_provider !== "google-drive") return null;
  const db = requireDatabase(env);
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, job.show_id),
    getStorageConnectionForUser(db, userId, job.source_storage_connection_id),
  ]);
  if (!show || !connection || connection.provider !== "google-drive") return null;
  const scope = {
    showId: show.id,
    showName: show.name,
    sourceFileId: job.source_file_id,
    renderJobId: job.id,
  } as const;
  try {
    const [captions, mp3, mp4] = await Promise.all([
      findGoogleDriveEpisodePublishArtifact(env, userId, connection, { ...scope, assetKind: "final-captions-vtt" }),
      findGoogleDriveEpisodePublishArtifact(env, userId, connection, { ...scope, assetKind: "final-podcast-mp3" }),
      findGoogleDriveEpisodePublishArtifact(env, userId, connection, { ...scope, assetKind: "final-podcast-mp4" }),
    ]);
    const serialize = (file: typeof captions) => file ? ({
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      openUrl: file.webViewLink,
    }) : null;
    return { captions: serialize(captions), mp3: serialize(mp3), mp4: serialize(mp4) };
  } catch {
    return null;
  }
};

const serializeJob = (job: RenderJobRow, finalOutputs: FinalOutputSummary | null = null) => ({
  id: job.id,
  episodeId: job.episode_id,
  status: job.status,
  cleanupProfileVersion: job.cleanup_profile_version,
  approvedEditRangeCount: approvedRangeCount(job),
  publication: publicationSummary(job),
  technicalMaster: job.derived_file_id ? {
    fileId: job.derived_file_id,
    fileName: job.derived_file_name,
    mimeType: job.derived_mime_type,
    sizeBytes: job.derived_size_bytes,
  } : null,
  finalOutputs,
  failureCode: job.failure_code,
  createdAt: job.created_at,
  startedAt: job.started_at,
  completedAt: job.completed_at,
  updatedAt: job.updated_at,
});

export const handleRenderApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  const match = url.pathname.match(/^\/api\/episodes\/([^/]+)\/render$/);
  if (!match) return null;

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (
      !(await isEpisodeSchemaReady(db)) ||
      !(await isEditorialApprovalSchemaReady(db)) ||
      !(await isRenderJobSchemaReady(db)) ||
      !(await isPublishPreferenceSchemaReady(db))
    ) {
      return json({ error: "render_job_schema_not_ready" }, 503);
    }

    const episodeId = decodeURIComponent(match[1]);
    const episode = await getEpisodeForUser(db, identity.userId, episodeId);
    if (!episode) return json({ error: "episode_not_found" }, 404);

    if (request.method === "GET") {
      const latest = await getLatestRenderJobForEpisode(db, identity.userId, episode.id);
      const outputs = latest ? await findFinalOutputs(env, identity.userId, latest) : null;
      return json({
        episodeId: episode.id,
        episodeStatus: episode.status,
        job: latest ? serializeJob(latest, outputs) : null,
      });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!env.RENDER_WORKFLOW) return json({ error: "render_workflow_not_configured" }, 503);

    const current = await getLatestRenderJobForEpisode(db, identity.userId, episode.id);
    if (current && (current.status === "queued" || current.status === "processing")) {
      return json({
        ok: true,
        alreadyRunning: true,
        episodeStatus: episode.status,
        job: serializeJob(current),
      });
    }

    const { job } = await createDerivedRenderJob(db, identity.userId, episode);
    try {
      const instance = await env.RENDER_WORKFLOW.create({
        id: job.workflow_instance_id,
        params: { jobId: job.id },
      });
      if (!instance?.id || instance.id !== job.workflow_instance_id) {
        throw new Error("render_workflow_instance_mismatch");
      }
    } catch {
      await failRenderJob(db, job.id, "render_workflow_start_failed");
      return json({ error: "render_workflow_start_failed" }, 503);
    }

    return json({
      ok: true,
      alreadyRunning: false,
      episodeStatus: episode.status,
      job: serializeJob(job),
    }, 202);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: error.message }, 503);
      if (error.message === "episode_not_found") return json({ error: error.message }, 404);
      if (
        error.message === "episode_not_ready_for_render" ||
        error.message === "render_edit_decisions_incomplete" ||
        error.message === "render_requires_immutable_source" ||
        error.message === "render_analysis_not_found" ||
        error.message.includes("UNIQUE constraint failed")
      ) {
        return json({ error: error.message.includes("UNIQUE") ? "render_already_running" : error.message }, 409);
      }
      if (
        error.message.startsWith("render_") ||
        error.message.startsWith("technical_cleanup_") ||
        error.message.startsWith("template_") ||
        error.message.startsWith("publish_")
      ) {
        return json({ error: error.message }, 400);
      }
    }
    return json({ error: "internal_error" }, 500);
  }
};
