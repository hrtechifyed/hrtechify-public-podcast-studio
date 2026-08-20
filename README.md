# HRTechify Public Podcast Studio

**Record. Refine. Publish your podcast.**

HRTechify Public Podcast Studio is an open-source, privacy-first, multi-user podcast production platform by **HRTechify — People • Technology • Growth**.

The product is designed to reproduce the proven workflow of the existing HRTechify podcast studio as a completely independent public project, while adding multi-user accounts, up to five active shows per user, direct browser recording, user-owned cloud storage, per-show branding, transparent-logo processing, templates, approval-controlled speech edits, and public documentation about how voice and data are handled.

## Core product principles

- One user account may have up to **5 active shows**.
- Every show has its own name, host name, logo, profile picture, intro/outro, template preferences, episodes and storage destination.
- Users choose where permanent podcast media is stored. The initial providers are **Google Drive** and **Dropbox**.
- Users may **record directly in the browser** or upload an existing audio recording.
- The original source recording is preserved and never overwritten by the production pipeline.
- Technical audio cleanup may be automated, but proposed edits that remove or change spoken content require explicit user approval.
- Users may upload their own logo. The studio may offer to create a transparent-background version, but only after asking the user and preserving the original.
- Every generated podcast video must visibly carry **“Podcast Powered by HRTechify”** in the bottom-right corner on every approved template.
- Creator branding remains primary; the HRTechify platform credit is visible but secondary.
- The public repository contains source code and documentation, but never production secrets, OAuth tokens or user media.

## Product flow

1. Create or sign in to an account.
2. Connect a storage provider.
3. Create a show, up to the five-show limit.
4. Add show branding and optionally create a transparent-logo variant.
5. Select a template.
6. Create an episode.
7. Record in the browser or upload audio.
8. Preserve the original in the user's selected storage.
9. Analyse audio and propose speech/timing edits.
10. Let the user approve or reject proposed spoken-content edits.
11. Confirm the final Show / Episode / Host text, logo and template.
12. Render mastered audio and a branded video.
13. Add the mandatory **Podcast Powered by HRTechify** footer.
14. Save final outputs to the user's selected storage.
15. Remove temporary processing media according to the retention policy.

## Application structure

The implementation is an npm-workspace monorepo:

```text
apps/
  web/        React + Vite application
  worker/     Cloudflare Worker API
packages/
  shared/     Product constants and shared types
  storage/    Provider-neutral storage contracts
  recorder/   Browser recording contracts
  audio/      Audio and edit-approval contracts
  templates/  Template manifest and branding rules
  renderer/   Final render contracts
database/     Future D1 migrations
tests/        Cross-package and end-to-end tests
```

The application skeleton intentionally has **no production database, OAuth provider, storage account or deployment secret connected yet**.

## Local development

Requirements:

- Node.js 20 or newer
- npm

Install dependencies:

```bash
npm install
```

Run the web application:

```bash
npm run dev:web
```

Run the Worker API locally in a second terminal:

```bash
npm run dev:worker
```

Type-check all workspaces:

```bash
npm run typecheck
```

Build the web application and validate the Worker:

```bash
npm run build
```

The initial Worker exposes only non-sensitive development routes:

- `GET /api/health`
- `GET /api/config`

The public config route exposes fixed product rules such as the maximum of five active shows and the mandatory platform credit. It contains no credentials or user data.

## Documentation

- [How It Works](HOW_IT_WORKS.md)
- [Privacy](PRIVACY.md)
- [Data Handling](DATA_HANDLING.md)
- [Voice Processing](VOICE_PROCESSING.md)
- [About HRTechify](ABOUT_HRTECHIFY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Roadmap](ROADMAP.md)

Detailed architecture notes are available in [`docs/`](docs/).

## Open source

This repository is intentionally public so developers can inspect the architecture, report bugs, suggest improvements and contribute. Production credentials and user content must never be committed.

## License

Licensed under the Apache License 2.0. HRTechify names, marks and branding remain subject to their respective trademark and brand rights.
