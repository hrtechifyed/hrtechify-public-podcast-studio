import { FormEvent, useEffect, useState } from "react";
import { EditorialApprovalPanel } from "./EditorialApprovalPanel";

interface EpisodeRecord {
  id: string;
  showId: string;
  title: string;
  status:
    | "draft"
    | "source_ready"
    | "analyzing"
    | "awaiting_edit_approval"
    | "awaiting_render_confirmation"
    | "rendering"
    | "completed"
    | "failed"
    | "cancelled";
  source: {
    provider: "google-drive" | "dropbox";
    storageConnectionId: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    immutable: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface EpisodeListProps {
  showId: string;
  showName: string;
}

const statusLabel = (status: EpisodeRecord["status"]) => {
  switch (status) {
    case "source_ready": return "Original saved";
    case "analyzing": return "Analyzing";
    case "awaiting_edit_approval": return "Waiting for edit approval";
    case "awaiting_render_confirmation": return "Ready for render confirmation";
    case "rendering": return "Rendering";
    case "completed": return "Completed";
    case "failed": return "Needs attention";
    case "cancelled": return "Cancelled";
    default: return "Draft";
  }
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

export function EpisodeList({ showId, showName }: EpisodeListProps) {
  const [episodes, setEpisodes] = useState<EpisodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEpisodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/episodes?showId=${encodeURIComponent(showId)}`, {
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as { episodes?: EpisodeRecord[]; error?: string } | null;
      if (response.status === 503 && payload?.error === "episode_schema_not_ready") {
        setSchemaReady(false);
        setEpisodes([]);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Could not load episodes.");
      setSchemaReady(true);
      setEpisodes(payload?.episodes ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load episodes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEpisodes();
  }, [showId]);

  const startEdit = (episode: EpisodeRecord) => {
    setEditingId(episode.id);
    setDraftTitle(episode.title);
    setError(null);
  };

  const saveTitle = async (event: FormEvent, episodeId: string) => {
    event.preventDefault();
    setBusyId(episodeId);
    setError(null);
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draftTitle }),
      });
      const payload = await response.json().catch(() => null) as { episode?: EpisodeRecord; error?: string } | null;
      if (!response.ok || !payload?.episode) throw new Error(payload?.error || "Could not update episode title.");
      setEpisodes((current) => current.map((episode) => episode.id === episodeId ? payload.episode! : episode));
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update episode title.");
    } finally {
      setBusyId(null);
    }
  };

  const updateEpisodeStatus = (episodeId: string, status: string) => {
    setEpisodes((current) => current.map((episode) =>
      episode.id === episodeId
        ? { ...episode, status: status as EpisodeRecord["status"] }
        : episode,
    ));
  };

  return (
    <section
      aria-label={`${showName} episodes`}
      style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow" style={{ marginTop: 0 }}>Episodes</p>
          <strong>Verified original recordings</strong>
          <p className="muted" style={{ margin: "5px 0 0" }}>Changing an episode title changes Studio metadata only. It never renames, edits or replaces the immutable original file in your storage.</p>
        </div>
        <button type="button" className="secondary-action compact" onClick={() => void loadEpisodes()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh episodes"}
        </button>
      </div>

      {!schemaReady ? (
        <div className="trust-note" style={{ marginTop: 12 }}>
          <strong>Episode tracking is not enabled in the database yet.</strong>
          <span>Original recordings can still be saved immutably in Drive. Episode records will become available after the Episode migration is applied.</span>
        </div>
      ) : loading ? (
        <p className="muted">Loading episodes…</p>
      ) : episodes.length === 0 ? (
        <p className="muted">No verified episode originals are registered yet. Save a recording above, then refresh this list.</p>
      ) : (
        <div className="archived-list" style={{ marginTop: 12 }}>
          {episodes.map((episode) => (
            <article key={episode.id}>
              <div style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    {editingId === episode.id ? (
                      <form onSubmit={(event) => void saveTitle(event, episode.id)} className="inline-actions">
                        <input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          maxLength={160}
                          required
                          aria-label="Episode title"
                        />
                        <button type="submit" className="primary-action compact" disabled={busyId === episode.id}>Save</button>
                        <button type="button" className="text-button" onClick={() => setEditingId(null)} disabled={busyId === episode.id}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <strong>{episode.title}</strong>
                        <span>
                          {statusLabel(episode.status)} · {formatBytes(episode.source.sizeBytes)} · immutable {episode.source.provider === "google-drive" ? "Google Drive" : "Dropbox"} original
                        </span>
                        <span>{episode.source.fileName}</span>
                      </>
                    )}
                  </div>
                  {editingId !== episode.id && (
                    <button type="button" className="secondary-action compact" onClick={() => startEdit(episode)}>
                      ✎ Edit title
                    </button>
                  )}
                </div>

                <EditorialApprovalPanel
                  episodeId={episode.id}
                  episodeTitle={episode.title}
                  episodeStatus={episode.status}
                  onStatusChange={(status) => updateEpisodeStatus(episode.id, status)}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
    </section>
  );
}
