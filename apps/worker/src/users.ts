import type { D1DatabaseLike } from "./db";
import type { VerifiedIdentity } from "./auth";
import { normalizeEmail } from "./auth-utils";

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at: string;
}

const passwordIdentitySubject = (email: string) => `password:${normalizeEmail(email)}`;

const hasUnverifiedPasswordBoundary = async (
  db: D1DatabaseLike,
  userId: string,
  email: string,
) => {
  const normalizedEmail = normalizeEmail(email);
  const row = await db
    .prepare(
      `SELECT 1 AS blocked
       WHERE EXISTS (
         SELECT 1
         FROM auth_identities
         WHERE user_id = ?
           AND provider = 'email'
           AND subject = ?
       ) OR (
         EXISTS (
           SELECT 1
           FROM auth_password_credentials
           WHERE user_id = ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM auth_password_verifications
           WHERE email = ?
             AND consumed_at IS NOT NULL
         )
       )`,
    )
    .bind(userId, passwordIdentitySubject(normalizedEmail), userId, normalizedEmail)
    .first<{ blocked: number }>();

  return Boolean(row);
};

export const getUserByEmail = async (
  db: D1DatabaseLike,
  email: string,
): Promise<UserRow | null> =>
  db
    .prepare(
      `SELECT id, email, display_name, status, created_at, updated_at
       FROM users
       WHERE email = ?`,
    )
    .bind(normalizeEmail(email))
    .first<UserRow>();

export const createUserForPasswordSignup = async (
  db: D1DatabaseLike,
  email: string,
): Promise<UserRow | null> => {
  const normalizedEmail = normalizeEmail(email);
  const userId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, status)
       VALUES (?, ?, NULL, 'active')`,
    )
    .bind(userId, normalizedEmail)
    .run();

  const created = await db
    .prepare(
      `SELECT id, email, display_name, status, created_at, updated_at
       FROM users
       WHERE id = ?`,
    )
    .bind(userId)
    .first<UserRow>();

  if (!created) return null;

  try {
    await db
      .prepare(
        `INSERT INTO auth_identities (provider, subject, user_id, email)
         VALUES ('email', ?, ?, ?)`,
      )
      .bind(passwordIdentitySubject(normalizedEmail), userId, normalizedEmail)
      .run();
  } catch {
    await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
    return null;
  }

  return created;
};

export const deletePasswordSignupUser = async (
  db: D1DatabaseLike,
  userId: string,
) => {
  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
};

export const findOrCreateUserForProvider = async (
  db: D1DatabaseLike,
  provider: "google" | "email",
  subject: string,
  email: string,
  displayName?: string,
): Promise<UserRow> => {
  const normalizedEmail = normalizeEmail(email);

  const linked = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.updated_at
       FROM auth_identities i
       JOIN users u ON u.id = i.user_id
       WHERE i.provider = ? AND i.subject = ?`,
    )
    .bind(provider, subject)
    .first<UserRow>();

  // PR #46 briefly created immediate password-only accounts using the same
  // provider/subject shape as verified email identities. If such an account has
  // no consumed password-verification record, do not let a later magic link
  // silently authenticate into that password-accessible account. Genuine legacy
  // verified password accounts retain their consumed verification record and
  // continue to work normally.
  if (
    linked &&
    provider === "email" &&
    await hasUnverifiedPasswordBoundary(db, linked.id, normalizedEmail)
  ) {
    throw new Error("unverified_password_email_conflict");
  }

  if (linked) {
    await db
      .prepare(
        `UPDATE users
         SET email = ?,
             display_name = COALESCE(?, display_name),
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(normalizedEmail, displayName ?? null, linked.id)
      .run();

    const refreshed = await db
      .prepare(
        `SELECT id, email, display_name, status, created_at, updated_at
         FROM users WHERE id = ?`,
      )
      .bind(linked.id)
      .first<UserRow>();

    if (!refreshed) throw new Error("user_lookup_failed");
    return refreshed;
  }

  const existingByEmail = await getUserByEmail(db, normalizedEmail);
  if (existingByEmail && await hasUnverifiedPasswordBoundary(db, existingByEmail.id, normalizedEmail)) {
    throw new Error("unverified_password_email_conflict");
  }

  const userId = existingByEmail?.id ?? crypto.randomUUID();

  if (!existingByEmail) {
    await db
      .prepare(
        `INSERT INTO users (id, email, display_name, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .bind(userId, normalizedEmail, displayName ?? null)
      .run();
  } else if (displayName) {
    await db
      .prepare(
        `UPDATE users
         SET display_name = COALESCE(display_name, ?), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(displayName, userId)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO auth_identities (provider, subject, user_id, email)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, subject) DO UPDATE SET
         user_id = excluded.user_id,
         email = excluded.email,
         updated_at = datetime('now')`,
    )
    .bind(provider, subject, userId, normalizedEmail)
    .run();

  const user = await db
    .prepare(
      `SELECT id, email, display_name, status, created_at, updated_at
       FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<UserRow>();

  if (!user) throw new Error("user_create_failed");
  return user;
};

export const upsertUserFromIdentity = async (
  db: D1DatabaseLike,
  identity: VerifiedIdentity,
): Promise<UserRow> => {
  const user = await db
    .prepare(
      `SELECT id, email, display_name, status, created_at, updated_at
       FROM users
       WHERE id = ?`,
    )
    .bind(identity.userId)
    .first<UserRow>();

  if (!user) {
    throw new Error("authenticated_user_not_found");
  }

  return user;
};
