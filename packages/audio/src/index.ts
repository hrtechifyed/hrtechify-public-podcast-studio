export type TechnicalAdjustment =
  | "noise_control"
  | "hum_control"
  | "click_reduction"
  | "de_essing"
  | "plosive_control"
  | "level_balancing"
  | "compression"
  | "peak_protection";

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
