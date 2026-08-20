import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  assertBackgroundRemovedCandidate,
  backgroundRemovedFileName,
  BackgroundRemovalValidationError,
  MAX_BACKGROUND_REMOVED_BYTES,
  parseCandidatePreviewPath,
  sourceBrandAssetKind,
} from "./background-removal";
import { requireDatabase, type WorkerEnv } from "./db";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import {
  createBrandSelectionMarker,
  getLatestBrandSelection,
  uploadBackgroundRemovedCandidate,
} from "./google-drive-branding";
import { getShowForUser } from "./shows";
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

const parseJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new BackgroundRemovalValidationError("invalid_json");
  }
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
  if (!env.IMAGES) {
    throw new BackgroundRemovalValidationError("images_binding_not_configured", 503);
  }
  if (!body) {
    throw new BackgroundRemovalValidationError("background_source_empty", 422);
  }

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
  if (!output.ok) {
    throw new BackgroundRemovalValidationError("background_removal_failed", 502);
  }

  const bytes = new Uint8Array(await output.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new BackgroundRemovalValidationError("background_removal_empty", 502);
  }
  if (bytes.byteLength > MAX_BACKGROUND_REMOVED_BYTES) {
    throw new BackgroundRemovalValidationError("background_removal_output_too_large", 413);
  }
  return bytes;
};

export const handleBackgroundRemovalApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/branding/background-removal")) return null;

  const candidatePreviewId = parseCandidatePreviewPath(url.pathname);
  const createPreview = url.pathname === PREVIEW_CREATE_PATH;
  const selectionRoute = url.pathname === SELECTION_PATH;
  if (createPreview && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (selectionRoute && request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!createPreview && !selectionRoute && (!candidatePreviewId || request.method !== "GET")) {
    return json({ error: "not_found" }, 404);
  }

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

    const { show, connection } = await loadAssignedDriveContext(
      db,
      identity.userId,
      showId,
      connectionId,
    );
    const drive = await createGoogleDriveSession(env, identity.userId, connection);

    if (selectionRoute && sourceAssetId) {
      const source = await drive.getOwnedFile(show.id, show.name, sourceAssetId);
      const sourceKind = sourceBrandAssetKind({
        id: source.id,
        name: source.name,
        mimeType: source.mimeType,
        appProperties: source.appProperties,
      });

      if (request.method === "GET") {
        const selection = await getLatestBrandSelection(env, identity.userId, connection, {
          showId: show.id,
          showName: show.name,
          sourceAssetId: source.id,
          sourceAssetKind: sourceKind,
        });
        await markStorageConnectionUsed(db, identity.userId, connection.id);
        return json({
          showId: show.id,
          connectionId: connection.id,
          sourceAssetId: source.id,
          selection,
        });
      }

      const choice = selectionBody?.choice;
      if (choice !== "original" && choice !== "background-removed") {
        throw new BackgroundRemovalValidationError("background_selection_choice_invalid");
      }

      let selectedAssetId = source.id;
      if (choice === "background-removed") {
        const candidateAssetId = requiredId(
          selectionBody?.candidateAssetId,
          "candidate_asset_id_required",
        );
        const candidate = await drive.getOwnedFile(show.id, show.name, candidateAssetId);
        assertBackgroundRemovedCandidate({
          id: candidate.id,
          name: candidate.name,
          mimeType: candidate.mimeType,
          appProperties: candidate.appProperties,
        });
        if (
          candidate.appProperties.sourceAssetId !== source.id ||
          candidate.appProperties.sourceAssetKind !== sourceKind
        ) {
          throw new BackgroundRemovalValidationError("background_candidate_source_mismatch", 409);
        }
        selectedAssetId = candidate.id;
      }

      const selection = await createBrandSelectionMarker(env, identity.userId, connection, {
        showId: show.id,
        showName: show.name,
        sourceAssetId: source.id,
        sourceAssetKind: sourceKind,
        selectedAssetId,
        choice,
      });
      await markStorageConnectionUsed(db, identity.userId, connection.id);
      return json({
        showId: show.id,
        connectionId: connection.id,
        sourceAssetId: source.id,
        selection,
      }, 201);
    }

    if (createPreview && sourceAssetId) {
      const source = await drive.getOwnedFile(show.id, show.name, sourceAssetId);
      const sourceKind = sourceBrandAssetKind({
        id: source.id,
        name: source.name,
        mimeType: source.mimeType,
        appProperties: source.appProperties,
      });
      const download = await drive.downloadOwnedFile(show.id, show.name, source.id);
      const pngBytes = await transformToTransparentPng(env, download.body);
      const candidate = await uploadBackgroundRemovedCandidate(
        env,
        identity.userId,
        connection,
        {
          showId: show.id,
          showName: show.name,
          sourceAssetId: source.id,
          sourceAssetKind: sourceKind,
          fileName: backgroundRemovedFileName(source.name),
          bytes: pngBytes,
        },
      );
      await markStorageConnectionUsed(db, identity.userId, connection.id);

      const previewUrl = new URL(
        `/api/branding/background-removal/candidates/${encodeURIComponent(candidate.id)}/preview`,
        url.origin,
      );
      previewUrl.searchParams.set("showId", show.id);
      previewUrl.searchParams.set("connectionId", connection.id);

      return json(
        {
          showId: show.id,
          connectionId: connection.id,
          sourceAssetId: source.id,
          candidate,
          previewUrl: `${previewUrl.pathname}${previewUrl.search}`,
        },
        201,
      );
    }

    if (!candidatePreviewId) return json({ error: "not_found" }, 404);
    const candidate = await drive.getOwnedFile(show.id, show.name, candidatePreviewId);
    assertBackgroundRemovedCandidate({
      id: candidate.id,
      name: candidate.name,
      mimeType: candidate.mimeType,
      appProperties: candidate.appProperties,
    });
    const download = await drive.downloadOwnedFile(show.id, show.name, candidate.id);
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
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") {
        return json({ error: error.code }, 503);
      }
      return json({ error: error.code }, 401);
    }
    if (error instanceof BackgroundRemovalValidationError) {
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
