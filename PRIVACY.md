# Privacy

HRTechify Public Podcast Studio is being designed around a simple principle: **the creator's media should remain under the creator's control**.

This document describes the intended product privacy model. It is not a substitute for the final legally reviewed Privacy Policy that must be published before production launch.

## What belongs to the user

The user's original recordings, show assets and final podcast outputs are intended to remain in the cloud storage destination selected by the user.

The platform should not require one permanent central HRTechify media library for all creators.

## What the platform may store

The application may retain limited account and operational information required to provide the service, such as:

- Account identity and sign-in metadata
- Show and episode metadata
- Storage connection metadata
- Provider file identifiers and paths
- Selected template/version
- Edit proposals and user decisions
- Job state and output references
- Usage and security/audit events

OAuth refresh credentials required for background processing must be encrypted at rest and revocable.

## What happens to voice recordings

The original recording is preserved and must not be overwritten by processing.

When processing is required, the platform may temporarily access or stage media to analyse audio, prepare proposed edits, master audio, generate captions and render the final video.

Temporary processing media must be deleted after completion, cancellation or a short defined expiry period.

## Spoken-content changes

Technical audio cleanup may be performed automatically where it does not change the speaker's words.

Any proposed edit that removes or materially changes spoken content requires explicit user approval before it is applied.

## Logo background removal

If a user uploads a logo, the studio may offer to create a transparent-background version. The user must be asked before this transformation is performed, the original must be preserved, and the user chooses which version to use.

## Storage choice

Initial supported permanent storage destinations are planned to be Google Drive and Dropbox. A show is linked to an active storage destination selected by the user.

## Account deletion and disconnection

The product should support disconnecting storage providers and deleting the user's platform account. Provider credentials and platform metadata should be removed according to the applicable retention policy.

Files that belong to the user in their own cloud storage remain there unless the user explicitly asks the application to remove them and the provider permissions allow that action.

## Voice and recording rights

Users are responsible for ensuring they have the necessary rights and consent to record, upload and process all voices and other content included in a production.

## Public source code does not mean public user data

This GitHub repository is public. Production secrets, OAuth tokens, personal user information, recordings, transcripts and private media must never be committed to the repository.

## Before public launch

The hosted product must publish a legally reviewed Privacy Policy and Terms of Use, define specific retention periods, document subprocessors where required, and provide appropriate contact and deletion mechanisms.
