import type { D1DatabaseLike } from "./db";

export interface CompletedEditorialRunRef {
  id: string;
  source_file_id: string;
  analyzer_version: string;
  sequence: number;
}

export const getLatestCompletedEditorialRun = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
): Promise<CompletedEditorialRunRef | null> =>
  db
    .prepare(
      `SELECT id, source_file_id, analyzer_version, sequence
       FROM episode_edit_analysis_runs
       WHERE user_id = ? AND episode_id = ? AND status = 'completed'
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .bind(userId, episodeId)
    .first<CompletedEditorialRunRef>();
