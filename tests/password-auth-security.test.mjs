import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authSource = await readFile(new URL("../apps/worker/src/auth-api.ts", import.meta.url), "utf8");
const passwordApiSource = await readFile(new URL("../apps/worker/src/password-auth-api.ts", import.meta.url), "utf8");
const passwordSource = await readFile(new URL("../apps/worker/src/password.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../apps/worker/src/password-auth-store.ts", import.meta.url), "utf8");
const storageSource = await readFile(new URL("../apps/worker/src/storage-api.ts", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../database/migrations/0004_password_authentication.sql", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../apps/worker/src/index.ts", import.meta.url), "utf8");

test("Google sign-in requests identity email only", () => {
  assert.match(authSource, /searchParams\.set\("scope", "openid email"\)/);
  assert.doesNotMatch(authSource, /openid email profile/);
  assert.doesNotMatch(authSource, /gmail\./i);
  assert.doesNotMatch(authSource, /contacts/i);
  assert.doesNotMatch(authSource, /calendar/i);
});

test("Google Drive permission remains separate and narrow", () => {
  assert.match(storageSource, /GOOGLE_DRIVE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.doesNotMatch(storageSource, /googleapis\.com\/auth\/drive"/);
  assert.doesNotMatch(storageSource, /googleapis\.com\/auth\/drive\.readonly/);
});

test("password hashing is salted PBKDF2 HMAC SHA256 with OWASP work factor", () => {
  assert.match(passwordSource, /PASSWORD_ITERATIONS = 600_000/);
  assert.match(passwordSource, /name: "PBKDF2"/);
  assert.match(passwordSource, /hash: "SHA-256"/);
  assert.match(passwordSource, /crypto\.getRandomValues/);
  assert.match(passwordSource, /constantTimeEqual/);
});

test("plaintext passwords are never persisted", () => {
  assert.match(migrationSource, /password_hash TEXT NOT NULL/);
  assert.match(migrationSource, /password_salt TEXT NOT NULL/);
  assert.doesNotMatch(migrationSource, /\bpassword TEXT\b/i);
  assert.doesNotMatch(storeSource, /INSERT[^;]*\bpassword\s*[,)]/is);
});

test("signup requires one-time email verification before credential creation", () => {
  assert.match(passwordApiSource, /savePasswordVerification/);
  assert.match(passwordApiSource, /sendPasswordVerificationEmail/);
  assert.match(passwordApiSource, /consumePasswordVerification/);
  const consumeIndex = passwordApiSource.indexOf("consumePasswordVerification(");
  const credentialIndex = passwordApiSource.indexOf("upsertPasswordCredential(", consumeIndex);
  assert.ok(consumeIndex >= 0 && credentialIndex > consumeIndex);
});

test("password reset is hashed, expiring, single-use and non-enumerating", () => {
  assert.match(passwordApiSource, /sha256Base64Url\(token\)/);
  assert.match(storeSource, /consumed_at IS NULL/);
  assert.match(storeSource, /expires_at > datetime\('now'\)/);
  assert.match(passwordApiSource, /If an account exists for that address, a password reset link will be sent/);
});

test("unknown-password attempts still pay the password hash cost", () => {
  assert.match(passwordApiSource, /burnUnknownPasswordAttempt\(password\)/);
  assert.match(passwordApiSource, /invalid_email_or_password/);
});

test("authentication abuse controls store only hashed rate keys", () => {
  assert.match(passwordApiSource, /sha256Base64Url\(`\$\{action\}:\$\{normalizeEmail\(email\)\}`\)/);
  assert.match(migrationSource, /key_hash TEXT NOT NULL/);
  assert.doesNotMatch(migrationSource, /auth_rate_limits[\s\S]*email TEXT/i);
});

test("password routes are intercepted before generic auth", () => {
  const handlerSection = indexSource.slice(indexSource.indexOf("const handlers = ["));
  const passwordIndex = handlerSection.indexOf("handlePasswordAuthApi,");
  const authIndex = handlerSection.indexOf("handleAuthApi,");
  assert.ok(passwordIndex >= 0 && authIndex > passwordIndex);
});
