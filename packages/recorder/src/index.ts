export type RecordingState =
  | "idle"
  | "requesting_permission"
  | "ready"
  | "recording"
  | "paused"
  | "stopped"
  | "recoverable"
  | "error";

export interface RecordingSession {
  id: string;
  state: RecordingState;
  mimeType?: string;
  startedAt?: string;
  durationMs: number;
  chunkCount: number;
}

export interface RecorderDevice {
  deviceId: string;
  label: string;
}

export interface RecordingResult {
  session: RecordingSession;
  blob: Blob;
  fileName: string;
}

type StoredChunk = {
  sessionId: string;
  sequence: number;
  blob: Blob;
};

const DB_NAME = "hrtechify-podcast-recorder";
const DB_VERSION = 1;
const STORE_NAME = "chunks";

const openChunkDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("recorder_storage_open_failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: ["sessionId", "sequence"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const persistChunk = async (chunk: StoredChunk) => {
  const db = await openChunkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(chunk);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("recorder_chunk_write_failed"));
  });
  db.close();
};

const readChunks = async (sessionId: string) => {
  const db = await openChunkDb();
  const chunks = await new Promise<StoredChunk[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const request = transaction.objectStore(STORE_NAME).getAll(range);
    request.onsuccess = () => resolve((request.result as StoredChunk[]).sort((a, b) => a.sequence - b.sequence));
    request.onerror = () => reject(request.error ?? new Error("recorder_chunk_read_failed"));
  });
  db.close();
  return chunks;
};

const clearChunks = async (sessionId: string) => {
  const db = await openChunkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const cursor = store.openCursor(range);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      current.delete();
      current.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("recorder_chunk_clear_failed"));
  });
  db.close();
};

const preferredMimeType = () => {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
};

const extensionForMime = (mimeType: string) => {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
};

export class BrowserPodcastRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private session: RecordingSession = {
    id: "",
    state: "idle",
    durationMs: 0,
    chunkCount: 0,
  };
  private startedAtMs = 0;
  private pausedAtMs = 0;
  private pausedDurationMs = 0;
  private sequence = 0;
  private persistenceChain = Promise.resolve();
  private stateListener?: (session: RecordingSession) => void;

  constructor(listener?: (session: RecordingSession) => void) {
    this.stateListener = listener;
  }

  get snapshot() {
    return { ...this.session };
  }

  private publish(state?: RecordingState) {
    if (state) this.session.state = state;
    if (this.startedAtMs && ["recording", "paused", "stopped"].includes(this.session.state)) {
      const now = this.session.state === "paused" ? this.pausedAtMs : Date.now();
      this.session.durationMs = Math.max(0, now - this.startedAtMs - this.pausedDurationMs);
    }
    this.stateListener?.({ ...this.session });
  }

  async listInputDevices(): Promise<RecorderDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
  }

  async start(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("browser_recording_not_supported");
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      throw new Error("recording_already_in_progress");
    }

    this.session = {
      id: crypto.randomUUID(),
      state: "requesting_permission",
      durationMs: 0,
      chunkCount: 0,
    };
    this.publish();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });

    const mimeType = preferredMimeType();
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 160_000 })
      : new MediaRecorder(this.stream, { audioBitsPerSecond: 160_000 });
    this.session.mimeType = this.recorder.mimeType || mimeType || "audio/webm";
    this.sequence = 0;
    this.startedAtMs = Date.now();
    this.pausedAtMs = 0;
    this.pausedDurationMs = 0;
    this.persistenceChain = clearChunks(this.session.id).catch(() => undefined);

    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const sequence = this.sequence++;
      this.session.chunkCount += 1;
      this.persistenceChain = this.persistenceChain
        .then(() => persistChunk({ sessionId: this.session.id, sequence, blob: event.data }))
        .catch(() => undefined);
      this.publish();
    };

    this.recorder.onerror = () => this.publish("error");
    this.recorder.start(2_000);
    this.publish("recording");
    return this.snapshot;
  }

  pause() {
    if (!this.recorder || this.recorder.state !== "recording") return;
    this.recorder.pause();
    this.pausedAtMs = Date.now();
    this.publish("paused");
  }

  resume() {
    if (!this.recorder || this.recorder.state !== "paused") return;
    this.pausedDurationMs += Math.max(0, Date.now() - this.pausedAtMs);
    this.pausedAtMs = 0;
    this.recorder.resume();
    this.publish("recording");
  }

  async stop(): Promise<RecordingResult> {
    if (!this.recorder || this.recorder.state === "inactive") {
      throw new Error("no_recording_in_progress");
    }

    const recorder = this.recorder;
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.requestData();
    recorder.stop();
    await stopped;
    await this.persistenceChain;

    if (this.pausedAtMs) {
      this.pausedDurationMs += Math.max(0, Date.now() - this.pausedAtMs);
      this.pausedAtMs = 0;
    }
    this.publish("stopped");

    const chunks = await readChunks(this.session.id);
    const mimeType = this.session.mimeType || recorder.mimeType || "audio/webm";
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: mimeType });
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;

    return {
      session: this.snapshot,
      blob,
      fileName: `podcast-recording-${this.session.id.slice(0, 8)}.${extensionForMime(mimeType)}`,
    };
  }

  async recover(sessionId: string, mimeType = "audio/webm"): Promise<RecordingResult | null> {
    const chunks = await readChunks(sessionId);
    if (!chunks.length) return null;
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: mimeType });
    const session: RecordingSession = {
      id: sessionId,
      state: "recoverable",
      mimeType,
      durationMs: 0,
      chunkCount: chunks.length,
    };
    return {
      session,
      blob,
      fileName: `recovered-podcast-recording-${sessionId.slice(0, 8)}.${extensionForMime(mimeType)}`,
    };
  }

  async discard(sessionId = this.session.id) {
    if (sessionId) await clearChunks(sessionId);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.session = { id: "", state: "idle", durationMs: 0, chunkCount: 0 };
    this.publish();
  }
}
