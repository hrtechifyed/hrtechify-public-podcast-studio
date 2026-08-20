# Storage Model

## Principle

Permanent creator media should be stored in the user's own connected cloud storage rather than in one shared HRTechify media repository.

Google Drive is the first implemented show-storage path. The provider abstraction remains so additional providers can be added later without changing the show/episode ownership model.

## Five-show ownership rule

One account may keep a maximum of **five non-deleted shows**.

Archived/hidden state does not create an unlimited way around that product limit. To add a sixth show, the user must delete one existing show from Podcast Studio first.

Deleting a show from Podcast Studio frees the application slot, but it does **not** silently delete the user's Google Drive folder or previously generated media. Provider-side deletion must always be a separate, explicit action.

## Google Drive structure

Every show owns its own Google Drive folder. Episodes for that show are always created under that show's `Episodes` folder.

```text
My Drive/
└── HRTechify Podcast Studio/
    ├── Show One/
    │   └── Episodes/
    │       ├── Episode One - a1b2c3d4/
    │       │   ├── original-recording.webm
    │       │   └── episode-metadata.json
    │       └── Episode Two - e5f6g7h8/
    │           ├── original-upload.wav
    │           └── episode-metadata.json
    └── Show Two/
        └── Episodes/
            └── ...
```

The application marks folders with Drive `appProperties` containing internal Show/Episode IDs so reconnecting can recover the correct workspace without relying only on folder names.

## Episode ownership

Every episode row contains one `show_id`. The API validates that the authenticated user owns that show before listing or creating episodes.

A new episode is not accepted by the application database until the show has a Google Drive workspace and the episode has a Drive folder ID.

The original audio file can originate from:

- an uploaded audio file; or
- a browser recording created inside Podcast Studio.

In both cases, the accepted source is written to Drive as a new immutable original file. Later cleanup, edits, mastering and rendering must create derived files rather than overwrite it.

## Episode metadata file

The Studio also writes `episode-metadata.json` into the episode folder. It records the episode/show identity, original source reference, selected template version, music plan and platform-credit rule. This makes the user's Drive folder understandable even independently of the application UI.

## Google authorization

Studio account authentication and Google Drive authorization are intentionally separate.

The browser asks for the narrow Google Drive `drive.file` scope only when the user connects Drive. The returned access token is intended to remain in the current page session rather than being stored in the public repository or ordinary browser persistence.

`drive.file` lets the app work with files/folders it creates or the user explicitly opens with the app. It is not a request for unrestricted access to every file in the user's Drive.

## Provider abstraction

The internal `StorageProvider` contract still models:

- `ensureShowWorkspace`
- `ensureEpisodeWorkspace`
- `writeOutput`
- `getOpenUrl`

Future Dropbox or other implementations must preserve the same tenant/show/episode isolation guarantees.

## File ownership

The platform database stores provider file/folder IDs and metadata needed to reconnect the application experience. User-owned media remains in the user's cloud account.

## Original recording rule

The original source file is never overwritten. Derived audio/video outputs are always new files.
