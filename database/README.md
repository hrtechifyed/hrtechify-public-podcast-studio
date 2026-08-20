# Database

HRTechify Public Podcast Studio uses Cloudflare D1 for small application metadata. User media does not belong in D1.

## Current schema

`migrations/0001_multi_user_foundation.sql` introduces:

- `users`
- `shows`
- indexes for per-user show lookup
- database triggers that prevent more than five active shows for one user

The five-show rule is enforced twice: in application code and in D1 as defense in depth.

## Tenant rule

Every query for a user-owned object must include the authenticated server-side `user_id`. The browser must never gain access merely by supplying an object ID or a `user_id` value.

## Applying migrations

A D1 database and binding are intentionally not hard-coded in the public repository. Once the Cloudflare environment is created, bind it to the Worker as `DB` and apply migrations using Wrangler.

Do not commit credentials, user data or production secrets. Media bytes remain in user-selected cloud storage rather than D1.

Later migrations will add storage connections, brand assets, templates, episodes, recordings, edit reviews, jobs, outputs, usage events and audit events.
