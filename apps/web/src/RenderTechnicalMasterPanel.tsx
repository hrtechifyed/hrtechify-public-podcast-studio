import { useEffect, useState } from "react";

interface OutputFile {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  openUrl: string | null;
}

interface RenderJob {
  id: string;
  episodeId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  cleanupProfileVersion: string;
  approvedEditRangeCount: number;
  publication: {
    template: { id: string; name: string; version: number };
    captionsEnabled: boolean;
    platformCredit: string;
  } | null;
  technicalMaster: {
    fileId: string;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
  } | null;
  finalOutputs: {
    captions: OutputFile | null;
    mp3: OutputFile | null;
    mp4: OutputFile | null;
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
  if (!job) return "No final render has been started.";
  if (job.status === "queued") return "Final render queued.";
  if (job.status === "processing") return "Creating technical master and final outputs…";
  if (job.status === "completed") return "Final podcast outputs created.";
  if (job.status === "failed") return "Final render needs attention.";
  return "Render cancelled.";
};

const OutputLink = ({ label, file }: { label: string; file: OutputFile | null }) => {
  if (!file) return <span>{label}: not found.</span>;
  return (
    <span>
      {label}: {file.openUrl ? (
        <a href={file.openUrl} target="_blank" rel="noreferrer">{file.fileName}</a>
      ) : file.fileName} · {formatBytes(file.sizeBytes)} · {file.mimeType || "type unavailable"}
    </span>
  );
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
      if (!response.ok) throw new Error(payload?.error || "Could not load final-render status.");
      setSchemaReady(true);
      setJob(payload?.job ?? null);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load final-render status.");
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
      if (!response.ok || !payload?.job) throw new Error(payload?.error || "Could not start final render.");
      setJob(payload.job);
      if (payload.episodeStatus) onStatusChange?.(payload.episodeStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start final render.");
    } finally {
      setBusy(false);
    }
  };

  if (episodeStatus === "source_ready" || episodeStatus === "analyzing" || episodeStatus === "awaiting_edit_approval") {
    return null;
  }

  return (
    <div className="trust-note" style={{ marginTop: 10 }}>
      <strong>Final episode outputs for {episodeTitle}</strong>
      <span>
        This is the final confirmation before processing begins. It creates a technical master, a downloadable WebVTT caption file, a final MP3 and a final MP4. Your original recording is never overwritten or replaced.
      </span>
      <span>
        Only edit ranges you explicitly marked “Apply in final edit” are removed. Your current immutable show intro and outro are included when present. Technical cleanup preserves words, pitch and speaking speed outside those approved cuts.
      </span>
      <span>
        The video uses the saved curated template. Burned-in captions follow the approved edited timeline, and “Powered by HRTechify” remains mandatory.
      </span>

      {!loaded ? (
        <span>Checking final-render status…</span>
      ) : !schemaReady ? (
        <span>Final-render tracking is not enabled in the database yet. No audio or video processing can start.</span>
      ) : (
        <>
          <span>{jobLabel(job)}</span>
          {job && (
            <span>
              {job.approvedEditRangeCount} approved cut range{job.approvedEditRangeCount === 1 ? "" : "s"} · cleanup profile {job.cleanupProfileVersion}
            </span>
          )}
          {job?.publication && (
            <span>
              Template: {job.publication.template.name} v{job.publication.template.version} · burned-in captions {job.publication.captionsEnabled ? "on" : "off"} · {job.publication.platformCredit}
            </span>
          )}
          {job?.status === "completed" && (
            <>
              {job.technicalMaster && (
                <span>
                  Technical master: {job.technicalMaster.fileName || "technical master"} · {formatBytes(job.technicalMaster.sizeBytes)} · {job.technicalMaster.mimeType || "audio/flac"}
                </span>
              )}
              <OutputLink label="WebVTT captions" file={job.finalOutputs?.captions ?? null} />
              <OutputLink label="Final MP3" file={job.finalOutputs?.mp3 ?? null} />
              <OutputLink label="Final MP4" file={job.finalOutputs?.mp4 ?? null} />
            </>
          )}
          {job?.status === "failed" && job.failureCode && (
            <span>Failure code: {job.failureCode}. The immutable original remains unchanged.</span>
          )}

          {episodeStatus === "awaiting_render_confirmation" && job?.status !== "queued" && job?.status !== "processing" && (
            <button type="button" className="primary-action compact" onClick={() => void startRender()} disabled={busy}>
              {busy ? "Starting render…" : "Create final MP3 + MP4"}
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
