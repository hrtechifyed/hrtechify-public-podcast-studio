# How HRTechify Public Podcast Studio Works

This explains the product flow in plain language.

## 1. Account and shows

A user creates one Studio account and may have up to **5 active shows**. Each show keeps its own name, host name, branding, intro/outro, template, storage destination and episodes.

## 2. Choose storage

The user connects Google Drive or Dropbox separately from sign-in and assigns one storage connection to a show. Permanent podcast media lives in that user-owned storage rather than one shared HRTechify media library.

## 3. Set up show branding

The user uploads logo/profile assets and optional intro/outro media. Originals remain unchanged. If background removal is requested, the user sees the result before choosing Accept, Retry or Keep Original.

## 4. Record or upload an episode

The user can record in the browser or upload a supported file. The accepted source is stored as an immutable original in the show's assigned storage.

## 5. Analyse and propose edits

When analysis is available and the user requests it, the Studio can propose clear accidental speech/timing edits such as a false start, repeated speech, fumble or unusual pause. The proposal does not alter the source.

## 6. User approval

Every spoken-content or timing proposal must receive an explicit decision. Only ranges marked **Apply in final edit** may be removed. **Keep Original** preserves that part of the recording.

## 7. Lock the final plan

Before generation, the Studio snapshots the exact source, completed analysis run, approved edit ranges, technical-cleanup rules, show name, episode name, host name, selected curated template, caption choice and mandatory **Powered by HRTechify** credit.

## 8. Final generation happens on the user's device

When the user clicks generation, a short message explains that the heavy processing will run on that computer rather than on HRTechify's servers.

The browser downloads the exact authenticated source and supporting files from the user's assigned Drive/Dropbox and loads a pinned FFmpeg WebAssembly runtime. It then performs the approved cuts, fixed technical mastering, caption-timeline transformation, MP3 creation and MP4 creation locally.

**Speed depends on the user's processor, available memory, browser and episode length. Keep the tab open until generation finishes.**

HRTechify does not use a paid Cloudflare Container or paid server-rendering fallback for this final generation step.

## 9. Preserve content integrity

The original remains unchanged. Outside approved edit ranges, technical processing preserves words, pitch and speaking speed. The final video uses an approved HRTechify template and keeps **Powered by HRTechify** as a non-removable platform credit.

## 10. Save outputs back to the user

The browser creates separate technical-master FLAC, WebVTT, MP3 and MP4 outputs. The Studio then streams those generated files through authenticated provider-neutral routes into the same assigned Google Drive or Dropbox without exposing provider refresh tokens to browser JavaScript.

If saving to connected storage fails, the locally generated files may still be offered for direct download during that browser session. The immutable source is not affected.

## 11. Free-use behavior

The hosted architecture is deliberately based on free-tier platform services plus on-device final generation. If a free service allowance or platform limit is reached, the relevant feature should stop clearly or become temporarily unavailable instead of intentionally switching to paid server processing.

See `USAGE_POLICY.md` for the full plain-language usage rule.

## 12. Returning users

Returning users select an existing show or create another within the five-show limit. Saved show assets and preferences can be reused, while each episode keeps its own locked production snapshot.
