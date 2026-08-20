import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  appendRecordingChunk,
  calculateRmsAndPeak,
  chooseRecordingMimeType,
  classifyRecordingSignal,
  createRecordingSessionId,
  deleteRecordingSession,
  listRecoverableRecordingSessions,
  rebuildRecordingBlob,
  recordingExtensionForMimeType,
  saveRecordingSession,
  updateRecordingSessionState,
  type PersistedRecordingSession,
  type RecordingSignal,
} from "@hrtechify/recorder";

interface RecorderPanelProps {
  showId: string;
  showName: string;
  connectionId: string | null;
}

type PanelState = "idle" | "recording" | "paused" | "stopped" | "uploading" | "saved" | "error";

const API_CHUNK_BYTES = 8 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "video/webm",
  "video/mp4",
]);

const apiMimeType = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("audio/webm")) return "audio/webm";
  if (normalized.startsWith("video/webm")) return "video/webm";
  if (normalized.startsWith("audio/mp4")) return "audio/mp4";
  if (normalized.startsWith("video/mp4")) return "video/mp4";
  return normalized;
};

const mimeTypeFromFile = (file: File) => {
  const declared = apiMimeType(file.type || "");
  if (ALLOWED_UPLOAD_TYPES.has(declared)) return declared;
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  switch (extension) {
    case "webm": return "audio/webm";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "m4a": return "audio/x-m4a";
    case "mp4": return "audio/mp4";
    default: return declared;
  }
};

const safeEpisodeFileName = (episodeName: string, mimeType: string) => {
  const cleaned = episodeName
    .trim()
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 150) || "HRPodcast";
  return `${cleaned}.${recordingExtensionForMimeType(mimeType)}`;
};

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const friendlyUploadError = (code?: string) => {
  switch (code) {
    case "show_storage_connection_required": return "Connect Google Drive to this show before saving the original recording.";
    case "show_storage_connection_mismatch": return "This show is assigned to a different Drive account. Refresh the page and try again.";
    case "google_drive_authorization_expired":
    case "google_drive_access_token_failed": return "Google Drive needs to be reconnected before this original can be saved.";
    case "google_drive_rate_limited": return "Google Drive is temporarily rate-limiting uploads. Try again shortly.";
    case "google_drive_resumable_session_expired": return "The Drive upload session expired. Start the save again; your local recording remains available.";
    default: return code || "The original recording could not be saved to Drive.";
  }
};

