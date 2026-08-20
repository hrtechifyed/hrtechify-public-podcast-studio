export const MAX_ACTIVE_SHOWS_PER_USER = 5 as const;
export const PLATFORM_CREDIT = "Podcast Powered by HRTechify" as const;
export const PLATFORM_CREDIT_POSITION = "bottom-right" as const;

export type StorageProviderName = "google-drive" | "dropbox";

export interface ShowSummary {
  id: string;
  name: string;
  hostName: string;
  storageProvider: StorageProviderName;
  status: "active" | "archived" | "deleted";
}

export interface EpisodeSummary {
  id: string;
  showId: string;
  title: string;
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
}
