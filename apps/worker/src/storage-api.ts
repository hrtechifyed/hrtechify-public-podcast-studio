import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import {
  addSecondsSqlite,
  pkceChallenge,
  randomToken,
  safeReturnTo,
  sha256Base64Url,
} from "./auth-utils";
import { requireDatabase, type WorkerEnv } from "./db";
import { createGoogleDriveSession, GoogleDriveError } from "./google-drive";
import {
  getShowForUser,
  listShowsForUser,
  setShowStorageConnectionForUser,
} from "./shows";
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
  returnTo: string,
  status: "connected" | "error",
  reason?: string,
) => {
  const destination = new URL(appDestination(request, env, returnTo));
  destination.searchParams.set("storage", status);
  destination.searchParams.set("provider", "google-drive");
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

const requireActiveGoogleDriveConnection = async (
  db: ReturnType<typeof requireDatabase>,
  userId: string,
  connectionId: string,
): Promise<StorageConnectionRow> => {
  const connection = await getStorageConnectionForUser(db, userId, connectionId);
  if (!connection || connection.provider !== "google-drive") {
    throw new GoogleDriveError("google_drive_connection_not_found", 404);
  }
  if (connection.status !== "active") {
    throw new GoogleDriveError("google_drive_connection_inactive", 409);
  }
  return connection;
};

const startGoogleDrive = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
) => {
  if (!googleDriveConfigured(env)) {
    return json({ error: "google_drive_not_configured" }, 503);
  }

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

const finishGoogleDrive = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
) => {
  if (!googleDriveConfigured(env)) {
    return redirect(storageDestination(request, env, "/", "error", "google_drive_not_configured"));
  }

  const db = requireDatabase(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirect(storageDestination(request, env, "/", "error", oauthError));
  }

  if (!state || !code) {
    return redirect(storageDestination(request, env, "/", "error", "google_drive_callback_invalid"));
  }

  const stateHash = await sha256Base64Url(state);
  const transaction = await consumeStorageOAuthState(db, stateHash);
  if (!transaction || transaction.provider !== "google-drive") {
    return redirect(storageDestination(request, env, "/", "error", "google_drive_state_invalid_or_expired"));
  }

  if (transaction.user_id !== userId) {
    return redirect(storageDestination(request, env, transaction.return_to, "error", "google_drive_user_mismatch"));
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
    return redirect(storageDestination(request, env, transaction.return_to, "error", "google_drive_token_exchange_failed"));
  }

  const token = (await tokenResponse.json()) as GoogleDriveTokenResponse;
  if (!token.access_token || !token.refresh_token) {
    return redirect(storageDestination(request, env, transaction.return_to, "error", "google_drive_refresh_token_missing"));
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    return redirect(storageDestination(request, env, transaction.return_to, "error", "google_drive_account_lookup_failed"));
  }

  const profile = (await profileResponse.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    return redirect(storageDestination(request, env, transaction.return_to, "error", "google_drive_account_invalid"));
  }

  const associatedData = `storage:${userId}:google-drive:${profile.sub}`;
  const refreshTokenEncrypted = await encryptStorageToken(
    token.refresh_token,
    env.TOKEN_ENCRYPTION_KEY!,
    associatedData,
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

  return redirect(storageDestination(request, env, transaction.return_to, "connected"));
};

const provisionShowWorkspace = async (
  env: WorkerEnv,
  userId: string,
  showId: string,
  connectionId: string,
) => {
  const db = requireDatabase(env);
  const [show, connection] = await Promise.all([
    getShowForUser(db, userId, showId),
    requireActiveGoogleDriveConnection(db, userId, connectionId),
  ]);
  if (!show) throw new GoogleDriveError("show_not_found", 404);

  const session = await createGoogleDriveSession(env, userId, connection);
  const workspace = await session.ensureShowWorkspace(show.id, show.name);
  await setShowStorageConnectionForUser(db, userId, show.id, connection.id);
  await markStorageConnectionUsed(db, userId, connection.id);

  return {
    showId: show.id,
    connectionId: connection.id,
    provider: "google-drive" as const,
    accountEmail: connection.provider_account_email,
    ...workspace,
  };
};

const provisionActiveShowWorkspaces = async (
  request: Request,
  env: WorkerEnv,
  userId: string,
) => {
  const db = requireDatabase(env);
  const body = await parseBody(request);
  const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : null;
  const replaceExisting = body.replaceExisting === true;

  const connections = (await listStorageConnectionsForUser(db, userId)).filter(
    (connection) => connection.provider === "google-drive" && connection.status === "active",
  );
  if (connections.length === 0) {
    throw new GoogleDriveError("google_drive_connection_not_found", 404);
  }

  let connection: StorageConnectionRow;
  if (requestedConnectionId) {
    connection = await requireActiveGoogleDriveConnection(db, userId, requestedConnectionId);
  } else if (connections.length === 1) {
    connection = connections[0];
  } else {
    throw new GoogleDriveError("google_drive_connection_selection_required", 409);
  }

  const shows = (await listShowsForUser(db, userId)).filter((show) => show.status === "active");
  const session = await createGoogleDriveSession(env, userId, connection);
  const provisioned: Array<Record<string, unknown>> = [];
  const skipped: Array<{ showId: string; reason: string }> = [];

  for (const show of shows) {
    if (!replaceExisting && show.storage_connection_id && show.storage_connection_id !== connection.id) {
      skipped.push({ showId: show.id, reason: "different_storage_connection" });
      continue;
    }

    const workspace = await session.ensureShowWorkspace(show.id, show.name);
    await setShowStorageConnectionForUser(db, userId, show.id, connection.id);
    provisioned.push({
      showId: show.id,
      connectionId: connection.id,
      provider: "google-drive",
      accountEmail: connection.provider_account_email,
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
    return json({ providers: { googleDrive: googleDriveConfigured(env), dropbox: false } });
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

    if (url.pathname === "/api/storage/google-drive/provision" && request.method === "POST") {
      const body = await parseBody(request);
      const showId = typeof body.showId === "string" ? body.showId : "";
      const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
      if (!showId) return json({ error: "show_id_required" }, 400);
      if (!connectionId) return json({ error: "storage_connection_id_required" }, 400);
      const workspace = await provisionShowWorkspace(env, identity.userId, showId, connectionId);
      return json({ workspace });
    }

    if (
      url.pathname === "/api/storage/google-drive/provision-active-shows" &&
      request.method === "POST"
    ) {
      return json(await provisionActiveShowWorkspaces(request, env, identity.userId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") {
        return json({ error: error.code }, 503);
      }
      return json({ error: error.code }, 401);
    }

    if (error instanceof GoogleDriveError) {
      return json({ error: error.code }, error.status);
    }

    if (error instanceof Error) {
      if (error.message === "d1_not_configured") {
        return json({ error: "d1_not_configured" }, 503);
      }
      if (error.message === "invalid_json") {
        return json({ error: "invalid_json" }, 400);
      }
    }

    return json({ error: "internal_error" }, 500);
  }
};
