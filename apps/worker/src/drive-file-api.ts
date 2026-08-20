import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  attachmentContentDisposition,
  parseDriveFileReadRoute,
} from "./drive-file-policy";
import {
  createResumableUploadToken,
  MAX_RESUMABLE_CHUNK_BYTES,
  parseResumableContentRange,
  parseResumableUploadStartBody,
  readResumableUploadToken,
  RESUMABLE_CHUNK_GRANULARITY_BYTES,
  RESUMABLE_UPLOAD_TOKEN_TTL_MS,
  ResumableUploadValidationError,
} from "./drive-resumable";
import {
  parseSmallDriveUploadBody,
  SmallDriveUploadValidationError,
} from "./drive-upload";
import { ensureEpisodeFromVerifiedOriginal } from "./episodes";
import {
  queryGoogleDriveResumableStatus,
  startGoogleDriveResumableUpload,
  uploadGoogleDriveResumableChunk,
  type ResumableChunkResult,
} from "./google-drive-resumable";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import { isEpisodeSchemaReady } from "./schema-readiness";
import { getShowForUser } from "./shows";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const SMALL_UPLOAD_PATH = "/api/storage/google-drive/files/small";
const RESUMABLE_START_PATH = "/api/storage/google-drive/files/resumable/start";
const RESUMABLE_CHUNK_PATH = "/api/storage/google-drive/files/resumable/chunk";
const RESUMABLE_STATUS_PATH = "/api/storage/google-drive/files/resumable/status";
const UPLOAD_TOKEN_HEADER = "x-hrtechify-upload-token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new SmallDriveUploadValidationError("invalid_json");
  }
};

const loadAssignedDriveContext = async (
  db: ReturnType<typeof requireDatabase>,
  userId: string,
  showId: string,
  connectionId: string,
) => {
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, showId),
    getStorageConnectionForUser(db, userId, connectionId),
  ]);

  if (!show) throw new GoogleDriveError("show_not_found", 404);
  if (show.status !== "active") throw new GoogleDriveError("show_not_active", 409);

  if (!connection || connection.provider !== "google-drive") {
    throw new GoogleDriveError("google_drive_connection_not_found", 404);
  }
  if (connection.status !== "active") {
    throw new GoogleDriveError("google_drive_connection_inactive", 409);
  }

  if (!show.storage_connection_id) {
    throw new GoogleDriveError("show_storage_connection_required", 409);
  }
  if (show.storage_connection_id !== connection.id) {
    throw new GoogleDriveError("show_storage_connection_mismatch", 409);
  }

  return { show, connection: connection as StorageConnectionRow };
};

const queryValue = (url: URL, name: string) => {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value;
};

const requireUploadTokenSecret = (env: WorkerEnv) => {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new GoogleDriveError("google_drive_not_configured", 503);
  }
  return env.TOKEN_ENCRYPTION_KEY;
};

const verifyCompletedOriginalRecording = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  show: { id: string; name: string },
  expectedTotalBytes: number,
  result: ResumableChunkResult,
) => {
  if (!result.complete || !result.file) return result;

  const drive = await createGoogleDriveSession(env, userId, connection);
  const verified = await drive.getOwnedFile(show.id, show.name, result.file.id);
  if (
    verified.appProperties.assetKind !== "original-recording" ||
    verified.appProperties.immutable !== "true" ||
    verified.sizeBytes !== expectedTotalBytes
  ) {
    throw new GoogleDriveError("google_drive_resumable_completion_invalid", 502);
  }

  return {
    complete: true,
    nextOffset: verified.sizeBytes,
    file: verified,
  } satisfies ResumableChunkResult;
};

