# Database

HRTechify Public Podcast Studio uses Cloudflare D1 for small application metadata. User media does not belong in D1.

## Production database

The production Worker binding is `DB` and points to the Cloudflare D1 database named `hrtechify-public-podcast-studio`.

The D1 database identifier is intentionally present in Wrangler configuration because it is a resource identifier, not a credential. Cloudflare API tokens, session keys, OAuth client secrets and user data must never be committed.

## Current schema

`migrations/0001_multi_user_foundation.sql` introduces:

- `users`
- `shows`
- indexes for per-user show lookup
- database triggers that prevent more than five active shows for one user

`migrations/0002_authentication.sql` introduces:

- `auth_identities` for linking verified Google/email identities to an internal user
- `auth_oauth_states` for short-lived Google OAuth state and PKCE transactions
- `auth_magic_links` for hashed, expiring, one-time email sign-in links

The five-show rule is enforced twice: in application code and in D1 as defense in depth.

## Tenant rule

Every query for a user-owned object must include the authenticated server-side `user_id`. The browser must never gain access merely by supplying an object ID or a `user_id` value.

Authentication provider subjects are mapped to an internal user ID. Protected routes use the signed session's internal ID; storage and media authorization are not derived from browser input.

## Applying migrations

The Worker Wrangler configuration points at `../../database/migrations`, so both existing migrations can be applied through the Worker workspace.

From the repository root:

```bash
npm run db:migrations:list
npm run db:migrate:remote
```

For local development only:

```bash
npm run db:migrate:local
```

Wrangler records applied migrations in D1 and will only apply migrations that have not already been recorded.

Do not commit credentials, user data or production secrets. Media bytes remain in user-selected cloud storage rather than D1.

Later migrations will add storage connections, brand assets, templates, episodes, recordings, edit reviews, jobs, outputs, usage events and audit events.
