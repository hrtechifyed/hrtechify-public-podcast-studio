import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storageApi = await readFile(new URL("../apps/worker/src/storage-api.ts", import.meta.url), "utf8");
const dropboxFileApi = await readFile(new URL("../apps/worker/src/dropbox-file-api.ts", import.meta.url), "utf8");
const compatApi = await readFile(new URL("../apps/worker/src/storage-upload-compat-api.ts", import.meta.url), "utf8");
const studioStorage = await readFile(new URL("../apps/worker/src/studio-storage.ts", import.meta.url), "utf8");
const privacyApi = await readFile(new URL("../apps/worker/src/account-privacy-api.ts", import.meta.url), "utf8");
const security = await readFile(new URL("../apps/worker/src/security.ts", import.meta.url), "utf8");
const index = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../apps/worker/src/schema-readiness.ts", import.meta.url), "utf8");
const privacyPage = await readFile(new URL("../apps/web/src/PrivacyPage.tsx", import.meta.url), "utf8");
const dropboxUi = await readFile(new URL("../apps/web/src/DropboxStorageWorkspace.tsx", import.meta.url), "utf8");
const root = await readFile(new URL("../apps/web/src/Root.tsx", import.meta.url), "utf8");

test("Dropbox uses PKCE offline OAuth with least-privilege App Folder file scopes", () => {
  assert.match(storageApi, /token_access_type", "offline"/);
  assert.match(storageApi, /code_challenge_method", "S256"/);
  assert.match(storageApi, /account_info\.read/);
  assert.match(storageApi, /files\.metadata\.read/);
  assert.match(storageApi, /files\.content\.read/);
  assert.match(storageApi, /files\.content\.write/);
  assert.doesNotMatch(storageApi, /full_dropbox|Full Dropbox/i);
  assert.match(storageApi, /dropboxAccess: "app-folder"/);
});

test("Dropbox recording uploads are resumable and register immutable originals", () => {
  assert.match(dropboxFileApi, /storage_upload_sessions/);
  assert.match(dropboxFileApi, /startDropboxResumableSession/);
  assert.match(dropboxFileApi, /uploadDropboxResumableChunk/);
  assert.match(dropboxFileApi, /assetKind: "original-recording"/);
  assert.match(dropboxFileApi, /immutable: true/);
  assert.match(dropboxFileApi, /ensureEpisodeFromVerifiedOriginal/);
});

test("existing recorder URLs transparently dispatch Dropbox without exposing provider tokens", () => {
  assert.match(compatApi, /google-drive\/files\/resumable/);
  assert.match(compatApi, /dropbox\/files\/resumable/);
  assert.match(compatApi, /connection\?\.provider !== "dropbox"/);
  assert.match(compatApi, /dropbox-browser-upload:/);
  assert.match(compatApi, /decryptStorageToken/);
  assert.match(index, /handleStorageUploadCompatApi/);
  assert.ok(index.indexOf("handleStorageUploadCompatApi") < index.indexOf("handleDriveFileApi"));
});

test("provider-neutral storage keeps ownership checks server-side", () => {
  assert.match(studioStorage, /google-drive/);
  assert.match(studioStorage, /dropbox/);
  assert.match(studioStorage, /getOwnedFile/);
  assert.match(studioStorage, /downloadOwnedFile/);
});

test("self-service account deletion preserves remote files", () => {
  assert.match(privacyApi, /DELETE MY ACCOUNT/);
  assert.match(privacyApi, /preserveStorageFiles/);
  assert.match(privacyApi, /storageFilesPreserved/);
  assert.doesNotMatch(privacyApi, /delete.*GoogleDrive|delete.*Dropbox/i);
  assert.match(privacyPage, /Google Drive and Dropbox files are preserved/);
});

test("request security is wired at the Worker boundary", () => {
  assert.match(index, /enforceRequestSecurity\(request, env\)/);
  assert.match(index, /applySecurityHeaders\(response, request\)/);
  assert.match(security, /Content-Security-Policy/i);
  assert.match(security, /Strict-Transport-Security/i);
  assert.match(security, /X-Frame-Options/i);
  assert.match(security, /X-Content-Type-Options/i);
  assert.match(security, /Permissions-Policy/i);
  assert.match(security, /Sec-Fetch-Site/i);
});

test("password schema readiness uses the exact migration table names", () => {
  assert.match(schema, /auth_password_credentials/);
  assert.match(schema, /auth_password_verifications/);
  assert.match(schema, /auth_password_resets/);
  assert.doesNotMatch(schema, /\[\s*"password_credentials"/);
});

test("Dropbox UI exposes separate connect and per-show assignment", () => {
  assert.match(dropboxUi, /\/api\/storage\/dropbox\/start/);
  assert.match(dropboxUi, /\/api\/storage\/dropbox\/provision/);
  assert.match(dropboxUi, /App Folder access only/);
  assert.match(dropboxUi, /Use .*Dropbox.* for this show/s);
  assert.match(dropboxUi, /ShowBrandingPanel/);
  assert.match(root, /DropboxStorageWorkspace/);
});

test("privacy page clearly distinguishes narrow Google and Dropbox permissions", () => {
  assert.match(privacyPage, /openid email/);
  assert.match(privacyPage, /drive\.file/);
  assert.match(privacyPage, /does not request Gmail permissions/);
  assert.match(privacyPage, /does not request Full Dropbox access/);
  assert.match(privacyPage, /Google Contacts/);
  assert.match(privacyPage, /Google Calendar/);
});
