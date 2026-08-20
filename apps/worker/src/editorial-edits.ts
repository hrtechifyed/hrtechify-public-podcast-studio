import {
  SPEECH_EDIT_KINDS,
  type SpeechEditDecision,
  type SpeechEditKind,
} from "@hrtechify/audio";
import type { D1DatabaseLike } from "./db";
import type { EpisodeRow } from "./episodes";

export interface EditorialAnalysisRunRow {
  id: string;
  user_id: string;
  show_id: string;
  episode_id: string;
  source_file_id: string;
  analyzer_version: string;
  status: "analyzing" | "completed" | "failed";
  failure_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface EditorialProposalInput {
  kind: SpeechEditKind;
  startMs: number;
  endMs: number;
  explanation: string;
  confidence?: number | null;
}

export interface EditorialProposalRow {
  id: string;
  analysis_run_id: string;
  user_id: string;
  show_id: string;
  episode_id: string;
  kind: SpeechEditKind;
  start_ms: number;
  end_ms: number;
  explanation: string;
  confidence: number | null;
  created_at: string;
  decision: SpeechEditDecision | null;
  decision_id: string | null;
  decided_at: string | null;
}

const EDIT_KIND_SET = new Set<string>(SPEECH_EDIT_KINDS);
const EDIT_DECISION_SET = new Set<SpeechEditDecision>(["apply", "keep_original"]);

const cleanAnalyzerVersion = (value: string) => {
  const cleaned = value.trim();
  if (!cleaned) throw new Error("analyzer_version_required");
  if (cleaned.length > 120) throw new Error("analyzer_version_too_long");
  return cleaned;
};

const cleanProposal = (input: EditorialProposalInput): EditorialProposalInput => {
  if (!EDIT_KIND_SET.has(input.kind)) throw new Error("edit_kind_invalid");
  if (
    !Number.isSafeInteger(input.startMs) ||
    !Number.isSafeInteger(input.endMs) ||
    input.startMs < 0 ||
    input.endMs <= input.startMs
  ) {
    throw new Error("edit_range_invalid");
  }
  const explanation = input.explanation.trim();
  if (!explanation) throw new Error("edit_explanation_required");
  if (explanation.length > 1000) throw new Error("edit_explanation_too_long");
  const confidence = input.confidence ?? null;
  if (
    confidence !== null &&
    (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    throw new Error("edit_confidence_invalid");
  }
  return { ...input, explanation, confidence };
};

const requireImmutableEpisode = (episode: EpisodeRow) => {
  if (episode.source_immutable !== 1 || !episode.source_file_id) {
    throw new Error("episode_source_not_immutable");
  }
};

const getRun = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
  runId: string,
) =>
  db
    .prepare(
      `SELECT id, user_id, show_id, episode_id, source_file_id, analyzer_version,
              status, failure_code, created_at, completed_at
       FROM episode_edit_analysis_runs
       WHERE id = ? AND user_id = ? AND episode_id = ?`,
    )
    .bind(runId, userId, episodeId)
    .first<EditorialAnalysisRunRow>();

export const createEditorialAnalysisRun = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
  analyzerVersion: string,
): Promise<EditorialAnalysisRunRow> => {
  requireImmutableEpisode(episode);
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  if (
    !["source_ready", "awaiting_edit_approval", "awaiting_render_confirmation", "failed"].includes(
      episode.status,
    )
  ) {
    throw new Error("episode_not_ready_for_analysis");
  }

  const runId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO episode_edit_analysis_runs
         (id, user_id, show_id, episode_id, source_file_id, analyzer_version, status)
       VALUES (?, ?, ?, ?, ?, ?, 'analyzing')`,
    )
    .bind(
      runId,
      userId,
      episode.show_id,
      episode.id,
      episode.source_file_id,
      cleanAnalyzerVersion(analyzerVersion),
    )
    .run();

  await db
    .prepare(
      `UPDATE episodes
       SET status = 'analyzing', updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
         AND status IN ('source_ready', 'awaiting_edit_approval', 'awaiting_render_confirmation', 'failed')`,
    )
    .bind(episode.id, userId)
    .run();

  const run = await getRun(db, userId, episode.id, runId);
  if (!run) throw new Error("edit_analysis_run_create_failed");
  return run;
};

export const completeEditorialAnalysisRun = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
  runId: string,
  proposals: EditorialProposalInput[],
) => {
  requireImmutableEpisode(episode);
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  const run = await getRun(db, userId, episode.id, runId);
  if (!run || run.status !== "analyzing") throw new Error("edit_analysis_run_not_active");
  if (run.source_file_id !== episode.source_file_id) throw new Error("edit_analysis_source_mismatch");
  if (proposals.length > 500) throw new Error("too_many_edit_proposals");

  const cleaned = proposals.map(cleanProposal);
  for (const proposal of cleaned) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO episode_edit_proposals
           (id, analysis_run_id, user_id, show_id, episode_id, kind,
            start_ms, end_ms, explanation, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        run.id,
        userId,
        episode.show_id,
        episode.id,
        proposal.kind,
        proposal.startMs,
        proposal.endMs,
        proposal.explanation,
        proposal.confidence ?? null,
      )
      .run();
  }

  await db
    .prepare(
      `UPDATE episode_edit_analysis_runs
       SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ? AND status = 'analyzing'`,
    )
    .bind(run.id, userId)
    .run();

  await db
    .prepare(
      `UPDATE episodes
       SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'analyzing'`,
    )
    .bind(cleaned.length > 0 ? "awaiting_edit_approval" : "awaiting_render_confirmation", episode.id, userId)
    .run();

  return { proposalCount: cleaned.length };
};

export const failEditorialAnalysisRun = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
  runId: string,
  failureCode: string,
) => {
  const cleaned = failureCode.trim().slice(0, 120) || "analysis_failed";
  await db
    .prepare(
      `UPDATE episode_edit_analysis_runs
       SET status = 'failed', failure_code = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ? AND episode_id = ? AND status = 'analyzing'`,
    )
    .bind(cleaned, runId, userId, episodeId)
    .run();
  await db
    .prepare(
      `UPDATE episodes
       SET status = 'failed', updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'analyzing'`,
    )
    .bind(episodeId, userId)
    .run();
};

const latestCompletedRunId = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
) => {
  const row = await db
    .prepare(
      `SELECT id
       FROM episode_edit_analysis_runs
       WHERE user_id = ? AND episode_id = ? AND status = 'completed'
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .bind(userId, episodeId)
    .first<{ id: string }>();
  return row?.id ?? null;
};

