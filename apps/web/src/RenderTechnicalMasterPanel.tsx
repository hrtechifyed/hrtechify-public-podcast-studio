import { useEffect, useState } from "react";

interface RenderJob {
  id: string;
  episodeId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  cleanupProfileVersion: string;
  approvedEditRangeCount: number;
  derived: {
    fileId: string;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
  } | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

interface RenderTechnicalMasterPanelProps {
  episodeId: string;
  episodeTitle: string;
  episodeStatus: string;
  onStatusChange?: (status: string) => void;
}

const formatBytes = (bytes: number | null) => {
  if (!bytes) return "size unavailable";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const jobLabel = (job: RenderJob | null) => {
  if (!job) return "No technical-master render has been started.";
  if (job.status === "queued") return "Render queued.";
  if (job.status === "processing") return "Creating technical master…";
  if (job.status === "completed") return "Technical master created.";
  if (job.status === "failed") return "Technical-master render needs attention.";
  return "Render cancelled.";
};

export function RenderTechnicalMasterPanel({
  episodeId,
  episodeTitle,
  episodeStatus,
  onStatusChange,
}: RenderTechnicalMasterPanelProps) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/render`, {
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        episodeStatus?: string;
        job?: RenderJob | null;
        error?: string;
      } | null;
      if (response.status === 503 && payload?.error === "render_job_schema_not_ready") {
        setSchemaReady(false);
        setLoaded(true);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Could not load render status.");
      setSchemaReady(true);
      setJob(payload?.job ?? null);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load render status.");
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (
      episodeStatus === "awaiting_render_confirmation" ||
      episodeStatus === "rendering" ||
      episodeStatus === "completed" ||
      episodeStatus === "failed"
    ) {
      void load();
    }
  }, [episodeId, episodeStatus]);

  useEffect(() => {
    if (job?.status !== "queued" && job?.status !== "processing") return undefined;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [episodeId, job?.status]);

  const startRender = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/render`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        job?: RenderJob;
        episodeStatus?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.job) throw new Error(payload?.error || "Could not start technical-master render.");
      setJob(payload.job);
      if (payload.episodeStatus) onStatusChange?.(payload.episodeStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start technical-master render.");
    } finally {
      setBusy(false);
    }
  };

  if (episodeStatus === "source_ready" || episodeStatus === "analyzing" || episodeStatus === "awaiting_edit_approval") {
    return null;
  }

  return (
    <div className="trust-note" style={{ marginTop: 10 }}>
      <strong>Technical master for {episodeTitle}</strong>
      <span>
        This is the final confirmation before audio processing begins. The render creates a new immutable FLAC in your Episodes folder. Your original recording is never overwritten or replaced.
      </span>
      <span>
        Only edit ranges you explicitly marked “Apply in final edit” are removed. Technical cleanup is limited to the fixed HRTechify podcast profile and preserves words, pitch and speaking speed outside those approved cuts.
      </span>

      {!loaded ? (
        <span>Checking render status…</span>
      ) : !schemaReady ? (
        <span>Render tracking is not enabled in the database yet. No audio processing can start.</span>
      ) : (
        <>
          <span>{jobLabel(job)}</span>
          {job && (
            <span>
              {job.approvedEditRangeCount} approved cut range{job.approvedEditRangeCount === 1 ? "" : "s"} · cleanup profile {job.cleanupProfileVersion}
            </span>
          )}
          {job?.status === "completed" && job.derived && (
            <span>
              Saved as {job.derived.fileName || "technical master"} · {formatBytes(job.derived.sizeBytes)} · {job.derived.mimeType || "audio/flac"}
            </span>
          )}
          {job?.status === "failed" && job.failureCode && (
            <span>Failure code: {job.failureCode}. The immutable original remains unchanged.</span>
          )}

          {episodeStatus === "awaiting_render_confirmation" && job?.status !== "queued" && job?.status !== "processing" && (
            <button type="button" className="primary-action compact" onClick={() => void startRender()} disabled={busy}>
              {busy ? "Starting render…" : "Create technical master"}
            </button>
          )}
          {(job?.status === "queued" || job?.status === "processing") && (
            <span>No additional action is needed while this render is running.</span>
          )}
        </>
      )}

      {error && <div className="notice error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
