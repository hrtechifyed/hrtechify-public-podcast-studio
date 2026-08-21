import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../apps/worker/src/schema-readiness.ts", import.meta.url), "utf8");
const passwordApi = await readFile(new URL("../apps/worker/src/password-auth-api.ts", import.meta.url), "utf8");
const authApi = await readFile(new URL("../apps/worker/src/auth-api.ts", import.meta.url), "utf8");
const onboarding = await readFile(new URL("../apps/worker/src/onboarding.ts", import.meta.url), "utf8");
const protectedApi = await readFile(new URL("../apps/worker/src/protected-api.ts", import.meta.url), "utf8");

test("schema readiness checks sqlite metadata without reading user data", () => {
  assert.match(schema, /FROM sqlite_master/);
  assert.match(schema, /WHERE type = 'table' AND name = \?/);
  assert.match(schema, /auth_password_credentials/);
  assert.match(schema, /auth_password_verifications/);
  assert.match(schema, /auth_password_resets/);
  assert.match(schema, /auth_rate_limits/);
  assert.match(schema, /user_onboarding/);
  assert.match(schema, /show_preferences/);
  assert.match(schema, /storage_asset_records/);
  assert.match(schema, /storage_upload_sessions/);
  assert.doesNotMatch(schema, /SELECT \* FROM users/);
});

test("password auth stays disabled until the required D1 schema exists", () => {
  assert.match(passwordApi, /isPasswordAuthSchemaReady/);
  assert.match(passwordApi, /password_schema_not_ready/);
  assert.match(passwordApi, /await requirePasswordSchema\(env\)/);
  assert.match(passwordApi, /signin: schemaReady/);
  assert.match(passwordApi, /signup: schemaReady/);
  assert.match(passwordApi, /recovery: schemaReady && passwordEmailConfigured\(env\)/);
  assert.match(authApi, /password: await passwordAuthConfiguration\(env\)/);
});

test("onboarding reads degrade to no-op defaults when migration 0005 is absent", () => {
  assert.match(onboarding, /if \(!\(await isOnboardingSchemaReady\(db\)\)\) return noOnboardingState\(\)/);
  assert.match(onboarding, /default_episode_name: HRTECHIFY_STARTER_EPISODE_NAME/);
  assert.match(onboarding, /throw new Error\("onboarding_schema_not_ready"\)/);
  assert.match(protectedApi, /error\.message === "onboarding_schema_not_ready"/);
  assert.match(protectedApi, /return json\(\{ error: "onboarding_schema_not_ready" \}, 503\)/);
});

test("missing onboarding schema does not block core account/show reads", () => {
  assert.match(protectedApi, /const onboarding = await ensureUserOnboarding/);
  assert.match(protectedApi, /listShowsForUser\(db, identity\.userId\)/);
  assert.match(onboarding, /starterShowId: null/);
  assert.match(onboarding, /brandSetupRequired: false/);
});
