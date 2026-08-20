export const MAX_ACTIVE_SHOWS_PER_USER = 5 as const;
export const PLATFORM_CREDIT = "Powered by HRTechify" as const;
export const PLATFORM_CREDIT_POSITION = "bottom-right" as const;

export const HRTECHIFY_STARTER_SHOW_NAME = "The HRTechify Show" as const;
export const HRTECHIFY_STARTER_HOST_NAME = "HRTechify" as const;
export const HRTECHIFY_STARTER_EPISODE_NAME = "HRPodcast" as const;
export const HRTECHIFY_LOGO_URL = "https://hrtechify.com/assets/hrtechify-logo.png" as const;

export type StorageProviderName = "google-drive" | "dropbox";

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
