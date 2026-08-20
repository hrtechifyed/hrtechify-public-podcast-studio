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

// The concrete browser implementation will use MediaRecorder plus IndexedDB
// chunk persistence. This package intentionally defines the contract first.
