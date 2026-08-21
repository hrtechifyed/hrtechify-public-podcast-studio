import { useEffect, useMemo, useState } from "react";
import { ShowBrandingPanel } from "./ShowBrandingPanel";

interface StorageConfig {
  providers?: { dropbox?: boolean };
  dropboxAccess?: string;
  dropboxScopes?: string[];
}

interface StorageConnection {
  id: string;
  provider: "google-drive" | "dropbox";
  accountEmail: string | null;
  status: "active" | "revoked" | "error";
}

interface Show {
  id: string;
  name: string;
  hostName: string;
  status: "active" | "archived" | "deleted";
  storageConnectionId: string | null;
}

const jsonOrNull = async <T,>(response: Response): Promise<T | null> => {
  try { return await response.json() as T; }
  catch { return null; }
};

const friendlyDropboxError = (code?: string) => {
  switch (code) {
    case "dropbox_not_configured": return "Dropbox is not configured for this deployment yet.";
    case "dropbox_connection_not_found": return "Connect Dropbox before assigning it to a show.";
    case "dropbox_connection_inactive": return "Reconnect this Dropbox account before using it.";
    case "dropbox_scope_insufficient": return "Dropbox did not grant the required App Folder file permissions. Reconnect Dropbox and approve the requested access.";
    case "dropbox_storage_schema_not_ready": return "Dropbox storage is waiting for the latest Studio database migration.";
    case "show_storage_connection_mismatch": return "This show is assigned to another storage account. Refresh and try again.";
    default: return code || "Dropbox storage could not be prepared.";
  }
};

export function DropboxStorageWorkspace() {
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [connections, setConnections] = useState<StorageConnection[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [busyShowId, setBusyShowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeDropbox = useMemo(
    () => connections.filter((item) => item.provider === "dropbox" && item.status === "active"),
    [connections],
  );
  const activeShows = useMemo(() => shows.filter((show) => show.status === "active"), [shows]);

  const refresh = async () => {
    const [configResponse, connectionsResponse, showsResponse] = await Promise.all([
      fetch("/api/storage/config", { credentials: "same-origin" }),
      fetch("/api/storage/connections", { credentials: "same-origin" }),
      fetch("/api/shows", { credentials: "same-origin" }),
    ]);
    if (configResponse.ok) setConfig(await jsonOrNull<StorageConfig>(configResponse));
    if (connectionsResponse.ok) {
      const payload = await jsonOrNull<{ connections?: StorageConnection[] }>(connectionsResponse);
      setConnections(payload?.connections ?? []);
    }
    if (showsResponse.ok) {
      const payload = await jsonOrNull<{ shows?: Show[] }>(showsResponse);
      setShows(payload?.shows ?? []);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const connectDropbox = () => {
    window.location.assign("/api/storage/dropbox/start?returnTo=/");
  };

  const assignShow = async (show: Show, connection: StorageConnection) => {
    setBusyShowId(show.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/storage/dropbox/provision", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showId: show.id, connectionId: connection.id }),
      });
      const payload = await jsonOrNull<{ workspace?: { showId?: string; provider?: string }; error?: string }>(response);
      if (!response.ok) throw new Error(friendlyDropboxError(payload?.error));
      if (payload?.workspace?.showId !== show.id || payload.workspace.provider !== "dropbox") {
        throw new Error("Dropbox did not confirm the requested show workspace.");
      }
      await refresh();
      setNotice(`Dropbox App Folder storage is ready for “${show.name}”. No other show was changed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dropbox storage could not be prepared.");
    } finally {
      setBusyShowId(null);
    }
  };

  const prepareAll = async (connection: StorageConnection) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/storage/dropbox/provision-active-shows", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      });
      const payload = await jsonOrNull<{ provisioned?: unknown[]; skipped?: unknown[]; error?: string }>(response);
      if (!response.ok) throw new Error(friendlyDropboxError(payload?.error));
      await refresh();
      const count = payload?.provisioned?.length ?? 0;
      setNotice(
        count > 0
          ? `${count} active show${count === 1 ? "" : "s"} prepared in this Dropbox App Folder. Existing shows assigned elsewhere were not moved.`
          : "Dropbox workspaces are already ready. Shows assigned to another storage account were not moved.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dropbox workspaces could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="shows-page" aria-label="Dropbox storage">
      <section className="show-form-card">
        <div className="form-heading">
          <div>
            <p className="eyebrow">Optional storage</p>
            <h2>Dropbox</h2>
            <p className="muted">
              Dropbox is separate from sign-in. HRTechify requests only App Folder access, so the Studio cannot browse the rest of your Dropbox. Files remain in your Dropbox even if you later delete the Studio account.
            </p>
          </div>
          <button
            type="button"
            className="secondary-action compact"
            onClick={connectDropbox}
            disabled={busy || config?.providers?.dropbox === false}
          >
            {activeDropbox.length > 0 ? "Add Dropbox account" : "Connect Dropbox"}
          </button>
        </div>

        {notice && <div className="notice success" style={{ marginTop: 12 }}>{notice}</div>}
        {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}

        {activeDropbox.length === 0 ? (
          <p className="muted">
            No Dropbox account is connected. Dropbox is optional and is authorized separately from Google sign-in. Access is confined to the HRTechify App Folder.
          </p>
        ) : (
          <div className="archived-list">
            {activeDropbox.map((connection) => (
              <article key={connection.id}>
                <div>
                  <strong>{connection.accountEmail || "Dropbox"}</strong>
                  <span>App Folder access only · no access to unrelated Dropbox files</span>
                </div>
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={() => void prepareAll(connection)}
                  disabled={busy}
                >
                  Check & prepare active shows
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {activeDropbox.length > 0 && activeShows.length > 0 && (
        <section className="show-form-card">
          <div className="form-heading">
            <div>
              <p className="eyebrow">Show storage</p>
              <h2>Use Dropbox for a show</h2>
              <p className="muted">Choose the exact Dropbox account for each show. Assigning one show does not move or alter another show.</p>
            </div>
          </div>

          <div className="archived-list">
            {activeShows.map((show) => {
              const assigned = connections.find((item) => item.id === show.storageConnectionId);
              return (
                <article key={show.id} style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <strong>{show.name}</strong>
                      <span>
                        {assigned?.provider === "dropbox"
                          ? `Dropbox · ${assigned.accountEmail || "connected"}`
                          : assigned?.provider === "google-drive"
                            ? `Currently Google Drive · ${assigned.accountEmail || "connected"}`
                            : "Storage not set"}
                      </span>
                    </div>
                    <div className="inline-actions">
                      {activeDropbox.map((connection) => (
                        <button
                          type="button"
                          key={connection.id}
                          className={show.storageConnectionId === connection.id ? "primary-action compact" : "secondary-action compact"}
                          disabled={busyShowId === show.id || busy}
                          onClick={() => void assignShow(show, connection)}
                        >
                          {busyShowId === show.id
                            ? "Preparing Dropbox…"
                            : show.storageConnectionId === connection.id
                              ? `Check & Fix Dropbox Workspace — ${connection.accountEmail || "Dropbox"}`
                              : `Use ${connection.accountEmail || "Dropbox"} for this show`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {assigned?.provider === "dropbox" && assigned.status === "active" && show.storageConnectionId && (
                    <div style={{ marginTop: 16 }}>
                      <p className="eyebrow">Dropbox-backed Studio workspace</p>
                      <ShowBrandingPanel showId={show.id} showName={show.name} connectionId={show.storageConnectionId} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
