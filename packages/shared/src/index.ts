export const MAX_SHOWS_PER_USER = 5 as const;
/** @deprecated Use MAX_SHOWS_PER_USER. Kept for compatibility with earlier clients. */
export const MAX_ACTIVE_SHOWS_PER_USER = MAX_SHOWS_PER_USER;
export const MAX_MUSIC_CUES_PER_EPISODE = 3 as const;
export const PLATFORM_CREDIT = "Podcast Powered by HRTechify" as const;
export const PLATFORM_CREDIT_POSITION = "bottom-right" as const;

export type StorageProviderName = "google-drive" | "dropbox";
export type RecordingSourceKind = "upload" | "recording";
export type MusicIntensity = "very-subtle" | "subtle" | "moderately-subtle";
export type MusicPlacement = "throughout" | "interval";

export interface MusicCue {
  id: string;
  trackId: string;
  intensity: MusicIntensity;
  placement: MusicPlacement;
  startSeconds: number;
  endSeconds: number | null;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "suspended" | "deleted";
}

export interface ShowSummary {
  id: string;
  name: string;
  hostName: string;
  description?: string | null;
  storageProvider: StorageProviderName | null;
  driveShowFolderId?: string | null;
  driveEpisodesFolderId?: string | null;
  status: "active" | "archived" | "deleted";
}

export interface CreateShowRequest {
  name: string;
  hostDisplayName: string;
  description?: string;
}

export interface EpisodeSummary {
  id: string;
  showId: string;
  title: string;
  sourceKind: RecordingSourceKind;
  sourceFileName: string;
  driveEpisodeFolderId: string;
  templateId: string;
  templateVersion: number;
  musicPlan: MusicCue[];
  status:
    | "draft"
    | "source_ready"
    | "analyzing"
    | "awaiting_edit_approval"
    | "awaiting_render_confirmation"
    | "rendering"
    | "completed"
    | "failed"
    | "cancelled";
  createdAt?: string;
  updatedAt?: string;
}
