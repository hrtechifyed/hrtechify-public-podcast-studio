export interface DriveFilePolicyInput {
  id: string;
  name: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
  capabilities?: {
    canDownload?: boolean;
  };
}

export type DriveFileReadRoute =
  | { kind: "metadata"; fileId: string }
  | { kind: "download"; fileId: string };

const FILE_ROUTE_PREFIX = "/api/storage/google-drive/files/";

export const parseDriveFileReadRoute = (pathname: string): DriveFileReadRoute | null => {
  if (!pathname.startsWith(FILE_ROUTE_PREFIX)) return null;

  const remainder = pathname.slice(FILE_ROUTE_PREFIX.length);
  const segments = remainder.split("/");
  if (segments.length < 1 || segments.length > 2) return null;
  if (!segments[0] || segments[0] === "small") return null;
  if (segments.length === 2 && segments[1] !== "download") return null;

  let fileId: string;
  try {
    fileId = decodeURIComponent(segments[0]);
  } catch {
    return null;
  }

  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) return null;

  return {
    kind: segments.length === 2 ? "download" : "metadata",
    fileId,
  };
};

export const isOwnedShowAsset = (
  file: DriveFilePolicyInput,
  showId: string,
  expectedParentId: string,
) => {
  if (file.trashed === true) return false;
  const properties = file.appProperties ?? {};
  if (properties.hrtechifyStudio !== "v1") return false;
  if (properties.role !== "asset") return false;
  if (properties.showId !== showId) return false;
  if (properties.folder !== "brand-assets" && properties.folder !== "episodes") return false;
  if (!(file.parents ?? []).includes(expectedParentId)) return false;
  return true;
};

export const canDownloadOwnedAsset = (file: DriveFilePolicyInput) =>
  file.capabilities?.canDownload === true;

const asciiFallbackName = (fileName: string) => {
  const normalized = fileName
    .replace(/[\r\n]/g, " ")
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .trim();
  return normalized || "download";
};

export const attachmentContentDisposition = (fileName: string) => {
  const fallback = asciiFallbackName(fileName);
  const encoded = encodeURIComponent(fileName.replace(/[\r\n]/g, " "))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
