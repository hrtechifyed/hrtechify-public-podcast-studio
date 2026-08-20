import {
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";

export type TemplateSlot =
  | "show_name"
  | "episode_name"
  | "host_name"
  | "user_logo"
  | "profile_photo"
  | "waveform"
  | "captions";

export interface TemplateManifest {
  id: string;
  name: string;
  version: number;
  canvas: {
    width: 1920;
    height: 1080;
    fps: number;
  };
  slots: Partial<Record<TemplateSlot, unknown>>;
  platformCredit: {
    text: typeof PLATFORM_CREDIT;
    required: true;
    removable: false;
    position: typeof PLATFORM_CREDIT_POSITION;
  };
}

export const REQUIRED_PLATFORM_CREDIT = {
  text: PLATFORM_CREDIT,
  required: true,
  removable: false,
  position: PLATFORM_CREDIT_POSITION,
} as const;
