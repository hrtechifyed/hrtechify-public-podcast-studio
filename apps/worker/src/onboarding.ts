import {
  HRTECHIFY_STARTER_EPISODE_NAME,
  HRTECHIFY_STARTER_HOST_NAME,
  HRTECHIFY_STARTER_SHOW_NAME,
} from "@hrtechify/shared";
import type { D1DatabaseLike } from "./db";
import { isOnboardingSchemaReady } from "./schema-readiness";
import { listShowsForUser, type ShowRow } from "./shows";

export interface UserOnboardingState {
  starterShowId: string | null;
  brandSetupRequired: boolean;
}

interface UserOnboardingRow {
  starter_show_id: string | null;
  brand_prompt_dismissed_at: string | null;
}

const noOnboardingState = (): UserOnboardingState => ({
  starterShowId: null,
  brandSetupRequired: false,
});

const readOnboarding = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<UserOnboardingRow | null> =>
  db
    .prepare(
      `SELECT starter_show_id, brand_prompt_dismissed_at
       FROM user_onboarding
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<UserOnboardingRow>();

const serialize = (row: UserOnboardingRow): UserOnboardingState => ({
  starterShowId: row.starter_show_id,
  brandSetupRequired: Boolean(row.starter_show_id && !row.brand_prompt_dismissed_at),
});

const insertLegacyOnboarding = async (db: D1DatabaseLike, userId: string) => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_onboarding
         (user_id, starter_show_id, brand_prompt_dismissed_at)
       VALUES (?, NULL, datetime('now'))`,
    )
    .bind(userId)
    .run();
};

const createStarterShowIfStillEmpty = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<string | null> => {
  const starterShowId = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO shows
         (id, user_id, name, host_display_name, description, status)
       SELECT ?, ?, ?, ?, NULL, 'active'
       WHERE NOT EXISTS (
         SELECT 1 FROM shows WHERE user_id = ? AND status <> 'deleted'
       )`,
    )
    .bind(
      starterShowId,
      userId,
      HRTECHIFY_STARTER_SHOW_NAME,
      HRTECHIFY_STARTER_HOST_NAME,
      userId,
    )
    .run();

  if ((result.meta?.changes ?? 0) !== 1) return null;

  await db
    .prepare(
      `INSERT OR IGNORE INTO show_preferences (show_id, default_episode_name)
       VALUES (?, ?)`,
    )
    .bind(starterShowId, HRTECHIFY_STARTER_EPISODE_NAME)
    .run();

  await db
    .prepare(
      `UPDATE user_onboarding
       SET starter_show_id = ?, updated_at = datetime('now')
       WHERE user_id = ? AND starter_show_id IS NULL`,
    )
    .bind(starterShowId, userId)
    .run();

  return starterShowId;
};

export const ensureUserOnboarding = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<UserOnboardingState> => {
  if (!(await isOnboardingSchemaReady(db))) return noOnboardingState();

  const existing = await readOnboarding(db, userId);
  if (existing) return serialize(existing);

  const existingShows = await listShowsForUser(db, userId);
  if (existingShows.length > 0) {
    await insertLegacyOnboarding(db, userId);
    return noOnboardingState();
  }

  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO user_onboarding
         (user_id, starter_show_id, brand_prompt_dismissed_at)
       VALUES (?, NULL, NULL)`,
    )
    .bind(userId)
    .run();

  if ((claim.meta?.changes ?? 0) === 1) {
    const starterShowId = await createStarterShowIfStillEmpty(db, userId);
    if (starterShowId) {
      return { starterShowId, brandSetupRequired: true };
    }
  }

  const afterClaim = await readOnboarding(db, userId);
  if (afterClaim?.starter_show_id) return serialize(afterClaim);

  const showsAfterClaim = await listShowsForUser(db, userId);
  const matchingStarter = showsAfterClaim.find(
    (show) =>
      show.name === HRTECHIFY_STARTER_SHOW_NAME &&
      show.host_display_name === HRTECHIFY_STARTER_HOST_NAME,
  );

  if (matchingStarter) {
    await db
      .prepare(
        `UPDATE user_onboarding
         SET starter_show_id = ?, updated_at = datetime('now')
         WHERE user_id = ? AND starter_show_id IS NULL`,
      )
      .bind(matchingStarter.id, userId)
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO show_preferences (show_id, default_episode_name)
         VALUES (?, ?)`,
      )
      .bind(matchingStarter.id, HRTECHIFY_STARTER_EPISODE_NAME)
      .run();
    return { starterShowId: matchingStarter.id, brandSetupRequired: true };
  }

  await insertLegacyOnboarding(db, userId);
  return noOnboardingState();
};

export const dismissBrandSetupPrompt = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<UserOnboardingState> => {
  if (!(await isOnboardingSchemaReady(db))) return noOnboardingState();

  await db
    .prepare(
      `UPDATE user_onboarding
       SET brand_prompt_dismissed_at = datetime('now'), updated_at = datetime('now')
       WHERE user_id = ?`,
    )
    .bind(userId)
    .run();
  const row = await readOnboarding(db, userId);
  return row ? serialize(row) : noOnboardingState();
};

export const ensureShowPreferences = async (
  db: D1DatabaseLike,
  show: ShowRow,
) => {
  if (!(await isOnboardingSchemaReady(db))) {
    return { default_episode_name: HRTECHIFY_STARTER_EPISODE_NAME };
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO show_preferences (show_id, default_episode_name)
       VALUES (?, ?)`,
    )
    .bind(show.id, HRTECHIFY_STARTER_EPISODE_NAME)
    .run();

  return db
    .prepare(
      `SELECT default_episode_name
       FROM show_preferences
       WHERE show_id = ?`,
    )
    .bind(show.id)
    .first<{ default_episode_name: string }>();
};

export const updateDefaultEpisodeName = async (
  db: D1DatabaseLike,
  show: ShowRow,
  value: unknown,
) => {
  if (typeof value !== "string") throw new Error("episode_name_required");
  const cleaned = value.trim();
  if (!cleaned) throw new Error("episode_name_required");
  if (cleaned.length > 160) throw new Error("episode_name_too_long");
  if (!(await isOnboardingSchemaReady(db))) throw new Error("onboarding_schema_not_ready");

  await ensureShowPreferences(db, show);
  await db
    .prepare(
      `UPDATE show_preferences
       SET default_episode_name = ?, updated_at = datetime('now')
       WHERE show_id = ?`,
    )
    .bind(cleaned, show.id)
    .run();
  return cleaned;
};
