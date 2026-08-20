import { useState } from "react";
import type {
  SpeechEditDecision,
  SpeechEditKind,
} from "@hrtechify/audio";

interface EditorialProposal {
  id: string;
  analysisRunId: string;
  kind: SpeechEditKind;
  startMs: number;
  endMs: number;
  explanation: string;
  confidence: number | null;
  approvalRequired: true;
  decision: SpeechEditDecision | null;
  decisionId: string | null;
  decidedAt: string | null;
}

interface EditorialApprovalPanelProps {
  episodeId: string;
  episodeTitle: string;
  episodeStatus: string;
  onStatusChange?: (status: string) => void;
}

const kindLabel: Record<SpeechEditKind, string> = {
  unusual_pause: "Unusual pause",
  false_start: "False start",
  repeated_speech: "Repeated speech",
  fumble: "Fumble",
  spoken_content_removal: "Spoken content removal",
};

const formatTime = (milliseconds: number) => {
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
};

const friendlyAnalysisError = (code?: string) => {
  switch (code) {
    case "workers_ai_not_configured": return "Podcast analysis is not enabled for this deployment yet.";
    case "media_binding_not_configured": return "Video audio extraction is not enabled for this deployment yet.";
    case "analysis_source_too_large_for_inline_worker": return "This original is too large for the current inline analyzer. It remains safe in your storage and will need the larger-file processing pipeline.";
    case "analysis_source_mime_not_supported": return "This recording format cannot be analyzed by the current inline analyzer.";
    case "analysis_transcript_timestamps_missing": return "The transcript did not contain reliable word timing, so no edit proposals were created.";
    case "analysis_transcription_failed": return "The transcription service could not analyze this original. No edit proposals were created.";
    case "analysis_media_transform_failed": return "Audio could not be extracted from this video. The original remains unchanged.";
    case "analysis_already_running": return "An analysis is already running for this episode.";
    case "google_drive_authorization_expired":
    case "google_drive_access_token_failed": return "Google Drive needs to be reconnected before this original can be analyzed.";
    default: return code || "Editorial analysis could not be completed.";
  }
};

