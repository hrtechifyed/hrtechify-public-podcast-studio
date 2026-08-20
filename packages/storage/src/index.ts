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
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  ensureShowWorkspace(showId: string, showName: string): Promise<ShowStorageWorkspace>;
  writeOutput(
    workspace: ShowStorageWorkspace,
    relativePath: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer,
    contentType: string,
  ): Promise<StorageObjectRef>;
  getOpenUrl(object: StorageObjectRef): Promise<string>;
}
