# Retention Policy — Technical Draft

This document defines the intended technical retention behavior for the product. Exact legal retention periods must be finalized before public launch and reflected in the legally reviewed Privacy Policy and Terms of Use.

## Permanent user media

Original recordings, brand assets and final outputs should remain in the user's selected Google Drive or Dropbox account until the user removes them or asks the application to remove them through an explicitly supported action.

The platform should not keep a permanent central copy by default.

## Temporary processing media

Temporary processing media may include normalized audio, render intermediates, caption work files and short-lived staging objects.

These should be deleted:

- after successful completion, once outputs are safely written
- after confirmed cancellation
- after failed jobs when no longer required for safe retry or diagnosis
- automatically after a short configured expiry period

The implementation must define and test the exact lifecycle duration before public beta.

## Transcript and edit-review data

Transcript/edit-analysis data may be retained as application metadata when required for episode history, captions, re-render or user review. Users should have a deletion path. The exact retention period must be declared before launch.

## OAuth credentials

Encrypted provider refresh credentials are retained only while the storage connection remains active and background access is needed. Revoking or deleting the connection should remove/revoke stored credentials according to provider and application requirements.

## Account metadata

User, show, episode, output-reference, usage and audit metadata may be retained for product operation, security and support according to a defined retention schedule.

## Deleted shows

A deleted show should stop counting toward the five-active-show limit once deletion/archival state is finalized. Deleting a show from the platform must not silently delete user-owned cloud files unless the user explicitly requests that behavior.

## Auditability

Deletion jobs should be observable and idempotent so repeated callbacks or retries cannot restore stale temporary state.
