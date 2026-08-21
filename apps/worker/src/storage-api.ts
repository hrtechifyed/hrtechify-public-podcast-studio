import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  addSecondsSqlite,
  pkceChallenge,
  randomToken,
  safeReturnTo,
  sha256Base64Url,
} from "./auth-utils";
import { requireDatabase, type WorkerEnv } from "./db";
import { createDropboxSession, DropboxError } from "./dropbox";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import {
  getShowForUser,
  listShowsForUser,
  setShowStorageConnectionForUser,
} from "./shows";
import { ensureStarterBrandAssets } from "./starter-branding";
import {
  consumeStorageOAuthState,
  getStorageConnectionForUser,
  listStorageConnectionsForUser,
  markStorageConnectionUsed,
  purgeExpiredStorageOAuthStates,
  saveStorageOAuthState,
  type StorageConnectionRow,
  upsertStorageConnection,
} from "./storage-store";
import { encryptStorageToken } from "./token-crypto";
import { upsertUserFromIdentity } from "./users";

const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DROPBOX_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.content.read",
  "files.content.write",
] as const;

type StorageProvider = StorageConnectionRow["provider"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store" },
  });

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

const appDestination = (request: Request, env: WorkerEnv, returnTo = "/") => {
  const origin = env.APP_URL?.trim() || new URL(request.url).origin;
  return new URL(safeReturnTo(returnTo), origin).toString();
};

const storageDestination = (
  request: Request,
  env: WorkerEnv,
  provider: StorageProvider,
  returnTo: string,
  status: "connected" | "error",
  reason?: string,
) => {
  const destination = new URL(appDestination(request, env, returnTo));
  destination.searchParams.set("storage", status);
  destination.searchParams.set("provider", provider);
  if (reason) destination.searchParams.set("reason", reason);
  return destination.toString();
};

const googleDriveConfigured = (env: WorkerEnv) =>
  Boolean(
    env.DB &&
      env.SESSION_SIGNING_KEY &&
      env.GOOGLE_DRIVE_CLIENT_ID &&
      env.GOOGLE_DRIVE_CLIENT_SECRET &&
      env.TOKEN_ENCRYPTION_KEY,
  );

const dropboxConfigured = (env: WorkerEnv) =>
  Boolean(
    env.DB &&
      env.SESSION_SIGNING_KEY &&
      env.DROPBOX_CLIENT_ID &&
      env.DROPBOX_CLIENT_SECRET &&
      env.TOKEN_ENCRYPTION_KEY,
  );

interface GoogleDriveTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

interface DropboxTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  account_id?: string;
  expires_in?: number;
}

interface DropboxCurrentAccount {
  account_id?: string;
  email?: string;
  email_verified?: boolean;
}

const serializeConnection = (
  connection: Awaited<ReturnType<typeof listStorageConnectionsForUser>>[number],
) => ({
  id: connection.id,
  provider: connection.provider,
  accountEmail: connection.provider_account_email,
  status: connection.status,
  scopes: connection.scopes.split(" ").filter(Boolean),
  lastUsedAt: connection.last_used_at,
  createdAt: connection.created_at,
  updatedAt: connection.updated_at,
});

const requireActiveStorageConnection = async (
  db: ReturnType<typeof requireDatabase>,
  userId: string,
  connectionId: string,
  provider?: StorageProvider,
): Promise<StorageConnectionRow> => {
  const connection = await getStorageConnectionForUser(db, userId, connectionId);
  if (!connection || (provider && connection.provider !== provider)) {
    throw provider === "dropbox"
      ? new DropboxError("dropbox_connection_not_found", 404)
      : new GoogleDriveError("google_drive_connection_not_found", 404);
  }
  if (connection.status !== "active") {
    throw connection.provider === "dropbox"
      ? new DropboxError("dropbox_connection_inactive", 409)
      : new GoogleDriveError("google_drive_connection_inactive", 409);
  }
  return connection;
};

