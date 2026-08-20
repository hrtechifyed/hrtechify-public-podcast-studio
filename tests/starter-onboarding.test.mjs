import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shared = await readFile(new URL("../packages/shared/src/index.ts", import.meta.url), "utf8");
const onboarding = await readFile(new URL("../apps/worker/src/onboarding.ts", import.meta.url), "utf8");
const protectedApi = await readFile(new URL("../apps/worker/src/protected-api.ts", import.meta.url), "utf8");
const starterBranding = await readFile(new URL("../apps/worker/src/starter-branding.ts", import.meta.url), "utf8");
const storageApi = await readFile(new URL("../apps/worker/src/storage-api.ts", import.meta.url), "utf8");
const editable = await readFile(new URL("../apps/web/src/EditableShowDefaults.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../apps/web/src/App.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../database/migrations/0005_starter_onboarding.sql", import.meta.url), "utf8");

test("starter defaults are centralized and use the official HRTechify logo", () => {
  assert.match(shared, /HRTECHIFY_STARTER_SHOW_NAME = "The HRTechify Show"/);
  assert.match(shared, /HRTECHIFY_STARTER_HOST_NAME = "HRTechify"/);
  assert.match(shared, /HRTECHIFY_STARTER_EPISODE_NAME = "HRPodcast"/);
  assert.match(shared, /HRTECHIFY_LOGO_URL = "https:\/\/hrtechify\.com\/assets\/hrtechify-logo\.png"/);
});

test("migration protects existing users from receiving an unwanted starter show", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_onboarding/);
  assert.match(migration, /INSERT OR IGNORE INTO user_onboarding/);
  assert.match(migration, /SELECT id, NULL, datetime\('now'\)\s+FROM users/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS show_preferences/);
  assert.match(migration, /default_episode_name TEXT NOT NULL DEFAULT 'HRPodcast'/);
});

test("new-user onboarding is idempotent and only creates a starter show when the user has no shows", () => {
  assert.match(onboarding, /INSERT OR IGNORE INTO user_onboarding/);
  assert.match(onboarding, /WHERE NOT EXISTS \(\s*SELECT 1 FROM shows WHERE user_id = \? AND status <> 'deleted'/s);
  assert.match(onboarding, /HRTECHIFY_STARTER_SHOW_NAME/);
  assert.match(onboarding, /HRTECHIFY_STARTER_HOST_NAME/);
  assert.match(onboarding, /HRTECHIFY_STARTER_EPISODE_NAME/);
  assert.match(onboarding, /brandSetupRequired: true/);
  assert.match(onboarding, /existingShows\.length > 0/);
  assert.match(onboarding, /brandSetupRequired: false/);
});

test("default episode name is tenant-scoped, persistent and validated", () => {
  assert.match(protectedApi, /\/api\\\/shows\\\/\(\[\^\/\]\+\)\\\/preferences/);
  assert.match(protectedApi, /getShowForUser\(db, identity\.userId, showId\)/);
  assert.match(onboarding, /if \(!cleaned\) throw new Error\("episode_name_required"\)/);
  assert.match(onboarding, /cleaned\.length > 160/);
  assert.match(onboarding, /UPDATE show_preferences/);
});

test("starter branding is copied only to the exact starter show and never overwrites existing originals", () => {
  assert.match(starterBranding, /onboarding\.starterShowId !== show\.id/);
  assert.match(starterBranding, /hasLogo/);
  assert.match(starterBranding, /hasProfile/);
  assert.match(starterBranding, /if \(hasLogo && hasProfile\) return/);
  assert.match(starterBranding, /show-logo-original/);
  assert.match(starterBranding, /profile-photo-original/);
  assert.match(starterBranding, /choice: "original"/);
  assert.doesNotMatch(starterBranding, /DELETE/);
  assert.doesNotMatch(starterBranding, /overwrite/i);
});

test("Drive provisioning invokes starter-brand preparation without broadening storage scope", () => {
  assert.match(storageApi, /ensureStarterBrandAssets/);
  assert.match(storageApi, /GOOGLE_DRIVE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.doesNotMatch(storageApi, /auth\/drive"/);
  assert.doesNotMatch(storageApi, /auth\/drive\.readonly/);
});

test("show, host and episode defaults are grey/read-only until their own pencil is used", () => {
  assert.match(editable, /EditableField = "show" \| "host" \| "episode"/);
  assert.match(editable, /readOnly=\{!isEditing\}/);
  assert.match(editable, /aria-readonly=\{!isEditing\}/);
  assert.match(editable, /background: editing \?/);
  assert.match(editable, /aria-label=\{`Edit \$\{label\}`\}/);
  assert.match(editable, />\s*✎\s*</);
  assert.match(editable, /Save/);
  assert.match(editable, /Cancel/);
});

test("first-time reminder opens in-product Brand Settings and remains dismissible", () => {
  assert.match(app, /Make this Studio yours\./);
  assert.match(app, /Open Brand Settings/);
  assert.match(app, /Dismiss reminder/);
  assert.match(app, /brand-settings-\$\{starterShow\.id\}/);
  assert.match(app, /\/api\/account\/onboarding\/dismiss-brand-prompt/);
  assert.match(app, /href="\/privacy"/);
});

test("starter logo and profile are previewed before Drive and remain fully replaceable", () => {
  assert.match(app, /Starter previews are ready now/);
  assert.match(app, /Show logo/);
  assert.match(app, /Profile photo/);
  assert.match(app, /Default: HRTechify logo · fully replaceable/);
  assert.match(app, /Connect Drive for Brand Settings/);
});
