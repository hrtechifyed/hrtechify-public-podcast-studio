import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { getEpisodeForUser, type EpisodeRow } from "./episodes";
import type { EpisodePublishArtifactKind } from "./google-drive-publish-artifacts";
import {
  completeRenderJob,
  createDerivedRenderJob,
  failRenderJob,
  getLatestRenderJobForEpisode,
  getRenderJobForUser,
  markRenderJobProcessing,
  parseStoredRenderPlan,
  recordTechnicalMaster,
  type RenderJobRow,
} from "./render-jobs";
import {
  isEditorialApprovalSchemaReady,
  isEpisodeSchemaReady,
  isPublishPreferenceSchemaReady,
  isRenderJobSchemaReady,
} from "./schema-readiness";
import { getShowForUser, type ShowRow } from "./shows";
import { listStudioBrandMedia } from "./storage-brand-media";
import {
  findEpisodePublishArtifact,
  uploadEpisodePublishArtifactStream,
} from "./storage-publish-artifacts";
import type { StudioStoredFile } from "./studio-storage";
import { getStorageConnectionForUser, type StorageConnectionRow } from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const MAX_LOCAL_OUTPUT_BYTES = 95 * 1024 * 1024;
const MAX_VTT_BYTES = 8 * 1024 * 1024;

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

const downloadUrl = (
  connection: StorageConnectionRow,
  show: Pick<ShowRow, "id">,
  fileId: string,
) => `/api/storage/${connection.provider}/files/${encodeURIComponent(fileId)}/download?showId=${encodeURIComponent(show.id)}&connectionId=${encodeURIComponent(connection.id)}`;

interface FinalOutputSummary {
  captions: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
  mp3: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
  mp4: null | { fileId: string; fileName: string; mimeType: string | null; sizeBytes: number | null; openUrl: string | null };
}

const serializeStoredFile = (
  file: StudioStoredFile | null,
  connection: StorageConnectionRow,
  show: ShowRow,
) => file ? ({
  fileId: file.id,
  fileName: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  openUrl: file.webViewLink || downloadUrl(connection, show, file.id),
}) : null;

const loadRenderStorageContext = async (
  env: WorkerEnv,
  userId: string,
  job: RenderJobRow,
) => {
  const db = requireDatabase(env);
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, job.show_id),
    getStorageConnectionForUser(db, userId, job.source_storage_connection_id),
  ]);
  if (!show) throw new Error("render_show_not_found");
  if (!connection || connection.status !== "active") throw new Error("render_storage_connection_unavailable");
  if (show.storage_connection_id !== connection.id) throw new Error("render_storage_snapshot_mismatch");
  if (connection.provider !== job.source_provider) throw new Error("render_storage_snapshot_mismatch");
  return { show, connection };
};

