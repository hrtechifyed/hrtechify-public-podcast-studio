import { HRTECHIFY_LOGO_URL } from "@hrtechify/shared";
import type { WorkerEnv } from "./db";
import {
  createBrandSelectionMarker,
  listShowBrandAssets,
  uploadOriginalBrandAsset,
} from "./google-drive-branding";
import { GoogleDriveError } from "./google-drive";
import { ensureUserOnboarding } from "./onboarding";
import type { ShowRow } from "./shows";
import type { StorageConnectionRow } from "./storage-store";

const MAX_STARTER_LOGO_BYTES = 8 * 1024 * 1024;

const fetchOfficialLogo = async () => {
  let response: Response;
  try {
    response = await fetch(HRTECHIFY_LOGO_URL, { redirect: "follow" });
  } catch {
    throw new GoogleDriveError("starter_branding_source_unavailable", 503);
  }
  if (!response.ok) throw new GoogleDriveError("starter_branding_source_unavailable", 503);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "image/png") {
    throw new GoogleDriveError("starter_branding_source_invalid", 502);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_STARTER_LOGO_BYTES) {
    throw new GoogleDriveError("starter_branding_source_too_large", 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STARTER_LOGO_BYTES) {
    throw new GoogleDriveError("starter_branding_source_invalid", 502);
  }
  return bytes;
};

export const ensureStarterBrandAssets = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  show: ShowRow,
) => {
  if (!env.DB) return { starter: false, created: [] as string[] };
  const onboarding = await ensureUserOnboarding(env.DB, userId);
  if (onboarding.starterShowId !== show.id) {
    return { starter: false, created: [] as string[] };
  }

  const existing = await listShowBrandAssets(env, userId, connection, {
    showId: show.id,
    showName: show.name,
  });
  const hasLogo = existing.some((asset) => asset.assetKind === "show-logo-original");
  const hasProfile = existing.some((asset) => asset.assetKind === "profile-photo-original");
  if (hasLogo && hasProfile) return { starter: true, created: [] as string[] };

  const bytes = await fetchOfficialLogo();
  const created: string[] = [];

  if (!hasLogo) {
    const logo = await uploadOriginalBrandAsset(env, userId, connection, {
      showId: show.id,
      showName: show.name,
      assetKind: "show-logo-original",
      fileName: "hrtechify-logo.png",
      mimeType: "image/png",
      bytes,
    });
    await createBrandSelectionMarker(env, userId, connection, {
      showId: show.id,
      showName: show.name,
      sourceAssetId: logo.id,
      sourceAssetKind: "show-logo-original",
      selectedAssetId: logo.id,
      choice: "original",
    });
    created.push(logo.id);
  }

  if (!hasProfile) {
    const profile = await uploadOriginalBrandAsset(env, userId, connection, {
      showId: show.id,
      showName: show.name,
      assetKind: "profile-photo-original",
      fileName: "hrtechify-profile.png",
      mimeType: "image/png",
      bytes,
    });
    await createBrandSelectionMarker(env, userId, connection, {
      showId: show.id,
      showName: show.name,
      sourceAssetId: profile.id,
      sourceAssetKind: "profile-photo-original",
      selectedAssetId: profile.id,
      choice: "original",
    });
    created.push(profile.id);
  }

  return { starter: true, created };
};
