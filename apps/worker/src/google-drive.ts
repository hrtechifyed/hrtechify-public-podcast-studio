import type { WorkerEnv } from "./db";
import {
  canDownloadOwnedAsset,
  isOwnedShowAsset,
} from "./drive-file-policy";
import { buildDriveMultipartUpload, type SmallDriveUploadFolder } from "./drive-upload";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const STUDIO_ROOT_NAME = "HRTechify Podcast Studio";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  capabilities?: {
    canDownload?: boolean;
  };
  appProperties?: Record<string, string>;
}

interface DriveFileList {
  files?: DriveFile[];
}

interface GoogleApiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    details?: Array<{
      reason?: string;
      metadata?: Record<string, string>;
    }>;
  };
}

export interface GoogleDriveWorkspace {
  rootFolderId: string;
  showFolderId: string;
  showFolderUrl: string | null;
  folders: {
    brandAssets: string;
    templates: string;
    episodes: string;
  };
}

export interface GoogleDriveStoredFile {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webViewLink: string | null;
  parents: string[];
  appProperties: Record<string, string>;
  canDownload: boolean;
}

export interface GoogleDriveFileDownload {
  file: GoogleDriveStoredFile;
  body: ReadableStream<Uint8Array> | null;
  sourceContentType: string | null;
  contentLength: string | null;
}

export class GoogleDriveError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(code);
    this.name = "GoogleDriveError";
  }
}

const qEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const driveFields = "id,name,mimeType,size,webViewLink,parents,appProperties,trashed,capabilities(canDownload)";

const refreshGoogleDriveAccessToken = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new GoogleDriveError("google_drive_not_configured", 503);
  }

  if (connection.provider !== "google-drive" || connection.status !== "active") {
    throw new GoogleDriveError("google_drive_connection_inactive", 409);
  }

  const associatedData = `storage:${userId}:google-drive:${connection.provider_account_id}`;
  let refreshToken: string;
  try {
    refreshToken = await decryptStorageToken(
      connection.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      associatedData,
    );
  } catch {
    throw new GoogleDriveError("google_drive_token_decryption_failed", 500);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new GoogleDriveError("google_drive_access_token_failed", 502);
  }

  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token) {
    throw new GoogleDriveError("google_drive_access_token_missing", 502);
  }

  return token.access_token;
};

const driveErrorFromResponse = async (response: Response): Promise<GoogleDriveError> => {
  let payload: GoogleApiErrorResponse | null = null;
  try {
    payload = (await response.clone().json()) as GoogleApiErrorResponse;
  } catch {
    payload = null;
  }

  const message = payload?.error?.message?.toLowerCase() ?? "";
  const reasons = [
    ...(payload?.error?.errors ?? []).map((item) => item.reason ?? ""),
    ...(payload?.error?.details ?? []).map((item) => item.reason ?? ""),
    payload?.error?.status ?? "",
  ].map((reason) => reason.toLowerCase());

  const apiDisabled =
    reasons.some((reason) =>
      ["accessnotconfigured", "service_disabled", "servicedisabled"].includes(reason.replaceAll("_", "")),
    ) ||
    message.includes("has not been used") ||
    message.includes("is disabled") ||
    message.includes("enable it by visiting") ||
    message.includes("drive api has not been used");

  if (apiDisabled) {
    return new GoogleDriveError("google_drive_api_not_enabled", 503);
  }

  if (response.status === 401) {
    return new GoogleDriveError("google_drive_authorization_expired", 401);
  }

  if (response.status === 403) {
    if (message.includes("insufficient") || reasons.some((reason) => reason.includes("insufficient"))) {
      return new GoogleDriveError("google_drive_scope_insufficient", 403);
    }
    return new GoogleDriveError("google_drive_permission_denied", 403);
  }

  if (response.status === 404) {
    return new GoogleDriveError("google_drive_resource_not_found", 404);
  }

  if (response.status === 429) {
    return new GoogleDriveError("google_drive_rate_limited", 429);
  }

  return new GoogleDriveError("google_drive_api_failed", 502);
};

