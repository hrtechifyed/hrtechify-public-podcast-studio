# Database

Database migrations will live in this directory when the multi-user D1 schema is introduced.

The first schema phase will cover authenticated users, storage connections, shows, brand assets, templates, episodes, recordings, edit reviews, jobs, outputs, usage events and audit events.

## Fixed rules

- Every tenant-owned record must be attributable to the authenticated user, directly or through its parent show.
- A user may have no more than **5 active shows**.
- The API must enforce ownership server-side; client-supplied `user_id` values never grant access.
- Media bytes do not belong in D1. D1 stores compact metadata and provider file references.

No production database is connected in the application skeleton phase.
