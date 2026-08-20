import { ChangeEvent, useEffect, useMemo, useState } from "react";

type BrandAssetKind = "show-logo-original" | "profile-photo-original";
type SelectionChoice = "original" | "background-removed";

interface BrandAssetRecord {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webViewLink: string | null;
  assetKind: string | null;
  immutable: boolean;
  createdTime: string | null;
  modifiedTime: string | null;
  canDownload: boolean;
}

interface BrandAssetsResponse {
  assets?: BrandAssetRecord[];
  error?: string;
}

interface BrandSelection {
  id: string;
  choice: SelectionChoice;
  sourceAssetId: string;
  selectedAssetId: string;
  createdTime: string | null;
}

interface CandidatePreview {
  sourceAssetId: string;
  candidate: BrandAssetRecord;
  previewUrl: string;
}

interface ShowBrandingPanelProps {
  showId: string;
  showName: string;
  connectionId: string;
}

const MAX_BRAND_ASSET_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const friendlyBrandError = (code?: string) => {
  switch (code) {
    case "brand_asset_mime_type_not_allowed":
      return "Use a PNG, JPEG or WebP image.";
    case "brand_asset_too_large":
      return "The image must be 8 MiB or smaller.";
    case "content_length_mismatch":
      return "The upload size changed while sending. Choose the file again.";
    case "images_binding_not_configured":
      return "Background removal is not enabled for this deployment yet.";
    case "background_removal_failed":
    case "background_removal_empty":
      return "The background could not be removed from this image. Keep the original or try again.";
    case "background_candidate_source_mismatch":
      return "That preview belongs to a different original. Generate a new preview for this image.";
    case "show_storage_connection_mismatch":
      return "This show is assigned to a different Drive account. Refresh the page and try again.";
    case "google_drive_authorization_expired":
    case "google_drive_access_token_failed":
      return "Google Drive needs to be reconnected before branding files can be used.";
    case "google_drive_rate_limited":
      return "Google Drive is temporarily rate-limiting requests. Try again shortly.";
    default:
      return code || "The branding asset could not be saved.";
  }
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

export function ShowBrandingPanel({ showId, showName, connectionId }: ShowBrandingPanelProps) {
  const [assets, setAssets] = useState<BrandAssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKind, setUploadingKind] = useState<BrandAssetKind | null>(null);
  const [processingSourceId, setProcessingSourceId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidatePreview | null>(null);
  const [selectionBySourceId, setSelectionBySourceId] = useState<Record<string, BrandSelection | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const newestLogo = useMemo(
    () => assets.find((asset) => asset.assetKind === "show-logo-original") ?? null,
    [assets],
  );
  const newestProfile = useMemo(
    () => assets.find((asset) => asset.assetKind === "profile-photo-original") ?? null,
    [assets],
  );

  const loadSelection = async (sourceAssetId: string) => {
    const url = new URL("/api/branding/background-removal/selection", window.location.origin);
    url.searchParams.set("showId", showId);
    url.searchParams.set("connectionId", connectionId);
    url.searchParams.set("sourceAssetId", sourceAssetId);
    const response = await fetch(url.toString(), { credentials: "same-origin" });
    const payload = (await response.json().catch(() => null)) as { selection?: BrandSelection | null; error?: string } | null;
    if (!response.ok) throw new Error(friendlyBrandError(payload?.error));
    setSelectionBySourceId((current) => ({ ...current, [sourceAssetId]: payload?.selection ?? null }));
  };

  const loadAssets = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/branding/assets", window.location.origin);
      url.searchParams.set("showId", showId);
      url.searchParams.set("connectionId", connectionId);
      const response = await fetch(url.toString(), { credentials: "same-origin" });
      const payload = (await response.json().catch(() => null)) as BrandAssetsResponse | null;
      if (!response.ok) throw new Error(friendlyBrandError(payload?.error));
      const nextAssets = payload?.assets ?? [];
      setAssets(nextAssets);
      const currentLogo = nextAssets.find((asset) => asset.assetKind === "show-logo-original");
      const currentProfile = nextAssets.find((asset) => asset.assetKind === "profile-photo-original");
      await Promise.all(
        [currentLogo, currentProfile]
          .filter((asset): asset is BrandAssetRecord => Boolean(asset))
          .map((asset) => loadSelection(asset.id)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load branding assets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCandidate(null);
    setSelectionBySourceId({});
    void loadAssets();
  }, [showId, connectionId]);

  const uploadAsset = async (
    assetKind: BrandAssetKind,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setNotice(null);

    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_BRAND_ASSET_BYTES) {
      setError("The image must be larger than zero bytes and 8 MiB or smaller.");
      return;
    }

    setUploadingKind(assetKind);
    try {
      const url = new URL("/api/branding/assets", window.location.origin);
      url.searchParams.set("showId", showId);
      url.searchParams.set("connectionId", connectionId);
      url.searchParams.set("assetKind", assetKind);
      url.searchParams.set("fileName", file.name);

      const response = await fetch(url.toString(), {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": file.type,
          "x-upload-size": String(file.size),
        },
        body: file,
      });
      const payload = (await response.json().catch(() => null)) as BrandAssetsResponse | null;
      if (!response.ok) throw new Error(friendlyBrandError(payload?.error));

      setCandidate(null);
      setNotice(
        assetKind === "show-logo-original"
          ? `Original logo saved for ${showName}.`
          : `Original profile photo saved for ${showName}.`,
      );
      await loadAssets();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The branding asset could not be saved.");
    } finally {
      setUploadingKind(null);
    }
  };

  const generateBackgroundPreview = async (source: BrandAssetRecord) => {
    setError(null);
    setNotice(null);
    setProcessingSourceId(source.id);
    try {
      const response = await fetch("/api/branding/background-removal/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showId, connectionId, sourceAssetId: source.id }),
      });
      const payload = (await response.json().catch(() => null)) as (CandidatePreview & { error?: string }) | null;
      if (!response.ok || !payload?.candidate || !payload.previewUrl) {
        throw new Error(friendlyBrandError(payload?.error));
      }
      setCandidate(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a background-removed preview.");
    } finally {
      setProcessingSourceId(null);
    }
  };

  const selectBrandVersion = async (
    source: BrandAssetRecord,
    choice: SelectionChoice,
    candidateAssetId?: string,
  ) => {
    setError(null);
    setNotice(null);
    setProcessingSourceId(source.id);
    try {
      const response = await fetch("/api/branding/background-removal/selection", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          showId,
          connectionId,
          sourceAssetId: source.id,
          choice,
          ...(candidateAssetId ? { candidateAssetId } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { selection?: BrandSelection; error?: string } | null;
      if (!response.ok || !payload?.selection) throw new Error(friendlyBrandError(payload?.error));
      setSelectionBySourceId((current) => ({ ...current, [source.id]: payload.selection! }));
      setCandidate(null);
      setNotice(
        choice === "background-removed"
          ? "Background-removed version accepted. The original remains unchanged in Drive."
          : "Original version kept. Any generated preview remains separate and does not replace it.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your branding choice.");
    } finally {
      setProcessingSourceId(null);
    }
  };

  const assetControl = (
    title: string,
    assetKind: BrandAssetKind,
    current: BrandAssetRecord | null,
  ) => {
    const selection = current ? selectionBySourceId[current.id] : null;
    const processing = current ? processingSourceId === current.id : false;
    return (
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <strong>{title}</strong>
        <p className="muted" style={{ margin: "6px 0 6px" }}>
          {current ? `${current.name} · ${formatBytes(current.sizeBytes)}` : "No original uploaded yet."}
        </p>
        {current && (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            {selection
              ? `Selected for production: ${selection.choice === "background-removed" ? "Background removed" : "Original"}`
              : "Production version not chosen yet."}
          </p>
        )}
        <div className="inline-actions">
          <label className="secondary-action compact" style={{ cursor: uploadingKind ? "not-allowed" : "pointer" }}>
            {uploadingKind === assetKind ? "Uploading…" : current ? "Upload a new original" : "Upload original"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={Boolean(uploadingKind) || Boolean(processingSourceId)}
              onChange={(event) => void uploadAsset(assetKind, event)}
            />
          </label>
          {current && (
            <button
              type="button"
              className="secondary-action compact"
              disabled={Boolean(processingSourceId) || Boolean(uploadingKind)}
              onClick={() => void generateBackgroundPreview(current)}
            >
              {processing ? "Removing background…" : "Remove background"}
            </button>
          )}
          {current?.webViewLink && (
            <a className="text-button" href={current.webViewLink} target="_blank" rel="noreferrer">
              Open original
            </a>
          )}
        </div>
      </div>
    );
  };

  const candidateSource = candidate
    ? assets.find((asset) => asset.id === candidate.sourceAssetId) ?? null
    : null;

  return (
    <section
      aria-label={`${showName} branding`}
      style={{
        marginTop: 14,
        padding: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <strong>Show branding</strong>
        <p className="muted" style={{ margin: "5px 0 0" }}>
          Originals stay unchanged in your Drive. Uploading a replacement keeps the previous original.
        </p>
      </div>

      {loading ? (
        <p className="muted">Loading branding…</p>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {assetControl("Show logo", "show-logo-original", newestLogo)}
          {assetControl("Profile photo", "profile-photo-original", newestProfile)}
        </div>
      )}

      {candidate && candidateSource && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 12,
          }}
        >
          <strong>Background-removed preview</strong>
          <p className="muted" style={{ margin: "5px 0 10px" }}>
            Nothing changes until you choose. The original remains stored unchanged.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div
              style={{
                width: 180,
                minHeight: 140,
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.08) 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
              }}
            >
              <img
                src={candidate.previewUrl}
                alt={`Background-removed preview for ${candidateSource.name}`}
                style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain" }}
              />
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-action compact"
                disabled={Boolean(processingSourceId)}
                onClick={() => void selectBrandVersion(candidateSource, "background-removed", candidate.candidate.id)}
              >
                Accept
              </button>
              <button
                type="button"
                className="secondary-action compact"
                disabled={Boolean(processingSourceId)}
                onClick={() => void generateBackgroundPreview(candidateSource)}
              >
                Retry
              </button>
              <button
                type="button"
                className="text-button"
                disabled={Boolean(processingSourceId)}
                onClick={() => void selectBrandVersion(candidateSource, "original")}
              >
                Keep Original
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="notice success" style={{ marginTop: 12 }}>{notice}</div>}
      {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}

      {assets.length > 2 && (
        <details style={{ marginTop: 12 }}>
          <summary>Previous originals ({assets.length - 2})</summary>
          <div className="archived-list" style={{ marginTop: 8 }}>
            {assets.slice(2).map((asset) => (
              <article key={asset.id}>
                <div>
                  <strong>{asset.name}</strong>
                  <span>{asset.assetKind === "show-logo-original" ? "Logo original" : "Profile photo original"} · {formatBytes(asset.sizeBytes)}</span>
                </div>
                {asset.webViewLink && (
                  <a className="text-button" href={asset.webViewLink} target="_blank" rel="noreferrer">Open</a>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
