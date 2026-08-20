import { FormEvent, useState } from "react";
import { PLATFORM_CREDIT } from "@hrtechify/shared";

const friendlyError = (code?: string) => {
  switch (code) {
    case "password_too_short": return "Use a password of at least 12 characters.";
    case "password_too_long": return "Use a password of 128 characters or fewer.";
    case "password_reset_invalid_or_expired": return "This password reset link is invalid, expired, or has already been used. Request a new one.";
    case "password_reset_not_configured": return "Password recovery is not enabled for this deployment yet.";
    default: return code || "Your password could not be updated.";
  }
};

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "This password reset link is missing its secure token. Request a new reset link.",
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(friendlyError(payload?.error));
      window.location.assign("/?mode=signin&passwordReset=1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your password could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-shell">
      <header className="topbar">
        <a className="text-button" href="/">← HRTechify Podcast Studio</a>
        <a className="nav-link" href="/privacy">Privacy</a>
      </header>

      <main className="signin-layout">
        <section className="signin-intro">
          <p className="eyebrow">Secure account recovery</p>
          <h1>Set a new password.</h1>
          <p>The reset link is short-lived and single-use. HRTechify never stores your password in readable form.</p>
          <div className="trust-note">
            <strong>Your existing Google permissions do not change.</strong>
            <span>Resetting a Studio password does not grant Gmail, Contacts, Calendar, or additional Drive access.</span>
          </div>
        </section>

        <section className="signin-card">
          <p className="eyebrow">Set new password</p>
          <h2>Choose a new Studio password</h2>
          <p className="muted">Use at least 12 characters. Long passphrases are welcome; no forced symbol or capitalization pattern is required.</p>

          {error && <div className="notice error">{error}</div>}

          <form className="stack-form" onSubmit={submit}>
            <label>
              New password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy || !token} />
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy || !token} />
            </label>
            <button className="primary-action" type="submit" disabled={busy || !token}>{busy ? "Updating…" : "Set new password"}</button>
          </form>

          <p className="signin-footnote"><a href="/?mode=signin">Back to Sign In</a></p>
        </section>
      </main>

      <footer style={{ justifyContent: "flex-end" }}><span>{PLATFORM_CREDIT}</span></footer>
    </div>
  );
}
