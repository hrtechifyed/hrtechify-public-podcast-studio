# Initial Product Decisions

This file records the initial product decisions agreed before implementation begins.

## Repository and product boundaries

- This repository is a completely new public project.
- It may reproduce the functioning of the existing HRTechify podcast studio, but it must not modify, redeploy or create a production dependency on that repository.
- The Nikita Book Review Studio repository is also out of scope and must not be modified.

## Account model

- One user account may have up to **5 active shows**.
- Each show has independent branding, episodes, template preference and storage destination.
- A deleted or archived show may free capacity for another active show after lifecycle handling is complete.

## Storage model

- Users choose where permanent media is stored.
- Initial providers: Google Drive and Dropbox.
- A user may connect providers at account level and choose an active destination per show.

## Recording

- Users may record audio directly in the browser or upload an existing recording.
- Browser recording must support pause/resume, preview and recovery-oriented chunk persistence.

## Branding

- Users may upload their own show logo and profile picture.
- The studio asks before removing a logo background.
- The original logo is preserved and the user chooses original or transparent variant.
- Show Name, Episode Name and Host Name are rendered from a locked pre-render snapshot.

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
