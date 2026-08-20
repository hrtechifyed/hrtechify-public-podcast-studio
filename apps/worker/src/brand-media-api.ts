import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  BrandMediaValidationError,
  createBrandMediaUploadToken,
  parseBrandMediaStartBody,
  readBrandMediaUploadToken,
} from "./brand-media-resumable";
import { requireDatabase, type WorkerEnv } from "./db";
import { parseResumableContentRange } from "./drive-resumable";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import { listShowBrandMedia } from "./google-drive-brand-media";
import {
  queryGoogleDriveResumableStatus,
  startGoogleDriveBrandMediaResumableUpload,
  uploadGoogleDriveResumableChunk,
} from "./google-drive-resumable";
import { getShowForUser } from "./shows";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const MEDIA_LIST_PATH = "/api/branding/media";
const START_PATH = "/api/branding/media/resumable/start";
const CHUNK_PATH = "/api/branding/media/resumable/chunk";
const STATUS_PATH = "/api/branding/media/resumable/status";
const UPLOAD_TOKEN_HEADER = "x-hrtechify-brand-upload-token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const parseJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new BrandMediaValidationError("invalid_json");
  }
};

const queryValue = (url: URL, name: string) => url.searchParams.get(name)?.trim() ?? "";

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
  if (connection.status !== "active") throw new GoogleDriveError("google_drive_connection_inactive", 409);
  if (!show.storage_connection_id) throw new GoogleDriveError("show_storage_connection_required", 409);
  if (show.storage_connection_id !== connection.id) {
    throw new GoogleDriveError("show_storage_connection_mismatch", 409);
  }
  return { show, connection: connection as StorageConnectionRow };
};

const verifyCompletedBrandMedia = async (
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
    if (!env.TOKEN_ENCRYPTION_KEY) {
      throw new BrandMediaValidationError("brand_media_upload_not_configured", 503);
    }

    if (isList) {
      const showId = queryValue(url, "showId");
      const connectionId = queryValue(url, "connectionId");
      if (!showId) return json({ error: "show_id_required" }, 400);
      if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
      const { show, connection } = await loadAssignedDriveContext(db, identity.userId, showId, connectionId);
      const media = await listShowBrandMedia(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ showId: show.id, connectionId: connection.id, media });
    }

    if (isStart) {
      const input = parseBrandMediaStartBody(await parseJson(request));
      const { show, connection } = await loadAssignedDriveContext(
        db,
        identity.userId,
        input.showId,
        input.connectionId,
      );
      const session = await startGoogleDriveBrandMediaResumableUpload(
        env,
        identity.userId,
        connection,
        {
          showId: show.id,
          showName: show.name,
          assetKind: input.assetKind,
          fileName: input.fileName,
          mimeType: input.mimeType,
          totalBytes: input.totalBytes,
        },
      );
      const uploadToken = await createBrandMediaUploadToken(
        { ...input, sessionUrl: session.sessionUrl },
        env.TOKEN_ENCRYPTION_KEY,
        identity.userId,
      );
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ uploadToken, nextOffset: 0 }, 201);
    }

    const uploadToken = request.headers.get(UPLOAD_TOKEN_HEADER) ?? "";
    const payload = await readBrandMediaUploadToken(
      uploadToken,
      env.TOKEN_ENCRYPTION_KEY,
      identity.userId,
    );
    const { show, connection } = await loadAssignedDriveContext(
      db,
      identity.userId,
      payload.showId,
      payload.connectionId,
    );

    if (isChunk) {
      const parsedRange = parseResumableContentRange(
        request.headers.get("content-range"),
        request.headers.get("content-length"),
        payload.totalBytes,
      );
      const chunkBody = await request.arrayBuffer();
      if (chunkBody.byteLength !== parsedRange.length) {
        throw new BrandMediaValidationError("resumable_chunk_body_length_mismatch");
      }
      const result = await uploadGoogleDriveResumableChunk(env, identity.userId, connection, {
        sessionUrl: payload.sessionUrl,
        contentRange: `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.totalBytes}`,
        contentLength: parsedRange.length,
        mimeType: payload.mimeType,
        body: chunkBody,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      if (!result.complete || !result.file) {
        return json({ complete: false, nextOffset: result.nextOffset });
      }
      const file = await verifyCompletedBrandMedia(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
        fileId: result.file.id,
        assetKind: payload.assetKind,
        expectedTotalBytes: payload.totalBytes,
      });
      return json({ complete: true, nextOffset: file.sizeBytes, file });
    }

    const result = await queryGoogleDriveResumableStatus(env, identity.userId, connection, {
      sessionUrl: payload.sessionUrl,
      totalBytes: payload.totalBytes,
    });
    await markStorageConnectionUsed(db, identity.userId, connection.id);
    if (!result.complete || !result.file) {
      return json({ complete: false, nextOffset: result.nextOffset });
    }
    const file = await verifyCompletedBrandMedia(env, identity.userId, connection, {
      showId: show.id,
      showName: show.name,
      fileId: result.file.id,
      assetKind: payload.assetKind,
      expectedTotalBytes: payload.totalBytes,
    });
    return json({ complete: true, nextOffset: file.sizeBytes, file });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof BrandMediaValidationError) return json({ error: error.code }, error.status);
    if (error instanceof GoogleDriveError) return json({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "d1_not_configured") {
      return json({ error: "d1_not_configured" }, 503);
    }
    return json({ error: "internal_error" }, 500);
  }
};
