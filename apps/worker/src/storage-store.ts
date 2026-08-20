import type { D1DatabaseLike } from "./db";

export interface StorageOAuthStateRow {
  state_hash: string;
  user_id: string;
  provider: "google-drive" | "dropbox";
  code_verifier: string;
  return_to: string;
  expires_at: string;
  created_at: string;
}

export interface StorageConnectionRow {
  id: string;
  user_id: string;
  provider: "google-drive" | "dropbox";
  provider_account_id: string;
  provider_account_email: string | null;
  refresh_token_encrypted: string;
  scopes: string;
  status: "active" | "revoked" | "error";
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export const purgeExpiredStorageOAuthStates = async (db: D1DatabaseLike) => {
  await db
    .prepare("DELETE FROM storage_oauth_states WHERE expires_at <= datetime('now')")
    .run();
};

export const saveStorageOAuthState = async (
  db: D1DatabaseLike,
  input: {
    stateHash: string;
    userId: string;
    provider: "google-drive" | "dropbox";
    codeVerifier: string;
    returnTo: string;
    expiresAt: string;
  },
) => {
  await db
    .prepare(
      `INSERT INTO storage_oauth_states
         (state_hash, user_id, provider, code_verifier, return_to, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.stateHash,
      input.userId,
      input.provider,
      input.codeVerifier,
      input.returnTo,
      input.expiresAt,
    )
    .run();
};

export const consumeStorageOAuthState = async (
  db: D1DatabaseLike,
  stateHash: string,
): Promise<StorageOAuthStateRow | null> => {
  const row = await db
    .prepare(
      `SELECT state_hash, user_id, provider, code_verifier, return_to, expires_at, created_at
       FROM storage_oauth_states
       WHERE state_hash = ? AND expires_at > datetime('now')`,
    )
    .bind(stateHash)
    .first<StorageOAuthStateRow>();

  if (!row) return null;
  await db.prepare("DELETE FROM storage_oauth_states WHERE state_hash = ?").bind(stateHash).run();
  return row;
};

export const listStorageConnectionsForUser = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<StorageConnectionRow[]> => {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, provider, provider_account_id, provider_account_email,
              refresh_token_encrypted, scopes, status, last_used_at, created_at, updated_at
       FROM storage_connections
       WHERE user_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<StorageConnectionRow>();

  return results;
};

export const upsertStorageConnection = async (
  db: D1DatabaseLike,
  input: {
    id: string;
    userId: string;
    provider: "google-drive" | "dropbox";
    providerAccountId: string;
    providerAccountEmail?: string;
    refreshTokenEncrypted: string;
    scopes: string;
  },
): Promise<StorageConnectionRow> => {
  await db
    .prepare(
      `INSERT INTO storage_connections
         (id, user_id, provider, provider_account_id, provider_account_email,
          refresh_token_encrypted, scopes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT(user_id, provider, provider_account_id) DO UPDATE SET
         provider_account_email = excluded.provider_account_email,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         scopes = excluded.scopes,
         status = 'active',
         updated_at = datetime('now')`,
    )
    .bind(
      input.id,
      input.userId,
      input.provider,
      input.providerAccountId,
      input.providerAccountEmail ?? null,
      input.refreshTokenEncrypted,
      input.scopes,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT id, user_id, provider, provider_account_id, provider_account_email,
              refresh_token_encrypted, scopes, status, last_used_at, created_at, updated_at
       FROM storage_connections
       WHERE user_id = ? AND provider = ? AND provider_account_id = ?`,
    )
    .bind(input.userId, input.provider, input.providerAccountId)
    .first<StorageConnectionRow>();

  if (!row) throw new Error("storage_connection_save_failed");
  return row;
};
