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

export const ORIGINAL_RECORDING_IS_IMMUTABLE = true as const;
