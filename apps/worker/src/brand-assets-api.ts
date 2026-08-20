import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  BrandAssetValidationError,
  parseBrandAssetUploadInput,
  validateBrandAssetBody,
} from "./brand-assets";
import { requireDatabase, type WorkerEnv } from "./db";
import { GoogleDriveError } from "./google-drive";
import {
  listShowBrandAssets,
  uploadOriginalBrandAsset,
} from "./google-drive-branding";
import { getShowForUser } from "./shows";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const BRAND_ASSETS_PATH = "/api/branding/assets";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

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

export const handleBrandAssetsApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/branding")) return null;
  if (url.pathname !== BRAND_ASSETS_PATH) return json({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

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

    if (request.method === "GET") {
      const assets = await listShowBrandAssets(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({
        showId: show.id,
        connectionId: connection.id,
        provider: "google-drive",
        assets,
      });
    }

    const upload = parseBrandAssetUploadInput({
      showId,
      connectionId,
      assetKind: queryValue(url, "assetKind"),
      fileName: queryValue(url, "fileName"),
      mimeType: request.headers.get("content-type")?.split(";", 1)[0] ?? "",
      contentLength: request.headers.get("x-upload-size") ?? request.headers.get("content-length"),
    });

    const bytes = new Uint8Array(await request.arrayBuffer());
    validateBrandAssetBody(bytes, upload.contentLength);

    const asset = await uploadOriginalBrandAsset(env, identity.userId, connection, {
      showId: show.id,
      showName: show.name,
      assetKind: upload.assetKind,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      bytes,
    });
    await markStorageConnectionUsed(db, identity.userId, connection.id);

    return json(
      {
        showId: show.id,
        connectionId: connection.id,
        provider: "google-drive",
        asset,
        openUrl: asset.webViewLink,
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
    if (error instanceof BrandAssetValidationError) {
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
