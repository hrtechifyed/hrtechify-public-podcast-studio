# Storage Model

## Principle

Permanent creator media should be stored in the user's selected cloud account rather than in one shared HRTechify media repository.

## Initial providers

- Google Drive
- Dropbox

The application should use an internal `StorageProvider` abstraction so future providers can be added without rewriting the production pipeline.

Expected provider operations include:

- connect
- refreshCredentials
- ensureWorkspace
- upload
- downloadStream
- writeOutput
- deleteTemporary
- getOpenUrl

## Per-user and per-show structure

A user may have up to five active shows. Each show gets a separate provider workspace.

Example:

```text
HRTechify Podcast Studio/
  Show One/
    Brand Assets/
    Templates/
    Episodes/
  Show Two/
    Brand Assets/
    Templates/
    Episodes/
```

Each episode may contain:

```text
Episode 001/
  original-recording.webm
  podcast-master.mp3
  final-video.mp4
  captions.vtt
```

## Google Drive workspace provisioning

The Google Drive integration creates and manages only folders created for HRTechify Podcast Studio under the user's `drive.file` authorization.

The workspace is provisioned idempotently:

1. Ensure one top-level `HRTechify Podcast Studio` folder created by the application.
2. Ensure one folder for the selected show beneath that root.
3. Ensure `Brand Assets`, `Templates`, and `Episodes` subfolders beneath the show folder.
4. Associate the show with the selected storage connection only after Drive provisioning succeeds.

Application-created folders carry private Drive `appProperties` markers for the workspace role and show ID. These markers let the application rediscover its own folders without asking for broad Drive access or relying only on mutable folder names. If a show is renamed, the application can rename the corresponding show folder while preserving the same workspace.

This phase does not add another D1 folder-ID table. Folder references are rediscovered from the application's Drive metadata when required. Provider file and folder IDs may be persisted later where a production operation benefits from doing so.

A user with exactly one active Google Drive connection has active show workspaces re-checked idempotently when the Studio loads. This creates missing folders and repairs app-owned renamed folders without duplicating them. The UI also provides `Prepare all active shows` and per-show `Repair Drive folders` controls so provisioning can be retried explicitly.

The Google Drive API must be enabled in the same Google Cloud project as the Drive OAuth client. If it is disabled, the Worker returns the explicit `google_drive_api_not_enabled` error so the Studio can show an actionable message rather than a generic failure.

With multiple connections, the user selects the destination for each show. Switching a show's destination does not delete or move the user's existing files from the previous provider workspace.

## Storage connection model

A user may connect one or more supported providers. Each show stores an active storage-connection reference so different shows may use different destinations.

Example:

- Show 1 → Google Drive
- Show 2 → Dropbox
- Show 3 → Google Drive

The user should not need to reconnect the same provider for every show unless provider authorization requires it.

## Show deletion and storage ownership

Deleting a show from HRTechify Podcast Studio marks the show as deleted in Studio metadata and removes it from the user's show list. The show no longer counts toward the active-show limit.

Deleting a show from the Studio does **not** delete the user's Google Drive files or folders. User-owned cloud files remain in the user's storage account so an application action cannot unexpectedly destroy creator media. A future explicit file-deletion feature, if added, must require separate clear user confirmation.

## File ownership

The platform stores provider file IDs, paths, checksums and open URLs as metadata where needed. User-owned files remain in the user's provider account.

## Original recording rule

The original source file is never overwritten. Derived audio/video outputs are written as new files.

## Provider access

Provider integrations should use the minimum permissions required. Google Drive storage uses `https://www.googleapis.com/auth/drive.file`, not broad Drive access. Broad storage access should not be requested unless a future feature genuinely needs it and the user receives clear consent information.
