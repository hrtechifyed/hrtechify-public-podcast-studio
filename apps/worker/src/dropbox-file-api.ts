import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { createDropboxSession, DropboxError } from "./dropbox";
import {
  DropboxResumableError,
  startDropboxResumableSession,
  uploadDropboxResumableChunk,
} from "./dropbox-resumable";
import {
  MAX_RESUMABLE_CHUNK_BYTES,
  parseResumableContentRange,
  parseResumableUploadStartBody,
  RESUMABLE_CHUNK_GRANULARITY_BYTES,
  RESUMABLE_UPLOAD_TOKEN_TTL_MS,
  ResumableUploadValidationError,
} from "./drive-resumable";
import { attachmentContentDisposition } from "./drive-file-policy";
import { ensureEpisodeFromVerifiedOriginal } from "./episodes";
import {
  isEpisodeSchemaReady,
  isStorageAssetSchemaReady,
  isStorageUploadSessionSchemaReady,
} from "./schema-readiness";
import { getShowForUser } from "./shows";
import { recordStorageAsset } from "./storage-asset-store";
import {
  advanceStorageUploadSession,
  completeStorageUploadSession,
  createStorageUploadSession,
  decryptStorageUploadSession,
  getStorageUploadSession,
  purgeExpiredStorageUploadSessions,
  reconcileStorageUploadSessionOffset,
} from "./storage-upload-sessions";
import { createStudioStorageSession, StudioStorageError } from "./studio-storage";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { decryptStorageToken, encryptStorageToken } from "./token-crypto";
import { upsertUserFromIdentity } from "./users";

const PREFIX = "/api/storage/dropbox/files";
const START_PATH = `${PREFIX}/resumable/start`;
const CHUNK_PATH = `${PREFIX}/resumable/chunk`;
const STATUS_PATH = `${PREFIX}/resumable/status`;
const TOKEN_HEADER = "x-hrtechify-upload-token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const parseJson = async (request: Request) => {
  try { return (await request.json()) as Record<string, unknown>; }
  catch { throw new ResumableUploadValidationError("invalid_json"); }
};

const loadContext = async (
  db: ReturnType<typeof requireDatabase>,
  userId: string,
  showId: string,
  connectionId: string,
) => {
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, showId),
    getStorageConnectionForUser(db, userId, connectionId),
  ]);
  if (!show) throw new StudioStorageError("show_not_found", 404);
  if (show.status !== "active") throw new StudioStorageError("show_not_active", 409);
  if (!connection || connection.provider !== "dropbox") throw new StudioStorageError("dropbox_connection_not_found", 404);
  if (connection.status !== "active") throw new StudioStorageError("dropbox_connection_inactive", 409);
  if (show.storage_connection_id !== connection.id) throw new StudioStorageError("show_storage_connection_mismatch", 409);
  return { show, connection: connection as StorageConnectionRow };
};

const createBrowserToken = async (env: WorkerEnv, userId: string, uploadId: string) => {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new StudioStorageError("storage_token_encryption_not_configured", 503);
  return encryptStorageToken(
    JSON.stringify({ version: 1, uploadId }),
    env.TOKEN_ENCRYPTION_KEY,
    `dropbox-browser-upload:${userId}`,
  );
};

const readBrowserToken = async (env: WorkerEnv, userId: string, token: string) => {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new StudioStorageError("storage_token_encryption_not_configured", 503);
  if (!token) throw new ResumableUploadValidationError("resumable_upload_token_required", 400);
  let value: unknown;
  try {
    value = JSON.parse(await decryptStorageToken(token, env.TOKEN_ENCRYPTION_KEY, `dropbox-browser-upload:${userId}`));
  } catch {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }
  const object = value as { version?: unknown; uploadId?: unknown };
  if (object.version !== 1 || typeof object.uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(object.uploadId)) {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }
  return object.uploadId;
};

