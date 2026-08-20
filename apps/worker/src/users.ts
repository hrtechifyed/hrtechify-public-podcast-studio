import type { D1DatabaseLike } from "./db";
import type { VerifiedIdentity } from "./auth";

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at: string;
}

export const upsertUserFromIdentity = async (
  db: D1DatabaseLike,
  identity: VerifiedIdentity,
): Promise<UserRow> => {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, status)
       VALUES (?, ?, ?, 'active')
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = COALESCE(excluded.display_name, users.display_name),
         updated_at = datetime('now')`,
    )
    .bind(identity.userId, identity.email, identity.displayName ?? null)
    .run();

  const user = await db
    .prepare(
      `SELECT id, email, display_name, status, created_at, updated_at
       FROM users
       WHERE id = ?`,
    )
    .bind(identity.userId)
    .first<UserRow>();

  if (!user) {
    throw new Error("user_upsert_failed");
  }

  return user;
};
