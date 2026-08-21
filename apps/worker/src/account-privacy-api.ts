import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { normalizeEmail, sha256Base64Url } from "./auth-utils";
import { requireDatabase, type D1DatabaseLike, type WorkerEnv } from "./db";
import { tableExists } from "./schema-readiness";
import { clearSessionCookie } from "./session";
import { upsertUserFromIdentity } from "./users";

const PRIVACY_PATH = "/api/account/privacy";
const DELETE_PATH = "/api/account/delete";
const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const deleteByEmailWhenTableExists = async (
  db: D1DatabaseLike,
  tableName: string,
  email: string,
) => {
  if (!(await tableExists(db, tableName))) return;
  await db.prepare(`DELETE FROM ${tableName} WHERE email = ?`).bind(email).run();
};

const deletePasswordRateLimits = async (db: D1DatabaseLike, email: string) => {
  if (!(await tableExists(db, "auth_rate_limits"))) return;
  for (const action of ["password-signin", "password-signup", "password-reset"] as const) {
    const keyHash = await sha256Base64Url(`${action}:${normalizeEmail(email)}`);
    await db.prepare("DELETE FROM auth_rate_limits WHERE action = ? AND key_hash = ?")
      .bind(action, keyHash)
      .run();
  }
};

const deleteAccountMetadata = async (
  db: D1DatabaseLike,
  userId: string,
  email: string,
) => {
  const normalizedEmail = normalizeEmail(email);

  // Pending email-only artifacts are not foreign-keyed to the user because they can exist before signup.
  await deleteByEmailWhenTableExists(db, "auth_magic_links", normalizedEmail);
  await deleteByEmailWhenTableExists(db, "auth_password_verifications", normalizedEmail);
  await deletePasswordRateLimits(db, normalizedEmail);

  // User-owned rows use ON DELETE CASCADE. Deleting the user removes authentication identities,
  // password credentials/resets, shows, episodes, workflow metadata, storage connections and encrypted refresh tokens.
  // No Google Drive or Dropbox deletion API is invoked here; user-owned storage files remain untouched.
  const result = await db.prepare("DELETE FROM users WHERE id = ? AND email = ?")
    .bind(userId, normalizedEmail)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error("account_delete_failed");
};

export const handleAccountPrivacyApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (url.pathname !== PRIVACY_PATH && url.pathname !== DELETE_PATH) return null;

  if (url.pathname === PRIVACY_PATH && request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (url.pathname === DELETE_PATH && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (url.pathname === PRIVACY_PATH) {
      return json({
        account: {
          email: user.email,
          status: user.status,
        },
        retention: {
          accountAndWorkflowMetadata: "kept while the account is active; deleted immediately when self-service account deletion succeeds",
          pendingVerificationLinks: "time-limited and purged or invalidated by their authentication flows; matching pending links are deleted during account deletion",
          session: "browser cookie is cleared when account deletion succeeds",
          renderContainerFiles: "ephemeral working files only; not the permanent media library",
          connectedStorageMedia: "retained in the user's Google Drive or Dropbox until the user removes it there",
        },
        deletion: {
          confirmation: DELETE_CONFIRMATION,
          storageFilesPreserved: true,
          remoteStorageDeletionSupported: false,
        },
      });
    }

    const body = await parseBody(request);
    if (!body) return json({ error: "invalid_json" }, 400);
    if (body.confirmation !== DELETE_CONFIRMATION) {
      return json({ error: "account_delete_confirmation_required" }, 400);
    }
    if (body.preserveStorageFiles !== true) {
      return json({ error: "storage_files_must_be_preserved" }, 400);
    }

    await deleteAccountMetadata(db, identity.userId, user.email);
    return json(
      {
        ok: true,
        accountDeleted: true,
        storageFilesPreserved: true,
        message: "Your HRTechify Studio account metadata and stored authentication credentials were deleted. Files in your connected Google Drive or Dropbox were not deleted.",
      },
      200,
      { "set-cookie": clearSessionCookie() },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(
        { error: error.code },
        error.code === "authentication_not_configured" ? 503 : 401,
      );
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
      if (error.message === "authenticated_user_not_found") return json({ error: "authentication_required" }, 401);
      if (error.message === "account_delete_failed") return json({ error: "account_delete_failed" }, 409);
    }
    return json({ error: "internal_error" }, 500);
  }
};