const parseReadRoute = (pathname: string) => {
  if (!pathname.startsWith(`${PREFIX}/`)) return null;
  const rest = pathname.slice(PREFIX.length + 1);
  if (rest.startsWith("resumable/")) return null;
  const segments = rest.split("/");
  if (segments.length < 1 || segments.length > 2 || !segments[0]) return null;
  if (segments.length === 2 && segments[1] !== "download") return null;
  let fileId: string;
  try { fileId = decodeURIComponent(segments[0]); } catch { return null; }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) return null;
  return { fileId, download: segments.length === 2 };
};

export const handleDropboxFileApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith(PREFIX)) return null;
  const isStart = url.pathname === START_PATH;
  const isChunk = url.pathname === CHUNK_PATH;
  const isStatus = url.pathname === STATUS_PATH;
  const readRoute = !isStart && !isChunk && !isStatus ? parseReadRoute(url.pathname) : null;
  if ((isStart || isStatus) && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (isChunk && request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  if (readRoute && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!isStart && !isChunk && !isStatus && !readRoute) return json({ error: "not_found" }, 404);

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (isStart) {
      if (!(await isStorageAssetSchemaReady(db)) || !(await isStorageUploadSessionSchemaReady(db))) {
        return json({ error: "dropbox_storage_schema_not_ready" }, 503);
      }
      const input = parseResumableUploadStartBody(await parseJson(request));
      const { show, connection } = await loadContext(db, identity.userId, input.showId, input.connectionId);
      await purgeExpiredStorageUploadSessions(db);
      const dropbox = await createDropboxSession(env, identity.userId, connection);
      const workspace = await dropbox.ensureShowWorkspace(show.id, show.name);
      const providerSessionId = await startDropboxResumableSession(env, identity.userId, connection);
      const row = await createStorageUploadSession(env, db, {
        userId: identity.userId,
        showId: show.id,
        connection,
        providerSessionId,
        destinationPath: `${workspace.folders.episodes}/${input.fileName}`,
        fileName: input.fileName,
        mimeType: input.mimeType,
        totalBytes: input.totalBytes,
        assetKind: "original-recording",
        folder: "episodes",
      });
      if (!row) throw new StudioStorageError("dropbox_upload_session_create_failed", 500);
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({
        showId: show.id,
        connectionId: connection.id,
        provider: "dropbox",
        uploadToken: await createBrowserToken(env, identity.userId, row.id),
        nextOffset: 0,
        totalBytes: input.totalBytes,
        maxChunkBytes: MAX_RESUMABLE_CHUNK_BYTES,
        chunkGranularityBytes: RESUMABLE_CHUNK_GRANULARITY_BYTES,
        tokenExpiresInSeconds: Math.floor(RESUMABLE_UPLOAD_TOKEN_TTL_MS / 1000),
      }, 201);
    }

    if (isChunk || isStatus) {
      if (!(await isStorageAssetSchemaReady(db)) || !(await isStorageUploadSessionSchemaReady(db))) {
        return json({ error: "dropbox_storage_schema_not_ready" }, 503);
      }
      const uploadId = await readBrowserToken(env, identity.userId, request.headers.get(TOKEN_HEADER) ?? "");
      const row = await getStorageUploadSession(db, identity.userId, uploadId);
      if (!row) return json({ error: "resumable_upload_token_expired" }, 410);
      const { show, connection } = await loadContext(db, identity.userId, row.show_id, row.connection_id);
      if (isStatus) {
        return json({ complete: false, showId: show.id, connectionId: connection.id, nextOffset: row.next_offset, totalBytes: row.total_bytes }, 202);
      }

      const range = parseResumableContentRange(
        request.headers.get("content-range"),
        request.headers.get("content-length"),
        row.total_bytes,
      );
      const body = await request.arrayBuffer();
      if (body.byteLength !== range.length) throw new ResumableUploadValidationError("resumable_chunk_body_length_mismatch");
      if (range.start !== row.next_offset) {
        return json({ error: "resumable_offset_mismatch", nextOffset: row.next_offset }, 409);
      }
      const secrets = await decryptStorageUploadSession(env, row);
      const result = await uploadDropboxResumableChunk(env, identity.userId, connection, {
        sessionId: secrets.providerSessionId,
        destinationPath: secrets.destinationPath,
        start: range.start,
        totalBytes: row.total_bytes,
        body,
      });

      if (!result.complete) {
        if (result.nextOffset !== range.end + 1) {
          await reconcileStorageUploadSessionOffset(db, identity.userId, row.id, result.nextOffset);
        } else if (!(await advanceStorageUploadSession(db, identity.userId, row.id, row.next_offset, result.nextOffset))) {
          return json({ error: "resumable_offset_race" }, 409);
        }
        return json({ complete: false, showId: show.id, connectionId: connection.id, nextOffset: result.nextOffset, totalBytes: row.total_bytes }, 202);
      }

      if (!result.file) throw new StudioStorageError("dropbox_upload_completion_invalid", 502);
      const record = await recordStorageAsset(db, {
        userId: identity.userId,
        showId: show.id,
        connection,
        providerFileId: result.file.id,
        fileName: result.file.name,
        mimeType: row.mime_type,
        sizeBytes: result.file.sizeBytes,
        folder: "episodes",
        assetKind: "original-recording",
        immutable: true,
        original: true,
      });
      if (!record) throw new StudioStorageError("storage_asset_record_failed", 500);
      await completeStorageUploadSession(db, identity.userId, row.id);
      const session = await createStudioStorageSession(env, db, identity.userId, connection);
      const file = await session.getOwnedFile(show.id, show.name, result.file.id);
      let episode: Awaited<ReturnType<typeof ensureEpisodeFromVerifiedOriginal>> | null = null;
      let episodeTracking: "registered" | "schema_not_ready" | "registration_failed" = "schema_not_ready";
      if (await isEpisodeSchemaReady(db)) {
        try {
          episode = await ensureEpisodeFromVerifiedOriginal(db, identity.userId, show, connection, file);
          episodeTracking = "registered";
        } catch {
          episodeTracking = "registration_failed";
        }
      }
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({
        complete: true,
        showId: show.id,
        connectionId: connection.id,
        provider: "dropbox",
        file,
        openUrl: null,
        episodeTracking,
        episode: episode ? {
          id: episode.id,
          showId: episode.show_id,
          title: episode.title,
          status: episode.status,
          createdAt: episode.created_at,
          updatedAt: episode.updated_at,
        } : null,
      }, 201);
    }

    if (!readRoute) return json({ error: "not_found" }, 404);
    const showId = url.searchParams.get("showId")?.trim() ?? "";
    const connectionId = url.searchParams.get("connectionId")?.trim() ?? "";
    if (!showId) return json({ error: "show_id_required" }, 400);
    if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
    const { show, connection } = await loadContext(db, identity.userId, showId, connectionId);
    const session = await createStudioStorageSession(env, db, identity.userId, connection);
    if (!readRoute.download) {
      const file = await session.getOwnedFile(show.id, show.name, readRoute.fileId);
      return json({ showId: show.id, connectionId: connection.id, provider: "dropbox", file, openUrl: null });
    }
    const download = await session.downloadOwnedFile(show.id, show.name, readRoute.fileId);
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": download.file.mimeType || download.sourceContentType || "application/octet-stream",
      "content-disposition": attachmentContentDisposition(download.file.name),
      "x-content-type-options": "nosniff",
    });
    if (download.contentLength && /^\d+$/.test(download.contentLength)) headers.set("content-length", download.contentLength);
    return new Response(download.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: error.code }, error.code === "authentication_not_configured" ? 503 : 401);
    if (error instanceof ResumableUploadValidationError) return json({ error: error.code }, error.status);
    if (error instanceof DropboxResumableError || error instanceof DropboxError || error instanceof StudioStorageError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof Error && error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
    return json({ error: "internal_error" }, 500);
  }
};
