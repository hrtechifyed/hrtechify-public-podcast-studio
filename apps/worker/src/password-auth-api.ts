import { normalizeEmail, randomToken, sha256Base64Url } from "./auth-utils";
import { requireDatabase, type WorkerEnv } from "./db";
import { isEmailDeliveryConfigured, sendPasswordResetEmail } from "./email";
import {
  burnUnknownPasswordAttempt,
  hashPassword,
  PasswordValidationError,
  validateNewPassword,
  verifyPassword,
} from "./password";
import {
  clearAuthRateLimit,
  consumePasswordReset,
  consumePasswordVerification,
  getPasswordCredentialByEmail,
  recordAuthAttempt,
  savePasswordReset,
  upsertPasswordCredential,
} from "./password-auth-store";
import { isPasswordAuthSchemaReady } from "./schema-readiness";
import { createSessionCookie } from "./session";
import { createUserForPasswordSignup, findOrCreateUserForProvider, getUserByEmail } from "./users";

const SIGNUP_PATH = "/api/auth/password/signup";
const VERIFY_PATH = "/api/auth/password/verify";
const SIGNIN_PATH = "/api/auth/password/signin";
const FORGOT_PATH = "/api/auth/password/forgot";
const RESET_PATH = "/api/auth/password/reset";

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

const validEmail = (value: unknown) => {
  const email = normalizeEmail(String(value ?? ""));
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    throw new PasswordValidationError("valid_email_required");
  }
  return email;
};

const parseJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new PasswordValidationError("invalid_json");
  }
};

const sessionKey = (env: WorkerEnv) => {
  if (!env.SESSION_SIGNING_KEY) throw new PasswordValidationError("authentication_not_configured", 503);
  return env.SESSION_SIGNING_KEY;
};

const passwordDbConfigured = (env: WorkerEnv) => Boolean(env.DB && env.SESSION_SIGNING_KEY);
const passwordEmailConfigured = (env: WorkerEnv) => passwordDbConfigured(env) && isEmailDeliveryConfigured(env);

const passwordSchemaReady = async (env: WorkerEnv) => {
  if (!passwordDbConfigured(env)) return false;
  return isPasswordAuthSchemaReady(requireDatabase(env));
};

const requirePasswordSchema = async (env: WorkerEnv) => {
  if (!(await passwordSchemaReady(env))) {
    throw new PasswordValidationError("password_schema_not_ready", 503);
  }
};

const rateKey = async (action: string, email: string) =>
  sha256Base64Url(`${action}:${normalizeEmail(email)}`);

const sessionForUser = async (
  env: WorkerEnv,
  user: { id: string; email: string; display_name: string | null },
) => createSessionCookie(
  { userId: user.id, email: user.email, displayName: user.display_name ?? undefined },
  sessionKey(env),
);

const signup = async (request: Request, env: WorkerEnv) => {
  if (!passwordDbConfigured(env)) return json({ error: "password_signup_not_configured" }, 503);
  await requirePasswordSchema(env);
  const body = await parseJson(request);
  const email = validEmail(body.email);
  const password = validateNewPassword(body.password);
  const db = requireDatabase(env);
  const keyHash = await rateKey("password-signup", email);
  if (!(await recordAuthAttempt(db, "password-signup", keyHash, 5, 15))) {
    return json({ error: "too_many_attempts" }, 429);
  }

  const existingCredential = await getPasswordCredentialByEmail(db, email);
  if (existingCredential) {
    return json({ error: "account_already_has_password" }, 409);
  }

  const existingUser = await getUserByEmail(db, email);
  if (existingUser) {
    return json({ error: "account_uses_other_signin" }, 409);
  }

  const user = await createUserForPasswordSignup(db, email);
  if (!user) {
    return json({ error: "account_uses_other_signin" }, 409);
  }

  const material = await hashPassword(password);
  await upsertPasswordCredential(db, user.id, user.email, material);
  await clearAuthRateLimit(db, "password-signup", keyHash);
  const cookie = await sessionForUser(env, user);

  return json(
    {
      ok: true,
      redirectTo: "/?auth=success&newAccount=1&brandSetup=1",
      message: "Account created. Your email is used as the account identifier but is not independently verified.",
    },
    201,
    { "set-cookie": cookie },
  );
};

// Legacy verification links remain consumable so an already-issued link is not broken.
const verifySignup = async (request: Request, env: WorkerEnv) => {
  if (!passwordDbConfigured(env)) return redirect("/?auth=error&reason=authentication_not_configured");
  if (!(await passwordSchemaReady(env))) return redirect("/?auth=error&reason=password_schema_not_ready");
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return redirect("/?auth=error&reason=password_verification_invalid_or_expired");
  }
  const db = requireDatabase(env);
  const row = await consumePasswordVerification(db, await sha256Base64Url(token));
  if (!row) return redirect("/?auth=error&reason=password_verification_invalid_or_expired");

  const existingCredential = await getPasswordCredentialByEmail(db, row.email);
  if (existingCredential) return redirect("/?auth=error&reason=account_already_has_password");

  const existingUser = await getUserByEmail(db, row.email);
  const user = existingUser ?? await findOrCreateUserForProvider(db, "email", normalizeEmail(row.email), row.email);
  if (user.status !== "active") return redirect("/?auth=error&reason=account_not_active");
  await upsertPasswordCredential(db, user.id, row.email, {
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    iterations: row.iterations,
  });
  await clearAuthRateLimit(db, "password-signup", await rateKey("password-signup", row.email));
  const cookie = await sessionForUser(env, user);
  return redirect("/?auth=success&newAccount=1&brandSetup=1", cookie);
};

