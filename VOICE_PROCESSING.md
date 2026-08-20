# Voice Processing Policy

The studio is designed around a human-controlled editing model.

## Original recording

The original source recording is immutable. Processing must create derived media rather than overwriting the source.

## Technical cleanup that may be automatic

Where it does not change spoken words, the pipeline may automatically apply technical processing such as:

- Noise or hum control
- Click reduction
- De-essing
- Plosive control
- Level balancing
- Compression
- Peak protection
- Format normalization

## Changes that require user approval

If an edit would remove or materially alter spoken content or pacing, the system may propose it but must not apply it until the user approves it. Examples include:

- Fumbles
- Repeated speech
- False starts
- Spoken-word removal
- Material shortening of unusual pauses
- Timing edits that materially change delivery

## Review experience

Meaningful proposals should include enough context for the user to make an informed decision, ideally including timestamps and local playback around the proposed edit.

The user must be able to choose **Apply** or **Keep Original**.

## Transcription

Transcription may be used for analysis, captions and edit review. Transcript correction may be made for captions when audio remains unchanged. Low-confidence areas should be surfaced for review where practical.

## Synthetic replacement speech

The initial product does not automatically synthesize replacement words into a user's voice. Any future synthetic-voice feature would require a separate explicit opt-in, separate product safeguards and clear disclosure.

## Final render lock

Before rendering, the user confirms the approved edits and final video metadata. The render uses the approved snapshot rather than mutable show settings.

## Public transparency

This policy should be reflected in both the repository documentation and the user-facing **Privacy & Your Data** and **How It Works** sections of the application.
