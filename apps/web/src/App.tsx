import {
  MAX_ACTIVE_SHOWS_PER_USER,
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";

const navigation = [
  "Studio",
  "My Shows",
  "Episodes",
  "Templates",
  "How It Works",
  "Privacy & Your Data",
  "About HRTechify",
];

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HRTechify</div>
          <div className="brand">Podcast Studio</div>
        </div>
        <a
          className="github-link"
          href="https://github.com/hrtechifyed/hrtechify-public-podcast-studio"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </header>

      <nav className="nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <button key={item} type="button" className="nav-item">
            {item}
          </button>
        ))}
      </nav>

      <main>
        <section className="hero">
          <p className="eyebrow">Open-source · privacy-first · user-controlled</p>
          <h1>Record. Refine. Publish your podcast.</h1>
          <p className="hero-copy">
            Create branded podcast episodes, record directly in your browser or
            upload existing audio, review proposed speech edits, and keep final
            media in cloud storage you choose.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-action">
              Create your first show
            </button>
            <button type="button" className="secondary-action">
              How it works
            </button>
          </div>
        </section>

        <section className="principles" aria-label="Product principles">
          <article>
            <span>01</span>
            <h2>Your media stays yours</h2>
            <p>
              Permanent podcast media is designed to live in your selected
              Google Drive or Dropbox destination.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Your voice stays under your control</h2>
            <p>
              Technical cleanup may be automated. Spoken-content removal or
              meaningful timing changes require your approval.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Multiple shows, one account</h2>
            <p>
              Each account can manage up to {MAX_ACTIVE_SHOWS_PER_USER} active
              shows, each with independent branding, storage and episodes.
            </p>
          </article>
        </section>

        <section className="status-card">
          <div>
            <p className="eyebrow">Foundation status</p>
            <h2>Application skeleton ready for feature development</h2>
            <p>
              Authentication, storage connections, recording and rendering will
              be added in controlled phases after this baseline is validated.
            </p>
          </div>
          <dl>
            <div>
              <dt>Platform credit</dt>
              <dd>{PLATFORM_CREDIT}</dd>
            </div>
            <div>
              <dt>Required position</dt>
              <dd>{PLATFORM_CREDIT_POSITION}</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer>
        <span>People · Technology · Growth</span>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