export const handleDriveFileApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/storage/google-drive/files")) return null;

  const isSmallUpload = url.pathname === SMALL_UPLOAD_PATH;
  const isResumableStart = url.pathname === RESUMABLE_START_PATH;
  const isResumableChunk = url.pathname === RESUMABLE_CHUNK_PATH;
  const isResumableStatus = url.pathname === RESUMABLE_STATUS_PATH;
  const isResumableRoute = isResumableStart || isResumableChunk || isResumableStatus;
  const readRoute = isSmallUpload || isResumableRoute ? null : parseDriveFileReadRoute(url.pathname);

  if (isSmallUpload && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (isResumableStart && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (isResumableChunk && request.method !== "PUT") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (isResumableStatus && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!isSmallUpload && !isResumableRoute && (!readRoute || request.method !== "GET")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (isSmallUpload) {
      const input = parseSmallDriveUploadBody(await parseBody(request));
      const { show, connection } = await loadAssignedDriveContext(
        db,
        identity.userId,
        input.showId,
        input.connectionId,
      );

      const session = await createGoogleDriveSession(env, identity.userId, connection);
      const file = await session.uploadSmallFile(show.id, show.name, {
        folder: input.folder,
        fileName: input.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);

      return json(
        {
          showId: show.id,
          connectionId: connection.id,
          provider: "google-drive",
          file,
          openUrl: file.webViewLink,
        },
        201,
      );
    }

    if (isResumableStart) {
      const input = parseResumableUploadStartBody(await parseBody(request));
      const { show, connection } = await loadAssignedDriveContext(
        db,
        identity.userId,
        input.showId,
        input.connectionId,
      );
      const started = await startGoogleDriveResumableUpload(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
        fileName: input.fileName,
        mimeType: input.mimeType,
        totalBytes: input.totalBytes,
      });
      const uploadToken = await createResumableUploadToken(
        { ...input, sessionUrl: started.sessionUrl },
        requireUploadTokenSecret(env),
        identity.userId,
      );
      await markStorageConnectionUsed(db, identity.userId, connection.id);

      return json(
        {
          showId: show.id,
          connectionId: connection.id,
          provider: "google-drive",
          uploadToken,
          totalBytes: input.totalBytes,
          maxChunkBytes: MAX_RESUMABLE_CHUNK_BYTES,
          chunkGranularityBytes: RESUMABLE_CHUNK_GRANULARITY_BYTES,
          tokenExpiresInSeconds: Math.floor(RESUMABLE_UPLOAD_TOKEN_TTL_MS / 1000),
        },
        201,
      );
    }

    if (isResumableChunk || isResumableStatus) {
      const token = request.headers.get(UPLOAD_TOKEN_HEADER) ?? "";
      const payload = await readResumableUploadToken(
        token,
        requireUploadTokenSecret(env),
        identity.userId,
      );
      const { show, connection } = await loadAssignedDriveContext(
        db,
        identity.userId,
        payload.showId,
        payload.connectionId,
      );

      let result: ResumableChunkResult;
      if (isResumableChunk) {
        const parsedRange = parseResumableContentRange(
          request.headers.get("content-range"),
          request.headers.get("content-length"),
          payload.totalBytes,
        );
        const chunkBody = await request.arrayBuffer();
        if (chunkBody.byteLength !== parsedRange.length) {
          throw new ResumableUploadValidationError("resumable_chunk_body_length_mismatch");
        }
        result = await uploadGoogleDriveResumableChunk(env, identity.userId, connection, {
          sessionUrl: payload.sessionUrl,
          contentRange: `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.totalBytes}`,
          contentLength: parsedRange.length,
          mimeType: payload.mimeType,
          body: chunkBody,
        });
      } else {
        result = await queryGoogleDriveResumableStatus(env, identity.userId, connection, {
          sessionUrl: payload.sessionUrl,
          totalBytes: payload.totalBytes,
        });
      }

      result = await verifyCompletedOriginalRecording(
        env,
        identity.userId,
        connection,
        show,
        payload.totalBytes,
        result,
      );
      await markStorageConnectionUsed(db, identity.userId, connection.id);

      if (!result.complete) {
        return json({
          complete: false,
          showId: show.id,
          connectionId: connection.id,
          nextOffset: result.nextOffset,
          totalBytes: payload.totalBytes,
        }, 202);
      }

      let episode: Awaited<ReturnType<typeof ensureEpisodeFromVerifiedOriginal>> | null = null;
      let episodeTracking: "registered" | "schema_not_ready" | "registration_failed" = "schema_not_ready";
      if (result.file && (await isEpisodeSchemaReady(db))) {
        try {
          episode = await ensureEpisodeFromVerifiedOriginal(
            db,
            identity.userId,
            show,
            connection,
            result.file,
          );
          episodeTracking = "registered";
        } catch {
          episodeTracking = "registration_failed";
        }
      }

      return json({
        complete: true,
        showId: show.id,
        connectionId: connection.id,
        provider: "google-drive",
        file: result.file,
        openUrl: result.file?.webViewLink ?? null,
        episodeTracking,
        episode: episode
          ? {
              id: episode.id,
              showId: episode.show_id,
              title: episode.title,
              status: episode.status,
              createdAt: episode.created_at,
              updatedAt: episode.updated_at,
            }
          : null,
      }, 201);
    }

    if (!readRoute) return json({ error: "method_not_allowed" }, 405);

    const showId = queryValue(url, "showId");
    const connectionId = queryValue(url, "connectionId");
    if (!showId) return json({ error: "show_id_required" }, 400);
    if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);

    const { show, connection } = await loadAssignedDriveContext(
      db,
      identity.userId,
      showId,
      connectionId,
    );
    const session = await createGoogleDriveSession(env, identity.userId, connection);

    if (readRoute.kind === "metadata") {
      const file = await session.getOwnedFile(show.id, show.name, readRoute.fileId);
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({
        showId: show.id,
        connectionId: connection.id,
        provider: "google-drive",
        file,
        openUrl: file.webViewLink,
      });
    }

    const download = await session.downloadOwnedFile(show.id, show.name, readRoute.fileId);
    await markStorageConnectionUsed(db, identity.userId, connection.id);

    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": download.file.mimeType || download.sourceContentType || "application/octet-stream",
      "content-disposition": attachmentContentDisposition(download.file.name),
      "x-content-type-options": "nosniff",
    });
    if (download.contentLength && /^\d+$/.test(download.contentLength)) {
      headers.set("content-length", download.contentLength);
    }

    return new Response(download.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") {
        return json({ error: error.code }, 503);
      }
      return json({ error: error.code }, 401);
    }

    if (error instanceof SmallDriveUploadValidationError) {
      return json({ error: error.code }, 400);
    }

    if (error instanceof ResumableUploadValidationError) {
      return json({ error: error.code }, error.status);
    }

    if (error instanceof GoogleDriveError) {
      return json({ error: error.code }, error.status);
    }

    if (error instanceof Error && error.message === "d1_not_configured") {
      return json({ error: "d1_not_configured" }, 503);
    }

    return json({ error: "internal_error" }, 500);
  }
};
