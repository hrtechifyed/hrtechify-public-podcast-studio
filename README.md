# HRTechify Public Podcast Studio

**Record. Refine. Publish your podcast.**

HRTechify Public Podcast Studio is an open-source, privacy-first, multi-user podcast production platform by **HRTechify — People • Technology • Growth**.

The project is completely independent from HRTechify's private podcast repository. It is designed for multiple creators, up to five shows per user, browser recording or audio upload, user-owned Google Drive storage, literary templates, template-owned CC0 background music, approval-controlled speech edits and transparent documentation about how voice and data are handled.

## Core product principles

- One user account may keep up to **5 non-deleted shows total**.
- When five shows exist, the Studio tells the user to delete one before creating another.
- Every show has its own name, host, optional creator logo, templates, episodes and Google Drive workspace.
- Creator **profile photographs are never rendered inside templates**.
- Google Drive is the first implemented permanent-media destination. Every show's episodes live inside that show's Drive folder.
- Users may **record directly in the browser** or upload an existing audio recording.
- The original source recording is preserved and never overwritten by the production pipeline.
- Technical audio cleanup may be automated, but proposed edits that remove or change spoken content require explicit user approval.
- Built-in templates use creative literary art direction, readable cursive accents and **no formal information boxes** in the rendered design.
- Every built-in template owns three optional **HRTechify procedural CC0-1.0 music choices**.
- An episode may use up to three different music cues at very-subtle, subtle or moderately-subtle level, either throughout or in non-overlapping intervals.
- Every generated podcast video must visibly carry **“Podcast Powered by HRTechify”** in the bottom-right corner.
- The public repository contains source code and documentation, but never production secrets, OAuth tokens or user media.

## Current Studio flow

1. Create or sign in to an account.
2. Create a show, up to the five-show limit.
3. Open that show's Studio.
4. Connect Google Drive using the narrow `drive.file` permission.
5. The Studio creates/reuses `HRTechify Podcast Studio/<Show>/Episodes/` in the user's Drive.
6. Name an episode.
7. Upload audio or record directly with the browser recorder.
8. Select a literary template.
9. Optionally select up to three template-owned background-music cues and their intensity/timing.
10. Save the immutable original source plus `episode-metadata.json` into that show's episode folder.
11. Continue through audio analysis, user-approved speech edits, mastering and final render as the production pipeline is completed.
12. Final rendered video retains the mandatory **Podcast Powered by HRTechify** footer.

Deleting a show from Podcast Studio frees an application slot but deliberately leaves the user's existing Google Drive media untouched.

## Google Drive layout

```text
My Drive/
└── HRTechify Podcast Studio/
    ├── Show One/
    │   └── Episodes/
    │       ├── Episode One - <id>/
    │       │   ├── original-<source-file>
    │       │   └── episode-metadata.json
    │       └── Episode Two - <id>/
    └── Show Two/
        └── Episodes/
```

## Literary template family

Current built-in concepts:

- Poet's Dawn
- Midnight Manuscript
- Wildflower Pages
- Coffee & Margins
- Moonlit Verse
- Ocean Notebook

All share the same safe information hierarchy for Show Name, Episode Name, Host Name, waveform, captions, optional creator logo and mandatory HRTechify credit. The artwork changes; the collision-safe geometry does not.

## Built-in music

The initial music library is defined as original procedural compositions and released under **CC0-1.0**. No third-party commercial audio file is required for the default template library.

Current track identities include Paper Lantern, Quiet Room, Velvet Pages, Open Window, Moon Notes and Ink Ripple. Each template exposes only three of them.

## Application structure

The implementation is an npm-workspace monorepo:

```text
apps/
  web/        React + Vite application
  worker/     Cloudflare Worker API
packages/
  shared/     Product constants and shared types
  storage/    Provider-neutral show/episode storage contracts
  recorder/   MediaRecorder + IndexedDB browser recording
  audio/      Speech-edit and template-music contracts/validation
  templates/  Literary template catalogue and safe-area rules
  renderer/   Final render snapshot/contracts
database/     D1 migrations
tests/        Cross-package and end-to-end tests
```

## Local development

Requirements:

- Node.js 20 or newer
- npm

```bash
npm install
npm run dev:web
```

Run the Worker API locally in a second terminal:

```bash
npm run dev:worker
```

Validation:

```bash
npm run typecheck
npm run build
```

## Security and storage note

Studio sign-in and Google Drive authorization are deliberately separate. The Drive connector asks for `drive.file`, not unrestricted access to every file in a user's Drive. Browser-recorded chunks are persisted in local IndexedDB during a recording for resilience, then the accepted source is uploaded to the user's selected show folder.

## Documentation

- [How It Works](HOW_IT_WORKS.md)
- [Privacy](PRIVACY.md)
- [Data Handling](DATA_HANDLING.md)
- [Voice Processing](VOICE_PROCESSING.md)
- [About HRTechify](ABOUT_HRTECHIFY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Roadmap](ROADMAP.md)
- [Template Specification](docs/template-specification.md)
- [Recording Flow](docs/recording-flow.md)
- [Storage Model](docs/storage-model.md)

## Open source

This repository is intentionally public so developers can inspect the architecture, report bugs, suggest improvements and contribute. Production credentials and user content must never be committed.

## License

Repository code is licensed under Apache License 2.0. HRTechify names, marks and branding remain subject to their respective trademark and brand rights. Built-in procedural music definitions are separately designated CC0-1.0 in their metadata.
