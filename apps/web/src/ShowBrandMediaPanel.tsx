import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { RecorderPanel } from "./RecorderPanel";

type BrandMediaKind = "show-intro-original" | "show-outro-original";

interface BrandMediaRecord {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webViewLink: string | null;
  assetKind: BrandMediaKind;
  createdTime: string | null;
  immutable: boolean;
  canDownload: boolean;
}

interface ShowBrandMediaPanelProps {
  showId: string;
  showName: string;
  connectionId: string;
}

const MAX_BYTES = 500 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RECOVERY_ATTEMPTS = 3;
const SUPPORTED_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "video/webm",
  "video/mp4",
]);

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const friendlyError = (code?: string) => {
  switch (code) {
    case "brand_media_mime_type_not_allowed": return "Use MP3, WAV, M4A, WebM or MP4 media.";
    case "brand_media_too_large": return "Intro/outro media must be 500 MiB or smaller.";
    case "google_drive_resumable_session_expired": return "The Drive upload session expired. Choose the file again to restart safely.";
    case "brand_media_upload_token_expired": return "The protected upload session expired. Choose the file again.";
    case "google_drive_rate_limited": return "Google Drive is temporarily rate-limiting uploads. Try again shortly.";
    default: return code || "The intro/outro upload could not be completed.";
  }
};

export function ShowBrandMediaPanel({ showId, showName, connectionId }: ShowBrandMediaPanelProps) {
  const [media, setMedia] = useState<BrandMediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKind, setUploadingKind] = useState<BrandMediaKind | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const intro = useMemo(() => media.find((item) => item.assetKind === "show-intro-original") ?? null, [media]);
  const outro = useMemo(() => media.find((item) => item.assetKind === "show-outro-original") ?? null, [media]);

  const loadMedia = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/branding/media", window.location.origin);
      url.searchParams.set("showId", showId);
      url.searchParams.set("connectionId", connectionId);
      const response = await fetch(url.toString(), { credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as { media?: BrandMediaRecord[]; error?: string } | null;
      if (!response.ok) throw new Error(friendlyError(payload?.error));
      setMedia(payload?.media ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load intro/outro media.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMedia(); }, [showId, connectionId]);

  const queryResumeOffset = async (uploadToken: string) => {
    const response = await fetch("/api/branding/media/resumable/status", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-hrtechify-brand-upload-token": uploadToken },
    });
    const payload = await response.json().catch(() => null) as { complete?: boolean; nextOffset?: number | null; error?: string } | null;
    if (!response.ok) throw new Error(friendlyError(payload?.error));
    return payload?.nextOffset ?? 0;
  };

  const sendFile = async (file: File, assetKind: BrandMediaKind) => {
    const startResponse = await fetch("/api/branding/media/resumable/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        showId,
        connectionId,
        assetKind,
        fileName: file.name,
        mimeType: file.type,
        totalBytes: file.size,
      }),
    });
    const startPayload = await startResponse.json().catch(() => null) as { uploadToken?: string; nextOffset?: number; error?: string } | null;
    if (!startResponse.ok || !startPayload?.uploadToken) throw new Error(friendlyError(startPayload?.error));

    const uploadToken = startPayload.uploadToken;
    let offset = startPayload.nextOffset ?? 0;
    let recoveryAttempts = 0;
    while (offset < file.size) {
      const endExclusive = Math.min(offset + CHUNK_BYTES, file.size);
      const chunk = file.slice(offset, endExclusive, file.type);
      let response: Response;
      try {
        response = await fetch("/api/branding/media/resumable/chunk", {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "content-type": file.type,
            "content-range": `bytes ${offset}-${endExclusive - 1}/${file.size}`,
            "x-hrtechify-brand-upload-token": uploadToken,
          },
          body: chunk,
        });
      } catch {
        if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) throw new Error("The intro/outro upload was interrupted repeatedly. Choose the file again to retry safely.");
        recoveryAttempts += 1;
        offset = await queryResumeOffset(uploadToken);
        setProgress(Math.floor((offset / file.size) * 100));
        continue;
      }

      const payload = await response.json().catch(() => null) as { complete?: boolean; nextOffset?: number | null; error?: string } | null;
      if (!response.ok) {
        if ((response.status >= 500 || response.status === 429) && recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
          recoveryAttempts += 1;
          offset = await queryResumeOffset(uploadToken);
          setProgress(Math.floor((offset / file.size) * 100));
          continue;
        }
        throw new Error(friendlyError(payload?.error));
      }
      recoveryAttempts = 0;
      offset = payload?.nextOffset ?? endExclusive;
      setProgress(Math.min(100, Math.floor((offset / file.size) * 100)));
      if (payload?.complete) break;
    }
  };

  const upload = async (assetKind: BrandMediaKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setNotice(null);
    if (!SUPPORTED_TYPES.has(file.type)) {
      setError("Use MP3, WAV, M4A, WebM or MP4 media.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setError("The media file must be larger than zero bytes and 500 MiB or smaller.");
      return;
    }

    setUploadingKind(assetKind);
    setProgress(0);
    try {
      await sendFile(file, assetKind);
      setProgress(100);
      setNotice(`${assetKind === "show-intro-original" ? "Intro" : "Outro"} original saved for ${showName}. Previous originals remain unchanged.`);
      await loadMedia();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The intro/outro upload could not be completed.");
    } finally {
      setUploadingKind(null);
    }
  };

  const control = (title: string, kind: BrandMediaKind, current: BrandMediaRecord | null) => (
    <div style={{ flex: "1 1 230px" }}>
      <strong>{title}</strong>
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        {current ? `${current.name} · ${formatBytes(current.sizeBytes)}` : `No ${title.toLowerCase()} uploaded yet.`}
      </p>
      <div className="inline-actions">
        <label className="secondary-action compact" style={{ cursor: uploadingKind ? "not-allowed" : "pointer" }}>
          {uploadingKind === kind ? `Uploading… ${progress}%` : current ? "Upload a new original" : `Upload ${title.toLowerCase()}`}
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/webm,audio/mp4,audio/x-m4a,video/webm,video/mp4"
            hidden
            disabled={Boolean(uploadingKind)}
            onChange={(event) => void upload(kind, event)}
          />
        </label>
        {current?.webViewLink && <a className="text-button" href={current.webViewLink} target="_blank" rel="noreferrer">Open in Drive</a>}
      </div>
    </div>
  );

  return (
    <>
      <section style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14 }} aria-label={`${showName} intro and outro`}>
        <strong>Intro & outro media</strong>
        <p className="muted" style={{ margin: "5px 0 12px" }}>Original media stays unchanged in your Drive. Interrupted uploads automatically check Drive and resume from the confirmed byte position.</p>
        {loading ? <p className="muted">Loading intro/outro…</p> : (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {control("Intro", "show-intro-original", intro)}
            {control("Outro", "show-outro-original", outro)}
          </div>
        )}
        {uploadingKind && <progress max={100} value={progress} style={{ width: "100%", marginTop: 12 }} />}
        {notice && <div className="notice success" style={{ marginTop: 12 }}>{notice}</div>}
        {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
        {media.length > 2 && <details style={{ marginTop: 12 }}><summary>Previous intro/outro originals ({media.length - 2})</summary></details>}
      </section>

      <RecorderPanel showId={showId} showName={showName} connectionId={connectionId} />
    </>
  );
}
