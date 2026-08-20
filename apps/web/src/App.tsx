import {
  FormEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MAX_MUSIC_CUES_PER_EPISODE,
  MAX_SHOWS_PER_USER,
  PLATFORM_CREDIT,
  type MusicCue,
  type MusicIntensity,
  type MusicPlacement,
} from "@hrtechify/shared";
import {
  TEMPLATE_MUSIC_TRACKS,
  validateMusicPlan,
} from "@hrtechify/audio";
import {
  BrowserPodcastRecorder,
  type RecordingResult,
  type RecordingSession,
} from "@hrtechify/recorder";
import {
  TEMPLATE_CATALOG,
  templateById,
  type TemplateManifest,
} from "@hrtechify/templates";
import {
  createEpisodeDriveFolder,
  driveFolderUrl,
  ensureShowDriveWorkspace,
  requestGoogleDriveToken,
  uploadBlobResumable,
  uploadEpisodeMetadata,
} from "./google-drive";

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
  driveShowFolderId: string | null;
  driveEpisodesFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Episode {
  id: string;
  showId: string;
  title: string;
  status: string;
  sourceKind: "upload" | "recording";
  sourceFileName: string;
  driveEpisodeFolderId: string;
  templateId: string;
  templateVersion: number;
  musicPlan: MusicCue[];
  createdAt: string;
}

interface ShowLimits {
  used: number;
  maximum: number;
  canCreate: boolean;
}

interface AuthConfig {
  providers: {
    google: boolean;
    email: boolean;
  };
}

interface ProductConfig {
  maxShowsPerUser: number;
  maxMusicCuesPerEpisode: number;
  googleDriveClientId: string | null;
  googleDriveScope: string;
}

interface ShowFormState {
  name: string;
  hostDisplayName: string;
  description: string;
}

type Page = "shows" | "studio" | "episodes" | "templates";
type SourceMode = "upload" | "recording";

const emptyShowForm: ShowFormState = {
  name: "",
  hostDisplayName: "",
  description: "",
};

const initialRecordingSession: RecordingSession = {
  id: "",
  state: "idle",
  durationMs: 0,
  chunkCount: 0,
};

const jsonOrNull = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const musicTrack = (trackId: string) =>
  TEMPLATE_MUSIC_TRACKS.find((track) => track.id === trackId) ?? null;

