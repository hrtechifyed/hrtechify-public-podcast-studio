export type RecordingSignal = "quiet" | "good" | "clipping";

export interface PersistedRecordingSession {
  id: string;
  showId: string;
  episodeName: string;
  mimeType: string;
  state: "recording" | "paused" | "stopped";
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

interface PersistedRecordingChunk {
  key: string;
  sessionId: string;
  index: number;
  blob: Blob;
}

const DB_NAME = "hrtechify-podcast-recorder";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const CHUNK_STORE = "chunks";

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_request_failed"));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb_transaction_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb_transaction_aborted"));
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_not_available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("showId", "showId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        chunks.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
  });

const getRecordingSession = async (database: IDBDatabase, sessionId: string) => {
  const transaction = database.transaction(SESSION_STORE, "readonly");
  const session = await requestResult(transaction.objectStore(SESSION_STORE).get(sessionId)) as PersistedRecordingSession | undefined;
  await transactionDone(transaction);
  return session;
};

const getChunkKeys = async (database: IDBDatabase, sessionId: string) => {
  const transaction = database.transaction(CHUNK_STORE, "readonly");
  const index = transaction.objectStore(CHUNK_STORE).index("sessionId");
  const keys = await requestResult(index.getAllKeys(sessionId));
  await transactionDone(transaction);
  return keys;
};

export const createRecordingSessionId = () => crypto.randomUUID();

export const chooseRecordingMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
};

export const recordingExtensionForMimeType = (mimeType: string) => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg")) return "mp3";
  return "webm";
};

export const classifyRecordingSignal = (rms: number, peak: number): RecordingSignal => {
  if (peak >= 0.985) return "clipping";
  if (rms < 0.018) return "quiet";
  return "good";
};

export const calculateRmsAndPeak = (samples: Float32Array) => {
  if (samples.length === 0) return { rms: 0, peak: 0 };
  let sumSquares = 0;
  let peak = 0;
  for (const value of samples) {
    const absolute = Math.abs(value);
    sumSquares += value * value;
    if (absolute > peak) peak = absolute;
  }
  return { rms: Math.sqrt(sumSquares / samples.length), peak };
};

export const saveRecordingSession = async (session: PersistedRecordingSession) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put(session);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

export const appendRecordingChunk = async (
  sessionId: string,
  index: number,
  blob: Blob,
) => {
  if (blob.size === 0) return;
  const database = await openDatabase();
  try {
    const session = await getRecordingSession(database, sessionId);
    if (!session) throw new Error("recording_session_not_found");

    const chunk: PersistedRecordingChunk = {
      key: `${sessionId}:${String(index).padStart(10, "0")}`,
      sessionId,
      index,
      blob,
    };
    const transaction = database.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(CHUNK_STORE).put(chunk);
    transaction.objectStore(SESSION_STORE).put({
      ...session,
      chunkCount: Math.max(session.chunkCount, index + 1),
      updatedAt: new Date().toISOString(),
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

export const updateRecordingSessionState = async (
  sessionId: string,
  state: PersistedRecordingSession["state"],
) => {
  const database = await openDatabase();
  try {
    const session = await getRecordingSession(database, sessionId);
    if (!session) throw new Error("recording_session_not_found");
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put({
      ...session,
      state,
      updatedAt: new Date().toISOString(),
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

export const listRecoverableRecordingSessions = async (showId: string) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const index = transaction.objectStore(SESSION_STORE).index("showId");
    const sessions = await requestResult(index.getAll(showId)) as PersistedRecordingSession[];
    await transactionDone(transaction);
    return sessions
      .filter((session) => session.chunkCount > 0)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
};

export const rebuildRecordingBlob = async (sessionId: string, mimeType: string) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHUNK_STORE, "readonly");
    const index = transaction.objectStore(CHUNK_STORE).index("sessionId");
    const chunks = await requestResult(index.getAll(sessionId)) as PersistedRecordingChunk[];
    await transactionDone(transaction);
    chunks.sort((left, right) => left.index - right.index);
    if (chunks.length === 0) throw new Error("recording_chunks_not_found");
    return new Blob(chunks.map((chunk) => chunk.blob), { type: mimeType || "audio/webm" });
  } finally {
    database.close();
  }
};

export const deleteRecordingSession = async (sessionId: string) => {
  const database = await openDatabase();
  try {
    const keys = await getChunkKeys(database, sessionId);
    const transaction = database.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(SESSION_STORE).delete(sessionId);
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    for (const key of keys) chunkStore.delete(key);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};
