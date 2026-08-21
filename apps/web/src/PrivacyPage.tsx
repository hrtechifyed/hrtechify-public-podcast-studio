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
              HRTechify Podcast Studio keeps identity permissions narrow, keeps permanent podcast media in storage you connect, preserves creator originals, and runs final media generation on your own device.
            </p>
          </div>
        </section>

        <PrivacySection title="Google Sign-In is identity only">
          <p><strong>Requested Google Sign-In scope:</strong> <code>openid email</code>.</p>
          <p>That lets Google provide a stable account identifier, the primary email address and whether that email is verified. The Studio does not request the Google <code>profile</code> scope for sign-in.</p>
          <p><strong>Seeing your email address is not the same as reading your email.</strong> HRTechify does not request Gmail permissions and cannot use Google Sign-In to read, search, send, modify, archive or delete Gmail messages.</p>
          <div className="trust-note" style={{ marginTop: 12 }}>
            <strong>Google Sign-In does not grant HRTechify access to:</strong>
            <span>Gmail inbox or message content · Gmail sending/modification · Google Contacts · Google Calendar · general Google activity · arbitrary Google Drive files.</span>
          </div>
        </PrivacySection>

        <PrivacySection title="Connected storage is a separate choice">
          <p>Signing in with Google does <strong>not</strong> connect Google Drive or Dropbox. Storage authorization happens separately only when you deliberately connect a provider.</p>
          <p><strong>Google Drive scope:</strong> <code>https://www.googleapis.com/auth/drive.file</code>. The Studio does not request broad <code>drive</code> or <code>drive.readonly</code> scopes.</p>
          <p><strong>Dropbox:</strong> HRTechify requires a Dropbox <strong>App Folder</strong> application and only the account/file permissions needed inside that app folder. It does not request Full Dropbox access.</p>
          <p>A show uses one explicitly assigned storage connection. The server rechecks the signed-in user, show and assigned provider before protected file operations.</p>
        </PrivacySection>

        <PrivacySection title="Where podcast files live">
          <p>Permanent podcast media remains in the storage you connect. Google Drive and Dropbox workspaces contain Brand Assets, Templates and Episodes. D1 stores account, show, authentication, ownership and workflow metadata; it is not the permanent podcast-media library.</p>
          <p>Original recordings, original logo/profile uploads and intro/outro media are immutable application originals. A newer upload creates another file rather than silently replacing the previous original.</p>
          <p>Derived captions, technical masters, final MP3 files and final MP4 files are saved as separate immutable files. They never replace the source recording.</p>
          <p>Deleting a show or account from the Studio does <strong>not</strong> delete files already stored in Google Drive or Dropbox. This is intentional to avoid destructive surprises.</p>
        </PrivacySection>

        <PrivacySection title="Free-use and processing rule">
          <p><strong>Final podcast generation runs on your device.</strong> HRTechify does not use a paid Cloudflare Container or paid server-render farm for final MP3/MP4 generation.</p>
          <p>The Studio is designed around free-tier platform services. If a free allowance or platform limit is reached, the affected feature may pause, return an error or become temporarily unavailable rather than intentionally switching the job to paid server processing.</p>
          <p>Because your computer performs final generation, speed depends on your processor, available memory, browser and episode length. Keep the tab open until generation finishes.</p>
        </PrivacySection>

        <PrivacySection title="Brand image processing">
          <p>If you choose <strong>Remove background</strong>, the source image can be processed through the configured Cloudflare Images binding to create a transparent PNG candidate. This is an optional action and is subject to the available free-plan allowance.</p>
          <p>The original image remains unchanged. A generated result does not become the production choice automatically: you must explicitly choose <strong>Accept</strong>, <strong>Retry</strong>, or <strong>Keep Original</strong>.</p>
        </PrivacySection>

        <PrivacySection title="Podcast transcription, captions and edit analysis">
          <p>Podcast speech analysis runs only when you explicitly choose <strong>Analyze original recording</strong>. The server reads the exact immutable episode original belonging to the signed-in user and show and can use the configured Cloudflare Workers AI binding for transcription and conservative edit-candidate detection.</p>
          <p>The analyzer is designed to identify clear technical or accidental speech-edit candidates such as long pauses, clear false starts, repeated speech or fumbles. It is not intended to remove ideas, opinions, meaningful hesitation, emphasis, accents, dialect, grammar choices or stylistic wording.</p>
          <p><strong>Analysis never changes the original recording.</strong> D1 does not store transcript text. Exact recognized word tokens/timestamps and a source WebVTT are saved as separate immutable files in the episode&apos;s assigned storage so captions can be reproduced later.</p>
          <p>D1 stores proposal ranges, explanations, confidence values, analysis-run metadata and append-only user decisions. Every spoken or timing change remains a proposal until you explicitly choose <strong>Apply in final edit</strong> or <strong>Keep Original</strong>.</p>
          <p>Server-side video-to-audio Media Transformations are not part of the zero-bill production configuration. If an input needs a processing path that is unavailable within the configured free architecture, the Studio should stop clearly rather than silently invoke paid media processing.</p>
        </PrivacySection>

        <PrivacySection title="Templates and final publishing">
          <p>The final video uses one of HRTechify&apos;s curated declarative templates. The browser chooses only the approved template identity and caption preference; it cannot supply arbitrary shell commands or unrestricted rendering instructions.</p>
          <p>Each generation snapshots the selected template version, show name, episode name, host name, caption choice, exact analysis run and user-approved edit ranges. The final MP4 includes <strong>{PLATFORM_CREDIT}</strong>; that credit is part of the fixed template contract and is not removable.</p>
          <p>A downloadable WebVTT caption file is created for the final timeline even when burned-in captions are turned off or unavailable in the local renderer.</p>
        </PrivacySection>

        <PrivacySection title="How on-device final generation works">
          <p>After all proposed editorial changes have an explicit decision, the Worker prepares a fixed render plan and authenticated same-origin download routes for the exact source, caption timing and current intro/outro files that belong to the signed-in user and assigned show storage.</p>
          <p>Your browser then loads a pinned FFmpeg WebAssembly runtime and performs the heavy audio/video work locally. Temporary media lives in browser memory and the local WebAssembly file system for that generation session; HRTechify does not create a paid server-rendering copy.</p>
          <p>The browser applies only approved cut ranges, targets the fixed podcast loudness/peak settings, creates a separate FLAC technical master, WebVTT captions, MP3 and MP4, and preserves words, pitch and speaking speed outside approved cuts.</p>
          <p>Completed files are streamed back through authenticated HRTechify routes into the show&apos;s assigned Google Drive or Dropbox. Provider refresh tokens remain server-side and are never exposed to browser JavaScript.</p>
          <p>If saving back to connected storage fails, the generated files can remain available for local download during that browser session. The immutable source is still unchanged.</p>
        </PrivacySection>

        <PrivacySection title="FFmpeg WebAssembly code download">
          <p>The browser downloads a pinned FFmpeg WebAssembly runtime from <strong>jsDelivr</strong> when local generation starts. This download is executable media-processing code, not your podcast data.</p>
          <p>Your source recording, caption timing, technical master, MP3 and MP4 are not uploaded to jsDelivr. Podcast files are downloaded only through authenticated HRTechify storage routes and are processed locally in the browser.</p>
        </PrivacySection>

        <PrivacySection title="Passwords and account recovery">
          <p>For email/password accounts, HRTechify does not store readable or reversible passwords. Passwords are processed with <strong>PBKDF2-HMAC-SHA256</strong>, a unique random salt and <strong>600,000 iterations</strong>; only the resulting hash material is stored.</p>
          <p>Password sign-up is email-verification-first. Verification links expire after 30 minutes and are single-use. Password-reset links expire after 20 minutes and are single-use. The random link token itself is not stored in D1; only its SHA-256 hash is stored.</p>
          <p>Forgot-password responses intentionally do not disclose whether an email address has an account.</p>
        </PrivacySection>

        <PrivacySection title="Sessions and OAuth credentials">
          <p>Signed-in Studio sessions use a server-signed cookie named <code>__Host-hrtechify_session</code> with <strong>HttpOnly</strong>, <strong>Secure</strong> and <strong>SameSite=Lax</strong> attributes. Client-side JavaScript cannot read that cookie.</p>
          <p>Google Drive and Dropbox refresh tokens are encrypted server-side before storage. Provider OAuth access tokens and provider upload-session details stay on the server.</p>
          <p>State-changing API requests are restricted to same-origin use. The Worker applies a restrictive Content Security Policy, anti-framing controls, MIME sniffing protection, no-referrer policy, HSTS over HTTPS and a self-only microphone permission policy.</p>
        </PrivacySection>

        <PrivacySection title="Services involved">
          <p><strong>Cloudflare</strong> runs the Worker and D1 database and can provide optional free-plan Workers AI and Images capabilities when available. Paid Containers, paid server-rendering Workflows and Media Transformations are not part of the zero-bill final-generation configuration.</p>
          <p><strong>Google</strong> provides optional Google Sign-In and, separately, optional Google Drive storage when you authorize it.</p>
          <p><strong>Dropbox</strong> provides optional App Folder-confined storage when you authorize it.</p>
          <p><strong>jsDelivr</strong> delivers the pinned FFmpeg WebAssembly runtime code used for local media generation; podcast media is not sent there.</p>
          <p><strong>Transactional email</strong> is used only for account verification, password recovery or authentication emails when email delivery is enabled. The current codebase uses a configured Resend integration; HRTechify does not need Gmail inbox access to send those emails.</p>
        </PrivacySection>

        <PrivacySection title="Account and retention controls">
          <p>Self-service account deletion removes HRTechify&apos;s D1 account metadata, authentication credentials, encrypted storage refresh tokens, show/episode records and workflow history, then clears the Studio session.</p>
          <p><strong>Connected storage files are intentionally preserved.</strong> Account deletion does not call Google Drive or Dropbox deletion APIs. If you also want those files removed, delete them directly from your Drive or Dropbox.</p>
        </PrivacySection>

        <AccountPrivacyPanel />

        <PrivacySection title="Permission rule we enforce">
          <p><strong>Google Sign-In:</strong> <code>openid email</code> only.</p>
          <p><strong>Google Drive:</strong> separate authorization using <code>drive.file</code> only.</p>
          <p><strong>Dropbox:</strong> App Folder application with only the account/file scopes required for Studio storage; no Full Dropbox permission.</p>
          <p><strong>Gmail, Contacts, Calendar and broad Drive access:</strong> not requested.</p>
        </PrivacySection>
      </main>

      <footer style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 16 }}>
          <a className="text-button" href="/">Back to Studio</a>
          <a className="text-button" href="/usage">Usage & processing</a>
        </div>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
