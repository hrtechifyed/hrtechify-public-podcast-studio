import type { ReactNode } from "react";
import { PLATFORM_CREDIT } from "@hrtechify/shared";
import { AccountPrivacyPanel } from "./AccountPrivacyPanel";

const PrivacySection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="show-form-card" style={{ marginTop: 18 }}>
    <div className="form-heading">
      <div>
        <h2>{title}</h2>
        <div className="muted" style={{ lineHeight: 1.7 }}>{children}</div>
      </div>
    </div>
  </section>
);

export function PrivacyPage() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HRTechify</div>
          <div className="brand">Podcast Studio</div>
        </div>
        <a className="secondary-action compact" href="/">Back to Studio</a>
      </header>

      <main className="shows-page" style={{ maxWidth: 980, margin: "0 auto" }}>
        <section className="shows-heading">
          <div>
            <p className="eyebrow">Privacy & your data</p>
            <h1>What the Studio can access — and what it cannot.</h1>
            <p>
              HRTechify Podcast Studio is designed to keep identity permissions narrow, keep permanent podcast media in storage you connect, and preserve original creator files.
            </p>
          </div>
        </section>

        <PrivacySection title="Google Sign-In is identity only">
          <p><strong>Requested Google Sign-In scope:</strong> <code>openid email</code>.</p>
          <p>That allows Google to tell the Studio a stable Google account identifier, the account&apos;s primary email address, and whether that email is verified. The Studio does not request the Google <code>profile</code> scope for sign-in.</p>
          <p><strong>Seeing your email address is not the same as reading your email.</strong> HRTechify does not request Gmail permissions and cannot use Google Sign-In to read, search, send, modify, archive, or delete Gmail messages.</p>
          <div className="trust-note" style={{ marginTop: 12 }}>
            <strong>Google Sign-In does not grant HRTechify access to:</strong>
            <span>Gmail inbox or message content · Gmail sending/modification · Google Contacts · Google Calendar · general Google activity · arbitrary Google Drive files.</span>
          </div>
        </PrivacySection>

        <PrivacySection title="Connected storage is a separate choice">
          <p>Signing in with Google does <strong>not</strong> connect Google Drive or Dropbox. Storage authorization happens separately only when you deliberately connect a provider.</p>
          <p><strong>Google Drive scope:</strong> <code>https://www.googleapis.com/auth/drive.file</code>. The Studio does not request broad <code>drive</code> or <code>drive.readonly</code> scopes.</p>
          <p><strong>Dropbox:</strong> HRTechify requires a Dropbox <strong>App Folder</strong> application and requests only account identification plus file metadata/content read-write scopes needed inside that app folder. It does not request Full Dropbox access.</p>
          <p>A show uses one explicitly assigned storage connection. The server rechecks the signed-in user, show and assigned provider before protected file operations.</p>
        </PrivacySection>

        <PrivacySection title="Where podcast files live">
          <p>Permanent podcast media remains in the storage you connect. Google Drive and Dropbox workspaces contain Brand Assets, Templates and Episodes. D1 stores account, show, authentication, ownership and workflow metadata; it is not the permanent podcast-media library.</p>
          <p>Original recordings, original logo/profile uploads and intro/outro media are treated as immutable application originals. A newer upload creates another file rather than silently overwriting the previous original.</p>
          <p>Derived caption files, technical masters, final MP3 files and final MP4 files are also stored as separate immutable application-created files. They never replace the source recording.</p>
          <p>Dropbox does not provide Google Drive-style custom app properties on files, so HRTechify stores a narrow D1 ownership/immutability index for Dropbox assets. The media bytes remain in the user&apos;s Dropbox App Folder.</p>
          <p>Deleting a show or account from the Studio does <strong>not</strong> delete files already stored in Google Drive or Dropbox. This is intentional to avoid destructive surprises.</p>
        </PrivacySection>

        <PrivacySection title="Brand image processing">
          <p>If you choose <strong>Remove background</strong>, the source image is processed through the Cloudflare Images binding to create a transparent PNG candidate. The candidate is stored as a separate immutable asset in the show&apos;s assigned storage.</p>
          <p>The original image remains unchanged. A generated result does not become the production choice automatically: you must explicitly choose <strong>Accept</strong>, <strong>Retry</strong>, or <strong>Keep Original</strong>.</p>
        </PrivacySection>

        <PrivacySection title="Podcast transcription, captions and edit analysis">
          <p>Podcast speech analysis runs only when you explicitly choose <strong>Analyze original recording</strong>. The server reads the exact immutable episode original belonging to the signed-in user and show and sends the audio to Cloudflare Workers AI for transcription and conservative edit-candidate detection. If the source is video, Cloudflare Media Transformations may first extract its audio track.</p>
          <p>The analyzer uses word timing to identify clear long pauses and repeated speech and may use a text model to propose clear false starts, repeated speech or fumbles. It is specifically instructed not to propose removing ideas, opinions, meaningful hesitation, emphasis, accents, dialect, grammar choices or stylistic wording.</p>
          <p><strong>Analysis never changes the original recording.</strong> D1 does not store the transcript text. To make captions reproducible, exact recognized word tokens/timestamps and a source WebVTT are saved as separate immutable files in the episode&apos;s assigned storage and tied to the exact source and completed analysis run.</p>
          <p>D1 stores proposal ranges, explanations, confidence values, analysis-run metadata and append-only user decisions. It does not become the permanent transcript library.</p>
          <p>Every spoken or timing change remains a proposal until you explicitly choose <strong>Apply in final edit</strong>. Choosing <strong>Keep Original</strong> rejects that proposed change. Neither choice overwrites, trims or replaces the source file.</p>
          <p>The final downloadable WebVTT is derived from recognized words after applying only approved cut ranges. Remaining word timing is shifted to the edited timeline and offset by the selected intro duration. The Studio does not use this step to rewrite what was said.</p>
          <p>This processing is unrelated to Gmail. Podcast analysis does not request or use Gmail, Contacts or Calendar permissions.</p>
        </PrivacySection>

        <PrivacySection title="Templates and final publishing">
          <p>The final video uses one of HRTechify&apos;s curated declarative templates. The browser may choose a template identifier and whether captions are burned into the MP4, but it cannot submit arbitrary FFmpeg filters, shell commands, font files, colors, coordinates, codecs or other free-form rendering instructions.</p>
          <p>Each render snapshots the selected approved template version, show name, episode name, host name, caption choice, exact analysis run and user-approved edit ranges. The final MP4 always includes <strong>{PLATFORM_CREDIT}</strong>; that credit is part of the fixed template contract and is not removable.</p>
          <p>A downloadable WebVTT caption file is created for the final timeline even when burned-in captions are turned off.</p>
        </PrivacySection>

        <PrivacySection title="Technical master and final MP3/MP4 rendering">
          <p>Rendering starts only after all proposed editorial changes have an explicit decision and you choose the final render action. The render plan is assembled server-side from those stored decisions, the fixed HRTechify technical-cleanup profile and your saved curated-template choice.</p>
          <p>The exact immutable episode source is streamed from its assigned storage connection into an isolated Cloudflare Container running FFmpeg. The render container has public internet access disabled. OAuth credentials and provider upload-session details remain Worker-side and are never passed into the container.</p>
          <p>Temporary source and working media exist only on the container&apos;s ephemeral disk while that render runs. The technical master is saved as a separate immutable FLAC. The Studio then creates separate final MP3, MP4 and WebVTT assets in the same show&apos;s Episodes storage.</p>
          <p>The current immutable show intro and outro are read as optional inputs when present. They are never modified. Audio-only intro/outro assets can be combined with a template-color visual for the video; video intro/outro assets are fitted into the final 1920 × 1080 frame.</p>
          <p>Technical cleanup uses two-pass loudness/peak normalization under the fixed podcast profile. Outside user-approved editorial cuts, the render verifies duration integrity and does not apply speaking-speed or pitch-changing filters. The final MP3 uses fixed podcast output settings and the final MP4 uses fixed H.264/AAC output settings.</p>
          <p>The workflow is retry-safe: output assets are linked to the exact source and render-job identity so retry logic can reuse the same derived output rather than intentionally creating duplicates.</p>
        </PrivacySection>

        <PrivacySection title="Passwords and account recovery">
          <p>For email/password accounts, HRTechify does not store readable or reversible passwords. Passwords are processed with <strong>PBKDF2-HMAC-SHA256</strong>, a unique random salt and <strong>600,000 iterations</strong>; only the resulting hash material is stored.</p>
          <p>Password sign-up is email-verification-first. Verification links expire after 30 minutes and are single-use. Password-reset links expire after 20 minutes and are single-use. The random link token itself is not stored in D1; only its SHA-256 hash is stored.</p>
          <p>Forgot-password responses intentionally do not disclose whether an email address has an account. Authentication abuse counters use hashed rate-limit keys rather than storing another raw copy of the email address in that control table.</p>
        </PrivacySection>

        <PrivacySection title="Sessions and OAuth credentials">
          <p>Signed-in Studio sessions use a server-signed cookie named <code>__Host-hrtechify_session</code> with <strong>HttpOnly</strong>, <strong>Secure</strong> and <strong>SameSite=Lax</strong> attributes. This prevents client-side JavaScript from reading the session cookie.</p>
          <p>Google Drive and Dropbox refresh tokens are encrypted server-side before storage. Provider OAuth access tokens and provider upload-session details stay on the server. Browser resumable flows receive HRTechify&apos;s own encrypted, user-bound capability token rather than raw refresh tokens.</p>
          <p>State-changing API requests are restricted to same-origin use. The Worker rejects explicit cross-site mutation requests and applies a restrictive Content Security Policy, anti-framing controls, MIME sniffing protection, no-referrer policy, HSTS over HTTPS, and a self-only microphone permission policy.</p>
        </PrivacySection>

        <PrivacySection title="Services involved">
          <p><strong>Cloudflare</strong> runs the Worker and D1 database, image processing when you request background removal, Workers AI when you request podcast analysis, Media Transformations when a video source needs its audio extracted, and isolated Workflows/Containers after you confirm rendering.</p>
          <p><strong>Google</strong> provides optional Google Sign-In and, separately, optional Google Drive storage when you authorize it.</p>
          <p><strong>Dropbox</strong> provides optional App Folder-confined storage when you authorize it. The Studio does not require Full Dropbox access.</p>
          <p><strong>Transactional email</strong> is used only for account verification, password recovery or authentication emails when email delivery is enabled. The current codebase uses a configured Resend integration; HRTechify does not need Gmail inbox access to send those emails.</p>
        </PrivacySection>

        <PrivacySection title="Account and retention controls">
          <p>Self-service account deletion removes HRTechify&apos;s D1 account metadata, authentication credentials, encrypted storage refresh tokens, show/episode records and workflow history, then clears the Studio session.</p>
          <p><strong>Connected storage files are intentionally preserved.</strong> Account deletion does not call Google Drive or Dropbox deletion APIs. If you also want those files removed, delete them directly from your Drive or Dropbox after or before deleting the Studio account.</p>
        </PrivacySection>

        <AccountPrivacyPanel />

        <PrivacySection title="Permission rule we enforce">
          <p><strong>Google Sign-In:</strong> <code>openid email</code> only.</p>
          <p><strong>Google Drive:</strong> separate authorization using <code>drive.file</code> only.</p>
          <p><strong>Dropbox:</strong> App Folder application with only the account/file scopes required for Studio storage; no Full Dropbox permission.</p>
          <p><strong>Gmail, Contacts, Calendar and broad Drive access:</strong> not requested.</p>
          <p>These permission restrictions are covered by automated regression tests so accidental expansion of provider access fails the repository test gate.</p>
        </PrivacySection>
      </main>

      <footer style={{ justifyContent: "space-between" }}>
        <a className="text-button" href="/">Back to Studio</a>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
