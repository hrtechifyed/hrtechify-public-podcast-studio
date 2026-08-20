import type { ReactNode } from "react";
import { PLATFORM_CREDIT } from "@hrtechify/shared";

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
          <p>That allows Google to tell the Studio a stable Google account identifier, the account's primary email address, and whether that email is verified. The Studio does not request the Google <code>profile</code> scope for sign-in.</p>
          <p><strong>Seeing your email address is not the same as reading your email.</strong> HRTechify does not request Gmail permissions and cannot use Google Sign-In to read, search, send, modify, archive, or delete Gmail messages.</p>
          <div className="trust-note" style={{ marginTop: 12 }}>
            <strong>Google Sign-In does not grant HRTechify access to:</strong>
            <span>Gmail inbox or message content · Gmail sending/modification · Google Contacts · Google Calendar · general Google activity · arbitrary Google Drive files.</span>
          </div>
        </PrivacySection>

        <PrivacySection title="Google Drive is a separate choice">
          <p>Signing in with Google does <strong>not</strong> connect Google Drive. Drive is requested separately only when you choose <strong>Connect Google Drive</strong>.</p>
          <p><strong>Requested Drive scope:</strong> <code>https://www.googleapis.com/auth/drive.file</code>.</p>
          <p>The Studio does not request the broad <code>drive</code> or <code>drive.readonly</code> scopes. The narrow <code>drive.file</code> permission is used for files the application creates or that you deliberately use with the application; it is not permission to browse your entire Drive.</p>
          <p>The connected Drive account is show-scoped in the Studio. A show uses the Drive connection assigned to that show, and the server rechecks the assignment before protected file operations.</p>
        </PrivacySection>

        <PrivacySection title="Where podcast files live">
          <p>Permanent podcast media is designed to remain in the storage you connect. With Google Drive, show folders hold Brand Assets, Templates and Episodes. D1 stores account, show, authentication and workflow metadata; it is not the permanent podcast-media library.</p>
          <p>Original recordings, original logo/profile uploads and intro/outro media are treated as immutable application originals. A newer upload creates another file rather than silently overwriting the previous original.</p>
          <p>Derived caption files, technical masters, final MP3 files and final MP4 files are also stored as separate immutable application-created files. They never replace the source recording.</p>
          <p>Deleting a show from the Studio currently removes the show from the Studio but <strong>does not delete files already stored in your Google Drive</strong>. This is intentional to avoid destructive surprises.</p>
        </PrivacySection>

        <PrivacySection title="Brand image processing">
          <p>If you choose <strong>Remove background</strong>, the source image is processed through the Cloudflare Images binding to create a transparent PNG candidate. The candidate is then stored in the same show's connected Drive Brand Assets folder.</p>
          <p>The original image remains unchanged. A generated result does not become the production choice automatically: you must explicitly choose <strong>Accept</strong>, <strong>Retry</strong>, or <strong>Keep Original</strong>.</p>
        </PrivacySection>

        <PrivacySection title="Podcast transcription, captions and edit analysis">
          <p>Podcast speech analysis runs only when you explicitly choose <strong>Analyze original recording</strong>. The server reads the exact immutable episode original that belongs to your show and sends the audio to Cloudflare Workers AI for transcription and conservative edit-candidate detection. If the source is a video, Cloudflare Media Transformations may first extract its audio track.</p>
          <p>The current analyzer uses word timing to identify clear long pauses and repeated speech, and may use a text model to propose clear false starts, repeated speech or fumbles. It is specifically instructed not to propose removing ideas, opinions, meaningful hesitation, emphasis, accents, dialect, grammar choices or stylistic wording.</p>
          <p><strong>Analysis never changes the original recording.</strong> D1 does not store the transcript text. To make captions reproducible, the exact recognized word tokens and their timestamps, plus a source WebVTT file, are saved as separate immutable files in the episode's connected Drive. Those files are tied to the exact source recording and exact completed analysis run.</p>
          <p>D1 stores proposal ranges, explanations, confidence values, analysis-run metadata and your append-only decisions. It does not become the permanent transcript library.</p>
          <p>Every spoken or timing change remains a proposal until you explicitly choose <strong>Apply in final edit</strong>. Choosing <strong>Keep Original</strong> rejects that proposed change. Neither choice overwrites, trims or replaces the source file in your Drive.</p>
          <p>The final downloadable WebVTT is derived from the recognized words after applying only your approved cut ranges. Remaining word timing is shifted to the edited timeline and offset by the selected intro duration. The Studio does not use this step to rewrite what was said.</p>
          <p>This processing is unrelated to Gmail. Podcast analysis does not request or use Gmail, Contacts or Calendar permissions.</p>
        </PrivacySection>

        <PrivacySection title="Templates and final publishing">
          <p>The final video uses one of HRTechify's curated declarative templates. The browser may choose a template identifier and whether captions are burned into the MP4, but it cannot submit arbitrary FFmpeg filters, shell commands, font files, colors, coordinates, codecs or other free-form rendering instructions.</p>
          <p>Each render snapshots the selected approved template version, show name, episode name, host name, caption choice, exact analysis run and user-approved edit ranges. The final MP4 always includes <strong>{PLATFORM_CREDIT}</strong>; that credit is part of the fixed template contract and is not removable.</p>
          <p>A downloadable WebVTT caption file is created for the final timeline even when burned-in captions are turned off.</p>
        </PrivacySection>

        <PrivacySection title="Technical master and final MP3/MP4 rendering">
          <p>Rendering starts only after all proposed editorial changes have an explicit decision and you choose the final render action. The render plan is assembled server-side from those stored decisions, the fixed HRTechify technical-cleanup profile and your saved curated-template choice.</p>
          <p>The exact immutable episode source is streamed from its assigned Google Drive connection into an isolated Cloudflare Container running FFmpeg. The render container has public internet access disabled. Google OAuth credentials and Google Drive resumable-upload URLs are never passed into the container.</p>
          <p>Temporary source and working media exist only on the container's ephemeral disk while that render runs. The technical master is saved as a separate immutable FLAC. The Studio then creates a separate final MP3, final MP4 and final WebVTT in the same show's Episodes folder.</p>
          <p>The current immutable show intro and outro are read as optional inputs when present. They are never modified. Audio-only intro/outro assets can be combined with a template-color visual for the video; video intro/outro assets are fitted into the final 1920 × 1080 frame.</p>
          <p>Technical cleanup uses two-pass loudness/peak normalization under the fixed podcast profile. Outside user-approved editorial cuts, the render verifies duration integrity and does not apply speaking-speed or pitch-changing filters. The final MP3 uses fixed podcast output settings and the final MP4 uses fixed H.264/AAC output settings.</p>
          <p>The workflow is retry-safe: output files are tagged with the exact source file and render-job identity so a retry can reuse the same derived output instead of intentionally creating duplicates.</p>
        </PrivacySection>

        <PrivacySection title="Passwords and account recovery">
          <p>For email/password accounts, HRTechify does not store readable or reversible passwords. Passwords are processed with <strong>PBKDF2-HMAC-SHA256</strong>, a unique random salt and <strong>600,000 iterations</strong>; only the resulting hash material is stored.</p>
          <p>Password sign-up is email-verification-first. Verification links expire after 30 minutes and are single-use. Password-reset links expire after 20 minutes and are single-use. The random link token itself is not stored in D1; only its SHA-256 hash is stored.</p>
          <p>Forgot-password responses intentionally do not disclose whether an email address has an account. Authentication abuse counters use hashed rate-limit keys rather than storing another raw copy of the email address in that control table.</p>
        </PrivacySection>

        <PrivacySection title="Sessions and OAuth credentials">
          <p>Signed-in Studio sessions use a server-signed cookie named <code>__Host-hrtechify_session</code> with <strong>HttpOnly</strong>, <strong>Secure</strong> and <strong>SameSite=Lax</strong> attributes. This prevents client-side JavaScript from reading the session cookie.</p>
          <p>Google Drive refresh tokens are encrypted server-side before storage. Google OAuth access tokens and Google resumable-upload URLs stay on the server and are not returned to the browser or supplied to the render container. Browser uploads use HRTechify's own protected opaque resumable token.</p>
        </PrivacySection>

        <PrivacySection title="Services involved">
          <p><strong>Cloudflare</strong> runs the Worker and D1 database, the image-processing binding used when you explicitly request background removal, Workers AI used when you explicitly request podcast analysis, Media Transformations when a video source needs its audio extracted for analysis, and isolated Workflows/Containers used after you explicitly confirm rendering.</p>
          <p><strong>Google</strong> provides optional Google Sign-In and, separately, optional Google Drive storage when you authorize it.</p>
          <p><strong>Transactional email</strong> is used only for account verification, password recovery, or other account-authentication emails when email delivery is enabled. The current codebase uses a configured Resend integration for that delivery; HRTechify does not need Gmail inbox access to send those emails.</p>
        </PrivacySection>

        <PrivacySection title="Account and deletion controls">
          <p>You can sign out at any time and can delete individual shows from the Studio without deleting their Drive files. Full self-service account deletion and retention controls are part of the remaining privacy-hardening roadmap and should not be represented as complete until those controls are implemented and tested.</p>
          <p>Until then, the Studio should never claim that deleting a Studio account automatically deletes user-owned Drive media.</p>
        </PrivacySection>

        <PrivacySection title="Permission rule we enforce">
          <p><strong>Google Sign-In:</strong> <code>openid email</code> only.</p>
          <p><strong>Google Drive:</strong> separate authorization using <code>drive.file</code> only.</p>
          <p><strong>Gmail, Contacts, Calendar and broad Drive access:</strong> not requested.</p>
          <p>These scope restrictions are also covered by automated regression tests so an accidental expansion of Google permissions causes the repository test gate to fail.</p>
        </PrivacySection>
      </main>

      <footer style={{ justifyContent: "space-between" }}>
        <a className="text-button" href="/">Back to Studio</a>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
