# Architecture

## Recommended stack

- **Web UI:** React/Vite
- **API:** Cloudflare Workers
- **Metadata:** Cloudflare D1
- **Durable orchestration:** Cloudflare Workflows
- **Media compute:** Cloudflare Containers
- **Temporary staging:** R2 only when required, with short lifecycle
- **Permanent media:** User-owned Google Drive or Dropbox
- **CI/CD:** GitHub Actions for testing, builds and deployment; not for untrusted public media processing

## High-level flow

```text
User Browser
    |
    v
React/Vite Studio
    |
    v
Cloudflare Worker API
    |
    +--> D1 metadata/state
    |
    +--> Storage provider adapters
    |
    +--> Cloudflare Workflow
              |
              v
        Media Container
        FFmpeg / renderer
              |
              +--> temporary staging only if required
              |
              +--> user's Google Drive / Dropbox
```

## Domain model

Core entities are expected to include:

- users
- storage_connections
- shows
- brand_assets
- templates
- episodes
- recordings
- edit_reviews
- jobs
- outputs
- usage_events
- audit_events

## Ownership hierarchy

```text
User
  +-- Storage connections
  +-- Shows (maximum 5 active)
       +-- Brand assets
       +-- Templates / template preference
       +-- Episodes
            +-- Recording
            +-- Edit review
            +-- Jobs
            +-- Outputs
```

## Core trust boundaries

1. The browser never grants itself ownership by sending a user ID.
2. The API resolves the authenticated user server-side.
3. Every tenant-owned object is authorized against that user.
4. Provider credentials are encrypted and scoped to the owning user.
5. Original recordings are immutable.
6. Temporary processing media is short-lived.
7. User templates cannot execute arbitrary code.
8. The renderer enforces the mandatory **Podcast Powered by HRTechify** footer independently of user template choices.

## Repository independence

This repository is a standalone public project with its own source history, deployment, database, credentials and infrastructure. Existing HRTechify podcast and book-review repositories are reference systems only and are not modified or depended upon in production.
