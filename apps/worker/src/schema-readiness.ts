import type { D1DatabaseLike } from "./db";

const tableExists = async (db: D1DatabaseLike, tableName: string) => {
  const row = await db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
    )
    .bind(tableName)
    .first<{ name: string }>();
  return row?.name === tableName;
};

const allTablesExist = async (db: D1DatabaseLike, tableNames: readonly string[]) => {
  for (const tableName of tableNames) {
    if (!(await tableExists(db, tableName))) return false;
  }
  return true;
};

export const PASSWORD_AUTH_TABLES = [
  "password_credentials",
  "password_verifications",
  "password_resets",
  "auth_rate_limits",
] as const;

export const ONBOARDING_TABLES = [
  "user_onboarding",
  "show_preferences",
] as const;

export const EPISODE_TABLES = ["episodes"] as const;

export const EDITORIAL_APPROVAL_TABLES = [
  "episode_edit_analysis_runs",
  "episode_edit_proposals",
  "episode_edit_decisions",
] as const;

export const RENDER_JOB_TABLES = ["episode_render_jobs"] as const;

export const PUBLISH_PREFERENCE_TABLES = ["episode_publish_preferences"] as const;

export const isPasswordAuthSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, PASSWORD_AUTH_TABLES);

export const isOnboardingSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, ONBOARDING_TABLES);

export const isEpisodeSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, EPISODE_TABLES);

export const isEditorialApprovalSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, EDITORIAL_APPROVAL_TABLES);

export const isRenderJobSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, RENDER_JOB_TABLES);

export const isPublishPreferenceSchemaReady = (db: D1DatabaseLike) =>
  allTablesExist(db, PUBLISH_PREFERENCE_TABLES);
