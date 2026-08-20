import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentContentDisposition,
  canDownloadOwnedAsset,
  isOwnedShowAsset,
  parseDriveFileReadRoute,
  type DriveFilePolicyInput,
} from "../apps/worker/src/drive-file-policy";

const ownedFile = (): DriveFilePolicyInput => ({
  id: "file_123",
  name: "episode.webm",
  trashed: false,
  parents: ["episodes-folder"],
  appProperties: {
    hrtechifyStudio: "v1",
    role: "asset",
    showId: "show-1",
    folder: "episodes",
  },
  capabilities: { canDownload: true },
});

test("parses metadata and download routes but not reserved or malformed paths", () => {
  assert.deepEqual(
    parseDriveFileReadRoute("/api/storage/google-drive/files/abc_DEF-123"),
    { kind: "metadata", fileId: "abc_DEF-123" },
  );
  assert.deepEqual(
    parseDriveFileReadRoute("/api/storage/google-drive/files/abc_DEF-123/download"),
    { kind: "download", fileId: "abc_DEF-123" },
  );
  assert.equal(parseDriveFileReadRoute("/api/storage/google-drive/files/small"), null);
  assert.equal(parseDriveFileReadRoute("/api/storage/google-drive/files/a%2Fb"), null);
  assert.equal(parseDriveFileReadRoute("/api/storage/google-drive/files/abc/preview"), null);
  assert.equal(parseDriveFileReadRoute("/api/storage/google-drive/files/abc/extra/download"), null);
});

test("accepts only an HRTechify asset for the expected show and physical parent folder", () => {
  assert.equal(isOwnedShowAsset(ownedFile(), "show-1", "episodes-folder"), true);
  assert.equal(isOwnedShowAsset(ownedFile(), "show-2", "episodes-folder"), false);
  assert.equal(isOwnedShowAsset(ownedFile(), "show-1", "different-parent"), false);
});

test("rejects copied, forged, incomplete, or trashed ownership metadata", () => {
  assert.equal(
    isOwnedShowAsset({ ...ownedFile(), appProperties: { ...ownedFile().appProperties, hrtechifyStudio: "v2" } }, "show-1", "episodes-folder"),
    false,
  );
  assert.equal(
    isOwnedShowAsset({ ...ownedFile(), appProperties: { ...ownedFile().appProperties, role: "show" } }, "show-1", "episodes-folder"),
    false,
  );
  assert.equal(
    isOwnedShowAsset({ ...ownedFile(), appProperties: { ...ownedFile().appProperties, folder: "templates" } }, "show-1", "episodes-folder"),
    false,
  );
  assert.equal(isOwnedShowAsset({ ...ownedFile(), appProperties: undefined }, "show-1", "episodes-folder"), false);
  assert.equal(isOwnedShowAsset({ ...ownedFile(), trashed: true }, "show-1", "episodes-folder"), false);
});

test("download requires an explicit Drive canDownload capability", () => {
  assert.equal(canDownloadOwnedAsset(ownedFile()), true);
  assert.equal(canDownloadOwnedAsset({ ...ownedFile(), capabilities: { canDownload: false } }), false);
  assert.equal(canDownloadOwnedAsset({ ...ownedFile(), capabilities: undefined }), false);
});

test("attachment header removes CRLF injection and preserves a UTF-8 filename", () => {
  const header = attachmentContentDisposition('Résumé "final"\r\nX-Evil: yes.mp3');
  assert.match(header, /^attachment; filename=/);
  assert.doesNotMatch(header, /\r|\n/);
  assert.match(header, /filename\*=UTF-8''/);
  assert.match(header, /R%C3%A9sum%C3%A9/);
  assert.doesNotMatch(header, /filename="[^"]*"[^;]*X-Evil/);
});
