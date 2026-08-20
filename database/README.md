# Database

HRTechify Public Podcast Studio uses Cloudflare D1 for small application metadata. User media does not belong in D1.

## Production database

The production Worker binding is `DB` and points to the Cloudflare D1 database named `hrtechify-podcast-prod`.

The D1 database identifier is intentionally present in Wrangler configuration because it is a resource identifier, not a credential. Cloudflare API tokens, session keys, OAuth client secrets and user data must never be committed.

## Current schema

`migrations/0001_multi_user_foundation.sql` introduces:

- `users`
- `shows`
- indexes for per-user show lookup
- the original database trigger for the initial five-active-show rule

`migrations/0002_authentication.sql` introduces:

- `auth_identities` for linking verified Google/email identities to an internal user
- `auth_oauth_states` for short-lived Google OAuth state and PKCE transactions
- `auth_magic_links` for hashed, expiring, one-time email sign-in links

`migrations/0003_google_drive_episodes_and_total_show_limit.sql` introduces:

- per-show Google Drive folder IDs
- soft-deletion timestamps
- a five **non-deleted shows total** database guard, matching the current product rule
- `episodes` with show/user ownership
- upload-vs-browser-recording source metadata
- immutable original source Drive references
- per-episode Drive folder references
- template version snapshots
- music-plan JSON

The five-show rule is enforced twice: in application code and D1 as defence in depth. Archived shows still occupy a slot; deleting one from the Studio frees capacity.

## Tenant rule

Every query for a user-owned object must include the authenticated server-side `user_id`. The browser must never gain access merely by supplying an object ID or a `user_id` value.

Authentication provider subjects are mapped to an internal user ID. Protected routes use the signed session's internal ID; storage and media authorization are not derived from browser input.

Each episode also carries `show_id`, and the API verifies that the authenticated user owns the parent show before episode operations proceed.

## Media boundary

D1 stores identifiers and episode configuration, not audio or video bytes. Original recordings/uploads and future derived outputs belong in the user's connected show storage. The current Google Drive flow stores every episode under that show's `Episodes` folder.

Deleting a show from the Studio does not silently delete the user's Drive folder or media.

## Applying migrations

The Worker Wrangler configuration points at `../../database/migrations`, so migrations can be applied through the Worker workspace.

From the repository root:

```bash
npm run db:migrations:list
npm run db:migrate:remote
```

For local development only:

```bash
npm run db:migrate:local
```

Wrangler records applied migrations in D1 and only applies migrations that have not already been recorded.

Do not commit credentials, user data or production secrets.