const findFinalOutputs = async (
  env: WorkerEnv,
  userId: string,
  job: RenderJobRow,
): Promise<FinalOutputSummary | null> => {
  try {
    const db = requireDatabase(env);
    const { show, connection } = await loadRenderStorageContext(env, userId, job);
    const scope = {
      showId: show.id,
      showName: show.name,
      sourceFileId: job.source_file_id,
      renderJobId: job.id,
    } as const;
    const [captions, mp3, mp4] = await Promise.all([
      findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-captions-vtt" }),
      findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-podcast-mp3" }),
      findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-podcast-mp4" }),
    ]);
    return {
      captions: serializeStoredFile(captions, connection, show),
      mp3: serializeStoredFile(mp3, connection, show),
      mp4: serializeStoredFile(mp4, connection, show),
    };
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

const setEpisodeRendering = async (env: WorkerEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'rendering', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'awaiting_render_confirmation'`,
  ).bind(episodeId, userId).run();
};

const setEpisodeCompleted = async (env: WorkerEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'completed', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status IN ('rendering', 'awaiting_render_confirmation')`,
  ).bind(episodeId, userId).run();
};

const setEpisodeFailed = async (env: WorkerEnv, userId: string, episodeId: string) => {
  const db = requireDatabase(env);
  await db.prepare(
    `UPDATE episodes
     SET status = 'failed', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'rendering'`,
  ).bind(episodeId, userId).run();
};

const selectLatestBrandMedia = (
  media: Awaited<ReturnType<typeof listStudioBrandMedia>>,
  kind: "show-intro-original" | "show-outro-original",
) => media.find((item) => item.assetKind === kind) ?? null;

const buildBrowserManifest = async (
  env: WorkerEnv,
  userId: string,
  episode: EpisodeRow,
  job: RenderJobRow,
) => {
  const db = requireDatabase(env);
  const { show, connection } = await loadRenderStorageContext(env, userId, job);
  if (
    episode.source_immutable !== 1 ||
    episode.source_file_id !== job.source_file_id ||
    episode.source_storage_connection_id !== connection.id ||
    episode.source_provider !== connection.provider
  ) {
    throw new Error("render_source_snapshot_mismatch");
  }

  const plan = parseStoredRenderPlan(job);
  const timing = await findEpisodePublishArtifact(env, db, userId, connection, {
    showId: show.id,
    showName: show.name,
    sourceFileId: job.source_file_id,
    analysisRunId: plan.analysisRunId,
    assetKind: "caption-word-timings",
  });
  if (!timing || timing.mimeType !== "application/json" || !timing.sizeBytes) {
    throw new Error("caption_timing_artifact_not_found");
  }

  const media = await listStudioBrandMedia(env, db, userId, connection, {
    showId: show.id,
    showName: show.name,
  });
  const intro = selectLatestBrandMedia(media, "show-intro-original");
  const outro = selectLatestBrandMedia(media, "show-outro-original");
  const mediaAsset = (file: typeof intro) => file ? ({
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    downloadUrl: downloadUrl(connection, show, file.id),
  }) : null;

  return {
    mode: "local-browser" as const,
    jobId: job.id,
    episodeId: episode.id,
    provider: connection.provider,
    source: {
      fileId: episode.source_file_id,
      fileName: episode.source_file_name,
      mimeType: episode.source_mime_type,
      sizeBytes: episode.source_size_bytes,
      immutable: true,
      downloadUrl: downloadUrl(connection, show, episode.source_file_id),
    },
    captionTiming: {
      fileId: timing.id,
      fileName: timing.name,
      mimeType: timing.mimeType,
      sizeBytes: timing.sizeBytes,
      downloadUrl: downloadUrl(connection, show, timing.id),
    },
    intro: mediaAsset(intro),
    outro: mediaAsset(outro),
    plan,
    notice: "Final generation runs on this device. Keep this tab open until it finishes.",
  };
};

type LocalArtifactKind = Extract<
  EpisodePublishArtifactKind,
  "derived-technical-master" | "final-captions-vtt" | "final-podcast-mp3" | "final-podcast-mp4"
>;

const LOCAL_ARTIFACTS: Record<LocalArtifactKind, { mimeType: string; maxBytes: number; fileName: (jobId: string) => string }> = {
  "derived-technical-master": {
    mimeType: "audio/flac",
    maxBytes: MAX_LOCAL_OUTPUT_BYTES,
    fileName: (jobId) => `technical-master-${jobId}.flac`,
  },
  "final-captions-vtt": {
    mimeType: "text/vtt",
    maxBytes: MAX_VTT_BYTES,
    fileName: (jobId) => `final-captions-${jobId}.vtt`,
  },
  "final-podcast-mp3": {
    mimeType: "audio/mpeg",
    maxBytes: MAX_LOCAL_OUTPUT_BYTES,
    fileName: (jobId) => `final-podcast-${jobId}.mp3`,
  },
  "final-podcast-mp4": {
    mimeType: "video/mp4",
    maxBytes: MAX_LOCAL_OUTPUT_BYTES,
    fileName: (jobId) => `final-podcast-${jobId}.mp4`,
  },
};

const parseJsonBody = async (request: Request) => {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

const requireJobForEpisode = async (
  env: WorkerEnv,
  userId: string,
  episode: EpisodeRow,
  jobId: string,
) => {
  const db = requireDatabase(env);
  const job = await getRenderJobForUser(db, userId, jobId);
  if (!job || job.episode_id !== episode.id || job.show_id !== episode.show_id) {
    throw new Error("render_job_not_found");
  }
  if (
    job.source_file_id !== episode.source_file_id ||
    job.source_provider !== episode.source_provider ||
    job.source_storage_connection_id !== episode.source_storage_connection_id
  ) {
    throw new Error("render_source_snapshot_mismatch");
  }
  return job;
};

const handleLocalArtifactUpload = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
  episode: EpisodeRow,
  kindValue: string,
) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(kindValue in LOCAL_ARTIFACTS)) return json({ error: "render_artifact_kind_not_allowed" }, 404);
  const kind = kindValue as LocalArtifactKind;
  const spec = LOCAL_ARTIFACTS[kind];
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "render_job_id_invalid" }, 400);
  const job = await requireJobForEpisode(env, userId, episode, jobId);
  if (job.status !== "queued" && job.status !== "processing") {
    return json({ error: "render_job_not_uploadable" }, 409);
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== spec.mimeType) return json({ error: "render_artifact_mime_invalid" }, 415);
  const sizeHeader = request.headers.get("x-hrtechify-file-size") ?? request.headers.get("content-length") ?? "";
  if (!/^\d+$/.test(sizeHeader)) return json({ error: "render_artifact_size_required" }, 411);
  const totalBytes = Number(sizeHeader);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > spec.maxBytes) {
    return json({ error: "render_artifact_size_invalid" }, 413);
  }
  if (!request.body) return json({ error: "render_artifact_body_missing" }, 400);

  const db = requireDatabase(env);
  const { show, connection } = await loadRenderStorageContext(env, userId, job);
  const file = await uploadEpisodePublishArtifactStream(env, db, userId, connection, {
    showId: show.id,
    showName: show.name,
    sourceFileId: job.source_file_id,
    renderJobId: job.id,
    assetKind: kind,
    fileName: spec.fileName(job.id),
    totalBytes,
    body: request.body,
  });

  if (kind === "derived-technical-master") {
    if (file.mimeType !== "audio/flac" || !file.sizeBytes) throw new Error("render_output_verification_failed");
    await recordTechnicalMaster(db, job.id, {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });
  }

  return json({
    ok: true,
    processingMode: "local-browser",
    artifact: serializeStoredFile(file, connection, show),
  }, 201);
};

