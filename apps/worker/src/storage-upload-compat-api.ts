import { requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { handleDropboxFileApi } from "./dropbox-file-api";
import { getStorageConnectionForUser } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_PREFIX = "/api/storage/google-drive/files/resumable";
const DROPBOX_PREFIX = "/api/storage/dropbox/files/resumable";
const START_PATH = `${DRIVE_PREFIX}/start`;
const CHUNK_PATH = `${DRIVE_PREFIX}/chunk`;
const STATUS_PATH = `${DRIVE_PREFIX}/status`;
const TOKEN_HEADER = "x-hrtechify-upload-token";

const rewriteToDropbox = (request: Request, url: URL) => {
  const rewritten = new URL(url.toString());
  rewritten.pathname = rewritten.pathname.replace(DRIVE_PREFIX, DROPBOX_PREFIX);
  return {
    request: new Request(rewritten.toString(), request),
    url: rewritten,
  };
};

const isDropboxBrowserUploadToken = async (
  env: WorkerEnv,
  userId: string,
  token: string,
) => {
  if (!token || !env.TOKEN_ENCRYPTION_KEY) return false;
  try {
    const raw = await decryptStorageToken(
      token,
      env.TOKEN_ENCRYPTION_KEY,
      `dropbox-browser-upload:${userId}`,
    );
    const parsed = JSON.parse(raw) as { version?: unknown; uploadId?: unknown };
    return parsed.version === 1 &&
      typeof parsed.uploadId === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.uploadId);
  } catch {
    return false;
  }
};

/**
 * Keeps the recorder's established resumable URLs stable while allowing the
 * server to dispatch the exact same browser flow to the show's assigned
 * storage provider. Google Drive requests fall through to handleDriveFileApi.
 */
export const handleStorageUploadCompatApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (url.pathname !== START_PATH && url.pathname !== CHUNK_PATH && url.pathname !== STATUS_PATH) {
    return null;
  }

  let identity: Awaited<ReturnType<typeof requireVerifiedIdentity>>;
  try {
    identity = await requireVerifiedIdentity(request, env);
  } catch {
    return null;
  }

  if (url.pathname === START_PATH && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await request.clone().json() as Record<string, unknown>;
    } catch {
      return null;
    }
    const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    if (!connectionId) return null;
    let connection;
    try {
      const db = requireDatabase(env);
      connection = await getStorageConnectionForUser(db, identity.userId, connectionId);
    } catch {
      return null;
    }
    if (connection?.provider !== "dropbox") return null;
    const rewritten = rewriteToDropbox(request, url);
    return handleDropboxFileApi(rewritten.request, rewritten.url, env);
  }

  if ((url.pathname === CHUNK_PATH || url.pathname === STATUS_PATH) &&
      (request.method === "PUT" || request.method === "POST")) {
    const token = request.headers.get(TOKEN_HEADER) ?? "";
    if (!(await isDropboxBrowserUploadToken(env, identity.userId, token))) return null;
    const rewritten = rewriteToDropbox(request, url);
    return handleDropboxFileApi(rewritten.request, rewritten.url, env);
  }

  return null;
};
