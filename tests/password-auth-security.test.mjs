import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authSource = await readFile(new URL("../apps/worker/src/auth-api.ts", import.meta.url), "utf8");
const authUiSource = await readFile(new URL("../apps/web/src/AuthLanding.tsx", import.meta.url), "utf8");
const passwordApiSource = await readFile(new URL("../apps/worker/src/password-auth-api.ts", import.meta.url), "utf8");
const passwordSource = await readFile(new URL("../apps/worker/src/password.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../apps/worker/src/password-auth-store.ts", import.meta.url), "utf8");
const usersSource = await readFile(new URL("../apps/worker/src/users.ts", import.meta.url), "utf8");
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

test("password signup is immediate without transactional email and creates a session", () => {
  const signupStart = passwordApiSource.indexOf("const signup =");
  const verifyStart = passwordApiSource.indexOf("const verifySignup =");
  const signupSource = passwordApiSource.slice(signupStart, verifyStart);
  assert.match(signupSource, /createUserForPasswordSignup/);
  assert.match(signupSource, /upsertPasswordCredential/);
  assert.match(signupSource, /sessionForUser/);
  assert.match(signupSource, /redirectTo: "\/\?auth=success&newAccount=1&brandSetup=1"/);
  assert.doesNotMatch(signupSource, /sendPasswordVerificationEmail|savePasswordVerification/);
  assert.match(passwordApiSource, /signup: schemaReady/);
  assert.match(passwordApiSource, /recovery: schemaReady && passwordEmailConfigured\(env\)/);
});

test("immediate password signup cannot claim an email already owned by another identity", () => {
  assert.match(passwordApiSource, /const existingUser = await getUserByEmail\(db, email\)/);
  assert.match(passwordApiSource, /account_uses_other_signin/);
  assert.match(usersSource, /INSERT OR IGNORE INTO users/);
  assert.match(usersSource, /if \(!created\) return null/);
  assert.match(usersSource, /INSERT INTO auth_identities/);
  assert.match(usersSource, /DELETE FROM users WHERE id = \?/);
});

test("unverified password identities cannot absorb later verified Google or email identities", () => {
  assert.match(usersSource, /const passwordIdentitySubject = \(email: string\) => `password:\$\{normalizeEmail\(email\)\}`/);
  assert.match(usersSource, /hasUnverifiedPasswordBoundary/);
  assert.match(usersSource, /FROM auth_password_credentials/);
  assert.match(usersSource, /subject = \?/);
  assert.match(usersSource, /throw new Error\("unverified_password_email_conflict"\)/);
  assert.match(authSource, /google_password_account_conflict/);
  assert.match(authSource, /email_password_account_conflict/);
  assert.match(authUiSource, /Google cannot be linked automatically because password-only email ownership is not verified/);
  assert.match(authUiSource, /params\.get\("auth"\) === "error"/);
});

test("password signup cannot leave a user stranded when credential setup fails", () => {
  const signupStart = passwordApiSource.indexOf("const signup =");
  const verifyStart = passwordApiSource.indexOf("const verifySignup =");
  const signupSource = passwordApiSource.slice(signupStart, verifyStart);
  const hashIndex = signupSource.indexOf("const material = await hashPassword(password)");
  const createIndex = signupSource.indexOf("createUserForPasswordSignup(db, email)");
  const credentialIndex = signupSource.indexOf("upsertPasswordCredential(db, user.id, user.email, material)");
  const rollbackIndex = signupSource.indexOf("deletePasswordSignupUser(db, user.id)");

  assert.ok(hashIndex >= 0 && createIndex > hashIndex, "password hashing must finish before the email is reserved");
  assert.ok(credentialIndex > createIndex, "credential persistence must happen after user creation");
  assert.ok(rollbackIndex > credentialIndex, "failed credential persistence must compensate by deleting the new user");
  assert.match(usersSource, /export const deletePasswordSignupUser/);
});

test("legacy verification links remain consumable without being used for new signups", () => {
  assert.match(passwordApiSource, /consumePasswordVerification/);
  assert.match(passwordApiSource, /Legacy verification links remain consumable/);
});

test("password reset remains hashed, expiring, single-use and non-enumerating when email is configured", () => {
  assert.match(passwordApiSource, /sha256Base64Url\(token\)/);
  assert.match(storeSource, /consumed_at IS NULL/);
  assert.match(storeSource, /expires_at > datetime\('now'\)/);
  assert.match(passwordApiSource, /If an account exists for that address, a password reset link will be sent/);
  assert.match(passwordApiSource, /if \(!passwordEmailConfigured\(env\)\) return json\(\{ error: "password_reset_not_configured" \}, 503\)/);
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
