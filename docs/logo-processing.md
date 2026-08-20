# Logo Processing

Users may upload their own show logo. The studio should help logos sit cleanly on templates without silently changing the creator's asset.

## Upload flow

1. User uploads a logo.
2. The studio previews the original.
3. The studio asks whether the user wants the background removed.
4. If the user says no, the original remains selected.
5. If the user says yes, the studio creates a transparent-background derivative.
6. The studio previews both versions on representative light/dark backgrounds or the selected template.
7. The user chooses which version to use.

## Non-destructive rule

The original logo is always preserved. Background removal creates a new file, typically a PNG with transparency.

## Suggested asset records

A brand asset may track:

- show_id
- asset_type
- original_file_ref
- processed_file_ref
- background_removed
- selected_variant
- checksum
- mime_type

## Storage

Both original and processed variants should be stored in the user's selected show storage, for example:

```text
Brand Assets/
  logo-original.jpg
  logo-transparent.png
```

## Quality controls

The background-removal result should be previewed before selection. If edge quality is poor, the user should be able to keep the original or retry processing.

## Template behavior

Templates should scale logos proportionally, keep them inside safe margins and never allow the creator logo to overlap the mandatory **Podcast Powered by HRTechify** bottom-right credit area.