const completeLocalRender = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
  episode: EpisodeRow,
) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await parseJsonBody(request);
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const job = await requireJobForEpisode(env, userId, episode, jobId);
  if (job.status !== "queued" && job.status !== "processing") return json({ error: "render_job_not_completable" }, 409);

  const db = requireDatabase(env);
  const { show, connection } = await loadRenderStorageContext(env, userId, job);
  const scope = {
    showId: show.id,
    showName: show.name,
    sourceFileId: job.source_file_id,
    renderJobId: job.id,
  } as const;
  const [technical, captions, mp3, mp4] = await Promise.all([
    findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "derived-technical-master" }),
    findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-captions-vtt" }),
    findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-podcast-mp3" }),
    findEpisodePublishArtifact(env, db, userId, connection, { ...scope, assetKind: "final-podcast-mp4" }),
  ]);
  if (
    !technical || technical.mimeType !== "audio/flac" || !technical.sizeBytes ||
    !captions || captions.mimeType !== "text/vtt" || !captions.sizeBytes ||
    !mp3 || mp3.mimeType !== "audio/mpeg" || !mp3.sizeBytes ||
    !mp4 || mp4.mimeType !== "video/mp4" || !mp4.sizeBytes
  ) {
    return json({ error: "render_outputs_incomplete" }, 409);
  }

  await recordTechnicalMaster(db, job.id, {
    id: technical.id,
    name: technical.name,
    mimeType: technical.mimeType,
    sizeBytes: technical.sizeBytes,
  });
  const completed = await completeRenderJob(db, job.id);
  if (!completed) throw new Error("render_job_complete_failed");
  await setEpisodeCompleted(env, userId, episode.id);
  return json({
    ok: true,
    processingMode: "local-browser",
    episodeStatus: "completed",
    job: serializeJob(completed, {
      captions: serializeStoredFile(captions, connection, show),
      mp3: serializeStoredFile(mp3, connection, show),
      mp4: serializeStoredFile(mp4, connection, show),
    }),
  });
};

