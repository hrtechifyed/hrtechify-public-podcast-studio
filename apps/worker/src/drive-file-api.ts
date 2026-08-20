import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  attachmentContentDisposition,
  parseDriveFileReadRoute,
} from "./drive-file-policy";
import {
  parseSmallDriveUploadBody,
  SmallDriveUploadValidationError,
} from "./drive-upload";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import { getShowForUser } from "./shows";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const SMALL_UPLOAD_PATH = "/api/storage/google-drive/files/small";

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

export const handleDriveFileApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/storage/google-drive/files")) return null;

  const isSmallUpload = url.pathname === SMALL_UPLOAD_PATH;
  const readRoute = isSmallUpload ? null : parseDriveFileReadRoute(url.pathname);

  if (isSmallUpload && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!isSmallUpload && (!readRoute || request.method !== "GET")) {
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

    if (error instanceof GoogleDriveError) {
      return json({ error: error.code }, error.status);
    }

    if (error instanceof Error && error.message === "d1_not_configured") {
      return json({ error: "d1_not_configured" }, 503);
    }

    return json({ error: "internal_error" }, 500);
  }
};
