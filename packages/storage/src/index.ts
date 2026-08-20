import type { StorageProviderName } from "@hrtechify/shared";

export interface StorageObjectRef {
  provider: StorageProviderName;
  providerFileId: string;
  providerPath: string;
  mimeType?: string;
  checksum?: string;
}

export interface ShowStorageWorkspace {
  showId: string;
  provider: StorageProviderName;
  rootFolderRef: string;
  showFolderRef: string;
  episodesFolderRef: string;
}

export interface EpisodeStorageWorkspace {
  showId: string;
  episodeId: string;
  provider: StorageProviderName;
  showFolderRef: string;
  episodeFolderRef: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  ensureShowWorkspace(showId: string, showName: string): Promise<ShowStorageWorkspace>;
  ensureEpisodeWorkspace(
    showWorkspace: ShowStorageWorkspace,
    episodeId: string,
    episodeName: string,
  ): Promise<EpisodeStorageWorkspace>;
  writeOutput(
    workspace: ShowStorageWorkspace | EpisodeStorageWorkspace,
    relativePath: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer,
    contentType: string,
  ): Promise<StorageObjectRef>;
  getOpenUrl(object: StorageObjectRef): Promise<string>;
}

export const GOOGLE_DRIVE_FOLDER_LAYOUT = {
  root: "HRTechify Podcast Studio",
  episodes: "Episodes",
  originalPrefix: "original-",
  metadataFileName: "episode-metadata.json",
} as const;

export const episodeDriveFolderName = (episodeTitle: string, episodeId: string) => {
  const safe = episodeTitle
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90) || "Untitled Episode";
  return `${safe} - ${episodeId.slice(0, 8)}`;
};
