import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../apps/web/src/App.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../apps/web/src/ShowBrandingPanel.tsx", import.meta.url), "utf8");

test("branding panel renders only for an active assigned Google Drive show", () => {
  assert.match(appSource, /assignedConnection\?\.provider === "google-drive"/);
  assert.match(appSource, /assignedConnection\.status === "active"/);
  assert.match(appSource, /show\.storageConnectionId &&/);
  assert.match(appSource, /<ShowBrandingPanel/);
  assert.match(appSource, /connectionId=\{show\.storageConnectionId\}/);
});

test("branding UI lists assets with the selected show and Drive connection", () => {
  assert.match(panelSource, /url\.searchParams\.set\("showId", showId\)/);
  assert.match(panelSource, /url\.searchParams\.set\("connectionId", connectionId\)/);
  assert.match(panelSource, /credentials: "same-origin"/);
});

test("branding upload sends raw file bytes with explicit size and MIME", () => {
  assert.match(panelSource, /"content-type": file\.type/);
  assert.match(panelSource, /"x-upload-size": String\(file\.size\)/);
  assert.match(panelSource, /body: file/);
  assert.doesNotMatch(panelSource, /FileReader/);
  assert.doesNotMatch(panelSource, /base64/i);
});

test("browser checks image type and 8 MiB limit before upload", () => {
  assert.match(panelSource, /image\/png/);
  assert.match(panelSource, /image\/jpeg/);
  assert.match(panelSource, /image\/webp/);
  assert.match(panelSource, /8 \* 1024 \* 1024/);
  assert.match(panelSource, /ACCEPTED_IMAGE_TYPES\.has\(file\.type\)/);
  assert.match(panelSource, /file\.size > MAX_BRAND_ASSET_BYTES/);
});

test("UI makes immutable-original retention explicit and offers no delete action", () => {
  assert.match(panelSource, /Originals stay unchanged in your Drive/);
  assert.match(panelSource, /keeps the previous original/);
  assert.match(panelSource, /Previous originals/);
  assert.doesNotMatch(panelSource, /method: "DELETE"/);
  assert.doesNotMatch(panelSource, /method: "PATCH"/);
});

test("both logo and profile-photo original kinds are exposed", () => {
  assert.match(panelSource, /"show-logo-original"/);
  assert.match(panelSource, /"profile-photo-original"/);
  assert.match(panelSource, /Show logo/);
  assert.match(panelSource, /Profile photo/);
});
