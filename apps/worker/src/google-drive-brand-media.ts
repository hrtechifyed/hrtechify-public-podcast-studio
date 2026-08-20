import type { WorkerEnv } from "./db";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FIELDS = "id,name,mimeType,size,webViewLink,parents,appProperties,createdTime,capabilities(canDownload)";

interface TokenResponse { access_token?: string }
interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  createdTime?: string;
  capabilities?: { canDownload?: boolean };
}
interface DriveList { files?: DriveFile[] }

export interface BrandMediaRecord {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webViewLink: string | null;
  assetKind: "show-intro-original" | "show-outro-original";
  createdTime: string | null;
  immutable: boolean;
  canDownload: boolean;
}

const qEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const accessToken = async (env: WorkerEnv, userId: string, connection: StorageConnectionRow) => {
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
  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) throw new GoogleDriveError("google_drive_access_token_missing", 502);
  return token.access_token;
};

export const listShowBrandMedia = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: { showId: string; showName: string },
): Promise<BrandMediaRecord[]> => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const token = await accessToken(env, userId, connection);
  const query = [
    `'${qEscape(workspace.folders.brandAssets)}' in parents`,
    "trashed=false",
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    "appProperties has { key='role' and value='asset' }",
    `appProperties has { key='showId' and value='${qEscape(input.showId)}' }`,
    "appProperties has { key='folder' and value='brand-assets' }",
    "appProperties has { key='original' and value='true' }",
    "appProperties has { key='immutable' and value='true' }",
  ].join(" and ");
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("fields", `files(${FIELDS})`);
  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new GoogleDriveError("google_drive_authorization_expired", 401);
    if (response.status === 403) throw new GoogleDriveError("google_drive_permission_denied", 403);
    if (response.status === 429) throw new GoogleDriveError("google_drive_rate_limited", 429);
    throw new GoogleDriveError("google_drive_api_failed", 502);
  }
  const payload = (await response.json()) as DriveList;
  return (payload.files ?? []).flatMap((file) => {
    const kind = file.appProperties?.assetKind;
    if (kind !== "show-intro-original" && kind !== "show-outro-original") return [];
    const size = file.size ? Number(file.size) : null;
    return [{
      id: file.id,
      name: file.name,
      mimeType: file.mimeType ?? null,
      sizeBytes: size !== null && Number.isFinite(size) ? size : null,
      webViewLink: file.webViewLink ?? null,
      assetKind: kind,
      createdTime: file.createdTime ?? null,
      immutable: file.appProperties?.immutable === "true",
      canDownload: file.capabilities?.canDownload === true,
    }];
  });
};
