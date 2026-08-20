# Browser Recording Flow

Direct browser recording is a first-class product feature.

## User experience

The recorder should provide:

- Microphone permission state
- Microphone/device selector
- Live input meter
- Clipping warning
- Record
- Pause
- Resume
- Stop
- Large elapsed timer
- Playback before upload
- Use This Recording
- Record Again

## Reliability model

Long recordings should not remain only in one in-memory browser Blob.

Recommended flow:

```text
Microphone
  |
  v
MediaRecorder
  |
  v
Small chunks
  |
  v
IndexedDB
  |
  +--> recovery after refresh/crash
  |
  v
User stops and previews
  |
  v
User accepts recording
  |
  v
Upload to selected show storage
```

## Session handling

A recording session ID should be created before the microphone starts. Chunks should be persisted incrementally.

If unfinished chunks exist after reload, the application should offer to recover or discard the unfinished recording. It should not automatically upload an unfinished recording without user confirmation.

## Browser formats

The application must detect the MIME type/container produced by the browser rather than assuming all browsers emit the same codec.

Accepted recordings may be normalized inside the media-processing container to a pipeline-safe internal format before analysis.

## Original preservation

The accepted browser recording is the original source. It must be saved to the user's selected show storage and must not be overwritten by later processing.