const templateStyle = (template: TemplateManifest): CSSProperties => ({
  "--template-bg": template.artDirection.background,
  "--template-ink": template.artDirection.ink,
  "--template-accent": template.artDirection.accent,
  "--template-secondary": template.artDirection.secondary,
  "--template-script": template.artDirection.scriptFontStack,
  "--template-body": template.artDirection.bodyFontStack,
} as CSSProperties);

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [productConfig, setProductConfig] = useState<ProductConfig | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [limits, setLimits] = useState<ShowLimits>({
    used: 0,
    maximum: MAX_SHOWS_PER_USER,
    canCreate: true,
  });
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [page, setPage] = useState<Page>("shows");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [showForm, setShowForm] = useState<ShowFormState>(emptyShowForm);
  const [editingShowId, setEditingShowId] = useState<string | null>(null);
  const [showFormOpen, setShowFormOpen] = useState(false);

  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [recordingSession, setRecordingSession] = useState<RecordingSession>(initialRecordingSession);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [recordingDevices, setRecordingDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [recordingDeviceId, setRecordingDeviceId] = useState("");
  const [templateId, setTemplateId] = useState(TEMPLATE_CATALOG[0].id);
  const [musicCues, setMusicCues] = useState<MusicCue[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const recorderRef = useRef<BrowserPodcastRecorder | null>(null);

  if (!recorderRef.current) {
    recorderRef.current = new BrowserPodcastRecorder((session) => setRecordingSession(session));
  }

  const selectedShow = useMemo(
    () => shows.find((show) => show.id === selectedShowId) ?? null,
    [shows, selectedShowId],
  );
  const selectedTemplate = useMemo(
    () => templateById(templateId) ?? TEMPLATE_CATALOG[0],
    [templateId],
  );
  const sourceBlob = sourceMode === "upload" ? uploadedFile : recordingResult?.blob ?? null;
  const sourceName = sourceMode === "upload"
    ? uploadedFile?.name ?? ""
    : recordingResult?.fileName ?? "";
  const sourcePreviewUrl = useMemo(
    () => sourceBlob ? URL.createObjectURL(sourceBlob) : "",
    [sourceBlob],
  );

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  const loadShows = async () => {
    const response = await fetch("/api/shows", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load your shows.");
    const payload = await jsonOrNull<{ shows: Show[]; limits: ShowLimits }>(response);
    if (!payload) throw new Error("Could not read the shows response.");
    setShows(payload.shows);
    setLimits(payload.limits);
    if (selectedShowId && !payload.shows.some((show) => show.id === selectedShowId)) {
      setSelectedShowId(null);
      setPage("shows");
    }
  };

  const loadEpisodes = async (showId: string) => {
    const response = await fetch(`/api/shows/${encodeURIComponent(showId)}/episodes`, {
      credentials: "same-origin",
    });
    const payload = await jsonOrNull<{ episodes?: Episode[]; error?: string }>(response);
    if (!response.ok) throw new Error(payload?.error ?? "Could not load episodes.");
    setEpisodes(payload?.episodes ?? []);
  };

  const bootstrap = async () => {
    setLoading(true);
    setError(null);
    try {
      const [authResponse, configResponse, accountResponse] = await Promise.all([
        fetch("/api/auth/config", { credentials: "same-origin" }),
        fetch("/api/config", { credentials: "same-origin" }),
        fetch("/api/account", { credentials: "same-origin" }),
      ]);
      if (authResponse.ok) setAuthConfig(await jsonOrNull<AuthConfig>(authResponse));
      if (configResponse.ok) setProductConfig(await jsonOrNull<ProductConfig>(configResponse));
      if (accountResponse.ok) {
        const payload = await jsonOrNull<{ user: Account }>(accountResponse);
        if (payload?.user) {
          setAccount(payload.user);
          await loadShows();
        }
      } else if (accountResponse.status === 401) {
        setAccount(null);
      } else if (accountResponse.status === 503) {
        setAccount(null);
        setError("Authentication or the database is not configured for this deployment yet.");
      }
    } catch {
      setError("The studio could not reach its account service.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("auth");
    if (authStatus === "success") setNotice("You are signed in.");
    if (authStatus === "error") {
      setError(`Sign-in could not be completed${params.get("reason") ? `: ${params.get("reason")}` : "."}`);
    }
    if (authStatus) window.history.replaceState({}, "", window.location.pathname);
    void bootstrap();
  }, []);

  const signInWithGoogle = () => window.location.assign("/api/auth/google/start?returnTo=/");

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
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setAccount(null);
    setShows([]);
    setEpisodes([]);
    setDriveToken(null);
    setLimits({ used: 0, maximum: MAX_SHOWS_PER_USER, canCreate: true });
    setNotice("You are signed out.");
    setBusy(false);
  };

  const openCreateShow = () => {
    if (!limits.canCreate) {
      setError(`You can create up to ${limits.maximum} shows. Delete an existing show before adding another.`);
      return;
    }
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
      const response = await fetch(editingShowId ? `/api/shows/${editingShowId}` : "/api/shows", {
        method: editingShowId ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(showForm),
      });
      const payload = await jsonOrNull<{ error?: string; message?: string }>(response);
      if (!response.ok) {
        if (payload?.error === "show_limit_reached") {
          throw new Error(payload.message ?? `You can create up to ${MAX_SHOWS_PER_USER} shows. Delete one before adding another.`);
        }
        throw new Error(payload?.error ?? "Could not save the show.");
      }
      await loadShows();
      setShowFormOpen(false);
      setEditingShowId(null);
      setShowForm(emptyShowForm);
      setNotice(editingShowId ? "Show updated." : "Show created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the show.");
    } finally {
      setBusy(false);
    }
  };

  const deleteShow = async (show: Show) => {
    const confirmed = window.confirm(
      `Delete “${show.name}” from Podcast Studio?\n\nThis frees one of your five show slots. Your existing Google Drive folder and episode media will NOT be deleted.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/shows/${encodeURIComponent(show.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = await jsonOrNull<{ error?: string; message?: string }>(response);
      if (!response.ok) throw new Error(payload?.error ?? "Could not delete the show.");
      await loadShows();
      setNotice(payload?.message ?? "Show deleted from the Studio. Google Drive media was left untouched.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the show.");
    } finally {
      setBusy(false);
    }
  };

  const openStudio = async (show: Show) => {
    setSelectedShowId(show.id);
    setPage("studio");
    setError(null);
    setNotice(null);
    setEpisodeTitle("");
    setUploadedFile(null);
    setRecordingResult(null);
    setMusicCues([]);
    try {
      await loadEpisodes(show.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load episodes.");
    }
  };

  const connectDriveForSelectedShow = async () => {
    if (!selectedShow) return;
    const clientId = productConfig?.googleDriveClientId ?? "";
    setDriveBusy(true);
    setError(null);
    try {
      const token = await requestGoogleDriveToken(clientId);
      const workspace = await ensureShowDriveWorkspace(token, selectedShow);
      const response = await fetch(`/api/shows/${encodeURIComponent(selectedShow.id)}/storage/google-drive`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          showFolderId: workspace.showFolderId,
          episodesFolderId: workspace.episodesFolderId,
        }),
      });
      const payload = await jsonOrNull<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save the Google Drive workspace.");
      setDriveToken(token);
      await loadShows();
      setNotice(`Google Drive is ready for “${selectedShow.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect Google Drive.");
    } finally {
      setDriveBusy(false);
    }
  };

  const loadRecorderDevices = async () => {
    try {
      const devices = await recorderRef.current!.listInputDevices();
      setRecordingDevices(devices);
      if (!recordingDeviceId && devices[0]) setRecordingDeviceId(devices[0].deviceId);
    } catch {
      setRecordingDevices([]);
    }
  };

  const startRecording = async () => {
    setError(null);
    setRecordingResult(null);
    try {
      await recorderRef.current!.start(recordingDeviceId || undefined);
      await loadRecorderDevices();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Microphone recording could not start.");
    }
  };

  const stopRecording = async () => {
    setError(null);
    try {
      const result = await recorderRef.current!.stop();
      setRecordingResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording could not be stopped.");
    }
  };

  const recordAgain = async () => {
    if (recordingResult?.session.id) await recorderRef.current!.discard(recordingResult.session.id);
    setRecordingResult(null);
    setRecordingSession(initialRecordingSession);
  };

  const resetSourceWhenModeChanges = async (mode: SourceMode) => {
    if (recordingSession.state === "recording" || recordingSession.state === "paused") {
      setError("Stop the current recording before switching audio source.");
      return;
    }
    setSourceMode(mode);
    setError(null);
  };

  const addMusicCue = () => {
    if (musicCues.length >= MAX_MUSIC_CUES_PER_EPISODE) return;
    if (musicCues.some((cue) => cue.placement === "throughout")) return;
    const nextTrackId = selectedTemplate.musicTrackIds.find(
      (candidate) => !musicCues.some((cue) => cue.trackId === candidate),
    );
    if (!nextTrackId) return;
    setMusicCues((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        trackId: nextTrackId,
        intensity: "very-subtle",
        placement: current.length ? "interval" : "throughout",
        startSeconds: current.length ? 0 : 0,
        endSeconds: current.length ? 30 : null,
      },
    ]);
  };

  const updateMusicCue = (cueId: string, patch: Partial<MusicCue>) => {
    setMusicCues((current) => {
      const updated = current.map((cue) => cue.id === cueId ? { ...cue, ...patch } : cue);
      const changed = updated.find((cue) => cue.id === cueId);
      if (changed?.placement === "throughout" && patch.placement === "throughout") {
        return [{ ...changed, startSeconds: 0, endSeconds: null }];
      }
      return updated;
    });
  };

  const changeTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    setMusicCues([]);
  };

  const saveEpisode = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedShow) return;
    if (!sourceBlob || !sourceName) {
      setError("Choose an audio file or record your narration before saving the episode.");
      return;
    }
    if (!driveToken) {
      setError("Connect Google Drive for this page session before saving the episode.");
      return;
    }
    if (!selectedShow.driveEpisodesFolderId) {
      setError("This show does not have its Google Drive Episodes folder yet. Reconnect Google Drive.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setUploadProgress(0);
    try {
      const validatedMusic = validateMusicPlan(musicCues, selectedTemplate.musicTrackIds);
      const episodeId = crypto.randomUUID();
      const episodeFolder = await createEpisodeDriveFolder(
        driveToken,
        selectedShow.id,
        selectedShow.driveEpisodesFolderId,
        episodeId,
        episodeTitle,
      );
      const originalName = `original-${sourceName.replace(/[\\/:*?"<>|]+/g, "-")}`;
      const sourceFile = await uploadBlobResumable(
        driveToken,
        episodeFolder.id,
        originalName,
        sourceBlob,
        setUploadProgress,
      );
      const metadata = {
        schemaVersion: 1,
        episodeId,
        showId: selectedShow.id,
        showName: selectedShow.name,
        episodeTitle: episodeTitle.trim(),
        hostName: selectedShow.hostName,
        source: {
          kind: sourceMode,
          fileId: sourceFile.id,
          fileName: originalName,
          mimeType: sourceBlob.type,
          sizeBytes: sourceBlob.size,
          immutableOriginal: true,
        },
        template: {
          id: selectedTemplate.id,
          name: selectedTemplate.name,
          version: selectedTemplate.version,
        },
        musicPlan: validatedMusic,
        platformCredit: PLATFORM_CREDIT,
        createdAt: new Date().toISOString(),
      };
      await uploadEpisodeMetadata(driveToken, episodeFolder.id, metadata);

      const response = await fetch(`/api/shows/${encodeURIComponent(selectedShow.id)}/episodes`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: episodeId,
          title: episodeTitle,
          sourceKind: sourceMode,
          sourceFileId: sourceFile.id,
          sourceFileName: originalName,
          sourceMimeType: sourceBlob.type,
          sourceSizeBytes: sourceBlob.size,
          driveEpisodeFolderId: episodeFolder.id,
          templateId: selectedTemplate.id,
          templateVersion: selectedTemplate.version,
          musicPlan: validatedMusic,
        }),
      });
      const payload = await jsonOrNull<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save episode metadata.");

      await loadEpisodes(selectedShow.id);
      setEpisodeTitle("");
      setUploadedFile(null);
      if (recordingResult?.session.id) await recorderRef.current!.discard(recordingResult.session.id);
      setRecordingResult(null);
      setRecordingSession(initialRecordingSession);
      setMusicCues([]);
      setUploadProgress(null);
      setNotice("Episode source saved inside this show's Google Drive folder. Your original audio was preserved unchanged.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Episode could not be saved.");
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
              One account can create up to {MAX_SHOWS_PER_USER} shows. Every episode belongs to one show and can be kept inside that show's Google Drive workspace.
            </p>
            <div className="trust-note">
              <strong>Your voice stays under your control.</strong>
              <span>Upload audio or record here. Spoken-content changes still require your approval.</span>
            </div>
          </section>
          <section className="signin-card">
            <p className="eyebrow">Sign in</p>
            <h2>Enter your studio</h2>
            <p className="muted">Studio sign-in is separate from Google Drive permission.</p>
            {notice && <div className="notice success">{notice}</div>}
            {error && <div className="notice error">{error}</div>}
            <button type="button" className="google-button" onClick={signInWithGoogle} disabled={!authConfig?.providers.google || busy}>
              Continue with Google
            </button>
            {!authConfig?.providers.google && <p className="setup-hint">Google sign-in needs deployment credentials before it becomes available.</p>}
            <div className="divider"><span>or</span></div>
            <form onSubmit={requestMagicLink} className="stack-form">
              <label>
                Email address
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required disabled={busy || !authConfig?.providers.email} />
              </label>
              <button className="primary-action" type="submit" disabled={busy || !authConfig?.providers.email}>Email me a sign-in link</button>
            </form>
            {!authConfig?.providers.email && <p className="setup-hint">Magic-link email needs its delivery credentials before it becomes available.</p>}
            <p className="signin-footnote">No password is stored by HRTechify Podcast Studio.</p>
          </section>
        </main>
        <footer>
          <span>HRTechify · People · Technology · Growth</span>
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
        <button type="button" className={`nav-item ${page === "shows" ? "active" : ""}`} onClick={() => setPage("shows")}>My Shows</button>
        <button type="button" className={`nav-item ${page === "studio" ? "active" : ""}`} onClick={() => selectedShow ? setPage("studio") : setPage("shows")}>Studio</button>
        <button type="button" className={`nav-item ${page === "episodes" ? "active" : ""}`} onClick={() => selectedShow ? setPage("episodes") : setPage("shows")}>Episodes</button>
        <button type="button" className={`nav-item ${page === "templates" ? "active" : ""}`} onClick={() => setPage("templates")}>Templates</button>
        <a className="nav-link" href="https://github.com/hrtechifyed/hrtechify-public-podcast-studio/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noreferrer">How It Works</a>
      </nav>

      {notice && <div className="notice success wide-notice global-notice">{notice}</div>}
      {error && <div className="notice error wide-notice global-notice">{error}</div>}

      {page === "shows" && (
        <main className="shows-page">
          <section className="shows-heading">
            <div>
              <p className="eyebrow">Your account</p>
              <h1>My Shows</h1>
              <p>Each show has its own identity, episodes and Google Drive folder. A user can keep a maximum of five shows.</p>
            </div>
            <div className="show-limit-card">
              <strong>{limits.used} of {limits.maximum}</strong>
              <span>shows used</span>
              <div className="limit-track" aria-hidden="true"><span style={{ width: `${Math.min(100, (limits.used / limits.maximum) * 100)}%` }} /></div>
            </div>
          </section>

          <section className="shows-actions">
            <div>
              <h2>Your shows</h2>
              <p>{limits.canCreate ? `You can create ${limits.maximum - limits.used} more.` : `You have reached the ${limits.maximum}-show limit. Delete a show to add a new one.`}</p>
            </div>
            <button type="button" className="primary-action" onClick={openCreateShow} disabled={!limits.canCreate || busy}>+ Create show</button>
          </section>

          {showFormOpen && (
            <section className="show-form-card">
              <div className="form-heading">
                <div><p className="eyebrow">{editingShowId ? "Edit show" : "New show"}</p><h2>{editingShowId ? "Update show details" : "Create a podcast show"}</h2></div>
                <button type="button" className="text-button" onClick={() => setShowFormOpen(false)}>Cancel</button>
              </div>
              <form onSubmit={saveShow} className="show-form-grid">
                <label>Show name<input value={showForm.name} onChange={(event) => setShowForm({ ...showForm, name: event.target.value })} maxLength={120} required /></label>
                <label>Host name<input value={showForm.hostDisplayName} onChange={(event) => setShowForm({ ...showForm, hostDisplayName: event.target.value })} maxLength={120} required /></label>
                <label className="full-field">Show description <span>optional</span><textarea value={showForm.description} onChange={(event) => setShowForm({ ...showForm, description: event.target.value })} maxLength={1200} rows={4} /></label>
                <div className="full-field form-actions">
                  <button className="primary-action" type="submit" disabled={busy}>{editingShowId ? "Save changes" : "Create show"}</button>
                  <button className="secondary-action" type="button" onClick={() => setShowFormOpen(false)}>Cancel</button>
                </div>
              </form>
            </section>
          )}

          <section className="show-grid">
            {shows.map((show) => (
              <article className="show-card" key={show.id}>
                <div className="show-card-topline">
                  <span className="status-pill active-status">{show.status === "archived" ? "Archived" : "Show"}</span>
                  <span className="storage-pill">{show.driveShowFolderId ? "Google Drive ready" : "Drive not connected"}</span>
                </div>
                <div className="show-letter">{show.name.slice(0, 1).toUpperCase()}</div>
                <h3>{show.name}</h3>
                <p className="host-line">Hosted by {show.hostName}</p>
                {show.description && <p className="show-description">{show.description}</p>}
                <div className="show-card-actions">
                  <button type="button" className="primary-action compact" onClick={() => void openStudio(show)}>Open Studio</button>
                  <button type="button" className="text-button" onClick={() => openEditShow(show)}>Edit</button>
                  <button type="button" className="danger-text-button" onClick={() => void deleteShow(show)} disabled={busy}>Delete</button>
                </div>
              </article>
            ))}
            {limits.canCreate && (
              <button type="button" className="create-show-tile" onClick={openCreateShow}>
                <span>+</span><strong>Create another show</strong><small>{limits.maximum - limits.used} slots remaining</small>
              </button>
            )}
          </section>

          {shows.length === 0 && !showFormOpen && (
            <section className="empty-state">
              <div className="show-letter large">+</div>
              <h2>Create your first show</h2>
              <p>A show becomes the home for its host details, logo, templates, episodes and Google Drive storage.</p>
              <button className="primary-action" type="button" onClick={openCreateShow}>Create your first show</button>
            </section>
          )}
        </main>
      )}

      {page === "studio" && selectedShow && (
        <main className="studio-page">
          <section className="studio-heading">
            <div><p className="eyebrow">Studio · {selectedShow.name}</p><h1>Create an episode</h1><p>Upload audio or record here. The accepted source is preserved as the original inside this show's Drive folder.</p></div>
            <div className="drive-status">
              <strong>{selectedShow.driveShowFolderId ? "Drive workspace linked" : "Connect Google Drive"}</strong>
              <span>Permission is requested separately from Studio sign-in.</span>
              <button type="button" className="secondary-action compact" onClick={() => void connectDriveForSelectedShow()} disabled={driveBusy || !productConfig?.googleDriveClientId}>
                {driveBusy ? "Connecting…" : driveToken ? "Reconnect Drive" : "Connect Drive"}
              </button>
              {selectedShow.driveShowFolderId && <a href={driveFolderUrl(selectedShow.driveShowFolderId)} target="_blank" rel="noreferrer">Open show folder</a>}
            </div>
          </section>

          <form className="episode-composer" onSubmit={saveEpisode}>
            <section className="composer-section">
              <div className="section-heading"><div><p className="eyebrow">Episode</p><h2>Name it</h2></div></div>
              <label>Episode name<input value={episodeTitle} onChange={(event) => setEpisodeTitle(event.target.value)} maxLength={180} placeholder="The question I couldn't stop thinking about" required /></label>
            </section>

            <section className="composer-section">
              <div className="section-heading"><div><p className="eyebrow">Original audio</p><h2>Upload or record</h2></div><span className="microcopy">Your original is never overwritten.</span></div>
              <div className="source-choice" role="group" aria-label="Audio source">
                <button type="button" className={sourceMode === "upload" ? "choice active" : "choice"} onClick={() => void resetSourceWhenModeChanges("upload")}>Upload audio</button>
                <button type="button" className={sourceMode === "recording" ? "choice active" : "choice"} onClick={() => void resetSourceWhenModeChanges("recording")}>Record in Studio</button>
              </div>

              {sourceMode === "upload" ? (
                <div className="upload-area">
                  <input type="file" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" onChange={(event) => setUploadedFile(event.target.files?.[0] ?? null)} />
                  <p>{uploadedFile ? `${uploadedFile.name} · ${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB` : "Choose an existing narration or podcast recording."}</p>
                </div>
              ) : (
                <div className="recorder-area">
                  <div className="recorder-topline">
                    <span className={`recording-dot ${recordingSession.state === "recording" ? "live" : ""}`} />
                    <strong>{formatDuration(recordingSession.durationMs)}</strong>
                    <span>{recordingSession.state.replaceAll("_", " ")}</span>
                  </div>
                  {recordingDevices.length > 0 && (
                    <label>Microphone<select value={recordingDeviceId} onChange={(event) => setRecordingDeviceId(event.target.value)}>{recordingDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
                  )}
                  <div className="recorder-actions">
                    {!["recording", "paused"].includes(recordingSession.state) && !recordingResult && <button type="button" className="record-button" onClick={() => void startRecording()}>● Record</button>}
                    {recordingSession.state === "recording" && <button type="button" className="secondary-action" onClick={() => recorderRef.current!.pause()}>Pause</button>}
                    {recordingSession.state === "paused" && <button type="button" className="secondary-action" onClick={() => recorderRef.current!.resume()}>Resume</button>}
                    {["recording", "paused"].includes(recordingSession.state) && <button type="button" className="primary-action" onClick={() => void stopRecording()}>Stop & preview</button>}
                    {recordingResult && <button type="button" className="text-button" onClick={() => void recordAgain()}>Record again</button>}
                  </div>
                  <p className="microcopy">Recording is captured in small browser chunks so a long session does not depend on one giant in-memory blob.</p>
                </div>
              )}

              {sourcePreviewUrl && <audio className="audio-preview" controls src={sourcePreviewUrl} />}
            </section>

            <section className="composer-section">
              <div className="section-heading"><div><p className="eyebrow">Creative literature</p><h2>Choose a template</h2></div><span className="microcopy">No profile pictures. No formal boxes.</span></div>
              <div className="template-strip">
                {TEMPLATE_CATALOG.map((template) => (
                  <button key={template.id} type="button" className={`template-mini ${templateId === template.id ? "selected" : ""}`} style={templateStyle(template)} onClick={() => changeTemplate(template.id)}>
                    <span className={`mini-motif motif-${template.artDirection.motif}`} />
                    <strong>{template.name}</strong>
                    <small>{template.description}</small>
                  </button>
                ))}
              </div>
              <TemplatePreview template={selectedTemplate} show={selectedShow} episodeTitle={episodeTitle || "Your episode title"} />
            </section>

            <section className="composer-section">
              <div className="section-heading"><div><p className="eyebrow">Background music</p><h2>Build a subtle music plan</h2></div><span className="microcopy">Maximum {MAX_MUSIC_CUES_PER_EPISODE} tracks · template-owned · original CC0 procedural compositions</span></div>
              <div className="music-library">
                {selectedTemplate.musicTrackIds.map((trackId) => {
                  const track = musicTrack(trackId);
                  return track ? <div className="music-library-item" key={track.id}><strong>{track.title}</strong><span>{track.mood}</span><small>CC0 · HRTechify procedural original</small></div> : null;
                })}
              </div>
              <div className="music-cues">
                {musicCues.map((cue, index) => (
                  <div className="music-cue" key={cue.id}>
                    <div className="cue-number">{index + 1}</div>
                    <label>Music<select value={cue.trackId} onChange={(event) => updateMusicCue(cue.id, { trackId: event.target.value })}>{selectedTemplate.musicTrackIds.map((trackId) => <option key={trackId} value={trackId}>{musicTrack(trackId)?.title ?? trackId}</option>)}</select></label>
                    <label>Level<select value={cue.intensity} onChange={(event) => updateMusicCue(cue.id, { intensity: event.target.value as MusicIntensity })}><option value="very-subtle">Very subtle</option><option value="subtle">Subtle</option><option value="moderately-subtle">Moderately subtle</option></select></label>
                    <label>Where<select value={cue.placement} onChange={(event) => updateMusicCue(cue.id, { placement: event.target.value as MusicPlacement })}><option value="throughout">Throughout</option><option value="interval">Specific interval</option></select></label>
                    {cue.placement === "interval" && <div className="interval-fields"><label>From (sec)<input type="number" min="0" step="1" value={cue.startSeconds} onChange={(event) => updateMusicCue(cue.id, { startSeconds: Number(event.target.value) })} /></label><label>To (sec)<input type="number" min="1" step="1" value={cue.endSeconds ?? ""} onChange={(event) => updateMusicCue(cue.id, { endSeconds: Number(event.target.value) })} /></label></div>}
                    <button type="button" className="danger-text-button" onClick={() => setMusicCues((current) => current.filter((item) => item.id !== cue.id))}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary-action" onClick={addMusicCue} disabled={musicCues.length >= MAX_MUSIC_CUES_PER_EPISODE || musicCues.some((cue) => cue.placement === "throughout")}>+ Add music cue</button>
              {musicCues.length === 0 && <p className="microcopy">Music is optional. Leave this empty for narration-only audio.</p>}
            </section>

            <section className="composer-submit">
              <div><strong>Save episode source</strong><span>The original audio and metadata go into {selectedShow.name} → Episodes → this episode.</span></div>
              <button type="submit" className="primary-action" disabled={busy || !episodeTitle.trim() || !sourceBlob || !driveToken}>{busy ? "Saving…" : "Save episode to Drive"}</button>
              {uploadProgress !== null && <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>}
            </section>
          </form>
        </main>
      )}

      {page === "episodes" && (
        <main className="episodes-page">
          <section className="studio-heading">
            <div><p className="eyebrow">Episodes</p><h1>{selectedShow ? selectedShow.name : "Choose a show"}</h1><p>{selectedShow ? "Every episode below belongs to this show's Drive workspace." : "Open a show from My Shows to see its episodes."}</p></div>
            {selectedShow && <button className="primary-action" type="button" onClick={() => setPage("studio")}>Create episode</button>}
          </section>
          {selectedShow && episodes.length === 0 && <section className="empty-state"><h2>No episodes yet</h2><p>Create one in Studio by uploading audio or recording directly.</p></section>}
          <section className="episode-list">
            {episodes.map((episode) => (
              <article key={episode.id}>
                <div><p className="eyebrow">{episode.sourceKind === "recording" ? "Recorded in Studio" : "Uploaded audio"}</p><h3>{episode.title}</h3><span>{new Date(episode.createdAt).toLocaleString()}</span></div>
                <div className="episode-meta"><span>{templateById(episode.templateId)?.name ?? episode.templateId}</span><span>{episode.musicPlan.length ? `${episode.musicPlan.length} music cue${episode.musicPlan.length === 1 ? "" : "s"}` : "No background music"}</span><a href={driveFolderUrl(episode.driveEpisodeFolderId)} target="_blank" rel="noreferrer">Open Drive folder</a></div>
              </article>
            ))}
          </section>
        </main>
      )}

      {page === "templates" && (
        <main className="templates-page">
          <section className="studio-heading"><div><p className="eyebrow">Templates</p><h1>Literary, not corporate.</h1><p>Every built-in design uses open composition, readable cursive accents and a consistent caption-safe area. User profile photos are never rendered.</p></div></section>
          <section className="template-gallery">
            {TEMPLATE_CATALOG.map((template) => <TemplatePreview key={template.id} template={template} show={selectedShow ?? { name: "Your Podcast", hostName: "Your Name" }} episodeTitle="A story worth listening to" compact />)}
          </section>
        </main>
      )}

      <footer><span>HRTechify · People · Technology · Growth</span><span>{PLATFORM_CREDIT}</span></footer>
    </div>
  );
}

function TemplatePreview({
  template,
  show,
  episodeTitle,
  compact = false,
}: {
  template: TemplateManifest;
  show: Pick<Show, "name" | "hostName"> | { name: string; hostName: string };
  episodeTitle: string;
  compact?: boolean;
}) {
  return (
    <div className={`literary-template motif-${template.artDirection.motif} ${compact ? "compact-preview" : ""}`} style={templateStyle(template)}>
      <div className="literary-flourish flourish-one" />
      <div className="literary-flourish flourish-two" />
      <div className="literary-copy">
        <div className="literary-show-name">{show.name}</div>
        <div className="literary-episode-name">{episodeTitle}</div>
        <div className="literary-host">with {show.hostName}</div>
      </div>
      <div className="literary-waveform"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
      <div className="caption-demo">Closed captions remain readable here without clashing with the episode details.</div>
      <div className="platform-credit-preview">{PLATFORM_CREDIT}</div>
      <div className="template-name-ribbon">{template.name}</div>
    </div>
  );
}
