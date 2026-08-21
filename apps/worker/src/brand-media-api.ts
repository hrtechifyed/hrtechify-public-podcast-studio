import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  BrandMediaValidationError,
  createBrandMediaUploadToken,
  parseBrandMediaStartBody,
  readBrandMediaUploadToken,
} from "./brand-media-resumable";
import { requireDatabase, type WorkerEnv } from "./db";
import { createDropboxSession, DropboxError } from "./dropbox";
import {
  DropboxResumableError,
  startDropboxResumableSession,
  uploadDropboxResumableChunk,
} from "./dropbox-resumable";
import { parseResumableContentRange } from "./drive-resumable";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import {
  queryGoogleDriveResumableStatus,
  startGoogleDriveBrandMediaResumableUpload,
  uploadGoogleDriveResumableChunk,
} from "./google-drive-resumable";
import {
  isStorageAssetSchemaReady,
  isStorageUploadSessionSchemaReady,
} from "./schema-readiness";
import { getShowForUser } from "./shows";
import { recordStorageAsset } from "./storage-asset-store";
import { listStudioBrandMedia } from "./storage-brand-media";
import {
  advanceStorageUploadSession,
  completeStorageUploadSession,
  createStorageUploadSession,
  decryptStorageUploadSession,
  getStorageUploadSession,
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

const MEDIA_LIST_PATH = "/api/branding/media";
const START_PATH = "/api/branding/media/resumable/start";
const CHUNK_PATH = "/api/branding/media/resumable/chunk";
const STATUS_PATH = "/api/branding/media/resumable/status";
const UPLOAD_TOKEN_HEADER = "x-hrtechify-brand-upload-token";
const DROPBOX_TOKEN_PREFIX = "dbx.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const parseJson = async (request: Request) => {
  try { return (await request.json()) as Record<string, unknown>; }
  catch { throw new BrandMediaValidationError("invalid_json"); }
};

const queryValue = (url: URL, name: string) => url.searchParams.get(name)?.trim() ?? "";

const loadAssignedStorageContext = async (
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
  if (!connection) throw new StudioStorageError("storage_connection_not_found", 404);
  if (connection.status !== "active") throw new StudioStorageError("storage_connection_inactive", 409);
  if (!show.storage_connection_id) throw new StudioStorageError("show_storage_connection_required", 409);
  if (show.storage_connection_id !== connection.id) throw new StudioStorageError("show_storage_connection_mismatch", 409);
  return { show, connection: connection as StorageConnectionRow };
};

const verifyCompletedGoogleBrandMedia = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    showId: string;
    showName: string;
    fileId: string;
    assetKind: "show-intro-original" | "show-outro-original";
    expectedTotalBytes: number;
  },
) => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const file = await drive.getOwnedFile(input.showId, input.showName, input.fileId);
  if (
    file.appProperties.folder !== "brand-assets" ||
    file.appProperties.assetKind !== input.assetKind ||
    file.appProperties.original !== "true" ||
    file.appProperties.immutable !== "true" ||
    file.sizeBytes !== input.expectedTotalBytes
  ) {
    throw new BrandMediaValidationError("brand_media_completion_verification_failed", 409);
  }
  return file;
};

const createDropboxBrandToken = async (env: WorkerEnv, userId: string, uploadId: string) => {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new BrandMediaValidationError("brand_media_upload_not_configured", 503);
  const encrypted = await encryptStorageToken(
    JSON.stringify({ version: 1, uploadId }),
    env.TOKEN_ENCRYPTION_KEY,
    `dropbox-brand-upload:${userId}`,
  );
  return `${DROPBOX_TOKEN_PREFIX}${encrypted}`;
};

