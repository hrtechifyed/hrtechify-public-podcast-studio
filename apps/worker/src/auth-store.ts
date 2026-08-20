import type { D1DatabaseLike } from "./db";

interface OAuthStateRow {
  state_hash: string;
  provider: "google";
  code_verifier: string;
  return_to: string;
  expires_at: string;
}

interface MagicLinkRow {
  token_hash: string;
  email: string;
  return_to: string;
  expires_at: string;
  consumed_at: string | null;
}

const changes = (result: { meta?: { changes?: number } }) => Number(result.meta?.changes ?? 0);

export const saveOAuthState = async (
  db: D1DatabaseLike,
  stateHash: string,
  codeVerifier: string,
  returnTo: string,
  expiresAt: string,
) => {
  await db
    .prepare(
      `INSERT INTO auth_oauth_states
         (state_hash, provider, code_verifier, return_to, expires_at)
       VALUES (?, 'google', ?, ?, ?)`,
    )
    .bind(stateHash, codeVerifier, returnTo, expiresAt)
    .run();
};

export const consumeOAuthState = async (
  db: D1DatabaseLike,
  stateHash: string,
): Promise<OAuthStateRow | null> => {
  const row = await db
    .prepare(
      `SELECT state_hash, provider, code_verifier, return_to, expires_at
       FROM auth_oauth_states
       WHERE state_hash = ? AND expires_at > datetime('now')`,
    )
    .bind(stateHash)
    .first<OAuthStateRow>();

  if (!row) return null;

  const result = await db
    .prepare(`DELETE FROM auth_oauth_states WHERE state_hash = ?`)
    .bind(stateHash)
    .run();

  return changes(result) === 1 ? row : null;
};

export const recentMagicLinkExists = async (
  db: D1DatabaseLike,
  email: string,
  cooldownSeconds = 60,
) => {
  const row = await db
    .prepare(
      `SELECT token_hash
       FROM auth_magic_links
       WHERE email = ?
         AND created_at > datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(email, `-${cooldownSeconds} seconds`)
    .first<{ token_hash: string }>();

  return Boolean(row);
};

export const saveMagicLink = async (
  db: D1DatabaseLike,
  tokenHash: string,
  email: string,
  returnTo: string,
  expiresAt: string,
) => {
  await db
    .prepare(
      `INSERT INTO auth_magic_links
         (token_hash, email, return_to, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(tokenHash, email, returnTo, expiresAt)
    .run();
};

export const consumeMagicLink = async (
  db: D1DatabaseLike,
  tokenHash: string,
): Promise<MagicLinkRow | null> => {
  const row = await db
    .prepare(
      `SELECT token_hash, email, return_to, expires_at, consumed_at
       FROM auth_magic_links
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first<MagicLinkRow>();

  if (!row) return null;

  const result = await db
    .prepare(
      `UPDATE auth_magic_links
       SET consumed_at = datetime('now')
       WHERE token_hash = ? AND consumed_at IS NULL`,
    )
    .bind(tokenHash)
    .run();

  return changes(result) === 1 ? row : null;
};

export const purgeExpiredAuthArtifacts = async (db: D1DatabaseLike) => {
  await db
    .prepare(`DELETE FROM auth_oauth_states WHERE expires_at <= datetime('now')`)
    .run();
  await db
    .prepare(
      `DELETE FROM auth_magic_links
       WHERE expires_at <= datetime('now', '-1 day') OR consumed_at <= datetime('now', '-1 day')`,
    )
    .run();
};
