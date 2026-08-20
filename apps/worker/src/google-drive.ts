import type { WorkerEnv } from "./db";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
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
  webViewLink?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

interface DriveFileList {
  files?: DriveFile[];
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

const driveFields = "id,name,webViewLink,parents,appProperties";

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
    if (response.status === 401 || response.status === 403) {
      throw new GoogleDriveError("google_drive_permission_denied", response.status);
    }
    throw new GoogleDriveError("google_drive_api_failed", 502);
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

export const createGoogleDriveSession = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  const accessToken = await refreshGoogleDriveAccessToken(env, userId, connection);
  let rootFolder: DriveFile | null = null;

  return {
    async ensureShowWorkspace(showId: string, showName: string): Promise<GoogleDriveWorkspace> {
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
    },
  };
};