const createProviderSession = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => connection.provider === "dropbox"
  ? createDropboxSession(env, userId, connection)
  : createGoogleDriveSession(env, userId, connection);

const startGoogleDrive = async (request: Request, env: WorkerEnv, userId: string) => {
  if (!googleDriveConfigured(env)) return json({ error: "google_drive_not_configured" }, 503);
  const db = requireDatabase(env);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  await purgeExpiredStorageOAuthStates(db);
  await saveStorageOAuthState(db, {
    stateHash,
    userId,
    provider: "google-drive",
    codeVerifier: verifier,
    returnTo,
    expiresAt: addSecondsSqlite(10 * 60),
  });

  const redirectUri = `${requestUrl.origin}/api/storage/google-drive/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", env.GOOGLE_DRIVE_CLIENT_ID!);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", `openid email ${GOOGLE_DRIVE_SCOPE}`);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent select_account");
  return redirect(authorizationUrl.toString());
};

const finishGoogleDrive = async (request: Request, env: WorkerEnv, userId: string) => {
  if (!googleDriveConfigured(env)) {
    return redirect(storageDestination(request, env, "google-drive", "/", "error", "google_drive_not_configured"));
  }
  const db = requireDatabase(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirect(storageDestination(request, env, "google-drive", "/", "error", oauthError));
  if (!state || !code) {
    return redirect(storageDestination(request, env, "google-drive", "/", "error", "google_drive_callback_invalid"));
  }

  const transaction = await consumeStorageOAuthState(db, await sha256Base64Url(state));
  if (!transaction || transaction.provider !== "google-drive") {
    return redirect(storageDestination(request, env, "google-drive", "/", "error", "google_drive_state_invalid_or_expired"));
  }
  if (transaction.user_id !== userId) {
    return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "error", "google_drive_user_mismatch"));
  }

  const redirectUri = `${url.origin}/api/storage/google-drive/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID!,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: transaction.code_verifier,
    }),
  });
  if (!tokenResponse.ok) {
    return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "error", "google_drive_token_exchange_failed"));
  }
  const token = (await tokenResponse.json()) as GoogleDriveTokenResponse;
  if (!token.access_token || !token.refresh_token) {
    return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "error", "google_drive_refresh_token_missing"));
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "error", "google_drive_account_lookup_failed"));
  }
  const profile = (await profileResponse.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "error", "google_drive_account_invalid"));
  }

  const refreshTokenEncrypted = await encryptStorageToken(
    token.refresh_token,
    env.TOKEN_ENCRYPTION_KEY!,
    `storage:${userId}:google-drive:${profile.sub}`,
  );
  await upsertStorageConnection(db, {
    id: crypto.randomUUID(),
    userId,
    provider: "google-drive",
    providerAccountId: profile.sub,
    providerAccountEmail: profile.email,
    refreshTokenEncrypted,
    scopes: token.scope || `openid email ${GOOGLE_DRIVE_SCOPE}`,
  });
  return redirect(storageDestination(request, env, "google-drive", transaction.return_to, "connected"));
};

