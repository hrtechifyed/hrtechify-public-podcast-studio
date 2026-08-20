import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  assertBackgroundRemovedCandidate,
  backgroundRemovedFileName,
  BackgroundRemovalValidationError,
  candidateKindFor,
  MAX_BACKGROUND_REMOVED_BYTES,
  parseCandidatePreviewPath,
  sourceBrandAssetKind,
} from "./background-removal";
import { requireDatabase, type WorkerEnv } from "./db";
import { GoogleDriveError } from "./google-drive";
import {
  createBrandSelectionMarker,
  getLatestBrandSelection,
  uploadBackgroundRemovedCandidate,
} from "./google-drive-branding";
import { isStorageAssetSchemaReady } from "./schema-readiness";
import { getShowForUser } from "./shows";
import { latestStorageSelection } from "./storage-asset-store";
import { createStudioStorageSession, StudioStorageError } from "./studio-storage";
import {
  getStorageConnectionForUser,
  markStorageConnectionUsed,
  type StorageConnectionRow,
} from "./storage-store";
import { upsertUserFromIdentity } from "./users";

const PREVIEW_CREATE_PATH = "/api/branding/background-removal/preview";
const SELECTION_PATH = "/api/branding/background-removal/selection";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
  if (connection.provider === "dropbox" && !(await isStorageAssetSchemaReady(db))) {
    throw new StudioStorageError("dropbox_storage_schema_not_ready", 503);
  }
  return { show, connection: connection as StorageConnectionRow };
};

const parseJson = async (request: Request) => {
  try { return (await request.json()) as Record<string, unknown>; }
  catch { throw new BackgroundRemovalValidationError("invalid_json"); }
};

const requiredId = (value: unknown, code: string) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value.trim())) {
    throw new BackgroundRemovalValidationError(code);
  }
  return value.trim();
};

const transformToTransparentPng = async (
  env: WorkerEnv,
  body: ReadableStream<Uint8Array> | null,
) => {
  if (!env.IMAGES) throw new BackgroundRemovalValidationError("images_binding_not_configured", 503);
  if (!body) throw new BackgroundRemovalValidationError("background_source_empty", 422);
  let output: Response;
  try {
    output = (
      await env.IMAGES
        .input(body)
        .transform({ segment: "foreground" })
        .output({ format: "image/png" })
    ).response();
  } catch {
    throw new BackgroundRemovalValidationError("background_removal_failed", 502);
  }
  if (!output.ok) throw new BackgroundRemovalValidationError("background_removal_failed", 502);
  const bytes = new Uint8Array(await output.arrayBuffer());
  if (bytes.byteLength === 0) throw new BackgroundRemovalValidationError("background_removal_empty", 502);
  if (bytes.byteLength > MAX_BACKGROUND_REMOVED_BYTES) {
    throw new BackgroundRemovalValidationError("background_removal_output_too_large", 413);
  }
  return bytes;
};

const selectionKindFor = (sourceKind: "show-logo-original" | "profile-photo-original") =>
  sourceKind === "show-logo-original" ? "show-logo-selection" as const : "profile-photo-selection" as const;

