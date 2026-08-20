import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MAX_ACTIVE_SHOWS_PER_USER,
  PLATFORM_CREDIT,
} from "@hrtechify/shared";

interface Account {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "suspended" | "deleted";
}

interface Show {
  id: string;
  name: string;
  hostName: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  storageConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShowLimits {
  active: number;
  maximum: number;
  canCreate: boolean;
}

interface AuthConfig {
  providers: {
    google: boolean;
    email: boolean;
  };
}

interface StorageConfig {
  providers: {
    googleDrive: boolean;
    dropbox: boolean;
  };
}

interface StorageConnection {
  id: string;
  provider: "google-drive" | "dropbox";
  accountEmail: string | null;
  status: "active" | "revoked" | "error";
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShowFormState {
  name: string;
  hostDisplayName: string;
  description: string;
}

const emptyShowForm: ShowFormState = {
  name: "",
  hostDisplayName: "",
  description: "",
};

const jsonOrNull = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const friendlyStorageError = (code?: string) => {
  switch (code) {
    case "google_drive_api_not_enabled":
      return "Google Drive is connected, but the Google Drive API is not enabled in the Google Cloud project. Enable the Google Drive API, then retry the Drive setup for the intended account.";
    case "google_drive_permission_denied":
      return "Google Drive denied the folder operation. Reconnect Google Drive and try again.";
    case "google_drive_scope_insufficient":
      return "The connected Google Drive permission is insufficient. Reconnect Google Drive and approve the requested drive.file access.";
    case "google_drive_authorization_expired":
    case "google_drive_access_token_failed":
      return "The Google Drive authorization needs to be refreshed. Reconnect Google Drive and try again.";
    case "google_drive_rate_limited":
      return "Google Drive is temporarily rate-limiting requests. Try again in a little while.";
    case "google_drive_connection_not_found":
      return "No active Google Drive connection was found. Connect Google Drive first.";
    default:
      return code || "Could not prepare the Google Drive folders.";
  }
};

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
  const [storageConnections, setStorageConnections] = useState<StorageConnection[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [limits, setLimits] = useState<ShowLimits>({
    active: 0,
    maximum: MAX_ACTIVE_SHOWS_PER_USER,
    canCreate: true,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [storageBusyShowIds, setStorageBusyShowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [showForm, setShowForm] = useState<ShowFormState>(emptyShowForm);
  const [editingShowId, setEditingShowId] = useState<string | null>(null);
  const [showFormOpen, setShowFormOpen] = useState(false);

  const activeShows = useMemo(
    () => shows.filter((show) => show.status === "active"),
    [shows],
  );
  const archivedShows = useMemo(
    () => shows.filter((show) => show.status === "archived"),
    [shows],
  );
  const activeGoogleDriveConnections = useMemo(
    () =>
      storageConnections.filter(
        (connection) => connection.provider === "google-drive" && connection.status === "active",
      ),
    [storageConnections],
  );

  const loadShows = async () => {
    const response = await fetch("/api/shows", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load your shows.");
    const payload = await jsonOrNull<{ shows: Show[]; limits: ShowLimits }>(response);
    if (!payload) throw new Error("Could not read the shows response.");
    setShows(payload.shows);
    setLimits(payload.limits);
    return payload;
  };

  const loadStorage = async () => {
    const [configResponse, connectionsResponse] = await Promise.all([
      fetch("/api/storage/config", { credentials: "same-origin" }),
      fetch("/api/storage/connections", { credentials: "same-origin" }),
    ]);

    if (configResponse.ok) {
      const config = await jsonOrNull<StorageConfig>(configResponse);
      if (config) setStorageConfig(config);
    }

    if (!connectionsResponse.ok) {
      if (connectionsResponse.status === 401) return [] as StorageConnection[];
      throw new Error("Could not load your storage connections.");
    }

    const payload = await jsonOrNull<{ connections: StorageConnection[] }>(connectionsResponse);
    const connections = payload?.connections ?? [];
    setStorageConnections(connections);
    return connections;
  };

  const provisionShowStorage = async (
    showId: string,
    connectionId: string,
    quiet = false,
  ) => {
    const response = await fetch("/api/storage/google-drive/provision", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showId, connectionId }),
    });
    const payload = await jsonOrNull<{
      error?: string;
      workspace?: { showId: string; connectionId: string };
    }>(response);
    if (!response.ok) throw new Error(friendlyStorageError(payload?.error));
    if (!payload?.workspace || payload.workspace.showId !== showId) {
      throw new Error("Google Drive did not confirm the requested show workspace.");
    }
    if (!quiet) setNotice("Google Drive folders are ready for this show.");
    return payload.workspace;
  };

  const provisionAllActiveShows = async (
    connectionId: string,
    quiet = false,
  ) => {
    const response = await fetch("/api/storage/google-drive/provision-active-shows", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    const payload = await jsonOrNull<{ error?: string; provisioned?: unknown[] }>(response);
    if (!response.ok) throw new Error(friendlyStorageError(payload?.error));
    await loadShows();
    if (!quiet) {
      const count = payload?.provisioned?.length ?? 0;
      setNotice(
        count > 0
          ? `Google Drive folders are ready for ${count} active show${count === 1 ? "" : "s"}.`
          : "Google Drive folders are already ready.",
      );
    }
    return payload;
  };

  const bootstrap = async () => {
    setLoading(true);
    setError(null);

    try {
      const [authResponse, accountResponse] = await Promise.all([
        fetch("/api/auth/config", { credentials: "same-origin" }),
        fetch("/api/account", { credentials: "same-origin" }),
      ]);

      if (authResponse.ok) {
        setAuthConfig(await jsonOrNull<AuthConfig>(authResponse));
      }

      if (accountResponse.ok) {
        const payload = await jsonOrNull<{ user: Account }>(accountResponse);
        if (payload?.user) {
          setAccount(payload.user);
          const [, connections] = await Promise.all([loadShows(), loadStorage()]);
          const activeDrive = connections.filter(
            (connection) => connection.provider === "google-drive" && connection.status === "active",
          );

          // Idempotent repair on each signed-in load when one Drive account is connected.
          // This creates missing folders and repairs renamed app-owned folders without duplication.
          if (activeDrive.length === 1) {
            await provisionAllActiveShows(activeDrive[0].id, true);
          }
        }
      } else if (accountResponse.status === 401) {
        setAccount(null);
      } else if (accountResponse.status === 503) {
        setAccount(null);
        setError("Authentication or the database is not configured for this deployment yet.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The studio could not reach its account service.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("auth");
    const storageStatus = params.get("storage");
    const reason = params.get("reason");

    if (authStatus === "success") setNotice("You are signed in.");
    if (authStatus === "error") {
      setError(`Sign-in could not be completed${reason ? `: ${reason}` : "."}`);
    }
    if (storageStatus === "connected") {
      setNotice("Google Drive is connected. Your show folders will be prepared automatically.");
    }
    if (storageStatus === "error") {
      setError(`Google Drive could not be connected${reason ? `: ${reason}` : "."}`);
    }
    if (authStatus || storageStatus) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    void bootstrap();
  }, []);

  const signInWithGoogle = () => {
    window.location.assign("/api/auth/google/start?returnTo=/");
  };

  const connectGoogleDrive = () => {
    window.location.assign("/api/storage/google-drive/start?returnTo=/");
  };

  const requestMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, returnTo: "/" }),
      });
      const payload = await jsonOrNull<{ message?: string; error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error ?? "Could not send the sign-in link.");
      setNotice(payload?.message ?? "Check your email for a secure sign-in link.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the sign-in link.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setAccount(null);
    setShows([]);
    setStorageConnections([]);
    setLimits({ active: 0, maximum: MAX_ACTIVE_SHOWS_PER_USER, canCreate: true });
    setNotice("You are signed out.");
    setBusy(false);
  };

  const openCreateShow = () => {
    if (!limits.canCreate) return;
    setEditingShowId(null);
    setShowForm(emptyShowForm);
    setShowFormOpen(true);
    setError(null);
  };

  const openEditShow = (show: Show) => {
    setEditingShowId(show.id);
    setShowForm({
      name: show.name,
      hostDisplayName: show.hostName,
      description: show.description ?? "",
    });
    setShowFormOpen(true);
    setError(null);
  };

  const saveShow = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const wasEditing = Boolean(editingShowId);
      const response = await fetch(editingShowId ? `/api/shows/${editingShowId}` : "/api/shows", {
        method: editingShowId ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(showForm),
      });
      const payload = await jsonOrNull<{ show?: Show; error?: string }>(response);
      if (!response.ok) {
        if (payload?.error === "active_show_limit_reached") {
          throw new Error(`You can have a maximum of ${MAX_ACTIVE_SHOWS_PER_USER} active shows.`);
        }
        throw new Error(payload?.error ?? "Could not save the show.");
      }

      if (payload?.show) {
        const currentConnection = payload.show.storageConnectionId
          ? storageConnections.find((connection) => connection.id === payload.show?.storageConnectionId)
          : null;
        if (currentConnection?.provider === "google-drive" && currentConnection.status === "active") {
          await provisionShowStorage(payload.show.id, currentConnection.id, true);
        } else if (!wasEditing && activeGoogleDriveConnections.length === 1) {
          await provisionShowStorage(payload.show.id, activeGoogleDriveConnections[0].id, true);
        }
      }

      await loadShows();
      setShowFormOpen(false);
      setEditingShowId(null);
      setShowForm(emptyShowForm);
      setNotice(wasEditing ? "Show updated." : "Show created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the show.");
    } finally {
      setBusy(false);
    }
  };

