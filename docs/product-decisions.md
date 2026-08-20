# Product Decisions

This file records current product decisions that implementation must preserve.

## Repository and product boundaries

- This repository is a completely independent public project.
- It may reproduce proven podcast-studio workflow ideas, but it must not modify, redeploy or create a production dependency on the private HRTechify podcast repository.
- The Nikita Book Review Studio repository is out of scope.

## Account and show model

- One user account may keep a maximum of **5 non-deleted shows total**.
- Each show has independent identity, episodes, template preferences and Google Drive workspace.
- Archived/hidden state does not create extra show capacity.
- If the user reaches five shows, the product must explain the limit and ask the user to delete one show before creating another.
- Deleting a show from Podcast Studio frees a slot but does not silently remove the user's Google Drive media.

## Episode storage model

- Google Drive is the first implemented permanent-media provider.
- Each show owns its own Drive folder.
- Every episode for that show must be stored under that show's `Episodes` folder.
- Every episode receives its own folder.
- The original source recording is stored there as a new immutable file.
- `episode-metadata.json` accompanies the source so the Drive copy retains show/episode/template/music context.
- Future storage providers must preserve the same show/episode ownership hierarchy.

## Recording

- Users may upload an existing audio file **or record directly in the browser**.
- Browser recording supports microphone permission, device choice, pause/resume, stop, playback and record-again.
- Long recording reliability uses MediaRecorder chunks plus IndexedDB persistence rather than relying on one giant in-memory Blob.
- The accepted browser recording becomes an original source and is never overwritten by later processing.

## Template visual direction

- Built-in templates must feel creative, literary and editorial rather than formal/corporate.
- Rendered template artwork must not use formal boxes or dashboard-like information panels.
- Readable cursive/script fonts are encouraged for show/host accents, paired with highly readable episode typography.
- Creator profile photographs are **never rendered in templates**.
- Creator logo remains an optional supported asset.
- Show Name, Episode Name and Host Name use consistent safe positioning across built-in templates.
- Closed captions have a fixed lower safe zone and must not clash with creator text, logo or platform credit.

## Background music

- Each built-in template exposes exactly three compatible background-music choices.
- Built-in music is created as HRTechify procedural originals and released under **CC0-1.0** so no third-party copyrighted music is required by the default product.
- Music is optional.
- A user may select up to **3 different tracks** for an episode.
- Each cue can be `very-subtle`, `subtle` or `moderately-subtle`.
- A cue can run `throughout` or during one explicit interval.
- If one cue runs throughout, it is the only cue.
- Multiple interval cues cannot overlap.
- Music must remain secondary to the spoken narration.

## Platform attribution

Every generated podcast video must visibly show:

**Podcast Powered by HRTechify**

The credit must be in the bottom-right corner, remain visible on all approved templates and be enforced by the renderer rather than left to user template configuration.

## Voice processing

- Original source recording remains immutable.
- Technical cleanup may be automatic where spoken content is unchanged.
- Spoken-content or material pacing changes are proposals only until explicitly approved by the user.

## Transparency

The hosted product must include user-facing sections for:

- How It Works
- Privacy & Your Data
- About HRTechify
- Open Source / GitHub contribution access

Repository documentation should remain aligned with those pages.
