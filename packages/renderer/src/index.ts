import {
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
  type MusicCue,
} from "@hrtechify/shared";

export interface RenderSnapshot {
  showName: string;
  episodeName: string;
  hostName: string;
  templateId: string;
  templateVersion: number;
  selectedLogoRef?: string;
  musicPlan: MusicCue[];
  captionsEnabled: boolean;
}

export interface FinalRenderRequest {
  userId: string;
  showId: string;
  episodeId: string;
  approvedAudioRef: string;
  snapshot: RenderSnapshot;
  platformCredit: {
    text: typeof PLATFORM_CREDIT;
    position: typeof PLATFORM_CREDIT_POSITION;
  };
}

export const createRequiredPlatformCredit = () => ({
  text: PLATFORM_CREDIT,
  position: PLATFORM_CREDIT_POSITION,
});