  const changeShowStatus = async (show: Show, action: "archive" | "restore") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/shows/${show.id}/${action}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await jsonOrNull<{ show?: Show; error?: string }>(response);
      if (!response.ok) {
        if (payload?.error === "active_show_limit_reached") {
          throw new Error(`Archive another show first. Your account already has ${MAX_ACTIVE_SHOWS_PER_USER} active shows.`);
        }
        throw new Error(payload?.error ?? `Could not ${action} the show.`);
      }

      if (action === "restore" && payload?.show && !payload.show.storageConnectionId && activeGoogleDriveConnections.length === 1) {
        await provisionShowStorage(payload.show.id, activeGoogleDriveConnections[0].id, true);
      }

      await loadShows();
      setNotice(action === "archive" ? "Show archived." : "Show restored.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} the show.`);
    } finally {
      setBusy(false);
    }
  };

  const deleteShow = async (show: Show) => {
    const confirmed = window.confirm(
      `Delete "${show.name}" from HRTechify Podcast Studio?\n\nThis removes the show from the Studio. Files already stored in Google Drive are not deleted.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/shows/${show.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = await jsonOrNull<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error ?? "Could not delete the show.");
      await loadShows();
      setNotice(`"${show.name}" was deleted from the Studio. Google Drive files were left untouched.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the show.");
    } finally {
      setBusy(false);
    }
  };

  const setupShowStorage = async (show: Show, connection: StorageConnection) => {
    setStorageBusyShowIds((current) => {
      const next = new Set(current);
      next.add(show.id);
      return next;
    });
    setError(null);
    setNotice(null);
    try {
      await provisionShowStorage(show.id, connection.id, true);
      await loadShows();
      setNotice(
        `Drive folders for "${show.name}" are ready in ${connection.accountEmail || "Google Drive"}. No other show was changed.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare Google Drive storage.");
    } finally {
      setStorageBusyShowIds((current) => {
        const next = new Set(current);
        next.delete(show.id);
        return next;
      });
    }
  };

  const setupAllStorage = async (connection: StorageConnection) => {
    const targetAccount = connection.accountEmail || "this Google Drive account";
    if (activeGoogleDriveConnections.length > 1) {
      const confirmed = window.confirm(
        `Prepare or repair active-show folders in ${targetAccount}?\n\nUnassigned active shows will use this Drive account. Shows already assigned to another Drive account will not be moved.`,
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await provisionAllActiveShows(connection.id, true);
      const count = payload?.provisioned?.length ?? 0;
      setNotice(
        count > 0
          ? `${count} active show${count === 1 ? "" : "s"} prepared in ${targetAccount}. Shows assigned to other Drive accounts were not moved.`
          : `Drive folders in ${targetAccount} are already ready. Shows assigned to other Drive accounts were not moved.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare Google Drive storage.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="center-screen">
        <div className="loader" />
        <p>Opening HRTechify Podcast Studio…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="public-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">HRTechify</div>
            <div className="brand">Podcast Studio</div>
          </div>
          <a className="github-link" href="https://github.com/hrtechifyed/hrtechify-public-podcast-studio" target="_blank" rel="noreferrer">
            Open Source on GitHub
          </a>
        </header>

        <main className="signin-layout">
          <section className="signin-intro">
            <p className="eyebrow">Open-source · privacy-first · user-controlled</p>
            <h1>Record. Refine. Publish your podcast.</h1>
            <p>
              One account can manage up to {MAX_ACTIVE_SHOWS_PER_USER} independent shows. Your show branding, episodes and storage stay separated show by show.
            </p>
            <div className="trust-note">
              <strong>Your voice stays under your control.</strong>
              <span>Spoken-content changes require your approval before production.</span>
            </div>
          </section>

          <section className="signin-card">
            <p className="eyebrow">Sign in</p>
            <h2>Enter your studio</h2>
            <p className="muted">Signing in to the studio is separate from connecting Google Drive or Dropbox.</p>

            {notice && <div className="notice success">{notice}</div>}
            {error && <div className="notice error">{error}</div>}

            <button
              type="button"
              className="google-button"
              onClick={signInWithGoogle}
              disabled={!authConfig?.providers.google || busy}
            >
              Continue with Google
            </button>
            {!authConfig?.providers.google && (
              <p className="setup-hint">Google sign-in needs deployment credentials before it becomes available.</p>
            )}

            <div className="divider"><span>or</span></div>

            <form onSubmit={requestMagicLink} className="stack-form">
              <label>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={busy || !authConfig?.providers.email}
                />
              </label>
              <button className="primary-action" type="submit" disabled={busy || !authConfig?.providers.email}>
                Email me a sign-in link
              </button>
            </form>
            {!authConfig?.providers.email && (
              <p className="setup-hint">Magic-link email needs its delivery credentials before it becomes available.</p>
            )}

            <p className="signin-footnote">No password is stored by HRTechify Podcast Studio.</p>
          </section>
        </main>

        <footer style={{ justifyContent: "flex-end" }}>
          <span>{PLATFORM_CREDIT}</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar signed-in-topbar">
        <div>
          <div className="eyebrow">HRTechify</div>
          <div className="brand">Podcast Studio</div>
        </div>
        <div className="account-menu">
          <div>
            <strong>{account.displayName || account.email}</strong>
            {account.displayName && <span>{account.email}</span>}
          </div>
          <button type="button" className="secondary-action compact" onClick={signOut} disabled={busy}>Sign out</button>
        </div>
      </header>

      <nav className="nav" aria-label="Primary navigation">
        <button type="button" className="nav-item active">My Shows</button>
        <button type="button" className="nav-item" disabled>Studio</button>
        <button type="button" className="nav-item" disabled>Episodes</button>
        <button type="button" className="nav-item" disabled>Templates</button>
        <a className="nav-link" href="https://github.com/hrtechifyed/hrtechify-public-podcast-studio/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noreferrer">How It Works</a>
        <a className="nav-link" href="https://github.com/hrtechifyed/hrtechify-public-podcast-studio/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy & Your Data</a>
      </nav>

      <main className="shows-page">
        <section className="shows-heading">
          <div>
            <p className="eyebrow">Your account</p>
            <h1>My Shows</h1>
            <p>Each show is an independent podcast workspace with its own branding, episodes and storage destination.</p>
          </div>
          <div className="show-limit-card">
            <strong>{limits.active} of {limits.maximum}</strong>
            <span>active shows</span>
            <div className="limit-track" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (limits.active / limits.maximum) * 100)}%` }} />
            </div>
          </div>
        </section>

        {notice && <div className="notice success wide-notice">{notice}</div>}
        {error && <div className="notice error wide-notice">{error}</div>}

        <section className="show-form-card">
          <div className="form-heading">
            <div>
              <p className="eyebrow">Your storage</p>
              <h2>Google Drive</h2>
              <p className="muted">
                Your permanent podcast files stay in your Drive. Each show receives its own Brand Assets, Templates and Episodes folders.
                {activeGoogleDriveConnections.length > 1 && " You have multiple Drive accounts connected. Choose the specific account below; existing shows assigned to another Drive account will not be moved."}
                {" Show-level Repair actions affect only the show whose card you clicked."}
              </p>
            </div>
            <button
              type="button"
              className="secondary-action compact"
              onClick={connectGoogleDrive}
              disabled={busy || storageConfig?.providers.googleDrive === false}
            >
              {activeGoogleDriveConnections.length > 0 ? "Add Drive account" : "Connect Google Drive"}
            </button>
          </div>

          {activeGoogleDriveConnections.length === 0 ? (
            <p className="muted">No Google Drive account is connected yet.</p>
          ) : (
            <div className="archived-list">
              {activeGoogleDriveConnections.map((connection) => (
                <article key={connection.id}>
                  <div>
                    <strong>{connection.accountEmail || "Google Drive"}</strong>
                    <span>
                      {activeGoogleDriveConnections.length > 1
                        ? "Connected with drive.file access only · actions on this row affect this account only"
                        : "Connected with drive.file access only"}
                    </span>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="secondary-action compact"
                      onClick={() => void setupAllStorage(connection)}
                      disabled={busy}
                    >
                      {activeGoogleDriveConnections.length > 1
                        ? `Prepare in ${connection.accountEmail || "this Drive"}`
                        : "Prepare / repair active shows"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="shows-actions">
          <div>
            <h2>Active shows</h2>
            <p>{limits.canCreate ? `You can create ${limits.maximum - limits.active} more.` : "You have reached the five-show limit. Archive or delete a show to create another."}</p>
          </div>
          <button type="button" className="primary-action" onClick={openCreateShow} disabled={!limits.canCreate || busy}>
            + Create show
          </button>
        </section>

        {showFormOpen && (
          <section className="show-form-card">
            <div className="form-heading">
              <div>
                <p className="eyebrow">{editingShowId ? "Edit show" : "New show"}</p>
                <h2>{editingShowId ? "Update show details" : "Create a podcast show"}</h2>
              </div>
              <button type="button" className="text-button" onClick={() => setShowFormOpen(false)}>Cancel</button>
            </div>
            <form onSubmit={saveShow} className="show-form-grid">
              <label>
                Show name
                <input value={showForm.name} onChange={(event) => setShowForm({ ...showForm, name: event.target.value })} maxLength={120} required />
              </label>
              <label>
                Host name
                <input value={showForm.hostDisplayName} onChange={(event) => setShowForm({ ...showForm, hostDisplayName: event.target.value })} maxLength={120} required />
              </label>
              <label className="full-field">
                Show description <span>optional</span>
                <textarea value={showForm.description} onChange={(event) => setShowForm({ ...showForm, description: event.target.value })} maxLength={1200} rows={4} />
              </label>
              <div className="full-field form-actions">
                <button className="primary-action" type="submit" disabled={busy}>{editingShowId ? "Save changes" : "Create show"}</button>
                <button className="secondary-action" type="button" onClick={() => setShowFormOpen(false)}>Cancel</button>
              </div>
            </form>
          </section>
        )}

        <section className="show-grid">
          {activeShows.map((show) => {
            const assignedConnection = storageConnections.find(
              (connection) => connection.id === show.storageConnectionId,
            );
            const showStorageBusy = storageBusyShowIds.has(show.id);
            return (
              <article className="show-card" key={show.id}>
                <div className="show-card-topline">
                  <span className="status-pill active-status">Active</span>
                  <span className="storage-pill">
                    {assignedConnection?.provider === "google-drive"
                      ? `Drive · ${assignedConnection.accountEmail || "connected"}`
                      : "Storage not set"}
                  </span>
                </div>
                <div className="show-avatar">{show.name.slice(0, 1).toUpperCase()}</div>
                <h3>{show.name}</h3>
                <p className="host-line">Hosted by {show.hostName}</p>
                {show.description && <p className="show-description">{show.description}</p>}

                {activeGoogleDriveConnections.length > 0 && (
                  <div className="form-actions" style={{ marginTop: 12 }}>
                    {activeGoogleDriveConnections.map((connection) => (
                      <button
                        type="button"
                        className={show.storageConnectionId === connection.id ? "primary-action compact" : "secondary-action compact"}
                        key={connection.id}
                        onClick={() => void setupShowStorage(show, connection)}
                        disabled={busy || showStorageBusy}
                      >
                        {showStorageBusy
                          ? "Working on this show…"
                          : show.storageConnectionId === connection.id
                            ? `Repair this show in ${connection.accountEmail || "Google Drive"}`
                            : `Use ${connection.accountEmail || "Google Drive"} for this show`}
                      </button>
                    ))}
                  </div>
                )}

                <div className="show-card-actions">
                  <button type="button" className="secondary-action compact" onClick={() => openEditShow(show)} disabled={busy || showStorageBusy}>Edit</button>
                  <button type="button" className="text-button" onClick={() => void changeShowStatus(show, "archive")} disabled={busy || showStorageBusy}>Archive</button>
                  <button type="button" className="text-button" onClick={() => void deleteShow(show)} disabled={busy || showStorageBusy}>Delete</button>
                </div>
              </article>
            );
          })}

          {limits.canCreate && (
            <button type="button" className="create-show-tile" onClick={openCreateShow}>
              <span>+</span>
              <strong>Create another show</strong>
              <small>{limits.maximum - limits.active} slots remaining</small>
            </button>
          )}
        </section>

        {activeShows.length === 0 && !showFormOpen && (
          <section className="empty-state">
            <div className="show-avatar large">+</div>
            <h2>Create your first show</h2>
            <p>Your show becomes the home for its host details, logo, profile image, templates, episodes and chosen storage.</p>
            <button className="primary-action" type="button" onClick={openCreateShow}>Create your first show</button>
          </section>
        )}

        {archivedShows.length > 0 && (
          <section className="archived-section">
            <div>
              <p className="eyebrow">Not counted in your limit</p>
              <h2>Archived shows</h2>
            </div>
            <div className="archived-list">
              {archivedShows.map((show) => (
                <article key={show.id}>
                  <div>
                    <strong>{show.name}</strong>
                    <span>Hosted by {show.hostName}</span>
                  </div>
                  <div className="inline-actions">
                    <button className="text-button" type="button" onClick={() => openEditShow(show)}>Edit</button>
                    <button className="secondary-action compact" type="button" onClick={() => void changeShowStatus(show, "restore")} disabled={busy || !limits.canCreate}>Restore</button>
                    <button className="text-button" type="button" onClick={() => void deleteShow(show)} disabled={busy}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer style={{ justifyContent: "flex-end" }}>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
