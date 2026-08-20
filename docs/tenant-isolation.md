# Tenant Isolation

HRTechify Public Podcast Studio is multi-user. Tenant isolation is therefore a security requirement, not a user-interface feature.

## Core rule

A user may access only resources they own directly or through an owned show.

The browser must never gain authorization by sending a `user_id` and expecting the server to trust it.

## Server-side identity

Every protected API route must:

1. Resolve the authenticated user from the server-side session.
2. Load the requested object together with its ownership chain.
3. Verify ownership before returning or mutating data.

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

Creating a show must perform a server-side count of the user's active shows. If the count is already five, creation is rejected regardless of what the client interface displays.

## Required tests

Automated tests should prove that User A cannot:

- Fetch User B's show by ID
- Fetch User B's episode by ID
- View User B's brand assets
- Use User B's storage connection
- Approve User B's edit review
- Cancel or restart User B's job
- Open User B's output reference through the application

Tests should also cover guessed identifiers, stale sessions and deleted/archived ownership states.

## Administrative access

Administrative troubleshooting should operate on metadata and failure traces by default. Routine access to user media should not be necessary for support or abuse control.
