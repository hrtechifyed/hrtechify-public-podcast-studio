import type { WorkerEnv } from "./db";
import type { SmallDriveUploadFolder } from "./drive-upload";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2";
const STUDIO_ROOT = "/HRTechify Podcast Studio";

interface DropboxTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface DropboxMetadata {
  ".tag"?: "file" | "folder" | "deleted";
  id?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  is_downloadable?: boolean;
  content_hash?: string;
}

interface DropboxCreateFolderResponse {
  metadata?: DropboxMetadata;
}

interface DropboxListFolderResponse {
  entries?: DropboxMetadata[];
  cursor?: string;
  has_more?: boolean;
}

interface DropboxErrorPayload {
  error_summary?: string;
}

export interface DropboxWorkspace {
  rootPath: string;
  showPath: string;
  showFolderUrl: null;
  folders: {
    brandAssets: string;
    templates: string;
    episodes: string;
  };
}

export interface DropboxStoredFile {
  id: string;
  name: string;
  mimeType: null;
  sizeBytes: number | null;
  webViewLink: null;
  parents: string[];
  appProperties: Record<string, string>;
  canDownload: boolean;
  pathLower: string;
  contentHash: string | null;
}

export interface DropboxFileDownload {
  file: DropboxStoredFile;
  body: ReadableStream<Uint8Array> | null;
  sourceContentType: string | null;
  contentLength: string | null;
}

export class DropboxError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(code);
    this.name = "DropboxError";
  }
}

const cleanSegment = (value: string) => {
  const cleaned = value.replace(/[\\/\u0000-\u001f\u007f]/g, "-").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") throw new DropboxError("dropbox_path_invalid", 400);
  return cleaned.slice(0, 180);
};

const showRoot = (showId: string) => `${STUDIO_ROOT}/Shows/${cleanSegment(showId)}`;

const dropboxErrorFromResponse = async (response: Response): Promise<DropboxError> => {
  let summary = "";
  try {
    summary = ((await response.clone().json()) as DropboxErrorPayload).error_summary?.toLowerCase() ?? "";
  } catch {
    summary = "";
  }
  if (response.status === 401) return new DropboxError("dropbox_authorization_expired", 401);
  if (response.status === 403) return new DropboxError("dropbox_permission_denied", 403);
  if (response.status === 409 && summary.includes("not_found")) return new DropboxError("dropbox_resource_not_found", 404);
  if (response.status === 409) return new DropboxError("dropbox_conflict", 409);
  if (response.status === 429) return new DropboxError("dropbox_rate_limited", 429);
  if (response.status >= 500) return new DropboxError("dropbox_retryable", 503);
  return new DropboxError("dropbox_api_failed", 502);
};

const refreshDropboxAccessToken = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new DropboxError("dropbox_not_configured", 503);
  }
  if (connection.provider !== "dropbox" || connection.status !== "active") {
    throw new DropboxError("dropbox_connection_inactive", 409);
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptStorageToken(
      connection.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      `storage:${userId}:dropbox:${connection.provider_account_id}`,
    );
  } catch {
    throw new DropboxError("dropbox_token_decryption_failed", 500);
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw await dropboxErrorFromResponse(response);
  const token = (await response.json()) as DropboxTokenResponse;
  if (!token.access_token) throw new DropboxError("dropbox_access_token_missing", 502);
  return token.access_token;
};

