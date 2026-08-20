import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import {
  buildWebVtt,
  parseCaptionTimingDocument,
  transformCaptionWordsForApprovedCuts,
} from "@hrtechify/renderer";
import type { WorkerEnv } from "./db";
import { requireDatabase } from "./db";
import { getEpisodeForUser } from "./episodes";
import {
  findGoogleDriveDerivedRenderOutput,
  uploadGoogleDriveDerivedRenderStream,
} from "./google-drive-derived";
import { listShowBrandMedia, type BrandMediaRecord } from "./google-drive-brand-media";
import {
  findGoogleDriveEpisodePublishArtifact,
  uploadGoogleDriveEpisodePublishArtifactBytes,
  uploadGoogleDriveEpisodePublishArtifactStream,
} from "./google-drive-publish-artifacts";
import { createGoogleDriveSession } from "./google-drive";
import { PodcastRenderContainer } from "./render-container";
import {
  completeRenderJob,
  failRenderJob,
  getRenderJobById,
  markRenderJobProcessing,
  parseStoredRenderPlan,
  recordTechnicalMaster,
} from "./render-jobs";
import {
  isPublishPreferenceSchemaReady,
  isRenderJobSchemaReady,
} from "./schema-readiness";
import { getShowForUser } from "./shows";
import { getStorageConnectionForUser } from "./storage-store";

interface RenderWorkflowParams {
  jobId: string;
}

interface RenderWorkflowEnv extends WorkerEnv {
  RENDER_CONTAINER: DurableObjectNamespace<PodcastRenderContainer>;
}

export const MAX_RENDER_SOURCE_BYTES = 1024 * 1024 * 1024;
export const MAX_RENDER_BRAND_MEDIA_BYTES = 256 * 1024 * 1024;
const MAX_CAPTION_TIMING_BYTES = 8 * 1024 * 1024;

const safeFailureCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : "render_failed";
  if (/^(render_|google_drive_|episode_|storage_|publish_|caption_)[a-z0-9_]{1,110}$/.test(code)) return code;
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

const selectLatestBrandMedia = (
  media: BrandMediaRecord[],
  kind: "show-intro-original" | "show-outro-original",
) => media.find((item) => item.assetKind === kind) ?? null;

const validateBrandMedia = (file: Awaited<ReturnType<ReturnType<typeof createGoogleDriveSession>["downloadOwnedFile"]>>, kind: string) => {
  if (
    file.file.appProperties.assetKind !== kind ||
    file.file.appProperties.original !== "true" ||
    file.file.appProperties.immutable !== "true" ||
    !file.file.sizeBytes ||
    file.file.sizeBytes > MAX_RENDER_BRAND_MEDIA_BYTES ||
    !file.body
  ) {
    throw new Error(`render_${kind.includes("intro") ? "intro" : "outro"}_media_invalid`);
  }
  return file.body;
};

