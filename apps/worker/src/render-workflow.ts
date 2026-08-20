import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import type { WorkerEnv } from "./db";
import { requireDatabase } from "./db";
import { getEpisodeForUser } from "./episodes";
import {
  findGoogleDriveDerivedRenderOutput,
  uploadGoogleDriveDerivedRenderStream,
} from "./google-drive-derived";
import { createGoogleDriveSession } from "./google-drive";
import { PodcastRenderContainer } from "./render-container";
import {
  completeRenderJob,
  failRenderJob,
  getRenderJobById,
  markRenderJobProcessing,
  parseStoredRenderPlan,
} from "./render-jobs";
import { isRenderJobSchemaReady } from "./schema-readiness";
import { getShowForUser } from "./shows";
import { getStorageConnectionForUser } from "./storage-store";

interface RenderWorkflowParams {
  jobId: string;
}

interface RenderWorkflowEnv extends WorkerEnv {
  RENDER_CONTAINER: DurableObjectNamespace<PodcastRenderContainer>;
}

export const MAX_RENDER_SOURCE_BYTES = 1024 * 1024 * 1024;

const safeFailureCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : "render_failed";
  if (/^(render_|google_drive_|episode_|storage_)[a-z0-9_]{1,110}$/.test(code)) return code;
  return "render_failed";
};

const serializeResult = (job: Awaited<ReturnType<typeof getRenderJobById>>) => job ? ({
  jobId: job.id,
  episodeId: job.episode_id,
  status: job.status,
  derivedFileId: job.derived_file_id,
  derivedFileName: job.derived_file_name,
  derivedMimeType: job.derived_mime_type,
  derivedSizeBytes: job.derived_size_bytes,
}) : null;

const setEpisodeRendering = async (env: RenderWorkflowEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'rendering', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'awaiting_render_confirmation'`,
  ).bind(episodeId, userId).run();
};

const setEpisodeCompleted = async (env: RenderWorkflowEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'completed', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'rendering'`,
  ).bind(episodeId, userId).run();
};

const setEpisodeFailedIfRendering = async (env: RenderWorkflowEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'failed', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'rendering'`,
  ).bind(episodeId, userId).run();
};

export class PodcastRenderWorkflow extends WorkflowEntrypoint<RenderWorkflowEnv, RenderWorkflowParams> {
  async run(event: WorkflowEvent<RenderWorkflowParams>, step: WorkflowStep) {
    const jobId = event.payload?.jobId;
    if (!jobId || typeof jobId !== "string" || jobId.length > 100) {
      throw new Error("render_job_id_invalid");
    }

    try {
      return await step.do(
        "render and store technical master",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "30 minutes",
        },
        async () => {
          const db = requireDatabase(this.env);
          if (!(await isRenderJobSchemaReady(db))) throw new Error("render_job_schema_not_ready");
          let job = await getRenderJobById(db, jobId);
          if (!job) throw new Error("render_job_not_found");
          if (job.status === "completed") return serializeResult(job);
          if (job.status === "cancelled") throw new Error("render_job_cancelled");

          const plan = parseStoredRenderPlan(job);
          const episode = await getEpisodeForUser(db, job.user_id, job.episode_id);
          if (!episode) throw new Error("episode_not_found");
          if (
            episode.source_immutable !== 1 ||
            episode.source_file_id !== job.source_file_id ||
            episode.source_storage_connection_id !== job.source_storage_connection_id ||
            episode.source_provider !== job.source_provider
          ) {
            throw new Error("render_source_snapshot_mismatch");
          }
          if (
            !Number.isSafeInteger(episode.source_size_bytes) ||
            episode.source_size_bytes <= 0 ||
            episode.source_size_bytes > MAX_RENDER_SOURCE_BYTES
          ) {
            throw new Error("render_source_too_large");
          }
          const show = await getShowForUser(db, job.user_id, job.show_id);
          if (!show) throw new Error("render_show_not_found");
          const connection = await getStorageConnectionForUser(
            db,
            job.user_id,
            job.source_storage_connection_id,
          );
          if (!connection || connection.status !== "active") {
            throw new Error("render_storage_connection_unavailable");
          }
          if (job.source_provider !== "google-drive" || connection.provider !== "google-drive") {
            throw new Error("render_provider_not_supported");
          }

          const existing = await findGoogleDriveDerivedRenderOutput(
            this.env,
            job.user_id,
            connection,
            { showId: show.id, showName: show.name, renderJobId: job.id },
          );
          if (existing) {
            if (existing.mimeType !== "audio/flac" || !existing.sizeBytes) {
              throw new Error("render_existing_output_invalid");
            }
            job = await completeRenderJob(db, job.id, {
              id: existing.id,
              name: existing.name,
              mimeType: existing.mimeType,
              sizeBytes: existing.sizeBytes,
            });
            await setEpisodeCompleted(this.env, job!.user_id, job!.episode_id);
            return serializeResult(job);
          }

          job = await markRenderJobProcessing(db, job.id);
          if (!job) throw new Error("render_job_not_found");
          await setEpisodeRendering(this.env, job.user_id, job.episode_id);

          const drive = await createGoogleDriveSession(this.env, job.user_id, connection);
          const source = await drive.downloadOwnedFile(show.id, show.name, job.source_file_id);
          if (!source.body) throw new Error("render_source_body_missing");
          if (
            source.file.id !== job.source_file_id ||
            source.file.appProperties.assetKind !== "original-recording" ||
            source.file.appProperties.immutable !== "true" ||
            source.file.sizeBytes !== episode.source_size_bytes
          ) {
            throw new Error("render_source_not_immutable_original");
          }

          const container = getContainer(this.env.RENDER_CONTAINER, job.id);
          try {
            const rendered = await container.renderTechnicalMaster(source.body, plan.approvedEdits);
            const output = await container.streamTechnicalMaster();
            const stored = await uploadGoogleDriveDerivedRenderStream(
              this.env,
              job.user_id,
              connection,
              {
                showId: show.id,
                showName: show.name,
                renderJobId: job.id,
                sourceFileId: job.source_file_id,
                fileName: `technical-master-${job.id}.flac`,
                mimeType: "audio/flac",
                totalBytes: rendered.sizeBytes,
                body: output,
              },
            );
            if (stored.mimeType !== "audio/flac" || !stored.sizeBytes) {
              throw new Error("render_output_verification_failed");
            }
            job = await completeRenderJob(db, job.id, {
              id: stored.id,
              name: stored.name,
              mimeType: stored.mimeType,
              sizeBytes: stored.sizeBytes,
            });
            if (!job) throw new Error("render_job_complete_failed");
            await setEpisodeCompleted(this.env, job.user_id, job.episode_id);
            return serializeResult(job);
          } finally {
            await container.cleanupFiles().catch(() => undefined);
          }
        },
      );
    } catch (error) {
      const failureCode = safeFailureCode(error);
      await step.do(
        "record render failure",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          const db = requireDatabase(this.env);
          const job = await getRenderJobById(db, jobId);
          if (job && job.status !== "completed" && job.status !== "cancelled") {
            await failRenderJob(db, job.id, failureCode);
            await setEpisodeFailedIfRendering(this.env, job.user_id, job.episode_id);
          }
        },
      );
      throw error;
    }
  }
}