export function EditorialApprovalPanel({
  episodeId,
  episodeTitle,
  episodeStatus,
  onStatusChange,
}: EditorialApprovalPanelProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [proposals, setProposals] = useState<EditorialProposal[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(episodeId)}/edit-proposals`,
        { credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => null) as {
        episodeStatus?: string;
        proposals?: EditorialProposal[];
        unresolvedCount?: number;
        error?: string;
      } | null;
      if (response.status === 503 && payload?.error === "editorial_approval_schema_not_ready") {
        setSchemaReady(false);
        setLoaded(true);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Could not load proposed edits.");
      setSchemaReady(true);
      setProposals(payload?.proposals ?? []);
      setUnresolvedCount(payload?.unresolvedCount ?? 0);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load proposed edits.");
      setLoaded(true);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) void load();
  };

  const analyze = async () => {
    setAnalysisBusy(true);
    setError(null);
    setAnalysisNotice(null);
    setOpen(true);
    onStatusChange?.("analyzing");
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/analyze`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        proposalCount?: number;
        transcriptWordCount?: number;
        episodeStatus?: string;
        proposals?: EditorialProposal[];
        unresolvedCount?: number;
        error?: string;
      } | null;
      if (!response.ok) throw new Error(friendlyAnalysisError(payload?.error));
      setLoaded(true);
      setSchemaReady(true);
      setProposals(payload?.proposals ?? []);
      setUnresolvedCount(payload?.unresolvedCount ?? 0);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
      const proposalCount = payload?.proposalCount ?? payload?.proposals?.length ?? 0;
      setAnalysisNotice(
        proposalCount === 0
          ? "Analysis found no clear edit candidates. The immutable original remains unchanged."
          : `Analysis found ${proposalCount} clear edit candidate${proposalCount === 1 ? "" : "s"}. Review each one before anything can be used in a final edit.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Editorial analysis could not be completed.");
      await load();
    } finally {
      setAnalysisBusy(false);
    }
  };

  const decide = async (proposalId: string, decision: SpeechEditDecision) => {
    setBusyProposalId(proposalId);
    setError(null);
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(episodeId)}/edit-proposals/${encodeURIComponent(proposalId)}/decision`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        proposals?: EditorialProposal[];
        unresolvedCount?: number;
        episodeStatus?: string;
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not save your edit decision.");
      setProposals(payload?.proposals ?? []);
      setUnresolvedCount(payload?.unresolvedCount ?? 0);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your edit decision.");
    } finally {
      setBusyProposalId(null);
    }
  };

  const statusHint = () => {
    if (analysisBusy || episodeStatus === "analyzing") return "Transcribing the immutable original and looking for clear edit candidates…";
    if (episodeStatus === "source_ready") return "Editorial analysis has not run yet.";
    if (episodeStatus === "failed") return "Editorial analysis needs attention before review.";
    if (episodeStatus === "awaiting_edit_approval") {
      return unresolvedCount > 0 ? `${unresolvedCount} proposal${unresolvedCount === 1 ? "" : "s"} still need a decision.` : "Review the proposed edits.";
    }
    if (episodeStatus === "awaiting_render_confirmation") return "Editorial decisions are complete. You can still review them before rendering starts.";
    if (episodeStatus === "rendering" || episodeStatus === "completed") return "Editorial decisions are locked because rendering has started or completed.";
    return "Review proposed editorial changes.";
  };

  const decisionsLocked = episodeStatus === "rendering" || episodeStatus === "completed" || episodeStatus === "cancelled";
  const canAnalyze = !decisionsLocked && episodeStatus !== "analyzing";

  return (
    <div style={{ width: "100%", marginTop: 10 }}>
      <div className="inline-actions">
        <button type="button" className="secondary-action compact" onClick={toggle}>
          {open ? "Hide edit review" : "Review proposed edits"}
        </button>
        {canAnalyze && (
          <button type="button" className="primary-action compact" onClick={() => void analyze()} disabled={analysisBusy || !schemaReady}>
            {analysisBusy ? "Analyzing original…" : episodeStatus === "source_ready" ? "Analyze original recording" : "Analyze original again"}
          </button>
        )}
      </div>
      <span className="muted" style={{ display: "inline-block", marginTop: 7 }}>{statusHint()}</span>

      {open && (
        <div className="trust-note" style={{ marginTop: 10 }}>
          <strong>Editorial approval for {episodeTitle}</strong>
          <span>
            Analysis reads the immutable original to detect clear pauses, repeated speech, false starts and fumbles. It does not edit the file. Every item below is a proposal only. “Apply in final edit” approves that exact time range for a later derived edit. “Keep Original” preserves it. Neither decision overwrites, trims or replaces your immutable source recording.
          </span>

          {analysisBusy && <span>Transcribing and analyzing the original. No changes are being applied.</span>}
          {analysisNotice && <div className="notice success" style={{ marginTop: 10 }}>{analysisNotice}</div>}

          {!loaded && !analysisBusy ? (
            <span>Loading proposed edits…</span>
          ) : !schemaReady ? (
            <span>Editorial approval tracking is not enabled in the database yet. The original recording remains unchanged.</span>
          ) : proposals.length === 0 ? (
            <span>
              {episodeStatus === "source_ready"
                ? "No analysis has produced proposals yet."
                : "No editorial removals were proposed for the latest completed analysis."}
            </span>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  style={{ padding: 12, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong>{kindLabel[proposal.kind]}</strong>
                    <span className="muted">{formatTime(proposal.startMs)}–{formatTime(proposal.endMs)}</span>
                  </div>
                  <p className="muted" style={{ margin: "7px 0" }}>{proposal.explanation}</p>
                  {proposal.confidence !== null && (
                    <span className="muted">Detection confidence: {Math.round(proposal.confidence * 100)}%</span>
                  )}
                  <div className="inline-actions" style={{ marginTop: 9 }}>
                    <button
                      type="button"
                      className={proposal.decision === "apply" ? "primary-action compact" : "secondary-action compact"}
                      disabled={decisionsLocked || busyProposalId === proposal.id || analysisBusy}
                      onClick={() => void decide(proposal.id, "apply")}
                    >
                      Apply in final edit
                    </button>
                    <button
                      type="button"
                      className={proposal.decision === "keep_original" ? "primary-action compact" : "secondary-action compact"}
                      disabled={decisionsLocked || busyProposalId === proposal.id || analysisBusy}
                      onClick={() => void decide(proposal.id, "keep_original")}
                    >
                      Keep Original
                    </button>
                    {proposal.decision && (
                      <span className="muted">
                        Current decision: {proposal.decision === "apply" ? "Apply in final edit" : "Keep Original"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {schemaReady && proposals.length > 0 && unresolvedCount === 0 && (
            <span>All proposed edits have an explicit decision. The original source remains unchanged.</span>
          )}
          {error && <div className="notice error" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
