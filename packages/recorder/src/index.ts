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

export * from "./browser";
