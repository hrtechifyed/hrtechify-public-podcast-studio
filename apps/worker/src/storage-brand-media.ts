import type { D1DatabaseLike, WorkerEnv } from "./db";
import { listShowBrandMedia, type BrandMediaRecord } from "./google-drive-brand-media";
import { listStorageAssetsByKind } from "./storage-asset-store";
import { createStudioStorageSession } from "./studio-storage";
import type { StorageConnectionRow } from "./storage-store";

export const listStudioBrandMedia = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
  input: { showId: string; showName: string },
): Promise<BrandMediaRecord[]> => {
  if (connection.provider === "google-drive") {
    return listShowBrandMedia(env, userId, connection, input);
  }
  if (connection.provider !== "dropbox") throw new Error("storage_provider_not_supported");
  const records = await listStorageAssetsByKind(
    db,
    userId,
    input.showId,
    connection.id,
    ["show-intro-original", "show-outro-original"],
  );
  const session = await createStudioStorageSession(env, db, userId, connection);
  const output: BrandMediaRecord[] = [];
  for (const record of records) {
    if (record.asset_kind !== "show-intro-original" && record.asset_kind !== "show-outro-original") continue;
    const file = await session.getOwnedFile(input.showId, input.showName, record.provider_file_id);
    output.push({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      webViewLink: file.webViewLink,
      assetKind: record.asset_kind,
      createdTime: record.created_at,
      immutable: record.immutable === 1,
      canDownload: file.canDownload,
    });
  }
  return output;
};
