import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const landing = await readFile(new URL("../apps/web/src/AuthLanding.tsx", import.meta.url), "utf8");
const reset = await readFile(new URL("../apps/web/src/ResetPasswordPage.tsx", import.meta.url), "utf8");
const privacy = await readFile(new URL("../apps/web/src/PrivacyPage.tsx", import.meta.url), "utf8");
const root = await readFile(new URL("../apps/web/src/Root.tsx", import.meta.url), "utf8");
const main = await readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

test("public home clearly separates first-time signup and returning-user signin", () => {
  assert.match(landing, />Sign Up</);
  assert.match(landing, />Sign In</);
  assert.match(landing, /First time here/);
  assert.match(landing, /Welcome back/);
  assert.match(landing, /\/api\/auth\/password\/signup/);
  assert.match(landing, /\/api\/auth\/password\/signin/);
});

test("returning users have forgot-password recovery and secure reset route", () => {
  assert.match(landing, /Forgot password\?/);
  assert.match(landing, /\/api\/auth\/password\/forgot/);
  assert.match(reset, /Set new password/);
  assert.match(reset, /\/api\/auth\/password\/reset/);
  assert.match(reset, /\{ token, password \}/);
  assert.match(reset, /passwordReset=1/);
});

test("Google remains optional but its privacy boundary is visible on the home screen", () => {
  assert.match(landing, /Continue with Google/);
  assert.match(landing, /does not give HRTechify access to your Gmail inbox/);
  assert.match(landing, /No Gmail, Contacts, Calendar or broad Drive access/);
  assert.match(landing, /openid email/);
  assert.match(landing, /drive\.file/);
});

test("home contains an in-product privacy section rather than only an external document", () => {
  assert.match(landing, /Privacy at a glance/);
  assert.match(landing, /Open full Privacy section/);
  assert.match(landing, /href="\/privacy"/);
  assert.doesNotMatch(landing, /github\.com[^\n]*PRIVACY/);
});

test("full privacy page distinguishes verified email identity from Gmail content access", () => {
  assert.match(privacy, /openid email/);
  assert.match(privacy, /Seeing your email address is not the same as reading your email/);
  assert.match(privacy, /does not request Gmail permissions/);
  assert.match(privacy, /Google Contacts/);
  assert.match(privacy, /Google Calendar/);
  assert.match(privacy, /profile/);
});

test("privacy page explains separate narrow Drive authorization", () => {
  assert.match(privacy, /Connected storage is a separate choice/);
  assert.match(privacy, /Signing in with Google does[\s\S]*not[\s\S]*connect Google Drive or Dropbox/);
  assert.match(privacy, /googleapis\.com\/auth\/drive\.file/);
  assert.match(privacy, /does not request broad/);
  assert.match(privacy, /drive\.readonly/);
  assert.match(privacy, /one explicitly assigned storage connection/);
});

test("privacy page documents password, session, token and media safeguards", () => {
  assert.match(privacy, /PBKDF2-HMAC-SHA256/);
  assert.match(privacy, /600,000 iterations/);
  assert.match(privacy, /single-use/);
  assert.match(privacy, /SHA-256 hash/);
  assert.match(privacy, /HttpOnly/);
  assert.match(privacy, /Secure/);
  assert.match(privacy, /SameSite=Lax/);
  assert.match(privacy, /refresh tokens are encrypted server-side/);
  assert.match(privacy, /Provider OAuth access tokens and provider upload-session details stay on the server/);
  assert.match(privacy, /encrypted, user-bound capability token/);
});

test("privacy page is honest about originals, Cloudflare processing and deletion state", () => {
  assert.match(privacy, /immutable application originals/);
  assert.match(privacy, /Cloudflare Images/);
  assert.match(privacy, /Accept/);
  assert.match(privacy, /Retry/);
  assert.match(privacy, /Keep Original/);
  assert.match(privacy, /does[\s\S]*not[\s\S]*delete files already stored in Google Drive or Dropbox/);
  assert.match(privacy, /Self-service account deletion removes HRTechify/);
  assert.match(privacy, /Account deletion does not call Google Drive or Dropbox deletion APIs/);
});

test("root keeps privacy and reset inside the app and gates Studio on account state", () => {
  assert.match(root, /pathname === "\/privacy"/);
  assert.match(root, /pathname === "\/reset-password"/);
  assert.match(root, /fetch\("\/api\/account"/);
  assert.match(root, /<PrivacyPage/);
  assert.match(root, /<ResetPasswordPage/);
  assert.match(root, /<AuthLanding/);
  assert.match(root, /<App/);
  assert.match(main, /<Root \/>/);
});