const driveJson = async <T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init?.body) headers.set("content-type", "application/json");

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw await driveErrorFromResponse(response);
  }

  return (await response.json()) as T;
};

const findFolder = async (
  accessToken: string,
  queryParts: string[],
): Promise<DriveFile | null> => {
  const q = [
    `mimeType='${FOLDER_MIME_TYPE}'`,
    "trashed=false",
    ...queryParts,
  ].join(" and ");
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", q);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("fields", `files(${driveFields})`);

  const result = await driveJson<DriveFileList>(accessToken, url.toString());
  return result.files?.[0] ?? null;
};

const createFolder = async (
  accessToken: string,
  input: {
    name: string;
    parentId?: string;
    appProperties: Record<string, string>;
  },
): Promise<DriveFile> => {
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("fields", driveFields);
  const body: Record<string, unknown> = {
    name: input.name,
    mimeType: FOLDER_MIME_TYPE,
    appProperties: input.appProperties,
  };
  if (input.parentId) body.parents = [input.parentId];

  return driveJson<DriveFile>(accessToken, url.toString(), {
    method: "POST",
    body: JSON.stringify(body),
  });
};

const renameFolderIfNeeded = async (
  accessToken: string,
  folder: DriveFile,
  desiredName: string,
): Promise<DriveFile> => {
  if (folder.name === desiredName) return folder;
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(folder.id)}`);
  url.searchParams.set("fields", driveFields);
  return driveJson<DriveFile>(accessToken, url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ name: desiredName }),
  });
};

const ensureStudioRoot = async (accessToken: string) => {
  const existing = await findFolder(accessToken, [
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    "appProperties has { key='role' and value='root' }",
  ]);
  if (existing) return renameFolderIfNeeded(accessToken, existing, STUDIO_ROOT_NAME);

  return createFolder(accessToken, {
    name: STUDIO_ROOT_NAME,
    appProperties: {
      hrtechifyStudio: "v1",
      role: "root",
    },
  });
};

const ensureShowFolder = async (
  accessToken: string,
  rootFolderId: string,
  showId: string,
  showName: string,
) => {
  const existing = await findFolder(accessToken, [
    `'${qEscape(rootFolderId)}' in parents`,
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    "appProperties has { key='role' and value='show' }",
    `appProperties has { key='showId' and value='${qEscape(showId)}' }`,
  ]);
  if (existing) return renameFolderIfNeeded(accessToken, existing, showName);

  return createFolder(accessToken, {
    name: showName,
    parentId: rootFolderId,
    appProperties: {
      hrtechifyStudio: "v1",
      role: "show",
      showId,
    },
  });
};

const ensureShowSubfolder = async (
  accessToken: string,
  showFolderId: string,
  showId: string,
  role: "brand-assets" | "templates" | "episodes",
  name: string,
) => {
  const existing = await findFolder(accessToken, [
    `'${qEscape(showFolderId)}' in parents`,
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    `appProperties has { key='role' and value='${role}' }`,
    `appProperties has { key='showId' and value='${qEscape(showId)}' }`,
  ]);
  if (existing) return renameFolderIfNeeded(accessToken, existing, name);

  return createFolder(accessToken, {
    name,
    parentId: showFolderId,
    appProperties: {
      hrtechifyStudio: "v1",
      role,
      showId,
    },
  });
};

const serializeStoredFile = (file: DriveFile): GoogleDriveStoredFile => {
  const parsedSize = file.size ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? null,
    sizeBytes: parsedSize !== null && Number.isFinite(parsedSize) ? parsedSize : null,
    webViewLink: file.webViewLink ?? null,
    parents: file.parents ?? [],
    appProperties: file.appProperties ?? {},
    canDownload: file.capabilities?.canDownload === true,
  };
};

const getDriveFile = async (
  accessToken: string,
  fileId: string,
): Promise<DriveFile> => {
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", driveFields);
  return driveJson<DriveFile>(accessToken, url.toString());
};

const uploadSmallFileToFolder = async (
  accessToken: string,
  input: {
    parentId: string;
    showId: string;
    folder: SmallDriveUploadFolder;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<GoogleDriveStoredFile> => {
  const boundary = `hrtechify_${crypto.randomUUID().replaceAll("-", "")}`;
  const { body, contentType } = buildDriveMultipartUpload({
    boundary,
    metadata: {
      name: input.fileName,
      parents: [input.parentId],
      appProperties: {
        hrtechifyStudio: "v1",
        role: "asset",
        showId: input.showId,
        folder: input.folder,
      },
    },
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  const url = new URL(`${DRIVE_UPLOAD_API}/files`);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", driveFields);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": contentType,
    },
    body,
  });
  if (!response.ok) {
    throw await driveErrorFromResponse(response);
  }

  return serializeStoredFile((await response.json()) as DriveFile);
};

export const createGoogleDriveSession = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  const accessToken = await refreshGoogleDriveAccessToken(env, userId, connection);
  let rootFolder: DriveFile | null = null;

  const ensureShowWorkspace = async (
    showId: string,
    showName: string,
  ): Promise<GoogleDriveWorkspace> => {
    rootFolder ??= await ensureStudioRoot(accessToken);
    const showFolder = await ensureShowFolder(
      accessToken,
      rootFolder.id,
      showId,
      showName.trim() || "Untitled Show",
    );

    const [brandAssets, templates, episodes] = await Promise.all([
      ensureShowSubfolder(accessToken, showFolder.id, showId, "brand-assets", "Brand Assets"),
      ensureShowSubfolder(accessToken, showFolder.id, showId, "templates", "Templates"),
      ensureShowSubfolder(accessToken, showFolder.id, showId, "episodes", "Episodes"),
    ]);

    return {
      rootFolderId: rootFolder.id,
      showFolderId: showFolder.id,
      showFolderUrl: showFolder.webViewLink ?? null,
      folders: {
        brandAssets: brandAssets.id,
        templates: templates.id,
        episodes: episodes.id,
      },
    };
  };

  const getOwnedShowAsset = async (
    showId: string,
    showName: string,
    fileId: string,
  ) => {
    const [workspace, file] = await Promise.all([
      ensureShowWorkspace(showId, showName),
      getDriveFile(accessToken, fileId),
    ]);
    const folder = file.appProperties?.folder;
    const expectedParentId = folder === "brand-assets"
      ? workspace.folders.brandAssets
      : folder === "episodes"
        ? workspace.folders.episodes
        : "";

    if (!expectedParentId || !isOwnedShowAsset(file, showId, expectedParentId)) {
      throw new GoogleDriveError("google_drive_file_not_found", 404);
    }

    return file;
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
      const parentId = input.folder === "brand-assets"
        ? workspace.folders.brandAssets
        : workspace.folders.episodes;
      return uploadSmallFileToFolder(accessToken, {
        parentId,
        showId,
        ...input,
      });
    },
    async getOwnedFile(showId: string, showName: string, fileId: string) {
      return serializeStoredFile(await getOwnedShowAsset(showId, showName, fileId));
    },
    async downloadOwnedFile(
      showId: string,
      showName: string,
      fileId: string,
    ): Promise<GoogleDriveFileDownload> {
      const file = await getOwnedShowAsset(showId, showName, fileId);
      if (!canDownloadOwnedAsset(file)) {
        throw new GoogleDriveError("google_drive_file_not_downloadable", 409);
      }

      const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`);
      url.searchParams.set("alt", "media");
      const response = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw await driveErrorFromResponse(response);
      }

      return {
        file: serializeStoredFile(file),
        body: response.body,
        sourceContentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
      };
    },
  };
};
