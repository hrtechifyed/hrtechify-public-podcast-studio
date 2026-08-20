# How HRTechify Public Podcast Studio Works

This document explains the product flow in plain language. It is intended to remain aligned with the user-facing **How It Works** section inside the application.

## 1. Account and shows

A user creates one HRTechify Podcast Studio account. Each account may have up to **5 active shows**.

Each show is a separate workspace with its own:

- Show name
- Host name
- Logo
- Optional transparent-logo variant
- Profile picture
- Intro and outro
- Preferred template
- Storage destination
- Episodes and outputs

A user may delete or archive a show and then create another, provided the number of active shows does not exceed five.

## 2. Choose storage

The user connects an approved storage provider. Initial support is planned for Google Drive and Dropbox.

The user may choose a storage destination per show. Permanent podcast media should live in user-owned storage rather than one shared HRTechify media library.

## 3. Set up show branding

The user uploads their logo and other show assets. When a logo has a solid or unwanted background, the studio asks whether the user wants a transparent-background version created.

The original is always preserved. The user previews the result and chooses whether to use the original or processed version.

## 4. Create an episode

The user selects a show and creates an episode. The episode inherits show-level branding and host details, while episode-specific data such as the episode name is entered for that production.

Before rendering, the exact Show Name, Episode Name, Host Name, logo and template are shown for confirmation.

## 5. Record or upload audio

Users may either:

- **Record directly in the browser**, or
- **Upload an existing audio file**.

The browser recorder is planned to support microphone selection, input level indication, record, pause, resume, stop, preview, record again and recovery of unfinished recording chunks where technically possible.

## 6. Preserve the original

The source recording is treated as immutable. The production pipeline must not overwrite it.

Once the user accepts the recording or upload, the original is saved to the user's selected storage and referenced by the application.

## 7. Analyse and refine

Technical audio processing may include noise/hum reduction, click control, level balancing, compression, de-essing, plosive control and peak protection.

Speech or timing changes that would remove or materially alter spoken content are handled differently. The system may propose edits for issues such as false starts, repeated speech, unusual pauses or fumbles, but the user decides whether each proposal is applied.

## 8. User approval

The user reviews meaningful speech/timing proposals and chooses to apply or keep the original content.

Only approved spoken-content changes proceed to the final production.

## 9. Final render confirmation

Immediately before rendering, the application displays the locked production configuration, including:

- Show Name
- Episode Name
- Host Name
- Selected logo
- Selected template
- Storage destination
- Mandatory **Podcast Powered by HRTechify** footer

Once confirmed, the episode uses a snapshot of these values so later show-profile changes do not silently alter that render.

## 10. Produce the podcast

The production pipeline creates mastered audio and the final podcast video. Depending on the chosen template, the video may include creator logo, profile picture, waveform, captions and other approved visual elements.

Every generated podcast video must display **Podcast Powered by HRTechify** in the bottom-right corner throughout the platform-generated episode body. Templates must reserve a safe area for this credit.

## 11. Return outputs to the user

Final outputs are written to the user's selected cloud storage. The application keeps only the metadata and references required to show episode status, history and links.

Temporary processing media is deleted according to the retention policy after completion, cancellation or expiry.

## 12. Returning users

Returning users select an existing show or create another one within the five-show limit. Saved show assets and preferences can be reused, while each new episode receives its own locked production snapshot.
