type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

type GoogleTokenClient = {
  requestAccessToken(options?: { prompt?: string }): void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: () => void;
          }): GoogleTokenClient;
        };
      };
    };
  }
}

export interface DriveFolderRef {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface DriveFileRef extends DriveFolderRef {
  mimeType?: string;
  size?: string;
}

export interface ShowDriveWorkspace {
  rootFolderId: string;
  showFolderId: string;
  episodesFolderId: string;
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const loadGoogleIdentityServices = async () => {
  if (window.google?.accounts?.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-hrtechify-google-identity="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("google_identity_script_failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.hrtechifyGoogleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("google_identity_script_failed"));
    document.head.appendChild(script);
  });
  if (!window.google?.accounts?.oauth2) throw new Error("google_identity_unavailable");
};

export const requestGoogleDriveToken = async (clientId: string) => {
  if (!clientId) throw new Error("google_drive_client_not_configured");
  await loadGoogleIdentityServices();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || "google_drive_authorization_failed"));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: () => reject(new Error("google_drive_authorization_failed")),
    });
    client.requestAccessToken({ prompt: "consent" });
  });
};

const driveFetch = async <T>(token: string, url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error(`google_drive_request_failed:${response.status}:${detail}`);
    if (response.status === 401) error.name = "GoogleDriveTokenExpired";
    throw error;
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
};

const escapeDriveQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const findFolderByProperty = async (
  token: string,
  propertyKey: string,
  propertyValue: string,
  parentId?: string,
) => {
  const parentClause = parentId ? `'${escapeDriveQuery(parentId)}' in parents and ` : "";
  const q = `${parentClause}mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='${escapeDriveQuery(propertyKey)}' and value='${escapeDriveQuery(propertyValue)}' }`;
  const params = new URLSearchParams({
    q,
    spaces: "drive",
    pageSize: "10",
    fields: "files(id,name,webViewLink)",
  });
  const payload = await driveFetch<{ files?: DriveFolderRef[] }>(
    token,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return payload.files?.[0] ?? null;
};

const findFolderByName = async (token: string, name: string, parentId: string) => {
  const q = `'${escapeDriveQuery(parentId)}' in parents and name='${escapeDriveQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const params = new URLSearchParams({ q, spaces: "drive", pageSize: "10", fields: "files(id,name,webViewLink)" });
  const payload = await driveFetch<{ files?: DriveFolderRef[] }>(
    token,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return payload.files?.[0] ?? null;
};

const createFolder = async (
  token: string,
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>,
) => {
  return driveFetch<DriveFolderRef>(token, "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
      ...(appProperties ? { appProperties } : {}),
    }),
  });
};

const safeDriveName = (value: string, fallback: string) =>
  (value.trim() || fallback)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 100);

export const ensureShowDriveWorkspace = async (
  token: string,
  show: {
    id: string;
    name: string;
    driveShowFolderId?: string | null;
    driveEpisodesFolderId?: string | null;
  },
): Promise<ShowDriveWorkspace> => {
  let root = await findFolderByProperty(token, "hrtechifyStudioRoot", "true");
  if (!root) {
    root = await createFolder(token, "HRTechify Podcast Studio", undefined, {
      hrtechifyStudioRoot: "true",
    });
  }

  let showFolder: DriveFolderRef | null = null;
  if (show.driveShowFolderId) {
    showFolder = { id: show.driveShowFolderId, name: show.name };
  } else {
    showFolder = await findFolderByProperty(token, "hrtechifyShowId", show.id, root.id);
    if (!showFolder) {
      showFolder = await createFolder(token, safeDriveName(show.name, "Podcast Show"), root.id, {
        hrtechifyShowId: show.id,
      });
    }
  }

  let episodesFolder: DriveFolderRef | null = null;
  if (show.driveEpisodesFolderId) {
    episodesFolder = { id: show.driveEpisodesFolderId, name: "Episodes" };
  } else {
    episodesFolder = await findFolderByName(token, "Episodes", showFolder.id);
    if (!episodesFolder) {
      episodesFolder = await createFolder(token, "Episodes", showFolder.id, {
        hrtechifyShowId: show.id,
        hrtechifyFolderRole: "episodes",
      });
    }
  }

  return {
    rootFolderId: root.id,
    showFolderId: showFolder.id,
    episodesFolderId: episodesFolder.id,
  };
};

export const createEpisodeDriveFolder = async (
  token: string,
  showId: string,
  episodesFolderId: string,
  episodeId: string,
  episodeTitle: string,
) => {
  const existing = await findFolderByProperty(token, "hrtechifyEpisodeId", episodeId, episodesFolderId);
  if (existing) return existing;
  const name = `${safeDriveName(episodeTitle, "Untitled Episode")} - ${episodeId.slice(0, 8)}`;
  return createFolder(token, name, episodesFolderId, {
    hrtechifyShowId: showId,
    hrtechifyEpisodeId: episodeId,
  });
};

export const uploadBlobResumable = async (
  token: string,
  parentId: string,
  name: string,
  blob: Blob,
  onProgress?: (progress: number) => void,
): Promise<DriveFileRef> => {
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": blob.type || "application/octet-stream",
        "x-upload-content-length": String(blob.size),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );
  if (!init.ok) throw new Error(`google_drive_upload_start_failed:${init.status}:${(await init.text()).slice(0, 300)}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("google_drive_upload_url_missing");

  return new Promise<DriveFileRef>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("google_drive_upload_network_error"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as DriveFileRef);
      } else {
        reject(new Error(`google_drive_upload_failed:${xhr.status}:${xhr.responseText.slice(0, 300)}`));
      }
    };
    xhr.send(blob);
  });
};

export const uploadEpisodeMetadata = async (
  token: string,
  episodeFolderId: string,
  metadata: unknown,
) => {
  const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
  return uploadBlobResumable(token, episodeFolderId, "episode-metadata.json", blob);
};

export const driveFolderUrl = (folderId?: string | null) =>
  folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` : "";
