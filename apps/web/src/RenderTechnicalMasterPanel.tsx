import { useEffect, useState } from "react";
import { renderPodcastOnDevice, type BrowserRenderManifest, type BrowserRenderResult } from "./browser-renderer";

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

interface LocalDownloads {
  technicalMaster: string;
  captions: string;
  mp3: string;
  mp4: string;
}

const formatBytes = (bytes: number | null) => {
  if (!bytes) return "size unavailable";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const jobLabel = (job: RenderJob | null) => {
  if (!job) return "No final generation has been started.";
  if (job.status === "queued") return "Ready for on-device generation.";
  if (job.status === "processing") return "On-device generation is ready or in progress.";
  if (job.status === "completed") return "Final podcast outputs created.";
  if (job.status === "failed") return "Final generation needs attention.";
  return "Generation cancelled.";
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

const createLocalDownloads = (result: BrowserRenderResult): LocalDownloads => ({
  technicalMaster: URL.createObjectURL(result.technicalMaster),
  captions: URL.createObjectURL(result.captions),
  mp3: URL.createObjectURL(result.mp3),
  mp4: URL.createObjectURL(result.mp4),
});

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
  const [showDeviceNotice, setShowDeviceNotice] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [localDownloads, setLocalDownloads] = useState<LocalDownloads | null>(null);
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
      if (!response.ok) throw new Error(payload?.error || "Could not load final-generation status.");
      setSchemaReady(true);
      setJob(payload?.job ?? null);
      if (payload?.episodeStatus) onStatusChange?.(payload.episodeStatus);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load final-generation status.");
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
    return () => {
      if (!localDownloads) return;
      Object.values(localDownloads).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [localDownloads]);

  const uploadArtifact = async (jobId: string, kind: string, blob: Blob) => {
    const response = await fetch(
      `/api/episodes/${encodeURIComponent(episodeId)}/render/artifacts/${encodeURIComponent(kind)}?jobId=${encodeURIComponent(jobId)}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": blob.type,
          "x-hrtechify-file-size": String(blob.size),
        },
        body: blob,
      },
    );
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || `Could not save ${kind}.`);
  };

  const reportFailure = async (jobId: string, code: "browser_render_failed" | "browser_upload_failed" | "browser_renderer_unavailable") => {
    await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/render/fail`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, code }),
    }).catch(() => undefined);
  };

  const startRender = async () => {
    setShowDeviceNotice(false);
    setBusy(true);
    setError(null);
    setWarnings([]);
    setProgress("Preparing on-device generation…");
    let activeJobId = "";
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/render`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        job?: RenderJob;
        episodeStatus?: string;
        browserRender?: BrowserRenderManifest;
        processingMode?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.job || !payload.browserRender || payload.processingMode !== "local-browser") {
        throw new Error(payload?.error || "Could not prepare on-device generation.");
      }
      activeJobId = payload.job.id;
      setJob(payload.job);
      if (payload.episodeStatus) onStatusChange?.(payload.episodeStatus);

      const result = await renderPodcastOnDevice(payload.browserRender, setProgress);
      setWarnings(result.warnings);
      setLocalDownloads((previous) => {
        if (previous) Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
        return createLocalDownloads(result);
      });

      setProgress("Saving the generated files to your connected storage…");
      try {
        await uploadArtifact(activeJobId, "derived-technical-master", result.technicalMaster);
        await uploadArtifact(activeJobId, "final-captions-vtt", result.captions);
        await uploadArtifact(activeJobId, "final-podcast-mp3", result.mp3);
        await uploadArtifact(activeJobId, "final-podcast-mp4", result.mp4);
      } catch (uploadError) {
        await reportFailure(activeJobId, "browser_upload_failed");
        throw uploadError;
      }

      const complete = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/render/complete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      const completed = await complete.json().catch(() => null) as {
        job?: RenderJob;
        episodeStatus?: string;
        error?: string;
      } | null;
      if (!complete.ok || !completed?.job) throw new Error(completed?.error || "Could not finish final-generation tracking.");
      setJob(completed.job);
      if (completed.episodeStatus) onStatusChange?.(completed.episodeStatus);
      setProgress("Generation complete. Your files are saved in your connected storage.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "On-device generation failed.";
      setError(message);
      if (activeJobId && !message.includes("save") && !message.includes("upload")) {
        await reportFailure(activeJobId, message.includes("renderer") ? "browser_renderer_unavailable" : "browser_render_failed");
      }
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  if (episodeStatus === "source_ready" || episodeStatus === "analyzing" || episodeStatus === "awaiting_edit_approval") {
    return null;
  }

  const canGenerate = episodeStatus === "awaiting_render_confirmation" || job?.status === "queued" || job?.status === "processing";

  return (
    <div className="trust-note" style={{ marginTop: 10 }}>
      <strong>Final episode outputs for {episodeTitle}</strong>
      <span>
        Final generation happens on your device. HRTechify prepares the approved plan, then your browser creates the technical master, WebVTT captions, MP3 and MP4. Your original recording is never overwritten or replaced.
      </span>
      <span>
        Only edit ranges you explicitly marked “Apply in final edit” are removed. Your current immutable show intro and outro are included when they can be converted locally. Technical cleanup preserves words, pitch and speaking speed outside those approved cuts.
      </span>
      <span>
        The video uses the saved curated template. “Powered by HRTechify” remains mandatory. Processing speed depends on the computer, available memory and browser being used.
      </span>

      {!loaded ? (
        <span>Checking final-generation status…</span>
      ) : !schemaReady ? (
        <span>Final-generation tracking is not enabled in the database yet. No processing can start.</span>
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

          {canGenerate && (
            <button type="button" className="primary-action compact" onClick={() => setShowDeviceNotice(true)} disabled={busy}>
              {busy ? "Generating on this device…" : job?.status === "processing" ? "Resume generation on this device" : "Create final MP3 + MP4"}
            </button>
          )}
        </>
      )}

      {progress && <div className="notice" style={{ marginTop: 8 }}>{progress}</div>}
      {warnings.map((warning) => <div key={warning} className="notice" style={{ marginTop: 8 }}>{warning}</div>)}

      {localDownloads && job?.status !== "completed" && (
        <div className="notice" style={{ marginTop: 8 }}>
          <strong>Your generated files are still available on this device.</strong>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <a href={localDownloads.captions} download={`final-captions-${episodeId}.vtt`}>Download WebVTT</a>
            <a href={localDownloads.mp3} download={`final-podcast-${episodeId}.mp3`}>Download MP3</a>
            <a href={localDownloads.mp4} download={`final-podcast-${episodeId}.mp4`}>Download MP4</a>
            <a href={localDownloads.technicalMaster} download={`technical-master-${episodeId}.flac`}>Download technical master</a>
          </div>
        </div>
      )}

      {showDeviceNotice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="On-device generation notice"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.62)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div className="show-form-card" style={{ maxWidth: 520, width: "100%", margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Generation happens on this device</h2>
            <p style={{ lineHeight: 1.65 }}>
              Final processing will run on your computer, not on HRTechify&apos;s servers. Speed depends on your computer, available memory and browser. Keep this tab open until it finishes.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="secondary-action compact" onClick={() => setShowDeviceNotice(false)}>Cancel</button>
              <button type="button" className="primary-action compact" onClick={() => void startRender()}>Continue generation</button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="notice error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