const readCaptionTimingDocument = async (
  body: ReadableStream<Uint8Array>,
  sizeBytes: number | null,
) => {
  if (!sizeBytes || sizeBytes <= 0 || sizeBytes > MAX_CAPTION_TIMING_BYTES) {
    throw new Error("caption_timing_artifact_size_invalid");
  }
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  if (bytes.byteLength !== sizeBytes || bytes.byteLength > MAX_CAPTION_TIMING_BYTES) {
    throw new Error("caption_timing_artifact_size_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("caption_timing_document_invalid");
  }
  return parseCaptionTimingDocument(parsed);
};

export class PodcastRenderWorkflow extends WorkflowEntrypoint<RenderWorkflowEnv, RenderWorkflowParams> {
  async run(event: WorkflowEvent<RenderWorkflowParams>, step: WorkflowStep) {
    const jobId = event.payload?.jobId;
    if (!jobId || typeof jobId !== "string" || jobId.length > 100) {
      throw new Error("render_job_id_invalid");
    }

    try {
      return await step.do(
        "render and store final podcast outputs",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "30 minutes",
        },
        async () => {
          const db = requireDatabase(this.env);
          if (!(await isRenderJobSchemaReady(db)) || !(await isPublishPreferenceSchemaReady(db))) {
            throw new Error("render_job_schema_not_ready");
          }
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

          const artifactScope = {
            showId: show.id,
            showName: show.name,
            sourceFileId: job.source_file_id,
            renderJobId: job.id,
          } as const;
          const [existingTechnical, existingCaptions, existingMp3, existingMp4] = await Promise.all([
            findGoogleDriveDerivedRenderOutput(this.env, job.user_id, connection, {
              showId: show.id,
              showName: show.name,
              renderJobId: job.id,
            }),
            findGoogleDriveEpisodePublishArtifact(this.env, job.user_id, connection, {
              ...artifactScope,
              assetKind: "final-captions-vtt",
            }),
            findGoogleDriveEpisodePublishArtifact(this.env, job.user_id, connection, {
              ...artifactScope,
              assetKind: "final-podcast-mp3",
            }),
            findGoogleDriveEpisodePublishArtifact(this.env, job.user_id, connection, {
              ...artifactScope,
              assetKind: "final-podcast-mp4",
            }),
          ]);

          if (existingTechnical && existingCaptions && existingMp3 && existingMp4) {
            if (
              existingTechnical.mimeType !== "audio/flac" ||
              existingCaptions.mimeType !== "text/vtt" ||
              existingMp3.mimeType !== "audio/mpeg" ||
              existingMp4.mimeType !== "video/mp4"
            ) {
              throw new Error("render_existing_output_invalid");
            }
            await recordTechnicalMaster(db, job.id, {
              id: existingTechnical.id,
              name: existingTechnical.name,
              mimeType: "audio/flac",
              sizeBytes: existingTechnical.sizeBytes ?? 0,
            });
            job = await completeRenderJob(db, job.id);
            if (!job) throw new Error("render_job_complete_failed");
            await setEpisodeCompleted(this.env, job.user_id, job.episode_id);
            return serializeResult(job);
          }

          job = await markRenderJobProcessing(db, job.id);
          if (!job) throw new Error("render_job_not_found");
          await setEpisodeRendering(this.env, job.user_id, job.episode_id);

          const drive = await createGoogleDriveSession(this.env, job.user_id, connection);
          const sourceMetadata = await drive.getOwnedFile(show.id, show.name, job.source_file_id);
          if (
            sourceMetadata.id !== job.source_file_id ||
            sourceMetadata.appProperties.assetKind !== "original-recording" ||
            sourceMetadata.appProperties.immutable !== "true" ||
            sourceMetadata.sizeBytes !== episode.source_size_bytes
          ) {
            throw new Error("render_source_not_immutable_original");
          }

          const container = getContainer(this.env.RENDER_CONTAINER, job.id);
          try {
            let technical = existingTechnical;
            if (technical) {
              const download = await drive.downloadOwnedFile(show.id, show.name, technical.id);
              if (!download.body || download.file.appProperties.renderJobId !== job.id) {
                throw new Error("render_existing_output_invalid");
              }
              await container.importTechnicalMaster(download.body);
            } else {
              const source = await drive.downloadOwnedFile(show.id, show.name, job.source_file_id);
              if (!source.body) throw new Error("render_source_body_missing");
              const rendered = await container.renderTechnicalMaster(source.body, plan.approvedEdits);
              const output = await container.streamTechnicalMaster();
              technical = await uploadGoogleDriveDerivedRenderStream(
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
            }
            if (technical.mimeType !== "audio/flac" || !technical.sizeBytes) {
              throw new Error("render_output_verification_failed");
            }
            job = await recordTechnicalMaster(db, job.id, {
              id: technical.id,
              name: technical.name,
              mimeType: technical.mimeType,
              sizeBytes: technical.sizeBytes,
            });
            if (!job) throw new Error("render_job_not_found");

            const timingArtifact = await findGoogleDriveEpisodePublishArtifact(
              this.env,
              job.user_id,
              connection,
              {
                showId: show.id,
                showName: show.name,
                sourceFileId: job.source_file_id,
                analysisRunId: plan.analysisRunId,
                assetKind: "caption-word-timings",
              },
            );
            if (!timingArtifact || timingArtifact.mimeType !== "application/json") {
              throw new Error("caption_timing_artifact_not_found");
            }
            const timingDownload = await drive.downloadOwnedFile(show.id, show.name, timingArtifact.id);
            if (!timingDownload.body) throw new Error("caption_timing_artifact_not_found");
            const timingDocument = await readCaptionTimingDocument(timingDownload.body, timingArtifact.sizeBytes);
            if (
              timingDocument.episodeId !== episode.id ||
              timingDocument.sourceFileId !== job.source_file_id ||
              timingDocument.analysisRunId !== plan.analysisRunId
            ) {
              throw new Error("caption_timing_document_mismatch");
            }

            const media = await listShowBrandMedia(this.env, job.user_id, connection, {
              showId: show.id,
              showName: show.name,
            });
            const introRecord = selectLatestBrandMedia(media, "show-intro-original");
            const outroRecord = selectLatestBrandMedia(media, "show-outro-original");
            let introBody: ReadableStream<Uint8Array> | null = null;
            let outroBody: ReadableStream<Uint8Array> | null = null;
            if (introRecord) {
              if (!introRecord.sizeBytes || introRecord.sizeBytes > MAX_RENDER_BRAND_MEDIA_BYTES) {
                throw new Error("render_intro_media_invalid");
              }
              const download = await drive.downloadOwnedFile(show.id, show.name, introRecord.id);
              introBody = validateBrandMedia(download, "show-intro-original");
            }
            if (outroRecord) {
              if (!outroRecord.sizeBytes || outroRecord.sizeBytes > MAX_RENDER_BRAND_MEDIA_BYTES) {
                throw new Error("render_outro_media_invalid");
              }
              const download = await drive.downloadOwnedFile(show.id, show.name, outroRecord.id);
              outroBody = validateBrandMedia(download, "show-outro-original");
            }
            const intro = await container.loadBrandMedia("intro", introBody);
            const outro = await container.loadBrandMedia("outro", outroBody);

            const transformedWords = transformCaptionWordsForApprovedCuts(
              timingDocument.words,
              plan.approvedEdits.map(({ startMs, endMs }) => ({ startMs, endMs })),
              intro.durationMs,
            );
            const finalVtt = buildWebVtt(transformedWords);
            const vttBytes = new TextEncoder().encode(finalVtt);
            const captions = existingCaptions ?? await uploadGoogleDriveEpisodePublishArtifactBytes(
              this.env,
              job.user_id,
              connection,
              {
                ...artifactScope,
                assetKind: "final-captions-vtt",
                fileName: `captions-${job.id}.vtt`,
                bytes: vttBytes,
              },
            );
            if (captions.mimeType !== "text/vtt") throw new Error("render_captions_output_invalid");

            const published = await container.renderFinalPublication({
              templateId: plan.publication.template.id,
              captionsEnabled: plan.publication.captionsEnabled,
              captionsVtt: finalVtt,
              showName: plan.publication.display.showName,
              episodeName: plan.publication.display.episodeName,
              hostName: plan.publication.display.hostName,
              platformCredit: plan.publication.platformCredit.text,
              intro,
              outro,
            });

            const mp3 = existingMp3 ?? await uploadGoogleDriveEpisodePublishArtifactStream(
              this.env,
              job.user_id,
              connection,
              {
                ...artifactScope,
                assetKind: "final-podcast-mp3",
                fileName: `${episode.title}-${job.id}.mp3`,
                totalBytes: published.mp3SizeBytes,
                body: await container.streamFinalMp3(),
              },
            );
            const mp4 = existingMp4 ?? await uploadGoogleDriveEpisodePublishArtifactStream(
              this.env,
              job.user_id,
              connection,
              {
                ...artifactScope,
                assetKind: "final-podcast-mp4",
                fileName: `${episode.title}-${job.id}.mp4`,
                totalBytes: published.mp4SizeBytes,
                body: await container.streamFinalMp4(),
              },
            );
            if (mp3.mimeType !== "audio/mpeg" || mp4.mimeType !== "video/mp4") {
              throw new Error("render_final_output_verification_failed");
            }

            job = await completeRenderJob(db, job.id);
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
