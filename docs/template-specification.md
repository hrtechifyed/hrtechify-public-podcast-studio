# Template Specification

Templates define the visual language of generated podcast videos while preserving creator branding and the mandatory HRTechify platform attribution.

## Creative direction

Built-in templates must feel like **creative literature rather than corporate presentation slides**.

The default visual rules are:

- no formal information boxes, rectangular text panels or dashboard-style cards inside the rendered template;
- readable cursive/script styling may be used for the show name, host line or decorative accents;
- episode titles must remain highly legible at video scale;
- typography should feel editorial, handwritten or literary rather than business-formal;
- decorative motifs can include ink washes, paper marks, botanical gestures, handwritten lines, subtle rings, ribbons or atmospheric gradients;
- creator text must remain in the same safe positions across the built-in family so changing a template does not change the information hierarchy;
- creator profile photographs are **not supported and must never be rendered in a template**.

The current built-in creative family is:

- Poet's Dawn
- Midnight Manuscript
- Wildflower Pages
- Coffee & Margins
- Moonlit Verse
- Ocean Notebook

## Required creator slots

Templates support:

- Show Name
- Episode Name
- Host Name
- Creator Logo
- Waveform or spectrum area
- Closed-caption safe area

There is deliberately **no profile-photo slot**.

## Closed-caption safety

Captions are treated as a permanent layout concern, not an afterthought.

Every template uses the same caption-safe lower area. Captions must:

- stay clear of Show / Episode / Host text;
- stay clear of the optional creator logo;
- stay clear of the mandatory HRTechify footer credit;
- remain readable on both light and dark artwork;
- use high-contrast text plus shadow/stroke treatment instead of introducing a large formal caption box by default;
- wrap within the reserved caption width rather than moving into creator metadata.

The preview and final renderer must use the same safe-area contract.

## Built-in background music

Each built-in template exposes exactly three compatible background-music choices. These are **HRTechify procedural originals released under CC0-1.0**, not third-party commercial tracks bundled into the repository.

A user may select up to three different music tracks for one episode.

Each selected music cue records:

- track ID;
- intensity: `very-subtle`, `subtle`, or `moderately-subtle`;
- placement: `throughout` or `interval`;
- interval start/end when applicable.

Rules:

- a maximum of three music cues may exist per episode;
- a track may be used only if the selected template offers it;
- the same track cannot be selected twice in one episode;
- one `throughout` cue must be the only cue;
- multiple interval cues may be used only when their intervals do not overlap;
- narration remains the primary audio and music levels are deliberately conservative.

## Mandatory HRTechify credit

Every template must reserve a safe bottom-right area for:

**Podcast Powered by HRTechify**

This credit is a renderer-enforced product rule, not a user-removable template option.

The credit must:

- remain visible throughout the platform-generated episode body;
- be readable at normal viewing size;
- remain visually secondary to creator branding;
- avoid overlap with captions, creator logo and creator text;
- stay in the bottom-right corner.

## Built-in template versioning

Built-in templates are versioned. Existing episode renders must retain the exact template version used when the render was confirmed.

## Custom templates

A future user-supplied template must be treated as validated media assets plus layout instructions, not executable application code.

Do not permit arbitrary HTML, JavaScript, shell scripts, macros or executable files.

A custom template package may include a validated manifest and approved image/video assets, but it must obey the same caption-safe, no-profile-photo and mandatory-credit rules.

## Validation

Template validation includes:

- canvas size and aspect ratio;
- supported codecs/file types for asset-based templates;
- file-size limits;
- safe margins;
- text overflow checks;
- logo/caption/footer collision checks;
- rejection of any profile-photo slot;
- rejection of layouts that place formal boxes over creator text as a built-in visual treatment;
- rejection of executable content;
- still preview before save.

## Render snapshot

The selected template version and the episode music plan are snapshotted with the episode before final rendering so later template changes cannot silently alter a confirmed render.
