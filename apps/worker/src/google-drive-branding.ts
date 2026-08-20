import type { WorkerEnv } from "./db";
import type { BrandAssetKind } from "./brand-assets";
import { buildDriveMultipartUpload } from "./drive-upload";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const BRAND_FIELDS = "id,name,mimeType,size,webViewLink,parents,appProperties,createdTime,modifiedTime,capabilities(canDownload)";

interface GoogleTokenResponse {
  access_token?: string;
}

interface DriveBrandFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  createdTime?: string;
  modifiedTime?: string;
  capabilities?: { canDownload?: boolean };
}

interface DriveBrandFileList {
  files?: DriveBrandFile[];
}

export interface BrandAssetRecord {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webViewLink: string | null;
  assetKind: string | null;
  immutable: boolean;
  createdTime: string | null;
  modifiedTime: string | null;
  canDownload: boolean;
}

const refreshAccessToken = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new GoogleDriveError("google_drive_not_configured", 503);
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptStorageToken(
      connection.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      `storage:${userId}:google-drive:${connection.provider_account_id}`,
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
  if (!response.ok) throw new GoogleDriveError("google_drive_access_token_failed", 502);
  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token) throw new GoogleDriveError("google_drive_access_token_missing", 502);
  return token.access_token;
};

const responseError = (response: Response) => {
  if (response.status === 401) return new GoogleDriveError("google_drive_authorization_expired", 401);
  if (response.status === 403) return new GoogleDriveError("google_drive_permission_denied", 403);
  if (response.status === 404) return new GoogleDriveError("google_drive_resource_not_found", 404);
  if (response.status === 429) return new GoogleDriveError("google_drive_rate_limited", 429);
  if (response.status >= 500) return new GoogleDriveError("google_drive_api_retryable", 503);
  return new GoogleDriveError("google_drive_api_failed", 502);
};

const serialize = (file: DriveBrandFile): BrandAssetRecord => {
  const parsedSize = file.size ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? null,
    sizeBytes: parsedSize !== null && Number.isFinite(parsedSize) ? parsedSize : null,
    webViewLink: file.webViewLink ?? null,
    assetKind: file.appProperties?.assetKind ?? null,
    immutable: file.appProperties?.immutable === "true",
    createdTime: file.createdTime ?? null,
    modifiedTime: file.modifiedTime ?? null,
    canDownload: file.capabilities?.canDownload === true,
  };
};

const qEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

export const uploadOriginalBrandAsset = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    showId: string;
    showName: string;
    assetKind: BrandAssetKind;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
) => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);
  const boundary = `hrtechify_brand_${crypto.randomUUID().replaceAll("-", "")}`;
  const { body, contentType } = buildDriveMultipartUpload({
    boundary,
    metadata: {
      name: input.fileName,
      parents: [workspace.folders.brandAssets],
      appProperties: {
        hrtechifyStudio: "v1",
        role: "asset",
        showId: input.showId,
        folder: "brand-assets",
        assetKind: input.assetKind,
        original: "true",
        immutable: "true",
      },
    },
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  const url = new URL(`${DRIVE_UPLOAD_API}/files`);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", BRAND_FIELDS);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": contentType,
    },
    body,
  });
  if (!response.ok) throw responseError(response);
  return serialize((await response.json()) as DriveBrandFile);
};

export const listShowBrandAssets = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: { showId: string; showName: string },
) => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);

  const query = [
    `'${qEscape(workspace.folders.brandAssets)}' in parents`,
    "trashed=false",
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    "appProperties has { key='role' and value='asset' }",
    `appProperties has { key='showId' and value='${qEscape(input.showId)}' }`,
    "appProperties has { key='folder' and value='brand-assets' }",
  ].join(" and ");

  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("fields", `files(${BRAND_FIELDS})`);

  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw responseError(response);
  const payload = (await response.json()) as DriveBrandFileList;

  return (payload.files ?? [])
    .map(serialize)
    .filter((file) =>
      file.assetKind === "show-logo-original" || file.assetKind === "profile-photo-original",
    );
};
