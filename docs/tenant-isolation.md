# Tenant Isolation

HRTechify Public Podcast Studio is multi-user. Tenant isolation is therefore a security requirement, not a user-interface feature.

## Core rule

A user may access only resources they own directly or through an owned show.

The browser must never gain authorization by sending a `user_id` and expecting the server to trust it.

## Server-side identity

Every protected API route must:

1. Resolve the authenticated user from a server-verified signed session.
2. Load the requested object together with its ownership chain.
3. Query by both object ID and authenticated ownership where applicable.
4. Verify ownership before returning or mutating data.

The first implementation uses an HttpOnly, Secure, SameSite session-cookie contract signed with HMAC. The signing key is a Worker secret and is never committed. The eventual sign-in provider is responsible for issuing that session only after verifying the person's identity.

## Current show routes

The first tenant-scoped API foundation includes:

- `GET /api/account`
- `GET /api/shows`
- `POST /api/shows`
- `GET /api/shows/:id`
- `POST /api/shows/:id/archive`
- `POST /api/shows/:id/restore`

All show access uses the user ID resolved from the verified session. No route accepts a client-supplied `user_id` as authority.

## Example hierarchy

```text
user
  +-- show
       +-- brand asset
       +-- episode
            +-- recording
            +-- edit review
            +-- job
            +-- output
```

## Five-show rule

Creating or restoring a show performs a server-side count of the user's active shows. If the count is already five, the action is rejected regardless of what the client interface displays.

D1 also contains triggers that reject an insert or restore that would create a sixth active show. This is defense in depth against application regressions or race conditions.

Archived shows do not count toward the five active show limit. Deleted records are excluded from normal show retrieval.

## Required tests

Automated tests should prove that User A cannot:

- Fetch User B's show by ID
- Archive or restore User B's show
- Fetch User B's episode by ID
- View User B's brand assets
- Use User B's storage connection
- Approve User B's edit review
- Cancel or restart User B's job
- Open User B's output reference through the application

Tests should also cover guessed identifiers, stale or tampered sessions, deleted/archived ownership states and attempts to create a sixth active show.

## Administrative access

Administrative troubleshooting should operate on metadata and failure traces by default. Routine access to user media should not be necessary for support or abuse control.