const readDropboxBrandToken = async (env: WorkerEnv, userId: string, token: string) => {
  if (!token.startsWith(DROPBOX_TOKEN_PREFIX) || !env.TOKEN_ENCRYPTION_KEY) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  let value: unknown;
  try {
    value = JSON.parse(await decryptStorageToken(
      token.slice(DROPBOX_TOKEN_PREFIX.length),
      env.TOKEN_ENCRYPTION_KEY,
      `dropbox-brand-upload:${userId}`,
    ));
  } catch {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  const object = value as { version?: unknown; uploadId?: unknown };
  if (object.version !== 1 || typeof object.uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(object.uploadId)) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  return object.uploadId;
};

export const handleBrandMediaApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/branding/media")) return null;
  const isList = url.pathname === MEDIA_LIST_PATH;
  const isStart = url.pathname === START_PATH;
  const isChunk = url.pathname === CHUNK_PATH;
  const isStatus = url.pathname === STATUS_PATH;
  if (!isList && !isStart && !isChunk && !isStatus) return json({ error: "not_found" }, 404);
  if (isList && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (isStart && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (isChunk && request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  if (isStatus && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);
    if (!env.TOKEN_ENCRYPTION_KEY) throw new BrandMediaValidationError("brand_media_upload_not_configured", 503);

    if (isList) {
      const showId = queryValue(url, "showId");
      const connectionId = queryValue(url, "connectionId");
      if (!showId) return json({ error: "show_id_required" }, 400);
      if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
      const { show, connection } = await loadAssignedStorageContext(db, identity.userId, showId, connectionId);
      if (connection.provider === "dropbox" && !(await isStorageAssetSchemaReady(db))) {
        return json({ error: "dropbox_storage_schema_not_ready" }, 503);
      }
      const media = await listStudioBrandMedia(env, db, identity.userId, connection, { showId: show.id, showName: show.name });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ showId: show.id, connectionId: connection.id, provider: connection.provider, media });
    }

    if (isStart) {
      const input = parseBrandMediaStartBody(await parseJson(request));
      const { show, connection } = await loadAssignedStorageContext(db, identity.userId, input.showId, input.connectionId);
      if (connection.provider === "google-drive") {
        const session = await startGoogleDriveBrandMediaResumableUpload(env, identity.userId, connection, {
          showId: show.id,
          showName: show.name,
          assetKind: input.assetKind,
          fileName: input.fileName,
          mimeType: input.mimeType,
          totalBytes: input.totalBytes,
        });
        const uploadToken = await createBrandMediaUploadToken(
          { ...input, sessionUrl: session.sessionUrl },
          env.TOKEN_ENCRYPTION_KEY,
          identity.userId,
        );
        await markStorageConnectionUsed(db, identity.userId, connection.id);
        return json({ uploadToken, nextOffset: 0, provider: "google-drive" }, 201);
      }

      if (!(await isStorageAssetSchemaReady(db)) || !(await isStorageUploadSessionSchemaReady(db))) {
        return json({ error: "dropbox_storage_schema_not_ready" }, 503);
      }
      const dropbox = await createDropboxSession(env, identity.userId, connection);
      const workspace = await dropbox.ensureShowWorkspace(show.id, show.name);
      const providerSessionId = await startDropboxResumableSession(env, identity.userId, connection);
      const row = await createStorageUploadSession(env, db, {
        userId: identity.userId,
        showId: show.id,
        connection,
        providerSessionId,
        destinationPath: `${workspace.folders.brandAssets}/${input.fileName}`,
        fileName: input.fileName,
        mimeType: input.mimeType,
        totalBytes: input.totalBytes,
        assetKind: input.assetKind,
        folder: "brand-assets",
      });
      if (!row) throw new BrandMediaValidationError("brand_media_upload_session_create_failed", 500);
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ uploadToken: await createDropboxBrandToken(env, identity.userId, row.id), nextOffset: 0, provider: "dropbox" }, 201);
    }

    const uploadToken = request.headers.get(UPLOAD_TOKEN_HEADER) ?? "";
    if (uploadToken.startsWith(DROPBOX_TOKEN_PREFIX)) {
      if (!(await isStorageAssetSchemaReady(db)) || !(await isStorageUploadSessionSchemaReady(db))) {
        return json({ error: "dropbox_storage_schema_not_ready" }, 503);
      }
      const uploadId = await readDropboxBrandToken(env, identity.userId, uploadToken);
      const row = await getStorageUploadSession(db, identity.userId, uploadId);
      if (!row) throw new BrandMediaValidationError("brand_media_upload_token_expired", 410);
      if (row.asset_kind !== "show-intro-original" && row.asset_kind !== "show-outro-original") {
        throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
      }
      const { show, connection } = await loadAssignedStorageContext(db, identity.userId, row.show_id, row.connection_id);
      if (connection.provider !== "dropbox") throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
      if (isStatus) return json({ complete: false, nextOffset: row.next_offset, provider: "dropbox" }, 202);
      const parsedRange = parseResumableContentRange(
        request.headers.get("content-range"),
        request.headers.get("content-length"),
        row.total_bytes,
      );
      const chunkBody = await request.arrayBuffer();
      if (chunkBody.byteLength !== parsedRange.length) throw new BrandMediaValidationError("resumable_chunk_body_length_mismatch");
      if (parsedRange.start !== row.next_offset) return json({ error: "resumable_offset_mismatch", nextOffset: row.next_offset }, 409);
      const secrets = await decryptStorageUploadSession(env, row);
      const result = await uploadDropboxResumableChunk(env, identity.userId, connection, {
        sessionId: secrets.providerSessionId,
        destinationPath: secrets.destinationPath,
        start: parsedRange.start,
        totalBytes: row.total_bytes,
        body: chunkBody,
      });
      if (!result.complete) {
        if (result.nextOffset !== parsedRange.end + 1) {
          await reconcileStorageUploadSessionOffset(db, identity.userId, row.id, result.nextOffset);
        } else if (!(await advanceStorageUploadSession(db, identity.userId, row.id, row.next_offset, result.nextOffset))) {
          return json({ error: "resumable_offset_race" }, 409);
        }
        return json({ complete: false, nextOffset: result.nextOffset, provider: "dropbox" }, 202);
      }
      if (!result.file) throw new BrandMediaValidationError("brand_media_completion_verification_failed", 409);
      const record = await recordStorageAsset(db, {
        userId: identity.userId,
        showId: show.id,
        connection,
        providerFileId: result.file.id,
        fileName: result.file.name,
        mimeType: row.mime_type,
        sizeBytes: result.file.sizeBytes,
        folder: "brand-assets",
        assetKind: row.asset_kind,
        immutable: true,
        original: true,
      });
      if (!record) throw new BrandMediaValidationError("brand_media_completion_verification_failed", 409);
      await completeStorageUploadSession(db, identity.userId, row.id);
      const storage = await createStudioStorageSession(env, db, identity.userId, connection);
      const file = await storage.getOwnedFile(show.id, show.name, result.file.id);
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ complete: true, nextOffset: file.sizeBytes, provider: "dropbox", file });
    }

    const payload = await readBrandMediaUploadToken(uploadToken, env.TOKEN_ENCRYPTION_KEY, identity.userId);
    const { show, connection } = await loadAssignedStorageContext(db, identity.userId, payload.showId, payload.connectionId);
    if (connection.provider !== "google-drive") throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
    if (isChunk) {
      const parsedRange = parseResumableContentRange(
        request.headers.get("content-range"),
        request.headers.get("content-length"),
        payload.totalBytes,
      );
      const chunkBody = await request.arrayBuffer();
      if (chunkBody.byteLength !== parsedRange.length) throw new BrandMediaValidationError("resumable_chunk_body_length_mismatch");
      const result = await uploadGoogleDriveResumableChunk(env, identity.userId, connection, {
        sessionUrl: payload.sessionUrl,
        contentRange: `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.totalBytes}`,
        contentLength: parsedRange.length,
        mimeType: payload.mimeType,
        body: chunkBody,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      if (!result.complete || !result.file) return json({ complete: false, nextOffset: result.nextOffset, provider: "google-drive" });
      const file = await verifyCompletedGoogleBrandMedia(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
        fileId: result.file.id,
        assetKind: payload.assetKind,
        expectedTotalBytes: payload.totalBytes,
      });
      return json({ complete: true, nextOffset: file.sizeBytes, provider: "google-drive", file });
    }

    const result = await queryGoogleDriveResumableStatus(env, identity.userId, connection, {
      sessionUrl: payload.sessionUrl,
      totalBytes: payload.totalBytes,
    });
    await markStorageConnectionUsed(db, identity.userId, connection.id);
    if (!result.complete || !result.file) return json({ complete: false, nextOffset: result.nextOffset, provider: "google-drive" });
    const file = await verifyCompletedGoogleBrandMedia(env, identity.userId, connection, {
      showId: show.id,
      showName: show.name,
      fileId: result.file.id,
      assetKind: payload.assetKind,
      expectedTotalBytes: payload.totalBytes,
    });
    return json({ complete: true, nextOffset: file.sizeBytes, provider: "google-drive", file });
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: error.code }, error.code === "authentication_not_configured" ? 503 : 401);
    if (error instanceof BrandMediaValidationError) return json({ error: error.code }, error.status);
    if (error instanceof GoogleDriveError || error instanceof DropboxError || error instanceof DropboxResumableError || error instanceof StudioStorageError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof Error && error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
    return json({ error: "internal_error" }, 500);
  }
};
