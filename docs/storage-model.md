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

## Storage connection model

A user may connect one or more supported providers. Each show stores an active storage-connection reference so different shows may use different destinations.

Example:

- Show 1 → Google Drive
- Show 2 → Dropbox
- Show 3 → Google Drive

The user should not need to reconnect the same provider for every show unless provider authorization requires it.

## File ownership

The platform stores provider file IDs, paths, checksums and open URLs as metadata where needed. User-owned files remain in the user's provider account.

## Original recording rule

The original source file is never overwritten. Derived audio/video outputs are written as new files.

## Provider access

Provider integrations should use the minimum permissions required. Broad storage access should not be requested unless a future feature genuinely needs it and the user receives clear consent information.