const startDropbox = async (request: Request, env: WorkerEnv, userId: string) => {
  if (!dropboxConfigured(env)) return json({ error: "dropbox_not_configured" }, 503);
  const db = requireDatabase(env);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  await purgeExpiredStorageOAuthStates(db);
  await saveStorageOAuthState(db, {
    stateHash,
    userId,
    provider: "dropbox",
    codeVerifier: verifier,
    returnTo,
    expiresAt: addSecondsSqlite(10 * 60),
  });

  const redirectUri = `${requestUrl.origin}/api/storage/dropbox/callback`;
  const authorizationUrl = new URL("https://www.dropbox.com/oauth2/authorize");
  authorizationUrl.searchParams.set("client_id", env.DROPBOX_CLIENT_ID!);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("token_access_type", "offline");
  authorizationUrl.searchParams.set("scope", DROPBOX_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return redirect(authorizationUrl.toString());
};

const finishDropbox = async (request: Request, env: WorkerEnv, userId: string) => {
  if (!dropboxConfigured(env)) {
    return redirect(storageDestination(request, env, "dropbox", "/", "error", "dropbox_not_configured"));
  }
  const db = requireDatabase(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirect(storageDestination(request, env, "dropbox", "/", "error", oauthError));
  if (!state || !code) {
    return redirect(storageDestination(request, env, "dropbox", "/", "error", "dropbox_callback_invalid"));
  }

  const transaction = await consumeStorageOAuthState(db, await sha256Base64Url(state));
  if (!transaction || transaction.provider !== "dropbox") {
    return redirect(storageDestination(request, env, "dropbox", "/", "error", "dropbox_state_invalid_or_expired"));
  }
  if (transaction.user_id !== userId) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_user_mismatch"));
  }

  const redirectUri = `${url.origin}/api/storage/dropbox/callback`;
  const tokenResponse = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: env.DROPBOX_CLIENT_ID!,
      client_secret: env.DROPBOX_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code_verifier: transaction.code_verifier,
    }),
  });
  if (!tokenResponse.ok) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_token_exchange_failed"));
  }
  const token = (await tokenResponse.json()) as DropboxTokenResponse;
  if (!token.access_token || !token.refresh_token) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_refresh_token_missing"));
  }

  const profileResponse = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_account_lookup_failed"));
  }
  const profile = (await profileResponse.json()) as DropboxCurrentAccount;
  const accountId = profile.account_id || token.account_id;
  if (!accountId || !profile.email || profile.email_verified === false) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_account_invalid"));
  }

  const granted = new Set((token.scope || "").split(" ").filter(Boolean));
  if (DROPBOX_SCOPES.some((scope) => !granted.has(scope))) {
    return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "error", "dropbox_scope_insufficient"));
  }

  const refreshTokenEncrypted = await encryptStorageToken(
    token.refresh_token,
    env.TOKEN_ENCRYPTION_KEY!,
    `storage:${userId}:dropbox:${accountId}`,
  );
  await upsertStorageConnection(db, {
    id: crypto.randomUUID(),
    userId,
    provider: "dropbox",
    providerAccountId: accountId,
    providerAccountEmail: profile.email,
    refreshTokenEncrypted,
    scopes: DROPBOX_SCOPES.join(" "),
  });
  return redirect(storageDestination(request, env, "dropbox", transaction.return_to, "connected"));
};

const provisionShowWorkspace = async (
  env: WorkerEnv,
  userId: string,
  showId: string,
  connectionId: string,
  provider?: StorageProvider,
) => {
  const db = requireDatabase(env);
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, showId),
    requireActiveStorageConnection(db, userId, connectionId, provider),
  ]);
  if (!show) throw new Error("show_not_found");

  const session = await createProviderSession(env, userId, connection);
  const workspace = await session.ensureShowWorkspace(show.id, show.name);
  await setShowStorageConnectionForUser(db, userId, show.id, connection.id);
  const starterBranding = connection.provider === "google-drive"
    ? await ensureStarterBrandAssets(env, userId, connection, show)
    : null;
  await markStorageConnectionUsed(db, userId, connection.id);
  return {
    showId: show.id,
    connectionId: connection.id,
    provider: connection.provider,
    accountEmail: connection.provider_account_email,
    starterBranding,
    ...workspace,
  };
};

