# Privacy

HRTechify Public Podcast Studio is designed around a simple principle: **the creator's media should remain under the creator's control**.

This repository document describes the product privacy model. It is not a substitute for a legally reviewed Privacy Policy where one is required for production use.

## What belongs to the user

Original recordings, show assets and completed podcast outputs remain in the Google Drive or Dropbox destination assigned by the user. HRTechify does not require a permanent central media library for all creators.

The original recording is immutable. Processing creates separate derived files rather than overwriting the source.

## What HRTechify stores

D1 may store limited account and operational information needed to run the Studio, including account identity, show and episode metadata, storage connection metadata, provider file identifiers, template choices, edit proposals and decisions, render-job state and output references.

Google Drive and Dropbox refresh credentials are encrypted at rest. Provider refresh tokens and raw provider upload credentials are not sent to browser JavaScript.

## Final generation happens on the user's device

Heavy final audio/video generation runs in the user's browser using FFmpeg WebAssembly. The browser downloads only the authenticated source and supporting files belonging to the signed-in user and assigned show storage connection.

Temporary working media exists in browser memory and the local WebAssembly file system for the generation session. HRTechify does not use a paid Cloudflare Container or paid server-render farm for final MP3/MP4 generation.

Generation speed depends on the user's processor, available memory, browser and episode length. Closing the tab or suspending the device can interrupt local generation.

Completed technical-master, WebVTT, MP3 and MP4 files are streamed back into the user's assigned Google Drive or Dropbox as separate immutable outputs. If saving back to storage fails, locally generated files may remain available for direct download during that browser session.

## FFmpeg runtime download

The browser downloads a pinned FFmpeg WebAssembly runtime from jsDelivr when final generation begins. That request downloads program code only. Podcast recordings, caption timing, technical masters and final outputs are not sent to jsDelivr.

## Free-use / no paid-rendering rule

The production architecture is intentionally designed around free-tier services and on-device final generation. If an available free allowance or platform limit is reached, the affected feature should fail clearly, pause or become temporarily unavailable rather than intentionally switching to paid server processing.

Optional Workers AI analysis and Cloudflare Images background removal remain subject to the available free-plan capacity. Paid Cloudflare Containers and Media Transformations are not part of the zero-bill final-generation deployment configuration.

See `USAGE_POLICY.md` for the plain-language usage rule.

## Spoken-content changes

Technical cleanup may be performed automatically only where it does not change the speaker's words. Any proposed edit that removes or materially changes spoken content requires explicit user approval before it is applied.

## Logo background removal

If a user requests background removal, the original image is preserved and the generated transparent-background candidate remains separate. The user chooses Accept, Retry or Keep Original.

## Account deletion and disconnection

Self-service account deletion removes HRTechify account/authentication/workflow metadata and encrypted storage credentials. Files already stored in the user's Google Drive or Dropbox are intentionally preserved; the Studio does not call provider deletion APIs as part of account deletion.

## Voice and recording rights

Users are responsible for ensuring they have the necessary rights and consent to record, upload and process all voices and other content included in a production.

## Public source code does not mean public user data

This GitHub repository is public. Production secrets, OAuth tokens, personal user information, recordings, transcripts and private media must never be committed to the repository.