export const handleBackgroundRemovalApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/branding/background-removal")) return null;

  const candidatePreviewId = parseCandidatePreviewPath(url.pathname);
  const createPreview = url.pathname === PREVIEW_CREATE_PATH;
  const selectionRoute = url.pathname === SELECTION_PATH;
  if (createPreview && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (selectionRoute && request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!createPreview && !selectionRoute && (!candidatePreviewId || request.method !== "GET")) return json({ error: "not_found" }, 404);

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    let showId = queryValue(url, "showId");
    let connectionId = queryValue(url, "connectionId");
    let sourceAssetId: string | null = null;
    let selectionBody: Record<string, unknown> | null = null;

    if (createPreview || (selectionRoute && request.method === "POST")) {
      const body = await parseJson(request);
      showId = typeof body.showId === "string" ? body.showId.trim() : "";
      connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
      sourceAssetId = requiredId(body.sourceAssetId, "source_asset_id_required");
      if (selectionRoute) selectionBody = body;
    } else if (selectionRoute && request.method === "GET") {
      sourceAssetId = requiredId(queryValue(url, "sourceAssetId"), "source_asset_id_required");
    }

    if (!showId) return json({ error: "show_id_required" }, 400);
    if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
    const { show, connection } = await loadAssignedStorageContext(db, identity.userId, showId, connectionId);
    const storage = await createStudioStorageSession(env, db, identity.userId, connection);

    if (selectionRoute && sourceAssetId) {
      const source = await storage.getOwnedFile(show.id, show.name, sourceAssetId);
      const sourceKind = sourceBrandAssetKind({ id: source.id, name: source.name, mimeType: source.mimeType, appProperties: source.appProperties });

      if (request.method === "GET") {
        let selection;
        if (connection.provider === "google-drive") {
          selection = await getLatestBrandSelection(env, identity.userId, connection, {
            showId: show.id,
            showName: show.name,
            sourceAssetId: source.id,
            sourceAssetKind: sourceKind,
          });
        } else {
          const record = await latestStorageSelection(db, {
            userId: identity.userId,
            showId: show.id,
            connectionId: connection.id,
            assetKind: selectionKindFor(sourceKind),
            sourceAssetId: source.id,
          });
          selection = record ? {
            id: record.provider_file_id,
            selectionKind: selectionKindFor(sourceKind),
            choice: record.selection_choice,
            sourceAssetId: source.id,
            selectedAssetId: record.selected_asset_id,
            createdTime: record.created_at,
          } : null;
        }
        await markStorageConnectionUsed(db, identity.userId, connection.id);
        return json({ showId: show.id, connectionId: connection.id, sourceAssetId: source.id, selection });
      }

      const choice = selectionBody?.choice;
      if (choice !== "original" && choice !== "background-removed") {
        throw new BackgroundRemovalValidationError("background_selection_choice_invalid");
      }
      let selectedAssetId = source.id;
      if (choice === "background-removed") {
        const candidateAssetId = requiredId(selectionBody?.candidateAssetId, "candidate_asset_id_required");
        const candidate = await storage.getOwnedFile(show.id, show.name, candidateAssetId);
        assertBackgroundRemovedCandidate({ id: candidate.id, name: candidate.name, mimeType: candidate.mimeType, appProperties: candidate.appProperties });
        if (
          candidate.appProperties.sourceAssetId !== source.id ||
          candidate.appProperties.sourceAssetKind !== sourceKind
        ) {
          throw new BackgroundRemovalValidationError("background_candidate_source_mismatch", 409);
        }
        selectedAssetId = candidate.id;
      }

      let selection;
      if (connection.provider === "google-drive") {
        selection = await createBrandSelectionMarker(env, identity.userId, connection, {
          showId: show.id,
          showName: show.name,
          sourceAssetId: source.id,
          sourceAssetKind: sourceKind,
          selectedAssetId,
          choice,
        });
      } else {
        if (storage.provider !== "dropbox") throw new StudioStorageError("storage_provider_mismatch", 500);
        const selectionKind = selectionKindFor(sourceKind);
        const marker = new TextEncoder().encode(JSON.stringify({
          version: 1,
          selectionKind,
          choice,
          sourceAssetId: source.id,
          selectedAssetId,
          createdAt: new Date().toISOString(),
        }));
        const file = await storage.uploadSmallAsset({
          showId: show.id,
          showName: show.name,
          folder: "brand-assets",
          fileName: `.hrtechify-${selectionKind}-${crypto.randomUUID()}.json`,
          mimeType: "application/json",
          bytes: marker,
          metadata: {
            assetKind: selectionKind,
            immutable: true,
            sourceAssetId: source.id,
            stateMarker: true,
            selectionChoice: choice,
            selectedAssetId,
            properties: { sourceAssetKind: sourceKind },
          },
        });
        selection = {
          id: file.id,
          selectionKind,
          choice,
          sourceAssetId: source.id,
          selectedAssetId,
          createdTime: new Date().toISOString(),
        };
      }
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({ showId: show.id, connectionId: connection.id, sourceAssetId: source.id, selection }, 201);
    }

    if (createPreview && sourceAssetId) {
      const source = await storage.getOwnedFile(show.id, show.name, sourceAssetId);
      const sourceKind = sourceBrandAssetKind({ id: source.id, name: source.name, mimeType: source.mimeType, appProperties: source.appProperties });
      const download = await storage.downloadOwnedFile(show.id, show.name, source.id);
      const pngBytes = await transformToTransparentPng(env, download.body);
      let candidate;
      if (connection.provider === "google-drive") {
        candidate = await uploadBackgroundRemovedCandidate(env, identity.userId, connection, {
          showId: show.id,
          showName: show.name,
          sourceAssetId: source.id,
          sourceAssetKind: sourceKind,
          fileName: backgroundRemovedFileName(source.name),
          bytes: pngBytes,
        });
      } else {
        if (storage.provider !== "dropbox") throw new StudioStorageError("storage_provider_mismatch", 500);
        candidate = await storage.uploadSmallAsset({
          showId: show.id,
          showName: show.name,
          folder: "brand-assets",
          fileName: backgroundRemovedFileName(source.name),
          mimeType: "image/png",
          bytes: pngBytes,
          metadata: {
            assetKind: candidateKindFor(sourceKind),
            immutable: true,
            original: false,
            sourceAssetId: source.id,
            properties: {
              derived: "true",
              candidate: "true",
              sourceAssetKind: sourceKind,
              transformation: "background-removal-v1",
            },
          },
        });
      }
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      const previewUrl = new URL(`/api/branding/background-removal/candidates/${encodeURIComponent(candidate.id)}/preview`, url.origin);
      previewUrl.searchParams.set("showId", show.id);
      previewUrl.searchParams.set("connectionId", connection.id);
      return json({
        showId: show.id,
        connectionId: connection.id,
        sourceAssetId: source.id,
        candidate,
        previewUrl: `${previewUrl.pathname}${previewUrl.search}`,
      }, 201);
    }

    if (!candidatePreviewId) return json({ error: "not_found" }, 404);
    const candidate = await storage.getOwnedFile(show.id, show.name, candidatePreviewId);
    assertBackgroundRemovedCandidate({ id: candidate.id, name: candidate.name, mimeType: candidate.mimeType, appProperties: candidate.appProperties });
    const download = await storage.downloadOwnedFile(show.id, show.name, candidate.id);
    await markStorageConnectionUsed(db, identity.userId, connection.id);
    return new Response(download.body, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: error.code }, error.code === "authentication_not_configured" ? 503 : 401);
    if (error instanceof BackgroundRemovalValidationError) return json({ error: error.code }, error.status);
    if (error instanceof GoogleDriveError || error instanceof StudioStorageError) return json({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
    return json({ error: "internal_error" }, 500);
  }
};
