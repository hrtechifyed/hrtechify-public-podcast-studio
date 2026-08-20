export const TECHNICAL_ADJUSTMENTS = [
  "noise_control",
  "hum_control",
  "click_reduction",
  "de_essing",
  "plosive_control",
  "level_balancing",
  "compression",
  "peak_protection",
] as const;

export type TechnicalAdjustment = (typeof TECHNICAL_ADJUSTMENTS)[number];
export type TechnicalCleanupCondition = "always" | "when_detected";
export type TechnicalCleanupStrength = "gentle";

export interface TechnicalCleanupRule {
  adjustment: TechnicalAdjustment;
  condition: TechnicalCleanupCondition;
  maxStrength: TechnicalCleanupStrength;
}

export interface TechnicalCleanupProfile {
  version: string;
  targetIntegratedLoudnessLkfs: number;
  loudnessToleranceDb: number;
  maxTruePeakDbfs: number;
  preserveWords: true;
  preserveTiming: true;
  preservePitch: true;
  preserveSpeakingSpeed: true;
  rules: readonly TechnicalCleanupRule[];
}

export interface TechnicalCleanupPlan {
  profileVersion: string;
  sourceImmutable: true;
  targetIntegratedLoudnessLkfs: number;
  loudnessToleranceDb: number;
  maxTruePeakDbfs: number;
  preserveWords: true;
  preserveTiming: true;
  preservePitch: true;
  preserveSpeakingSpeed: true;
  adjustments: readonly TechnicalCleanupRule[];
}

export const PODCAST_TECHNICAL_CLEANUP_PROFILE_V1 = Object.freeze({
  version: "podcast-cleanup-v1",
  targetIntegratedLoudnessLkfs: -16,
  loudnessToleranceDb: 1,
  maxTruePeakDbfs: -1,
  preserveWords: true,
  preserveTiming: true,
  preservePitch: true,
  preserveSpeakingSpeed: true,
  rules: Object.freeze([
    { adjustment: "level_balancing", condition: "always", maxStrength: "gentle" },
    { adjustment: "peak_protection", condition: "always", maxStrength: "gentle" },
    { adjustment: "compression", condition: "when_detected", maxStrength: "gentle" },
    { adjustment: "noise_control", condition: "when_detected", maxStrength: "gentle" },
    { adjustment: "hum_control", condition: "when_detected", maxStrength: "gentle" },
    { adjustment: "click_reduction", condition: "when_detected", maxStrength: "gentle" },
    { adjustment: "de_essing", condition: "when_detected", maxStrength: "gentle" },
    { adjustment: "plosive_control", condition: "when_detected", maxStrength: "gentle" },
  ]),
}) satisfies TechnicalCleanupProfile;

const TECHNICAL_ADJUSTMENT_SET = new Set<string>(TECHNICAL_ADJUSTMENTS);

export const validateTechnicalCleanupProfile = (profile: TechnicalCleanupProfile) => {
  if (!profile.version.trim()) throw new Error("technical_cleanup_version_required");
  if (profile.targetIntegratedLoudnessLkfs !== -16) throw new Error("technical_cleanup_loudness_invalid");
  if (profile.loudnessToleranceDb !== 1) throw new Error("technical_cleanup_tolerance_invalid");
  if (profile.maxTruePeakDbfs !== -1) throw new Error("technical_cleanup_peak_invalid");
  if (!profile.preserveWords || !profile.preserveTiming || !profile.preservePitch || !profile.preserveSpeakingSpeed) {
    throw new Error("technical_cleanup_preservation_required");
  }
  const seen = new Set<string>();
  for (const rule of profile.rules) {
    if (!TECHNICAL_ADJUSTMENT_SET.has(rule.adjustment)) throw new Error("technical_cleanup_adjustment_invalid");
    if (seen.has(rule.adjustment)) throw new Error("technical_cleanup_duplicate_adjustment");
    seen.add(rule.adjustment);
    if (rule.condition !== "always" && rule.condition !== "when_detected") {
      throw new Error("technical_cleanup_condition_invalid");
    }
    if (rule.maxStrength !== "gentle") throw new Error("technical_cleanup_strength_invalid");
  }
  if (seen.size !== TECHNICAL_ADJUSTMENTS.length) throw new Error("technical_cleanup_adjustments_incomplete");
  return true;
};

export const createTechnicalCleanupPlan = (
  sourceImmutable: boolean,
  profile: TechnicalCleanupProfile = PODCAST_TECHNICAL_CLEANUP_PROFILE_V1,
): TechnicalCleanupPlan => {
  if (!sourceImmutable) throw new Error("technical_cleanup_requires_immutable_source");
  validateTechnicalCleanupProfile(profile);
  return Object.freeze({
    profileVersion: profile.version,
    sourceImmutable: true,
    targetIntegratedLoudnessLkfs: profile.targetIntegratedLoudnessLkfs,
    loudnessToleranceDb: profile.loudnessToleranceDb,
    maxTruePeakDbfs: profile.maxTruePeakDbfs,
    preserveWords: true,
    preserveTiming: true,
    preservePitch: true,
    preserveSpeakingSpeed: true,
    adjustments: Object.freeze(profile.rules.map((rule) => Object.freeze({ ...rule }))),
  });
};

export const SPEECH_EDIT_KINDS = [
  "unusual_pause",
  "false_start",
  "repeated_speech",
  "fumble",
  "spoken_content_removal",
] as const;

export type SpeechEditKind = (typeof SPEECH_EDIT_KINDS)[number];
export type SpeechEditDecision = "apply" | "keep_original";

export interface SpeechEditProposal {
  id: string;
  kind: SpeechEditKind;
  startMs: number;
  endMs: number;
  explanation: string;
  approvalRequired: true;
  decision?: SpeechEditDecision;
}

export const ORIGINAL_RECORDING_IS_IMMUTABLE = true as const;