const signin = async (request: Request, env: WorkerEnv) => {
  if (!passwordDbConfigured(env)) return json({ error: "password_signin_not_configured" }, 503);
  await requirePasswordSchema(env);
  const body = await parseJson(request);
  const email = validEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const db = requireDatabase(env);
  const keyHash = await rateKey("password-signin", email);
  if (!(await recordAuthAttempt(db, "password-signin", keyHash, 10, 15))) {
    return json({ error: "too_many_attempts" }, 429);
  }

  const credential = await getPasswordCredentialByEmail(db, email);
  if (!credential) {
    await burnUnknownPasswordAttempt(password);
    return json({ error: "invalid_email_or_password" }, 401);
  }
  const valid = await verifyPassword(password, {
    passwordHash: credential.password_hash,
    passwordSalt: credential.password_salt,
    iterations: credential.iterations,
  });
  if (!valid) return json({ error: "invalid_email_or_password" }, 401);
  if (credential.status !== "active") return json({ error: "account_not_active" }, 403);

  await clearAuthRateLimit(db, "password-signin", keyHash);
  const cookie = await createSessionCookie(
    {
      userId: credential.user_id,
      email: credential.email,
      displayName: credential.display_name ?? undefined,
    },
    sessionKey(env),
  );
  return json({ ok: true }, 200, { "set-cookie": cookie });
};

const forgotPassword = async (request: Request, env: WorkerEnv) => {
  if (!passwordEmailConfigured(env)) return json({ error: "password_reset_not_configured" }, 503);
  await requirePasswordSchema(env);
  const body = await parseJson(request);
  const email = validEmail(body.email);
  const db = requireDatabase(env);
  const keyHash = await rateKey("password-reset", email);
  const generic = {
    ok: true,
    message: "If an account exists for that address, a password reset link will be sent.",
  };
  if (!(await recordAuthAttempt(db, "password-reset", keyHash, 5, 30))) return json(generic, 202);

  const user = await getUserByEmail(db, email);
  if (!user || user.status !== "active") return json(generic, 202);

  const token = randomToken(32);
  await savePasswordReset(db, await sha256Base64Url(token), user.id, user.email);
  const resetUrl = new URL("/reset-password", new URL(request.url).origin);
  resetUrl.searchParams.set("token", token);
  try {
    await sendPasswordResetEmail(env, user.email, resetUrl.toString());
  } catch {
    return json({ error: "email_delivery_failed" }, 503);
  }
  return json(generic, 202);
};

const resetPassword = async (request: Request, env: WorkerEnv) => {
  if (!passwordDbConfigured(env)) return json({ error: "password_reset_not_configured" }, 503);
  await requirePasswordSchema(env);
  const body = await parseJson(request);
  const token = String(body.token ?? "");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return json({ error: "password_reset_invalid_or_expired" }, 400);
  }
  validateNewPassword(body.password);
  const db = requireDatabase(env);
  const reset = await consumePasswordReset(db, await sha256Base64Url(token));
  if (!reset) return json({ error: "password_reset_invalid_or_expired" }, 400);

  const material = await hashPassword(body.password);
  await upsertPasswordCredential(db, reset.user_id, reset.email, material);
  await clearAuthRateLimit(db, "password-signin", await rateKey("password-signin", reset.email));
  await clearAuthRateLimit(db, "password-reset", await rateKey("password-reset", reset.email));
  return json({ ok: true, message: "Your password has been updated. You can now sign in." });
};

export const passwordAuthConfiguration = async (env: WorkerEnv) => {
  const schemaReady = await passwordSchemaReady(env);
  return {
    signin: schemaReady,
    signup: schemaReady,
    recovery: schemaReady && passwordEmailConfigured(env),
    schemaReady,
  };
};

export const handlePasswordAuthApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/auth/password/")) return null;

  try {
    if (url.pathname === SIGNUP_PATH && request.method === "POST") return await signup(request, env);
    if (url.pathname === VERIFY_PATH && request.method === "GET") return await verifySignup(request, env);
    if (url.pathname === SIGNIN_PATH && request.method === "POST") return await signin(request, env);
    if (url.pathname === FORGOT_PATH && request.method === "POST") return await forgotPassword(request, env);
    if (url.pathname === RESET_PATH && request.method === "POST") return await resetPassword(request, env);
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof PasswordValidationError) return json({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "d1_not_configured") {
      return json({ error: "d1_not_configured" }, 503);
    }
    return json({ error: "internal_error" }, 500);
  }
};
