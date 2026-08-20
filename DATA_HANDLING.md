# Data Handling

This document defines the intended technical data-handling model for HRTechify Public Podcast Studio.

## Data classes

### 1. User media
Examples: original recordings, logos, profile pictures, intro/outro media, final MP3/MP4 and caption files.

**Primary location:** the user's selected Google Drive or Dropbox workspace.

**Platform retention:** no permanent central copy by default. Temporary access or staging may occur when technically required for processing.

### 2. Application metadata
Examples: user account, show metadata, episode status, storage provider references, template selection, edit decisions, output references and job state.

**Primary location:** HRTechify application metadata store.

### 3. Temporary processing media
Examples: normalized audio, working video frames, temporary transcripts/caption artifacts and render intermediates.

**Primary location:** ephemeral processing runtime and, only when required, short-lived temporary object storage.

**Retention:** delete after completion, cancellation or configured expiry.

### 4. Credentials
Examples: OAuth refresh tokens and provider connection information.

**Primary location:** encrypted platform storage.

**Rules:** never browser localStorage for long-lived refresh tokens; never source control; revoke/delete when the connection is removed.

## Multi-user ownership

Every tenant-owned record must be scoped to the authenticated user, directly or through a parent show. The API must derive user identity from the authenticated server-side session rather than trusting a client-supplied user ID.

## Five-show limit

One user may have no more than **5 active shows**. The server must enforce this rule. Archived or deleted shows do not count as active once the applicable lifecycle rules have completed.

## Show-level separation

Each show has its own branding, storage destination, templates and episodes. Provider workspaces should be separated by show so assets and outputs cannot collide across shows.

## File integrity

The original recording should have an immutable reference/checksum. Processing creates derived files rather than overwriting the original.

## Deletion

Deletion must distinguish between:

- Platform metadata
- Provider credentials
- Temporary processing media
- User-owned files in Drive/Dropbox

Deleting a platform account must not silently delete user-owned cloud files unless the user explicitly requests that action and it is supported.

## Repository hygiene

Never commit:

- `.env` files containing secrets
- OAuth client secrets
- Cloudflare tokens
- encryption keys
- production database dumps
- user emails or account exports
- recordings or transcripts
- production logs containing personal data

Use `.env.example` and synthetic test fixtures instead.
