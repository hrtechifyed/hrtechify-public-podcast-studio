import type { SpeechEditDecision } from "@hrtechify/audio";
import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { EditorialAnalysisError, runEditorialAnalysis } from "./editorial-analysis";
import {
  listLatestEditorialProposals,
  recordEditorialDecision,
  type EditorialProposalRow,
} from "./editorial-edits";
import { getEpisodeForUser } from "./episodes";
import { GoogleDriveError } from "./google-drive";
import { isEditorialApprovalSchemaReady, isEpisodeSchemaReady } from "./schema-readiness";
import { upsertUserFromIdentity } from "./users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const serializeProposal = (proposal: EditorialProposalRow) => ({
  id: proposal.id,
  analysisRunId: proposal.analysis_run_id,
  kind: proposal.kind,
  startMs: proposal.start_ms,
  endMs: proposal.end_ms,
  explanation: proposal.explanation,
  confidence: proposal.confidence,
  approvalRequired: true as const,
  decision: proposal.decision,
  decisionId: proposal.decision_id,
  decidedAt: proposal.decided_at,
});

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

const validDecision = (value: unknown): value is SpeechEditDecision =>
  value === "apply" || value === "keep_original";

export const handleEditorialEditsApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  const analyzeMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/analyze$/);
  const listMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/edit-proposals$/);
  const decisionMatch = url.pathname.match(
    /^\/api\/episodes\/([^/]+)\/edit-proposals\/([^/]+)\/decision$/,
  );
  if (!analyzeMatch && !listMatch && !decisionMatch) return null;

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (!(await isEpisodeSchemaReady(db)) || !(await isEditorialApprovalSchemaReady(db))) {
      return json({ error: "editorial_approval_schema_not_ready" }, 503);
    }

    const episodeId = decodeURIComponent((analyzeMatch ?? listMatch ?? decisionMatch)![1]);
    const episode = await getEpisodeForUser(db, identity.userId, episodeId);
    if (!episode) return json({ error: "episode_not_found" }, 404);

    if (analyzeMatch) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const result = await runEditorialAnalysis(env, db, identity.userId, episode);
      const proposals = await listLatestEditorialProposals(db, identity.userId, episode.id);
      const refreshedEpisode = await getEpisodeForUser(db, identity.userId, episode.id);
      return json({
        ok: true,
        ...result,
        episodeStatus: refreshedEpisode?.status ?? episode.status,
        proposals: proposals.map(serializeProposal),
        unresolvedCount: proposals.filter((proposal) => !proposal.decision).length,
      }, 201);
    }

    if (listMatch) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const proposals = await listLatestEditorialProposals(db, identity.userId, episode.id);
      const unresolvedCount = proposals.filter((proposal) => !proposal.decision).length;
      return json({
        episodeId: episode.id,
        episodeStatus: episode.status,
        proposals: proposals.map(serializeProposal),
        unresolvedCount,
        allDecided: proposals.length > 0 && unresolvedCount === 0,
      });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const proposalId = decodeURIComponent(decisionMatch![2]);
    const body = await parseBody(request);
    if (!validDecision(body.decision)) return json({ error: "edit_decision_invalid" }, 400);

    const result = await recordEditorialDecision(
      db,
      identity.userId,
      episode,
      proposalId,
      body.decision,
    );
    const proposals = await listLatestEditorialProposals(db, identity.userId, episode.id);
    const refreshedEpisode = await getEpisodeForUser(db, identity.userId, episode.id);
    return json({
      ok: true,
      decisionId: result.decisionId,
      unresolvedCount: result.unresolvedCount,
      episodeStatus: refreshedEpisode?.status ?? episode.status,
      proposals: proposals.map(serializeProposal),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof EditorialAnalysisError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof GoogleDriveError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: error.message }, 503);
      if (error.message === "invalid_json") return json({ error: error.message }, 400);
      if (/UNIQUE constraint failed.*episode_edit_analysis_runs/i.test(error.message)) {
        return json({ error: "analysis_already_running" }, 409);
      }
      if (error.message === "episode_not_ready_for_analysis") {
        return json({ error: error.message }, 409);
      }
      if (error.message === "edit_proposal_not_found" || error.message === "edit_analysis_not_found") {
        return json({ error: error.message }, 404);
      }
      if (error.message === "edit_decisions_locked") return json({ error: error.message }, 409);
      if (error.message.endsWith("_invalid") || error.message.endsWith("_required") || error.message.endsWith("_too_long")) {
        return json({ error: error.message }, 400);
      }
    }
    return json({ error: "internal_error" }, 500);
  }
};
