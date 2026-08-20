import { requireDatabase, type WorkerEnv } from "./db";
import {
  addSecondsSqlite,
  normalizeEmail,
  pkceChallenge,
  randomToken,
  safeReturnTo,
  sha256Base64Url,
} from "./auth-utils";
import {
  consumeMagicLink,
  consumeOAuthState,
  purgeExpiredAuthArtifacts,
  recentMagicLinkExists,
  saveMagicLink,
  saveOAuthState,
} from "./auth-store";
import { isEmailDeliveryConfigured, sendMagicLinkEmail } from "./email";
import { clearSessionCookie, createSessionCookie } from "./session";
import { findOrCreateUserForProvider } from "./users";

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

const redirect = (location: string, cookie?: string) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};

const appDestination = (request: Request, env: WorkerEnv, returnTo = "/") => {
  const origin = env.APP_URL?.trim() || new URL(request.url).origin;
  return new URL(safeReturnTo(returnTo), origin).toString();
};

const errorDestination = (request: Request, env: WorkerEnv, code: string) => {
  const target = new URL(appDestination(request, env));
  target.searchParams.set("auth", "error");
  target.searchParams.set("reason", code);
  return target.toString();
};

const requireSessionKey = (env: WorkerEnv) => {
  if (!env.SESSION_SIGNING_KEY) throw new Error("authentication_not_configured");
  return env.SESSION_SIGNING_KEY;
};

const googleConfigured = (env: WorkerEnv) =>
  Boolean(
    env.GOOGLE_AUTH_CLIENT_ID &&
      env.GOOGLE_AUTH_CLIENT_SECRET &&
      env.SESSION_SIGNING_KEY &&
      env.DB,
  );

const emailConfigured = (env: WorkerEnv) =>
  Boolean(env.SESSION_SIGNING_KEY && env.DB && isEmailDeliveryConfigured(env));

interface GoogleTokenResponse {
  access_token?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

const startGoogle = async (request: Request, env: WorkerEnv) => {
  if (!googleConfigured(env)) {
    return json({ error: "google_auth_not_configured" }, 503);
  }

  const db = requireDatabase(env);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);

  await purgeExpiredAuthArtifacts(db);
  await saveOAuthState(db, stateHash, verifier, returnTo, addSecondsSqlite(10 * 60));

  const redirectUri = `${requestUrl.origin}/api/auth/google/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", env.GOOGLE_AUTH_CLIENT_ID!);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return redirect(authorizationUrl.toString());
};

const finishGoogle = async (request: Request, env: WorkerEnv) => {
  if (!googleConfigured(env)) {
    return redirect(errorDestination(request, env, "google_auth_not_configured"));
  }

  const db = requireDatabase(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return redirect(errorDestination(request, env, "google_callback_invalid"));
  }

  const stateHash = await sha256Base64Url(state);
  const transaction = await consumeOAuthState(db, stateHash);
  if (!transaction) {
    return redirect(errorDestination(request, env, "google_state_invalid_or_expired"));
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_AUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_AUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: transaction.code_verifier,
    }),
  });

  if (!tokenResponse.ok) {
    return redirect(errorDestination(request, env, "google_token_exchange_failed"));
  }

  const token = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!token.access_token) {
    return redirect(errorDestination(request, env, "google_token_missing"));
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    return redirect(errorDestination(request, env, "google_profile_failed"));
  }

  const profile = (await profileResponse.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    return redirect(errorDestination(request, env, "google_identity_invalid"));
  }

  const user = await findOrCreateUserForProvider(
    db,
    "google",
    profile.sub,
    profile.email,
    profile.name,
  );

  if (user.status !== "active") {
    return redirect(errorDestination(request, env, "account_not_active"));
  }

  const cookie = await createSessionCookie(
    { userId: user.id, email: user.email, displayName: user.display_name ?? undefined },
    requireSessionKey(env),
  );

  const destination = new URL(appDestination(request, env, transaction.return_to));
  destination.searchParams.set("auth", "success");
  return redirect(destination.toString(), cookie);
};

const startEmail = async (request: Request, env: WorkerEnv) => {
  if (!emailConfigured(env)) {
    return json({ error: "email_auth_not_configured" }, 503);
  }

  let body: { email?: unknown; returnTo?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; returnTo?: unknown };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = normalizeEmail(String(body.email ?? ""));
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return json({ error: "valid_email_required" }, 400);
  }

  const db = requireDatabase(env);
  await purgeExpiredAuthArtifacts(db);

  if (await recentMagicLinkExists(db, email)) {
    return json({ ok: true, message: "If the address can receive mail, a sign-in link is on its way." });
  }

  const token = randomToken(32);
  const tokenHash = await sha256Base64Url(token);
  const returnTo = safeReturnTo(typeof body.returnTo === "string" ? body.returnTo : "/");
  await saveMagicLink(db, tokenHash, email, returnTo, addSecondsSqlite(15 * 60));

  const verifyUrl = new URL("/api/auth/email/verify", new URL(request.url).origin);
  verifyUrl.searchParams.set("token", token);

  try {
    await sendMagicLinkEmail(env, email, verifyUrl.toString());
  } catch {
    return json({ error: "email_delivery_failed" }, 503);
  }

  return json({ ok: true, message: "If the address can receive mail, a sign-in link is on its way." });
};

const finishEmail = async (request: Request, env: WorkerEnv) => {
  if (!emailConfigured(env)) {
    return redirect(errorDestination(request, env, "email_auth_not_configured"));
  }

  const db = requireDatabase(env);
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return redirect(errorDestination(request, env, "magic_link_invalid"));
  }

  const tokenHash = await sha256Base64Url(token);
  const magicLink = await consumeMagicLink(db, tokenHash);
  if (!magicLink) {
    return redirect(errorDestination(request, env, "magic_link_invalid_or_expired"));
  }

  const user = await findOrCreateUserForProvider(
    db,
    "email",
    normalizeEmail(magicLink.email),
    magicLink.email,
  );

  if (user.status !== "active") {
    return redirect(errorDestination(request, env, "account_not_active"));
  }

  const cookie = await createSessionCookie(
    { userId: user.id, email: user.email, displayName: user.display_name ?? undefined },
    requireSessionKey(env),
  );

  const destination = new URL(appDestination(request, env, magicLink.return_to));
  destination.searchParams.set("auth", "success");
  return redirect(destination.toString(), cookie);
};

export const handleAuthApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/auth/")) return null;

  if (url.pathname === "/api/auth/config" && request.method === "GET") {
    return json({
      providers: {
        google: googleConfigured(env),
        email: emailConfigured(env),
      },
    });
  }

  if (url.pathname === "/api/auth/google/start" && request.method === "GET") {
    return startGoogle(request, env);
  }

  if (url.pathname === "/api/auth/google/callback" && request.method === "GET") {
    return finishGoogle(request, env);
  }

  if (url.pathname === "/api/auth/email/start" && request.method === "POST") {
    return startEmail(request, env);
  }

  if (url.pathname === "/api/auth/email/verify" && request.method === "GET") {
    return finishEmail(request, env);
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return json({ error: "method_not_allowed" }, 405);
};
