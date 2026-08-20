import { FormEvent, useEffect, useState } from "react";

interface PrivacyPayload {
  account?: { email?: string; status?: string };
  retention?: Record<string, string>;
  deletion?: {
    confirmation?: string;
    storageFilesPreserved?: boolean;
    remoteStorageDeletionSupported?: boolean;
  };
  error?: string;
}

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

export function AccountPrivacyPanel() {
  const [payload, setPayload] = useState<PrivacyPayload | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [preserveFiles, setPreserveFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/account/privacy", { credentials: "same-origin" })
      .then(async (response) => {
        const next = await response.json().catch(() => null) as PrivacyPayload | null;
        if (!active || !response.ok) return;
        setPayload(next);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (confirmation !== DELETE_CONFIRMATION || !preserveFiles) {
      setError("Type DELETE MY ACCOUNT and confirm that your connected-storage files will be preserved.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, preserveStorageFiles: true }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "account_delete_failed");
      window.location.assign("/?account=deleted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account deletion could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="show-form-card" style={{ marginTop: 18 }} aria-label="Account deletion controls">
      <div className="form-heading">
        <div>
          <h2>Account deletion</h2>
          <div className="muted" style={{ lineHeight: 1.7 }}>
            <p>
              Delete your HRTechify Studio account metadata, authentication credentials, connected-storage tokens,
              show/episode records and workflow history. <strong>Your Google Drive and Dropbox files are preserved.</strong>
            </p>
            {payload?.account?.email && <p>Signed-in account: <strong>{payload.account.email}</strong>.</p>}
            <p>
              HRTechify intentionally does not call Google Drive or Dropbox delete APIs during account deletion.
              Remove those files yourself in the connected storage service if you also want the media deleted.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={deleteAccount} className="show-form-grid" style={{ marginTop: 12 }}>
        <label className="full-field">
          Type <strong>{DELETE_CONFIRMATION}</strong> to confirm
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="full-field" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={preserveFiles}
            onChange={(event) => setPreserveFiles(event.target.checked)}
            style={{ width: 18, height: 18, marginTop: 3 }}
          />
          <span>I understand that files already stored in my connected Google Drive or Dropbox are preserved and must be deleted there separately if I want them removed.</span>
        </label>
        {error && <div className="notice error full-field">{error}</div>}
        <div className="full-field form-actions">
          <button
            type="submit"
            className="secondary-action"
            disabled={busy || confirmation !== DELETE_CONFIRMATION || !preserveFiles}
          >
            {busy ? "Deleting account metadata…" : "Delete my HRTechify Studio account"}
          </button>
        </div>
      </form>
    </section>
  );
}
