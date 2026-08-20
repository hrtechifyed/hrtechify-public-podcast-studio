import type { D1DatabaseLike } from "./db";
import { addSecondsSqlite, normalizeEmail } from "./auth-utils";
import type { StoredPasswordMaterial } from "./password";

interface PasswordCredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
  status: "active" | "suspended" | "deleted";
  display_name: string | null;
}

interface VerificationRow {
  token_hash: string;
  email: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
}

interface ResetRow {
  token_hash: string;
  user_id: string;
  email: string;
}

export const getPasswordCredentialByEmail = async (
  db: D1DatabaseLike,
  email: string,
): Promise<PasswordCredentialRow | null> =>
  db
    .prepare(
      `SELECT c.user_id, c.email, c.password_hash, c.password_salt, c.iterations,
              u.status, u.display_name
       FROM auth_password_credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.email = ?`,
    )
    .bind(normalizeEmail(email))
    .first<PasswordCredentialRow>();

export const upsertPasswordCredential = async (
  db: D1DatabaseLike,
  userId: string,
  email: string,
  material: StoredPasswordMaterial,
) => {
  await db
    .prepare(
      `INSERT INTO auth_password_credentials
         (user_id, email, password_hash, password_salt, iterations)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         iterations = excluded.iterations,
         updated_at = datetime('now')`,
    )
    .bind(
      userId,
      normalizeEmail(email),
      material.passwordHash,
      material.passwordSalt,
      material.iterations,
    )
    .run();
};

export const savePasswordVerification = async (
  db: D1DatabaseLike,
  tokenHash: string,
  email: string,
  material: StoredPasswordMaterial,
) => {
  const normalized = normalizeEmail(email);
  await db
    .prepare(
      `DELETE FROM auth_password_verifications
       WHERE email = ? OR expires_at <= datetime('now') OR consumed_at IS NOT NULL`,
    )
    .bind(normalized)
    .run();
  await db
    .prepare(
      `INSERT INTO auth_password_verifications
         (token_hash, email, password_hash, password_salt, iterations, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenHash,
      normalized,
      material.passwordHash,
      material.passwordSalt,
      material.iterations,
      addSecondsSqlite(30 * 60),
    )
    .run();
};

export const consumePasswordVerification = async (
  db: D1DatabaseLike,
  tokenHash: string,
): Promise<VerificationRow | null> => {
  const row = await db
    .prepare(
      `SELECT token_hash, email, password_hash, password_salt, iterations
       FROM auth_password_verifications
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first<VerificationRow>();
  if (!row) return null;

  const result = await db
    .prepare(
      `UPDATE auth_password_verifications
       SET consumed_at = datetime('now')
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return row;
};

export const savePasswordReset = async (
  db: D1DatabaseLike,
  tokenHash: string,
  userId: string,
  email: string,
) => {
  await db
    .prepare(
      `DELETE FROM auth_password_resets
       WHERE user_id = ? OR expires_at <= datetime('now') OR consumed_at IS NOT NULL`,
    )
    .bind(userId)
    .run();
  await db
    .prepare(
      `INSERT INTO auth_password_resets
         (token_hash, user_id, email, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(tokenHash, userId, normalizeEmail(email), addSecondsSqlite(20 * 60))
    .run();
};

export const consumePasswordReset = async (
  db: D1DatabaseLike,
  tokenHash: string,
): Promise<ResetRow | null> => {
  const row = await db
    .prepare(
      `SELECT token_hash, user_id, email
       FROM auth_password_resets
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first<ResetRow>();
  if (!row) return null;

  const result = await db
    .prepare(
      `UPDATE auth_password_resets
       SET consumed_at = datetime('now')
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return row;
};

export const recordAuthAttempt = async (
  db: D1DatabaseLike,
  action: "password-signin" | "password-signup" | "password-reset",
  keyHash: string,
  maximumAttempts: number,
  windowMinutes: number,
) => {
  const existing = await db
    .prepare(
      `SELECT attempts,
              CASE WHEN window_started_at > datetime('now', ?) THEN 1 ELSE 0 END AS in_window
       FROM auth_rate_limits
       WHERE action = ? AND key_hash = ?`,
    )
    .bind(`-${windowMinutes} minutes`, action, keyHash)
    .first<{ attempts: number; in_window: number }>();

  if (existing?.in_window === 1 && Number(existing.attempts) >= maximumAttempts) {
    return false;
  }

  if (!existing || existing.in_window !== 1) {
    await db
      .prepare(
        `INSERT INTO auth_rate_limits (action, key_hash, window_started_at, attempts)
         VALUES (?, ?, datetime('now'), 1)
         ON CONFLICT(action, key_hash) DO UPDATE SET
           window_started_at = datetime('now'), attempts = 1, updated_at = datetime('now')`,
      )
      .bind(action, keyHash)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE auth_rate_limits
         SET attempts = attempts + 1, updated_at = datetime('now')
         WHERE action = ? AND key_hash = ?`,
      )
      .bind(action, keyHash)
      .run();
  }
  return true;
};

export const clearAuthRateLimit = async (
  db: D1DatabaseLike,
  action: "password-signin" | "password-signup" | "password-reset",
  keyHash: string,
) => {
  await db
    .prepare(`DELETE FROM auth_rate_limits WHERE action = ? AND key_hash = ?`)
    .bind(action, keyHash)
    .run();
};
