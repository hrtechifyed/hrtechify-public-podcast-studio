# Usage & Processing Policy

## The simple version

HRTechify Podcast Studio is designed so **other people's podcast generation does not require paid final-rendering infrastructure on the HRTechify Cloudflare account**.

Final MP3 and MP4 generation happens on the user's own computer in the browser.

## What this means for users

When a user clicks final generation, the Studio explains that processing will happen on that device. Speed depends on the computer, available memory, browser and episode length. The user should keep the browser tab open until generation finishes.

A slow computer may take longer. A device with insufficient memory may be unable to finish a large episode. Closing the tab, suspending the device or losing connectivity can interrupt the job.

## What HRTechify does not do

- No paid Cloudflare Container is used for final podcast rendering.
- No paid server-render farm is used as an automatic fallback.
- The Studio does not intentionally switch a local render to paid server compute when a user's device is slow.
- Media Transformations are not configured as part of the zero-bill production architecture.

## Free platform capacity

The website and APIs can use free-tier Cloudflare services. Optional features such as Workers AI analysis or Cloudflare Images background removal are subject to whatever free capacity is available to the deployment.

If a free allowance or platform limit is exhausted, the intended behavior is to stop clearly, return an error or become temporarily unavailable rather than intentionally enabling paid overage.

This is an architecture and product rule, not a promise that third-party providers will never change their products, pricing or account controls. Deployment owners should therefore keep billing settings and provider plans under review when third-party terms change.

## Where files go

Permanent podcast originals and outputs remain in the user's assigned Google Drive or Dropbox. The browser may temporarily hold working media in memory while generating the final output.

Once generation finishes, the Studio attempts to save the separate technical master, WebVTT, MP3 and MP4 to the user's connected storage. If that save fails, locally generated files may be offered for direct download during the current browser session.

## Privacy during local generation

Provider refresh tokens remain on the server. The browser receives authenticated HRTechify download routes for only the files that belong to the signed-in user and assigned show storage.

The browser downloads a pinned FFmpeg WebAssembly runtime from jsDelivr. Podcast media is not sent to jsDelivr.

## Content integrity

The original recording remains immutable. Only edit ranges explicitly approved by the user are removed from the generated version. Technical processing must preserve words, pitch and speaking speed outside those approved cuts.

The selected curated HRTechify template is used for the final video, and `Powered by HRTechify` remains mandatory.