export function RecorderPanel({ showId, showName, connectionId }: RecorderPanelProps) {
  const [episodeName, setEpisodeName] = useState("HRPodcast");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [signal, setSignal] = useState<RecordingSignal>("quiet");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingMimeType, setRecordingMimeType] = useState("audio/webm");
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<PersistedRecordingSession[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [savedOpenUrl, setSavedOpenUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunkIndexRef = useRef(0);
  const pendingChunkWritesRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const refreshRecoverable = async () => {
    try {
      setRecoverable(await listRecoverableRecordingSessions(showId));
    } catch {
      setRecoverable([]);
    }
  };

  useEffect(() => {
    let active = true;
    void fetch(`/api/shows/${encodeURIComponent(showId)}/preferences`, { credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { preferences?: { defaultEpisodeName?: string } } | null;
        if (active && response.ok && payload?.preferences?.defaultEpisodeName) {
          setEpisodeName(payload.preferences.defaultEpisodeName);
        }
      })
      .catch(() => undefined);
    void refreshRecoverable();
    return () => { active = false; };
  }, [showId]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    void audioContextRef.current?.close();
  }, []);

  const refreshDevices = async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((device) => device.kind === "audioinput");
    setDevices(inputs);
    if (!deviceId && inputs[0]) setDeviceId(inputs[0].deviceId);
  };

  const stopMeter = () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    setLevel(0);
  };

  const stopStream = () => {
    stopMeter();
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
  };

  const startMeter = (stream: MediaStream) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = context;
    const samples = new Float32Array(analyser.fftSize);
    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      const measurement = calculateRmsAndPeak(samples);
      setSignal(classifyRecordingSignal(measurement.rms, measurement.peak));
      setLevel(Math.min(100, Math.round(measurement.peak * 100)));
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  };

  const startTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (!startedAtRef.current || pausedAtRef.current !== null) return;
      setElapsedMs(Date.now() - startedAtRef.current - pausedTotalRef.current);
    }, 250);
  };

  const startRecording = async () => {
    setError(null);
    setNotice(null);
    setSavedOpenUrl(null);
    setRecordingBlob(null);
    setElapsedMs(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support secure microphone recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      streamRef.current = stream;
      await refreshDevices();

      const preferred = chooseRecordingMimeType();
      if (!preferred) throw new Error("This browser does not expose a supported WebM or MP4 audio recorder.");
      const recorder = new MediaRecorder(stream, { mimeType: preferred });
      const sessionId = createRecordingSessionId();
      const createdAt = new Date().toISOString();
      await saveRecordingSession({
        id: sessionId,
        showId,
        episodeName: episodeName.trim() || "HRPodcast",
        mimeType: recorder.mimeType || preferred,
        state: "recording",
        createdAt,
        updatedAt: createdAt,
        chunkCount: 0,
      });

      setLocalSessionId(sessionId);
      setRecordingMimeType(recorder.mimeType || preferred);
      chunkIndexRef.current = 0;
      pendingChunkWritesRef.current = Promise.resolve();
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        const index = chunkIndexRef.current;
        chunkIndexRef.current += 1;
        pendingChunkWritesRef.current = pendingChunkWritesRef.current.then(() =>
          appendRecordingChunk(sessionId, index, event.data),
        );
      };

      recorder.onerror = () => {
        setError("The browser recorder reported an error. Captured chunks already written locally are retained for recovery.");
        setState("error");
      };

      recorder.onstop = () => {
        void (async () => {
          try {
            await pendingChunkWritesRef.current;
            await updateRecordingSessionState(sessionId, "stopped");
            const blob = await rebuildRecordingBlob(sessionId, recorder.mimeType || preferred);
            setRecordingBlob(blob);
            setRecordingMimeType(apiMimeType(recorder.mimeType || preferred));
            setState("stopped");
            setNotice("Recording stopped. The captured original is still stored locally until Drive confirms the immutable upload.");
            await refreshRecoverable();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not rebuild the locally captured recording.");
            setState("error");
          } finally {
            stopStream();
          }
        })();
      };

      startMeter(stream);
      startedAtRef.current = Date.now();
      pausedAtRef.current = null;
      pausedTotalRef.current = 0;
      recorder.start(1000);
      startTimer();
      setState("recording");
    } catch (caught) {
      stopStream();
      setError(caught instanceof Error ? caught.message : "Microphone recording could not start.");
      setState("error");
    }
  };

  const pauseRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording" || !localSessionId) return;
    recorder.requestData();
    recorder.pause();
    pausedAtRef.current = Date.now();
    await updateRecordingSessionState(localSessionId, "paused");
    setState("paused");
  };

  const resumeRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused" || !localSessionId) return;
    if (pausedAtRef.current !== null) pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    recorder.resume();
    await updateRecordingSessionState(localSessionId, "recording");
    setState("recording");
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.requestData();
    recorder.stop();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const uploadImmutableOriginal = async (
    blob: Blob,
    mimeType: string,
    fileName: string,
    sessionIdToDelete?: string | null,
  ) => {
    if (!connectionId) throw new Error("Connect Google Drive to this show before saving the original recording.");
    const normalizedMime = apiMimeType(mimeType || blob.type || "audio/webm");
    if (!ALLOWED_UPLOAD_TYPES.has(normalizedMime)) throw new Error("This recording format is not supported for immutable storage.");
    if (blob.size <= 0) throw new Error("The recording is empty.");

    setState("uploading");
    setUploadProgress(0);
    const startResponse = await fetch("/api/storage/google-drive/files/resumable/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showId, connectionId, fileName, mimeType: normalizedMime, totalBytes: blob.size }),
    });
    const startPayload = await startResponse.json().catch(() => null) as {
      uploadToken?: string;
      maxChunkBytes?: number;
      chunkGranularityBytes?: number;
      error?: string;
    } | null;
    if (!startResponse.ok || !startPayload?.uploadToken) throw new Error(friendlyUploadError(startPayload?.error));

    const uploadToken = startPayload.uploadToken;
    const maxChunk = Math.min(startPayload.maxChunkBytes || API_CHUNK_BYTES, API_CHUNK_BYTES);
    const granularity = startPayload.chunkGranularityBytes || 256 * 1024;
    const alignedChunk = Math.max(granularity, Math.floor(maxChunk / granularity) * granularity);
    let offset = 0;
    let recoveryAttempts = 0;
    let finalOpenUrl: string | null = null;

    const readStatus = async () => {
      const response = await fetch("/api/storage/google-drive/files/resumable/status", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-hrtechify-upload-token": uploadToken },
      });
      const payload = await response.json().catch(() => null) as {
        complete?: boolean;
        nextOffset?: number | null;
        file?: { webViewLink?: string | null };
        error?: string;
      } | null;
      if (!response.ok) throw new Error(friendlyUploadError(payload?.error));
      if (payload?.complete) finalOpenUrl = payload.file?.webViewLink ?? null;
      return payload?.nextOffset ?? 0;
    };

    while (offset < blob.size) {
      const endExclusive = Math.min(offset + alignedChunk, blob.size);
      const chunk = blob.slice(offset, endExclusive, normalizedMime);
      let response: Response;
      try {
        response = await fetch("/api/storage/google-drive/files/resumable/chunk", {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "content-type": normalizedMime,
            "content-range": `bytes ${offset}-${endExclusive - 1}/${blob.size}`,
            "x-hrtechify-upload-token": uploadToken,
          },
          body: chunk,
        });
      } catch {
        if (recoveryAttempts >= 3) throw new Error("The upload was interrupted repeatedly. Your local original has been kept for retry.");
        recoveryAttempts += 1;
        offset = await readStatus();
        setUploadProgress(Math.floor((offset / blob.size) * 100));
        continue;
      }

      const payload = await response.json().catch(() => null) as {
        complete?: boolean;
        nextOffset?: number | null;
        file?: { webViewLink?: string | null };
        error?: string;
      } | null;
      if (!response.ok) {
        if ((response.status >= 500 || response.status === 429) && recoveryAttempts < 3) {
          recoveryAttempts += 1;
          offset = await readStatus();
          setUploadProgress(Math.floor((offset / blob.size) * 100));
          continue;
        }
        throw new Error(friendlyUploadError(payload?.error));
      }

      recoveryAttempts = 0;
      offset = payload?.nextOffset ?? endExclusive;
      finalOpenUrl = payload?.file?.webViewLink ?? finalOpenUrl;
      setUploadProgress(Math.min(100, Math.floor((offset / blob.size) * 100)));
      if (payload?.complete) break;
    }

    setUploadProgress(100);
    setSavedOpenUrl(finalOpenUrl);
    setState("saved");
    setNotice("Immutable original saved in this show's Drive Episodes folder. No spoken content has been changed.");
    if (sessionIdToDelete) {
      await deleteRecordingSession(sessionIdToDelete);
      if (localSessionId === sessionIdToDelete) setLocalSessionId(null);
      await refreshRecoverable();
    }
  };

  const saveCurrent = async () => {
    if (!recordingBlob) return;
    setError(null);
    try {
      await uploadImmutableOriginal(
        recordingBlob,
        recordingMimeType,
        safeEpisodeFileName(episodeName, recordingMimeType),
        localSessionId,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the original recording.");
      setState("stopped");
    }
  };

  const recoverSession = async (session: PersistedRecordingSession) => {
    setError(null);
    try {
      const blob = await rebuildRecordingBlob(session.id, session.mimeType);
      setEpisodeName(session.episodeName || "HRPodcast");
      setRecordingBlob(blob);
      setRecordingMimeType(apiMimeType(session.mimeType));
      setLocalSessionId(session.id);
      setState("stopped");
      setNotice("Recovered local recording. Review the episode name, then save the immutable original to Drive.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not recover this local recording.");
    }
  };

  const discardSession = async (sessionId: string) => {
    await deleteRecordingSession(sessionId);
    if (localSessionId === sessionId) {
      setLocalSessionId(null);
      setRecordingBlob(null);
      setState("idle");
    }
    await refreshRecoverable();
  };

  const uploadSelectedFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    const normalized = mimeTypeFromFile(file);
    if (!ALLOWED_UPLOAD_TYPES.has(normalized)) {
      setError("Use MP3, WAV, M4A, WebM or MP4 for an uploaded recording.");
      return;
    }
    try {
      const suppliedName = episodeName.trim() || file.name.replace(/\.[^.]+$/, "") || "HRPodcast";
      await uploadImmutableOriginal(file, normalized, safeEpisodeFileName(suppliedName, normalized));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the uploaded original.");
      setState("idle");
    }
  };

  return (
    <section aria-label={`${showName} recorder`} style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14 }}>
      <p className="eyebrow">New Episode</p>
      <h4 style={{ margin: "4px 0 8px" }}>Record here or upload a recording</h4>
      <p className="muted" style={{ marginTop: 0 }}>
        Recording chunks are saved locally while you speak. After Stop, the untouched original is saved to your assigned Drive before any editing or cleanup can happen.
      </p>

      <label>
        Episode name
        <input value={episodeName} onChange={(event) => setEpisodeName(event.target.value)} maxLength={160} disabled={state === "recording" || state === "paused" || state === "uploading"} />
      </label>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
        <label style={{ flex: "1 1 220px" }}>
          Microphone
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={state === "recording" || state === "paused" || state === "uploading"}>
            <option value="">Default microphone</option>
            {devices.map((device, index) => (
              <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-action compact" onClick={() => void refreshDevices()} disabled={state === "recording" || state === "paused"}>Refresh microphones</button>
      </div>

      {(state === "recording" || state === "paused") && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <strong>{state === "paused" ? "Paused" : "Recording"} · {formatDuration(elapsedMs)}</strong>
            <span className="muted">{signal === "clipping" ? "Too loud — clipping risk" : signal === "quiet" ? "Input is very quiet" : "Input level looks good"}</span>
          </div>
          <progress max={100} value={level} style={{ width: "100%", marginTop: 7 }} aria-label="Microphone input level" />
        </div>
      )}

      <div className="inline-actions" style={{ marginTop: 12 }}>
        {(state === "idle" || state === "stopped" || state === "saved" || state === "error") && (
          <button type="button" className="primary-action compact" onClick={() => void startRecording()}>Record here</button>
        )}
        {state === "recording" && <button type="button" className="secondary-action compact" onClick={() => void pauseRecording()}>Pause</button>}
        {state === "paused" && <button type="button" className="secondary-action compact" onClick={() => void resumeRecording()}>Resume</button>}
        {(state === "recording" || state === "paused") && <button type="button" className="primary-action compact" onClick={stopRecording}>Stop</button>}
        <label className="secondary-action compact" style={{ cursor: state === "uploading" ? "not-allowed" : "pointer" }}>
          Upload recording
          <input type="file" accept="audio/mpeg,audio/wav,audio/webm,audio/mp4,audio/x-m4a,video/webm,video/mp4,.webm,.mp3,.wav,.m4a,.mp4" hidden disabled={state === "recording" || state === "paused" || state === "uploading"} onChange={(event) => void uploadSelectedFile(event)} />
        </label>
      </div>

      {recordingBlob && state === "stopped" && (
        <div className="trust-note" style={{ marginTop: 12 }}>
          <strong>Local original ready · {(recordingBlob.size / (1024 * 1024)).toFixed(2)} MiB</strong>
          <span>{connectionId ? "Save it to Drive before moving to editing." : "Connect Google Drive to this show before the permanent immutable save."}</span>
          <div className="inline-actions" style={{ marginTop: 8 }}>
            <button type="button" className="primary-action compact" onClick={() => void saveCurrent()} disabled={!connectionId}>Save original to Drive</button>
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div style={{ marginTop: 12 }}>
          <strong>Saving immutable original… {uploadProgress}%</strong>
          <progress max={100} value={uploadProgress} style={{ width: "100%", marginTop: 7 }} />
        </div>
      )}

      {savedOpenUrl && <p style={{ marginTop: 10 }}><a className="text-button" href={savedOpenUrl} target="_blank" rel="noreferrer">Open original in Drive</a></p>}
      {notice && <div className="notice success" style={{ marginTop: 12 }}>{notice}</div>}
      {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}

      {recoverable.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Locally recoverable recordings ({recoverable.length})</summary>
          <div className="archived-list" style={{ marginTop: 8 }}>
            {recoverable.map((session) => (
              <article key={session.id}>
                <div>
                  <strong>{session.episodeName}</strong>
                  <span>{session.chunkCount} saved chunks · last updated {new Date(session.updatedAt).toLocaleString()}</span>
                </div>
                <div className="inline-actions">
                  <button type="button" className="secondary-action compact" onClick={() => void recoverSession(session)}>Recover</button>
                  <button type="button" className="text-button" onClick={() => void discardSession(session.id)}>Discard local copy</button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