const provisionActiveShowWorkspaces = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
  provider: StorageProvider,
) => {
  const db = requireDatabase(env);
  const body = await parseBody(request);
  const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : null;
  const replaceExisting = body.replaceExisting === true;
  const connections = (await listStorageConnectionsForUser(db, userId)).filter(
    (connection) => connection.provider === provider && connection.status === "active",
  );
  if (connections.length === 0) {
    throw provider === "dropbox"
      ? new DropboxError("dropbox_connection_not_found", 404)
      : new GoogleDriveError("google_drive_connection_not_found", 404);
  }

  let connection: StorageConnectionRow;
  if (requestedConnectionId) {
    connection = await requireActiveStorageConnection(db, userId, requestedConnectionId, provider);
  } else if (connections.length === 1) {
    connection = connections[0];
  } else {
    throw provider === "dropbox"
      ? new DropboxError("dropbox_connection_selection_required", 409)
      : new GoogleDriveError("google_drive_connection_selection_required", 409);
  }

  const shows = (await listShowsForUser(db, userId)).filter((show) => show.status === "active");
  const session = await createProviderSession(env, userId, connection);
  const provisioned: Array<Record<string, unknown>> = [];
  const skipped: Array<{ showId: string; reason: string }> = [];
  for (const show of shows) {
    if (!replaceExisting && show.storage_connection_id && show.storage_connection_id !== connection.id) {
      skipped.push({ showId: show.id, reason: "different_storage_connection" });
      continue;
    }
    const workspace = await session.ensureShowWorkspace(show.id, show.name);
    await setShowStorageConnectionForUser(db, userId, show.id, connection.id);
    const starterBranding = connection.provider === "google-drive"
      ? await ensureStarterBrandAssets(env, userId, connection, show)
      : null;
    provisioned.push({
      showId: show.id,
      connectionId: connection.id,
      provider: connection.provider,
      accountEmail: connection.provider_account_email,
      starterBranding,
      ...workspace,
    });
  }
  await markStorageConnectionUsed(db, userId, connection.id);
  return { connection: serializeConnection(connection), provisioned, skipped };
};

export const handleStorageApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/storage")) return null;

  if (url.pathname === "/api/storage/config" && request.method === "GET") {
    return json({
      providers: {
        googleDrive: googleDriveConfigured(env),
        dropbox: dropboxConfigured(env),
      },
      dropboxAccess: "app-folder",
      dropboxScopes: [...DROPBOX_SCOPES],
    });
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (url.pathname === "/api/storage/connections" && request.method === "GET") {
      const connections = await listStorageConnectionsForUser(db, identity.userId);
      return json({ connections: connections.map(serializeConnection) });
    }

    if (url.pathname === "/api/storage/google-drive/start" && request.method === "GET") {
      return startGoogleDrive(request, env, identity.userId);
    }
    if (url.pathname === "/api/storage/google-drive/callback" && request.method === "GET") {
      return finishGoogleDrive(request, env, identity.userId);
    }
    if (url.pathname === "/api/storage/dropbox/start" && request.method === "GET") {
      return startDropbox(request, env, identity.userId);
    }
    if (url.pathname === "/api/storage/dropbox/callback" && request.method === "GET") {
      return finishDropbox(request, env, identity.userId);
    }

    const provisionMatch = /^\/api\/storage\/(google-drive|dropbox)\/provision$/.exec(url.pathname);
    if (provisionMatch && request.method === "POST") {
      const provider = provisionMatch[1] as StorageProvider;
      const body = await parseBody(request);
      const showId = typeof body.showId === "string" ? body.showId : "";
      const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
      if (!showId) return json({ error: "show_id_required" }, 400);
      if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
      const workspace = await provisionShowWorkspace(env, identity.userId, showId, connectionId, provider);
      return json({ workspace });
    }

    const provisionAllMatch = /^\/api\/storage\/(google-drive|dropbox)\/provision-active-shows$/.exec(url.pathname);
    if (provisionAllMatch && request.method === "POST") {
      return json(await provisionActiveShowWorkspaces(
        request,
        env,
        identity.userId,
        provisionAllMatch[1] as StorageProvider,
      ));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof GoogleDriveError || error instanceof DropboxError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof Error) {
      if (error.message === "show_not_found") return json({ error: "show_not_found" }, 404);
      if (error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
      if (error.message === "invalid_json") return json({ error: "invalid_json" }, 400);
    }
    return json({ error: "internal_error" }, 500);
  }
};
