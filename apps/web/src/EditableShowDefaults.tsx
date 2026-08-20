import { useEffect, useState } from "react";
import { HRTECHIFY_STARTER_EPISODE_NAME } from "@hrtechify/shared";

type EditableField = "show" | "host" | "episode" | null;

interface EditableShowDefaultsProps {
  showId: string;
  showName: string;
  hostName: string;
  description: string | null;
  onUpdated: () => Promise<unknown> | void;
}

const fieldStyle = (editing: boolean) => ({
  background: editing ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
  opacity: editing ? 1 : 0.72,
  cursor: editing ? "text" : "default",
});

export function EditableShowDefaults({
  showId,
  showName,
  hostName,
  description,
  onUpdated,
}: EditableShowDefaultsProps) {
  const [editing, setEditing] = useState<EditableField>(null);
  const [showValue, setShowValue] = useState<string>(showName);
  const [hostValue, setHostValue] = useState<string>(hostName);
  const [episodeValue, setEpisodeValue] = useState<string>(HRTECHIFY_STARTER_EPISODE_NAME);
  const [savedEpisodeValue, setSavedEpisodeValue] = useState<string>(HRTECHIFY_STARTER_EPISODE_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShowValue(showName);
    setHostValue(hostName);
  }, [showName, hostName]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/shows/${encodeURIComponent(showId)}/preferences`, {
          credentials: "same-origin",
        });
        const payload = await response.json().catch(() => null) as {
          preferences?: { defaultEpisodeName?: string };
        } | null;
        if (!active || !response.ok) return;
        const value = payload?.preferences?.defaultEpisodeName || HRTECHIFY_STARTER_EPISODE_NAME;
        setEpisodeValue(value);
        setSavedEpisodeValue(value);
      } catch {
        // The visible starter value remains usable; save will surface a real error if needed.
      }
    };
    void load();
    return () => { active = false; };
  }, [showId]);

  const begin = (field: Exclude<EditableField, null>) => {
    setError(null);
    setEditing(field);
  };

  const cancel = () => {
    setShowValue(showName);
    setHostValue(hostName);
    setEpisodeValue(savedEpisodeValue);
    setEditing(null);
    setError(null);
  };

  const saveShowDetails = async () => {
    const response = await fetch(`/api/shows/${encodeURIComponent(showId)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: showValue,
        hostDisplayName: hostValue,
        description: description ?? "",
      }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "Could not update show details.");
    await onUpdated();
  };

  const saveEpisodeDefault = async () => {
    const response = await fetch(`/api/shows/${encodeURIComponent(showId)}/preferences`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEpisodeName: episodeValue }),
    });
    const payload = await response.json().catch(() => null) as {
      error?: string;
      preferences?: { defaultEpisodeName?: string };
    } | null;
    if (!response.ok) throw new Error(payload?.error || "Could not update the episode name.");
    const saved = payload?.preferences?.defaultEpisodeName || episodeValue;
    setEpisodeValue(saved);
    setSavedEpisodeValue(saved);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editing === "episode") await saveEpisodeDefault();
      else await saveShowDetails();
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this value.");
    } finally {
      setBusy(false);
    }
  };

  const row = (
    field: Exclude<EditableField, null>,
    label: string,
    value: string,
    setValue: (value: string) => void,
    maxLength: number,
  ) => {
    const isEditing = editing === field;
    return (
      <label style={{ display: "block" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>{label}</span>
          {!isEditing && (
            <button
              type="button"
              className="text-button"
              aria-label={`Edit ${label}`}
              title={`Edit ${label}`}
              onClick={() => begin(field)}
              disabled={busy || Boolean(editing)}
              style={{ fontSize: 18, lineHeight: 1 }}
            >
              ✎
            </button>
          )}
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          readOnly={!isEditing}
          aria-readonly={!isEditing}
          maxLength={maxLength}
          style={fieldStyle(isEditing)}
        />
        {isEditing && (
          <span className="inline-actions" style={{ marginTop: 7 }}>
            <button type="button" className="primary-action compact" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="text-button" onClick={cancel} disabled={busy}>Cancel</button>
          </span>
        )}
      </label>
    );
  };

  return (
    <section aria-label="Editable show defaults" style={{ marginTop: 14 }}>
      <p className="eyebrow">Show defaults</p>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        These values start with HRTechify examples. Each stays greyed until you use its pencil, and every value can be changed.
      </p>
      <div className="show-form-grid">
        {row("show", "Show Name", showValue, setShowValue, 120)}
        {row("host", "Host Name", hostValue, setHostValue, 120)}
        <div className="full-field">
          {row("episode", "Episode Name", episodeValue, setEpisodeValue, 160)}
          <p className="setup-hint">This is the default name the Studio will prefill for the next new episode.</p>
        </div>
      </div>
      {error && <div className="notice error" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
