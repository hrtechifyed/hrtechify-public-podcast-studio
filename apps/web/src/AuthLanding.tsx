import { FormEvent, useEffect, useState } from "react";
import { PLATFORM_CREDIT } from "@hrtechify/shared";

type Mode = "signup" | "signin" | "forgot";

interface AuthConfig {
  providers: {
    google: boolean;
    password?: {
      signin: boolean;
      signup: boolean;
      recovery: boolean;
    };
  };
}

const friendlyError = (code?: string) => {
  switch (code) {
    case "valid_email_required": return "Enter a valid email address.";
    case "password_too_short": return "Use a password of at least 12 characters.";
    case "password_too_long": return "Use a password of 128 characters or fewer.";
    case "account_already_has_password": return "This email already has a password. Sign in or use Forgot password.";
    case "invalid_email_or_password": return "The email or password is incorrect.";
    case "too_many_attempts": return "Too many attempts. Try again later.";
    case "email_delivery_failed": return "The account email could not be sent right now. Try again later.";
    case "password_signup_not_configured": return "Email sign-up is not enabled for this deployment yet.";
    case "password_signin_not_configured": return "Password sign-in is not enabled for this deployment yet.";
    case "password_reset_not_configured": return "Password recovery is not enabled for this deployment yet.";
    default: return code || "The request could not be completed.";
  }
};

export function AuthLanding() {
  const initialMode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "signin";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    new URLSearchParams(window.location.search).get("passwordReset") === "1"
      ? "Password updated. Sign in with your new password."
      : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/config", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.ok) setConfig(await response.json() as AuthConfig);
      })
      .catch(() => setError("The sign-in service could not be reached."));
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirmPassword("");
  };

  const google = () => {
    window.location.assign("/api/auth/google/start?returnTo=/");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const response = await fetch("/api/auth/password/signup", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        if (!response.ok) throw new Error(friendlyError(payload?.error));
        setNotice(payload?.message ?? "Check your email to verify your account.");
        return;
      }

      if (mode === "signin") {
        const response = await fetch("/api/auth/password/signin", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(friendlyError(payload?.error));
        window.location.assign("/");
        return;
      }

      const response = await fetch("/api/auth/password/forgot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      if (!response.ok) throw new Error(friendlyError(payload?.error));
      setNotice(payload?.message ?? "If an account exists for that address, a reset link will be sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const passwordEnabled = mode === "signup"
    ? config?.providers.password?.signup !== false
    : mode === "signin"
      ? config?.providers.password?.signin !== false
      : config?.providers.password?.recovery !== false;

  return (
    <div className="public-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HRTechify</div>
          <div className="brand">Podcast Studio</div>
        </div>
        <a className="nav-link" href="/privacy">Privacy</a>
      </header>

      <main className="signin-layout">
        <section className="signin-intro">
          <p className="eyebrow">Private by design · creator controlled</p>
          <h1>Build your podcast without giving up control of your voice or your data.</h1>
          <p>
            Create a show, keep permanent media in your own connected storage, approve spoken-content edits, and produce from an immutable original.
          </p>
          <div className="trust-note">
            <strong>Google sign-in does not give HRTechify access to your Gmail inbox.</strong>
            <span>It requests only your Google account identifier and verified email address. Drive is connected separately with narrow file-level permission.</span>
          </div>
          <p className="muted"><a href="/privacy">See exactly what HRTechify can and cannot access →</a></p>
        </section>

        <section className="signin-card">
          {mode !== "forgot" && (
            <div className="inline-actions" role="tablist" aria-label="Account access">
              <button type="button" className={mode === "signup" ? "primary-action compact" : "secondary-action compact"} onClick={() => switchMode("signup")}>Sign Up</button>
              <button type="button" className={mode === "signin" ? "primary-action compact" : "secondary-action compact"} onClick={() => switchMode("signin")}>Sign In</button>
            </div>
          )}

          <p className="eyebrow" style={{ marginTop: 18 }}>{mode === "signup" ? "First time here" : mode === "signin" ? "Welcome back" : "Account recovery"}</p>
          <h2>{mode === "signup" ? "Create your Studio account" : mode === "signin" ? "Sign in to your Studio" : "Forgot your password?"}</h2>
          <p className="muted">
            {mode === "signup"
              ? "We verify your email before a password account becomes active."
              : mode === "signin"
                ? "Use your email and password, or continue with Google."
                : "Enter your email. The response will not reveal whether an account exists."}
          </p>

          {notice && <div className="notice success">{notice}</div>}
          {error && <div className="notice error">{error}</div>}

          {mode !== "forgot" && (
            <>
              <button type="button" className="google-button" onClick={google} disabled={busy || config?.providers.google === false}>
                Continue with Google
              </button>
              <p className="setup-hint">Google sign-in: verified email identity only. No Gmail, Contacts, Calendar or broad Drive access.</p>
              <div className="divider"><span>or</span></div>
            </>
          )}

          <form onSubmit={submit} className="stack-form">
            <label>
              Email address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required disabled={busy} />
            </label>

            {mode !== "forgot" && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 12 : undefined}
                  maxLength={128}
                  required
                  disabled={busy}
                />
                {mode === "signup" && <span className="setup-hint">At least 12 characters. No forced symbol or capitalization pattern.</span>}
              </label>
            )}

            {mode === "signup" && (
              <label>
                Confirm password
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} />
              </label>
            )}

            <button className="primary-action" type="submit" disabled={busy || !passwordEnabled}>
              {busy ? "Working…" : mode === "signup" ? "Create account" : mode === "signin" ? "Sign in" : "Send reset link"}
            </button>
          </form>

          {mode === "signin" && <button type="button" className="text-button" onClick={() => switchMode("forgot")} disabled={busy}>Forgot password?</button>}
          {mode === "forgot" && <button type="button" className="text-button" onClick={() => switchMode("signin")} disabled={busy}>Back to Sign In</button>}

          <p className="signin-footnote">By continuing, you can review how account, media and Google permissions are handled in <a href="/privacy">Privacy</a>.</p>
        </section>
      </main>

      <footer style={{ justifyContent: "flex-end" }}><span>{PLATFORM_CREDIT}</span></footer>
    </div>
  );
}
