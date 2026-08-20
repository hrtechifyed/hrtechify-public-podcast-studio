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
import { isStorageAssetSchemaReady } from "./schema-readiness";
import { getShowForUser } from "./shows";
import { listStorageAssetsByKind } from "./storage-asset-store";
import { createStudioStorageSession, StudioStorageError } from "./studio-storage";
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

const listDropboxBrandAssets = async (
  env: WorkerEnv,
  db: ReturnType<typeof requireDatabase>,
  userId: string,
  connection: StorageConnectionRow,
  show: { id: string; name: string },
) => {
  if (!(await isStorageAssetSchemaReady(db))) throw new StudioStorageError("dropbox_storage_schema_not_ready", 503);
  const records = await listStorageAssetsByKind(
    db,
    userId,
    show.id,
    connection.id,
    ["show-logo-original", "profile-photo-original"],
  );
  const session = await createStudioStorageSession(env, db, userId, connection);
  return Promise.all(records.map(async (record) => {
    const file = await session.getOwnedFile(show.id, show.name, record.provider_file_id);
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      webViewLink: file.webViewLink,
      assetKind: record.asset_kind,
      immutable: record.immutable === 1,
      createdTime: record.created_at,
      modifiedTime: record.created_at,
      canDownload: file.canDownload,
    };
  }));
};

export const handleBrandAssetsApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/branding")) return null;
  if (url.pathname !== BRAND_ASSETS_PATH) return json({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    const showId = queryValue(url, "showId");
    const connectionId = queryValue(url, "connectionId");
    if (!showId) return json({ error: "show_id_required" }, 400);
    if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
    const { show, connection } = await loadAssignedStorageContext(db, identity.userId, showId, connectionId);

    if (request.method === "GET") {
      const assets = connection.provider === "google-drive"
        ? await listShowBrandAssets(env, identity.userId, connection, { showId: show.id, showName: show.name })
        : await listDropboxBrandAssets(env, db, identity.userId, connection, show);
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ showId: show.id, connectionId: connection.id, provider: connection.provider, assets });
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

    let asset;
    if (connection.provider === "google-drive") {
      asset = await uploadOriginalBrandAsset(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
        assetKind: upload.assetKind,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        bytes,
      });
    } else {
      if (!(await isStorageAssetSchemaReady(db))) throw new StudioStorageError("dropbox_storage_schema_not_ready", 503);
      const session = await createStudioStorageSession(env, db, identity.userId, connection);
      asset = await session.uploadSmallAsset({
        showId: show.id,
        showName: show.name,
        folder: "brand-assets",
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        bytes,
        metadata: {
          assetKind: upload.assetKind,
          immutable: true,
          original: true,
        },
      });
    }
    await markStorageConnectionUsed(db, identity.userId, connection.id);
    return json({
      showId: show.id,
      connectionId: connection.id,
      provider: connection.provider,
      asset,
      openUrl: asset.webViewLink,
    }, 201);
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: error.code }, error.code === "authentication_not_configured" ? 503 : 401);
    if (error instanceof BrandAssetValidationError) return json({ error: error.code }, error.status);
    if (error instanceof GoogleDriveError || error instanceof StudioStorageError) return json({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
    return json({ error: "internal_error" }, 500);
  }
};
