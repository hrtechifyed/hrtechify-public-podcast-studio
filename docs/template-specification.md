# Template Specification

Templates define the visual layout of generated podcast videos while preserving creator branding and mandatory platform attribution.

## Required creator slots

Templates should support, as applicable:

- Show Name
- Episode Name
- Host Name
- Creator Logo
- Optional Profile Picture
- Waveform or spectrum area
- Caption safe area
- Optional lower-third area

## Mandatory HRTechify credit

Every template must reserve a safe bottom-right area for:

**Powered by HRTechify**

This credit is a renderer-enforced product rule, not a user-removable template option.

The credit must:

- remain visible throughout the platform-generated episode body
- be readable at normal viewing size
- remain visually secondary to creator branding
- avoid overlap with captions, creator logo, lower thirds or other required text
- stay in the bottom-right corner

If a custom template occupies the reserved footer area, it must be rejected or require adjustment before it can be used.

## Built-in templates

Built-in templates should be versioned. Existing episode renders must retain the exact template version used when the render was confirmed.

## Custom templates

User-supplied templates must be treated as validated media assets plus layout instructions, not executable application code.

Do not permit arbitrary HTML, JavaScript, shell scripts, macros or executable files.

A custom template package may include a validated manifest and approved image/video assets.

## Example conceptual manifest

```json
{
  "version": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "slots": {
    "show": {},
    "episode": {},
    "host": {},
    "logo": {},
    "profilePhoto": {},
    "waveform": {},
    "captions": {}
  },
  "platformCredit": {
    "text": "Powered by HRTechify",
    "required": true,
    "position": "bottom-right"
  }
}
```

## Validation

Template validation should include:

- Canvas size and aspect ratio
- Supported codecs/file types
- File size limits
- Safe margins
- Text overflow checks
- Logo/caption/footer collision checks
- Rejection of executable content
- Still preview before save

## Render snapshot

The selected template version is snapshotted with the episode before final rendering so later template changes cannot silently alter a confirmed render.
