import { useEffect, useState } from "react";

interface TemplateOption {
  id: string;
  name: string;
  version: number;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  platformCredit: {
    text: string;
    required: true;
    removable: false;
    position: "bottom-right";
  };
}

interface PublishPreferences {
  episodeId: string;
  templateId: string;
  templateVersion: number;
  captionsEnabled: boolean;
  updatedAt: string;
}

interface Props {
  episodeId: string;
  episodeStatus: string;
}

export function PublishPreferencesPanel({ episodeId, episodeStatus }: Props) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [preferences, setPreferences] = useState<PublishPreferences | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const locked = ["rendering", "completed", "cancelled"].includes(episodeStatus);

  const load = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/publish-preferences`, {
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        preferences?: PublishPreferences;
        templates?: TemplateOption[];
        error?: string;
      } | null;
      if (response.status === 503 && payload?.error === "publish_preferences_schema_not_ready") {
        setSchemaReady(false);
        return;
      }
      if (!response.ok || !payload?.preferences) {
        throw new Error(payload?.error || "Could not load final-publish settings.");
      }
      setSchemaReady(true);
      setPreferences(payload.preferences);
      setTemplates(payload.templates ?? []);
      setTemplateId(payload.preferences.templateId);
      setCaptionsEnabled(payload.preferences.captionsEnabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load final-publish settings.");
    }
  };

  useEffect(() => {
    void load();
  }, [episodeId]);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/publish-preferences`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, captionsEnabled }),
      });
      const payload = await response.json().catch(() => null) as {
        preferences?: PublishPreferences;
        templates?: TemplateOption[];
        error?: string;
      } | null;
      if (!response.ok || !payload?.preferences) {
        throw new Error(payload?.error || "Could not save final-publish settings.");
      }
      setPreferences(payload.preferences);
      setTemplates(payload.templates ?? templates);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save final-publish settings.");
    } finally {
      setBusy(false);
    }
  };

  if (!schemaReady) {
    return (
      <div className="trust-note" style={{ marginTop: 10 }}>
        <strong>Final-publish settings are not enabled in the database yet.</strong>
        <span>No template or caption choice can be applied until the publish-preferences migration is active.</span>
      </div>
    );
  }

  if (!preferences) {
    return error ? <div className="notice error" style={{ marginTop: 10 }}>{error}</div> : null;
  }

  const selected = templates.find((template) => template.id === templateId) ?? null;

  return (
    <div className="trust-note" style={{ marginTop: 10 }}>
      <strong>Final video style</strong>
      <span>
        Choose one of HRTechify's curated templates. These are fixed declarative layouts—not user-supplied rendering commands. The final video always includes “Powered by HRTechify”.
      </span>

      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <label>
          <span>Template</span>
          <select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setSaved(false); }} disabled={locked || busy}>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>

        {selected && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: selected.backgroundColor, border: "1px solid rgba(255,255,255,0.2)" }} />
            <span>{selected.name} · version {selected.version} · credit fixed {selected.platformCredit.position}</span>
          </div>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={captionsEnabled}
            onChange={(event) => { setCaptionsEnabled(event.target.checked); setSaved(false); }}
            disabled={locked || busy}
          />
          <span>Burn approved-timeline captions into the final MP4</span>
        </label>
        <span>A downloadable WebVTT caption file is still created even when burned-in captions are turned off.</span>
      </div>

      {!locked && (
        <button type="button" className="secondary-action compact" onClick={() => void save()} disabled={busy || !templateId} style={{ marginTop: 8 }}>
          {busy ? "Saving…" : "Save final-publish settings"}
        </button>
      )}
      {locked && <span>These settings are locked because rendering has already started.</span>}
      {saved && <span>Final-publish settings saved.</span>}
      {error && <div className="notice error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
