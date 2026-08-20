import {
  MAX_MUSIC_CUES_PER_EPISODE,
  type MusicCue,
  type MusicIntensity,
} from "@hrtechify/shared";

export type TechnicalAdjustment =
  | "noise_control"
  | "hum_control"
  | "click_reduction"
  | "de_essing"
  | "plosive_control"
  | "level_balancing"
  | "compression"
  | "peak_protection";

export type SpeechEditKind =
  | "unusual_pause"
  | "false_start"
  | "repeated_speech"
  | "fumble"
  | "spoken_content_removal";

export interface SpeechEditProposal {
  id: string;
  kind: SpeechEditKind;
  startMs: number;
  endMs: number;
  explanation: string;
  approvalRequired: true;
  decision?: "apply" | "keep_original";
}

export interface ProceduralMusicRecipe {
  bpm: number;
  rootHz: number;
  texture: "warm" | "airy" | "velvet" | "acoustic" | "dreamy" | "ambient";
  pulse: 1 | 2 | 4;
}

export interface TemplateMusicTrack {
  id: string;
  title: string;
  mood: string;
  license: "CC0-1.0";
  origin: "hrtechify-procedural";
  recipe: ProceduralMusicRecipe;
}

/**
 * These tracks are intentionally described as procedural compositions rather
 * than bundled third-party recordings. The renderer can synthesize them from
 * the recipe, which avoids introducing copyrighted or attribution-dependent
 * audio assets into the public repository.
 */
export const TEMPLATE_MUSIC_TRACKS: readonly TemplateMusicTrack[] = [
  {
    id: "paper-lantern",
    title: "Paper Lantern",
    mood: "warm, reflective and lightly melodic",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 66, rootHz: 220, texture: "warm", pulse: 2 },
  },
  {
    id: "quiet-room",
    title: "Quiet Room",
    mood: "airy, restrained and almost weightless",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 58, rootHz: 196, texture: "airy", pulse: 1 },
  },
  {
    id: "velvet-pages",
    title: "Velvet Pages",
    mood: "low, nocturnal and intimate",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 62, rootHz: 174.61, texture: "velvet", pulse: 2 },
  },
  {
    id: "open-window",
    title: "Open Window",
    mood: "light, organic and gently optimistic",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 76, rootHz: 246.94, texture: "acoustic", pulse: 4 },
  },
  {
    id: "moon-notes",
    title: "Moon Notes",
    mood: "dreamy, spacious and soft-edged",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 54, rootHz: 207.65, texture: "dreamy", pulse: 1 },
  },
  {
    id: "ink-ripple",
    title: "Ink Ripple",
    mood: "minimal, atmospheric and contemporary",
    license: "CC0-1.0",
    origin: "hrtechify-procedural",
    recipe: { bpm: 70, rootHz: 185, texture: "ambient", pulse: 2 },
  },
] as const;

export const MUSIC_GAIN_DB: Record<MusicIntensity, number> = {
  "very-subtle": -30,
  subtle: -24,
  "moderately-subtle": -18,
};

export const musicTrackById = (trackId: string) =>
  TEMPLATE_MUSIC_TRACKS.find((track) => track.id === trackId) ?? null;

export const validateMusicPlan = (
  cues: readonly MusicCue[],
  allowedTrackIds: readonly string[],
): MusicCue[] => {
  if (cues.length > MAX_MUSIC_CUES_PER_EPISODE) {
    throw new Error("music_cue_limit_exceeded");
  }

  const allowed = new Set(allowedTrackIds);
  const usedTracks = new Set<string>();
  let throughoutCount = 0;

  const normalized = cues.map((cue) => {
    if (!allowed.has(cue.trackId)) throw new Error("music_track_not_available_for_template");
    if (usedTracks.has(cue.trackId)) throw new Error("music_track_must_be_unique");
    usedTracks.add(cue.trackId);

    if (!(cue.intensity in MUSIC_GAIN_DB)) throw new Error("music_intensity_invalid");
    if (cue.placement !== "throughout" && cue.placement !== "interval") {
      throw new Error("music_placement_invalid");
    }

    if (cue.placement === "throughout") {
      throughoutCount += 1;
      return { ...cue, startSeconds: 0, endSeconds: null };
    }

    const start = Number(cue.startSeconds);
    const end = Number(cue.endSeconds);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
      throw new Error("music_interval_invalid");
    }
    return { ...cue, startSeconds: start, endSeconds: end };
  });

  if (throughoutCount > 1 || (throughoutCount === 1 && normalized.length > 1)) {
    throw new Error("throughout_music_must_be_the_only_cue");
  }

  const intervals = normalized
    .filter((cue) => cue.placement === "interval")
    .sort((left, right) => left.startSeconds - right.startSeconds);
  for (let index = 1; index < intervals.length; index += 1) {
    const previousEnd = intervals[index - 1].endSeconds ?? Infinity;
    if (intervals[index].startSeconds < previousEnd) {
      throw new Error("music_intervals_must_not_overlap");
    }
  }

  return normalized;
};

export const ORIGINAL_RECORDING_IS_IMMUTABLE = true as const;