export const listLatestEditorialProposals = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
): Promise<EditorialProposalRow[]> => {
  const runId = await latestCompletedRunId(db, userId, episodeId);
  if (!runId) return [];
  const { results } = await db
    .prepare(
      `SELECT p.id, p.analysis_run_id, p.user_id, p.show_id, p.episode_id,
              p.kind, p.start_ms, p.end_ms, p.explanation, p.confidence, p.created_at,
              d.decision, d.id AS decision_id, d.created_at AS decided_at
       FROM episode_edit_proposals p
       LEFT JOIN episode_edit_decisions d
         ON d.sequence = (
           SELECT MAX(d2.sequence)
           FROM episode_edit_decisions d2
           WHERE d2.user_id = p.user_id AND d2.proposal_id = p.id
         )
       WHERE p.user_id = ? AND p.episode_id = ? AND p.analysis_run_id = ?
       ORDER BY p.start_ms ASC, p.end_ms ASC`,
    )
    .bind(userId, episodeId, runId)
    .all<EditorialProposalRow>();
  return results;
};

export const recordEditorialDecision = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
  proposalId: string,
  decision: SpeechEditDecision,
) => {
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  if (!EDIT_DECISION_SET.has(decision)) throw new Error("edit_decision_invalid");
  if (!["awaiting_edit_approval", "awaiting_render_confirmation"].includes(episode.status)) {
    throw new Error("edit_decisions_locked");
  }

  const runId = await latestCompletedRunId(db, userId, episode.id);
  if (!runId) throw new Error("edit_analysis_not_found");
  const proposal = await db
    .prepare(
      `SELECT id
       FROM episode_edit_proposals
       WHERE id = ? AND user_id = ? AND show_id = ? AND episode_id = ? AND analysis_run_id = ?`,
    )
    .bind(proposalId, userId, episode.show_id, episode.id, runId)
    .first<{ id: string }>();
  if (!proposal) throw new Error("edit_proposal_not_found");

  const decisionId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO episode_edit_decisions
         (id, user_id, show_id, episode_id, proposal_id, decision)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(decisionId, userId, episode.show_id, episode.id, proposal.id, decision)
    .run();

  const unresolved = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM episode_edit_proposals p
       WHERE p.user_id = ? AND p.episode_id = ? AND p.analysis_run_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM episode_edit_decisions d
           WHERE d.user_id = p.user_id AND d.proposal_id = p.id
         )`,
    )
    .bind(userId, episode.id, runId)
    .first<{ count: number }>();

  if ((unresolved?.count ?? 0) === 0) {
    await db
      .prepare(
        `UPDATE episodes
         SET status = 'awaiting_render_confirmation', updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND status = 'awaiting_edit_approval'`,
      )
      .bind(episode.id, userId)
      .run();
  }

  return { decisionId, unresolvedCount: unresolved?.count ?? 0 };
};

export const listApprovedEditorialEdits = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
) => {
  const proposals = await listLatestEditorialProposals(db, userId, episodeId);
  return proposals.filter((proposal) => proposal.decision === "apply");
};
