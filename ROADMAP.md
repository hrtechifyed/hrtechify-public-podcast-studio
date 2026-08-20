# Product Roadmap

This roadmap defines the planned engineering order for HRTechify Public Podcast Studio. It is a product plan, not a promise of specific delivery dates.

## Phase 0 — Foundation

- Public repository and clean Git history
- Product documentation
- Security/privacy rules
- Contributor guidelines
- Architecture baseline

## Phase 1 — Functional baseline

Reproduce the established HRTechify podcast-studio workflow in this independent repository without modifying the existing podcast or book-review repositories.

Exit condition: one test user can complete the end-to-end upload → review → approval → render workflow in the new project.

## Phase 2 — Multi-user foundation

- Authentication
- Users and shows
- Maximum 5 active shows per user
- Tenant-scoped metadata
- Authorization middleware
- Cross-tenant isolation tests

Exit condition: two users cannot access each other's shows, episodes, assets, storage connections or jobs even when IDs are guessed.

## Phase 3 — User-owned storage

- StorageProvider interface
- Per-user Google Drive connection
- Dropbox adapter
- Per-show storage destination
- Provider folder/workspace creation
- Output links

Exit condition: each show writes only to its selected user-authorized storage destination.

## Phase 4 — Show branding

- Show name and host name
- Profile picture
- Logo upload
- Opt-in transparent-background processing
- Original/processed logo preview and selection
- Intro/outro assets
- Preferred template

## Phase 5 — Direct browser recording

- Microphone permission and selector
- Input meter and clipping warning
- Record / Pause / Resume / Stop
- Playback and Record Again
- Chunk persistence in IndexedDB
- Recovery of unfinished recordings
- Save accepted original to user storage

## Phase 6 — Template system

- Versioned built-in templates
- Show / Episode / Host slots
- Creator logo and profile-photo slots
- Waveform/caption areas
- Safe custom template validation
- Mandatory bottom-right **Podcast Powered by HRTechify** platform-credit zone

## Phase 7 — Editing and approval

- Technical cleanup pipeline
- Transcript/analysis
- Timestamped speech/timing proposals
- Apply / Keep Original controls
- Approved-edits-only production
- Final render snapshot

## Phase 8 — Durable public media processing

- Background workflow orchestration
- Containerized FFmpeg/rendering
- Browser-close resilience
- Cancellation and idempotency
- Final quality checks
- Temporary media cleanup

## Phase 9 — Public transparency UI

- How It Works
- Privacy & Your Data
- About HRTechify
- Open Source / GitHub contribution links

## Phase 10 — Public hardening and beta

- OAuth production configuration
- Quotas and rate limiting
- Cross-tenant security tests
- Browser compatibility tests
- Failed-job support path
- Cost and performance measurement
- Legally reviewed Privacy Policy and Terms of Use

## Initial non-negotiable product rules

1. Maximum 5 active shows per user.
2. Original recordings are preserved.
3. Spoken-content changes require user approval.
4. Users choose permanent storage.
5. Logo background removal requires user consent and preserves the original.
6. Every generated podcast video displays **Podcast Powered by HRTechify** in the bottom-right corner.