const apiJson = async <T>(accessToken: string, endpoint: string, body: unknown): Promise<T> => {
  const response = await fetch(`${DROPBOX_API}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await dropboxErrorFromResponse(response);
  return (await response.json()) as T;
};

const getMetadataOrNull = async (accessToken: string, path: string) => {
  try {
    return await apiJson<DropboxMetadata>(accessToken, "/files/get_metadata", {
      path,
      include_deleted: false,
    });
  } catch (error) {
    if (error instanceof DropboxError && error.code === "dropbox_resource_not_found") return null;
    throw error;
  }
};

const ensureFolder = async (accessToken: string, path: string) => {
  const existing = await getMetadataOrNull(accessToken, path);
  if (existing) {
    if (existing[".tag"] !== "folder") throw new DropboxError("dropbox_workspace_path_conflict", 409);
    return existing;
  }
  try {
    const created = await apiJson<DropboxCreateFolderResponse>(accessToken, "/files/create_folder_v2", {
      path,
      autorename: false,
    });
    if (!created.metadata || created.metadata[".tag"] !== "folder") {
      throw new DropboxError("dropbox_folder_metadata_invalid", 502);
    }
    return created.metadata;
  } catch (error) {
    if (error instanceof DropboxError && error.code === "dropbox_conflict") {
      const raced = await getMetadataOrNull(accessToken, path);
      if (raced?.[".tag"] === "folder") return raced;
    }
    throw error;
  }
};

const serialize = (metadata: DropboxMetadata, showId: string): DropboxStoredFile => {
  if (metadata[".tag"] !== "file" || !metadata.id || !metadata.name || !metadata.path_lower) {
    throw new DropboxError("dropbox_file_metadata_invalid", 502);
  }
  return {
    id: metadata.id.replace(/^id:/, ""),
    name: metadata.name,
    mimeType: null,
    sizeBytes: Number.isSafeInteger(metadata.size) ? metadata.size! : null,
    webViewLink: null,
    parents: [metadata.path_lower.slice(0, metadata.path_lower.lastIndexOf("/"))],
    appProperties: {
      hrtechifyStudio: "v1",
      showId,
    },
    canDownload: metadata.is_downloadable !== false,
    pathLower: metadata.path_lower,
    contentHash: metadata.content_hash ?? null,
  };
};

const expectedFolderForAsset = (showId: string, pathLower: string) => {
  const root = showRoot(showId).toLowerCase();
  const brand = `${root}/brand assets/`;
  const episodes = `${root}/episodes/`;
  const templates = `${root}/templates/`;
  return pathLower.startsWith(brand) || pathLower.startsWith(episodes) || pathLower.startsWith(templates);
};

export const createDropboxSession = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  const accessToken = await refreshDropboxAccessToken(env, userId, connection);

  const ensureShowWorkspace = async (showId: string, _showName: string): Promise<DropboxWorkspace> => {
    const root = STUDIO_ROOT;
    const shows = `${root}/Shows`;
    const showPath = showRoot(showId);
    const brandAssets = `${showPath}/Brand Assets`;
    const templates = `${showPath}/Templates`;
    const episodes = `${showPath}/Episodes`;
    for (const path of [root, shows, showPath, brandAssets, templates, episodes]) {
      await ensureFolder(accessToken, path);
    }
    return {
      rootPath: root,
      showPath,
      showFolderUrl: null,
      folders: { brandAssets, templates, episodes },
    };
  };

  const getOwnedMetadata = async (showId: string, fileId: string) => {
    const metadata = await apiJson<DropboxMetadata>(accessToken, "/files/get_metadata", {
      path: `id:${fileId}`,
      include_deleted: false,
    });
    if (!metadata.path_lower || !expectedFolderForAsset(showId, metadata.path_lower)) {
      throw new DropboxError("dropbox_file_not_found", 404);
    }
    return metadata;
  };

  return {
    ensureShowWorkspace,
    async uploadSmallFile(
      showId: string,
      showName: string,
      input: {
        folder: SmallDriveUploadFolder;
        fileName: string;
        mimeType: string;
        bytes: Uint8Array;
      },
    ) {
      const workspace = await ensureShowWorkspace(showId, showName);
      const parent = input.folder === "brand-assets" ? workspace.folders.brandAssets : workspace.folders.episodes;
      const path = `${parent}/${cleanSegment(input.fileName)}`;
      const response = await fetch(`${DROPBOX_CONTENT_API}/files/upload`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream",
          "dropbox-api-arg": JSON.stringify({
            path,
            mode: "add",
            autorename: true,
            mute: true,
            strict_conflict: true,
          }),
        },
        body: input.bytes.slice().buffer,
      });
      if (!response.ok) throw await dropboxErrorFromResponse(response);
      return serialize((await response.json()) as DropboxMetadata, showId);
    },
    async listFolder(showId: string, showName: string, folder: "brand-assets" | "templates" | "episodes") {
      const workspace = await ensureShowWorkspace(showId, showName);
      const path = folder === "brand-assets"
        ? workspace.folders.brandAssets
        : folder === "templates"
          ? workspace.folders.templates
          : workspace.folders.episodes;
      const entries: DropboxStoredFile[] = [];
      let result = await apiJson<DropboxListFolderResponse>(accessToken, "/files/list_folder", {
        path,
        recursive: false,
        include_deleted: false,
        include_non_downloadable_files: true,
        limit: 2000,
      });
      for (;;) {
        for (const entry of result.entries ?? []) {
          if (entry[".tag"] === "file") entries.push(serialize(entry, showId));
        }
        if (!result.has_more || !result.cursor) break;
        result = await apiJson<DropboxListFolderResponse>(accessToken, "/files/list_folder/continue", {
          cursor: result.cursor,
        });
      }
      return entries;
    },
    async getOwnedFile(showId: string, _showName: string, fileId: string) {
      return serialize(await getOwnedMetadata(showId, fileId), showId);
    },
    async downloadOwnedFile(showId: string, _showName: string, fileId: string): Promise<DropboxFileDownload> {
      const metadata = await getOwnedMetadata(showId, fileId);
      if (metadata.is_downloadable === false) throw new DropboxError("dropbox_file_not_downloadable", 409);
      const response = await fetch(`${DROPBOX_CONTENT_API}/files/download`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "dropbox-api-arg": JSON.stringify({ path: `id:${fileId}` }),
        },
      });
      if (!response.ok) throw await dropboxErrorFromResponse(response);
      return {
        file: serialize(metadata, showId),
        body: response.body,
        sourceContentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
      };
    },
  };
};
