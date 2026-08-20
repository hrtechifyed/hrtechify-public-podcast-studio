import { MAX_ACTIVE_SHOWS_PER_USER } from "@hrtechify/shared";
import type { D1DatabaseLike } from "./db";

export interface ShowRow {
  id: string;
  user_id: string;
  name: string;
  host_display_name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  storage_connection_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateShowInput {
  name: string;
  hostDisplayName: string;
  description?: string;
}

export class ShowLimitError extends Error {
  constructor() {
    super("active_show_limit_reached");
    this.name = "ShowLimitError";
  }
}

const cleanText = (value: string, field: string, maxLength: number) => {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field}_required`);
  if (cleaned.length > maxLength) throw new Error(`${field}_too_long`);
  return cleaned;
};

export const listShowsForUser = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<ShowRow[]> => {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, host_display_name, description, status,
              storage_connection_id, created_at, updated_at
       FROM shows
       WHERE user_id = ? AND status <> 'deleted'
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<ShowRow>();

  return results;
};

export const getShowForUser = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
): Promise<ShowRow | null> => {
  return db
    .prepare(
      `SELECT id, user_id, name, host_display_name, description, status,
              storage_connection_id, created_at, updated_at
       FROM shows
       WHERE id = ? AND user_id = ? AND status <> 'deleted'`,
    )
    .bind(showId, userId)
    .first<ShowRow>();
};

export const countActiveShowsForUser = async (
  db: D1DatabaseLike,
  userId: string,
): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM shows
       WHERE user_id = ? AND status = 'active'`,
    )
    .bind(userId)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
};

export const createShowForUser = async (
  db: D1DatabaseLike,
  userId: string,
  input: CreateShowInput,
): Promise<ShowRow> => {
  const activeCount = await countActiveShowsForUser(db, userId);
  if (activeCount >= MAX_ACTIVE_SHOWS_PER_USER) {
    throw new ShowLimitError();
  }

  const id = crypto.randomUUID();
  const name = cleanText(input.name, "show_name", 120);
  const hostDisplayName = cleanText(input.hostDisplayName, "host_name", 120);
  const description = input.description?.trim() || null;

  try {
    await db
      .prepare(
        `INSERT INTO shows
           (id, user_id, name, host_display_name, description, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
      )
      .bind(id, userId, name, hostDisplayName, description)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("active_show_limit_reached")) {
      throw new ShowLimitError();
    }
    throw error;
  }

  const show = await getShowForUser(db, userId, id);
  if (!show) throw new Error("show_create_failed");
  return show;
};

export const archiveShowForUser = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
): Promise<boolean> => {
  const show = await getShowForUser(db, userId, showId);
  if (!show) return false;

  await db
    .prepare(
      `UPDATE shows
       SET status = 'archived', updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(showId, userId)
    .run();

  return true;
};

export const restoreShowForUser = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
): Promise<ShowRow | null> => {
  const show = await getShowForUser(db, userId, showId);
  if (!show) return null;
  if (show.status === "active") return show;

  const activeCount = await countActiveShowsForUser(db, userId);
  if (activeCount >= MAX_ACTIVE_SHOWS_PER_USER) throw new ShowLimitError();

  await db
    .prepare(
      `UPDATE shows
       SET status = 'active', updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'archived'`,
    )
    .bind(showId, userId)
    .run();

  return getShowForUser(db, userId, showId);
};
