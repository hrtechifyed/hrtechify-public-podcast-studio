import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  parseSmallDriveUploadBody,
  SmallDriveUploadValidationError,
} from "./drive-upload";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import { getShowForUser } from "./shows";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

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

export const handleDriveFileApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/storage/google-drive/files")) return null;

  if (url.pathname !== "/api/storage/google-drive/files/small" || request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    const input = parseSmallDriveUploadBody(await parseBody(request));
    const [show, connection] = await Promise.all([
      getShowForUser(db, identity.userId, input.showId),
      getStorageConnectionForUser(db, identity.userId, input.connectionId),
    ]);

    if (!show) return json({ error: "show_not_found" }, 404);
    if (show.status !== "active") return json({ error: "show_not_active" }, 409);

    if (!connection || connection.provider !== "google-drive") {
      return json({ error: "google_drive_connection_not_found" }, 404);
    }
    if (connection.status !== "active") {
      return json({ error: "google_drive_connection_inactive" }, 409);
    }

    if (!show.storage_connection_id) {
      return json({ error: "show_storage_connection_required" }, 409);
    }
    if (show.storage_connection_id !== connection.id) {
      return json({ error: "show_storage_connection_mismatch" }, 409);
    }

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
      },
      201,
    );
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