const failLocalRender = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
  episode: EpisodeRow,
) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await parseJsonBody(request);
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const allowed = new Set([
    "browser_render_failed",
    "browser_upload_failed",
    "browser_renderer_unavailable",
    "browser_render_cancelled",
  ]);
  if (!allowed.has(code)) return json({ error: "render_failure_code_invalid" }, 400);
  const job = await requireJobForEpisode(env, userId, episode, jobId);
  const failed = await failRenderJob(requireDatabase(env), job.id, code);
  await setEpisodeFailed(env, userId, episode.id);
  return json({ ok: true, episodeStatus: "failed", job: failed ? serializeJob(failed) : null });
};

export const handleRenderApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  const mainMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/render$/);
  const artifactMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/render\/artifacts\/([^/]+)$/);
  const completeMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/render\/complete$/);
  const failMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/render\/fail$/);
  const routeMatch = mainMatch || artifactMatch || completeMatch || failMatch;
  if (!routeMatch) return null;

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

    const episodeId = decodeURIComponent(routeMatch[1]);
    const episode = await getEpisodeForUser(db, identity.userId, episodeId);
    if (!episode) return json({ error: "episode_not_found" }, 404);

    if (artifactMatch) {
      return handleLocalArtifactUpload(request, env, identity.userId, episode, decodeURIComponent(artifactMatch[2]));
    }
    if (completeMatch) return completeLocalRender(request, env, identity.userId, episode);
    if (failMatch) return failLocalRender(request, env, identity.userId, episode);

    if (request.method === "GET") {
      const latest = await getLatestRenderJobForEpisode(db, identity.userId, episode.id);
      const outputs = latest ? await findFinalOutputs(env, identity.userId, latest) : null;
      return json({
        processingMode: "local-browser",
        zeroBillMode: true,
        episodeId: episode.id,
        episodeStatus: episode.status,
        job: latest ? serializeJob(latest, outputs) : null,
      });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    let job = await getLatestRenderJobForEpisode(db, identity.userId, episode.id);
    if (!job || (job.status !== "queued" && job.status !== "processing")) {
      const created = await createDerivedRenderJob(db, identity.userId, episode);
      job = created.job;
    }
    if (job.status === "queued") {
      const processing = await markRenderJobProcessing(db, job.id);
      if (!processing) throw new Error("render_job_not_found");
      job = processing;
    }
    await setEpisodeRendering(env, identity.userId, episode.id);
    const browserRender = await buildBrowserManifest(env, identity.userId, episode, job);

    return json({
      ok: true,
      processingMode: "local-browser",
      zeroBillMode: true,
      episodeStatus: "rendering",
      job: serializeJob(job),
      browserRender,
    }, 202);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: error.message }, 503);
      if (error.message === "episode_not_found" || error.message === "render_job_not_found") {
        return json({ error: error.message }, 404);
      }
      if (error.message === "invalid_json") return json({ error: error.message }, 400);
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
        error.message.startsWith("publish_") ||
        error.message.startsWith("caption_") ||
        error.message.startsWith("storage_") ||
        error.message.startsWith("google_drive_") ||
        error.message.startsWith("dropbox_")
      ) {
        return json({ error: error.message }, 400);
      }
    }
    return json({ error: "internal_error" }, 500);
  }
};
