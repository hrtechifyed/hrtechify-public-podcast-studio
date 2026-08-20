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

export const SAFE_TEMPLATE_IDS = [
  "hrtechify-studio-dark",
  "hrtechify-clean-light",
  "hrtechify-warm-focus",
] as const;

export type SafeTemplateId = (typeof SAFE_TEMPLATE_IDS)[number];

export interface TemplateManifest {
  id: SafeTemplateId;
  name: string;
  version: 1;
  canvas: {
    width: 1920;
    height: 1080;
    fps: 30;
  };
  style: {
    backgroundColor: `#${string}`;
    textColor: `#${string}`;
    mutedTextColor: `#${string}`;
    accentColor: `#${string}`;
    waveformColor: `#${string}`;
    fontFamily: "DejaVu Sans";
    showFontSize: number;
    episodeFontSize: number;
    hostFontSize: number;
    creditFontSize: number;
    captionFontSize: number;
    captionBandOpacity: number;
  };
  layout: {
    horizontalPadding: number;
    showY: number;
    episodeY: number;
    waveformY: number;
    waveformHeight: number;
    hostY: number;
    captionBottomMargin: number;
  };
  slots: Readonly<Partial<Record<TemplateSlot, true>>>;
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

const manifests = [
  {
    id: "hrtechify-studio-dark",
    name: "Studio Dark",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    style: {
      backgroundColor: "#0B0C10",
      textColor: "#F7F7F5",
      mutedTextColor: "#C5C7CE",
      accentColor: "#D6B75A",
      waveformColor: "#D6B75A",
      fontFamily: "DejaVu Sans",
      showFontSize: 42,
      episodeFontSize: 68,
      hostFontSize: 34,
      creditFontSize: 24,
      captionFontSize: 38,
      captionBandOpacity: 0.72,
    },
    layout: {
      horizontalPadding: 150,
      showY: 126,
      episodeY: 212,
      waveformY: 575,
      waveformHeight: 150,
      hostY: 855,
      captionBottomMargin: 84,
    },
    slots: {
      show_name: true,
      episode_name: true,
      host_name: true,
      waveform: true,
      captions: true,
      user_logo: true,
      profile_photo: true,
    },
    platformCredit: REQUIRED_PLATFORM_CREDIT,
  },
  {
    id: "hrtechify-clean-light",
    name: "Clean Light",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    style: {
      backgroundColor: "#F4F2EC",
      textColor: "#171717",
      mutedTextColor: "#575757",
      accentColor: "#8C6A1F",
      waveformColor: "#8C6A1F",
      fontFamily: "DejaVu Sans",
      showFontSize: 40,
      episodeFontSize: 64,
      hostFontSize: 32,
      creditFontSize: 23,
      captionFontSize: 38,
      captionBandOpacity: 0.68,
    },
    layout: {
      horizontalPadding: 170,
      showY: 132,
      episodeY: 224,
      waveformY: 565,
      waveformHeight: 148,
      hostY: 850,
      captionBottomMargin: 82,
    },
    slots: {
      show_name: true,
      episode_name: true,
      host_name: true,
      waveform: true,
      captions: true,
      user_logo: true,
      profile_photo: true,
    },
    platformCredit: REQUIRED_PLATFORM_CREDIT,
  },
  {
    id: "hrtechify-warm-focus",
    name: "Warm Focus",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    style: {
      backgroundColor: "#211B18",
      textColor: "#FFF8EE",
      mutedTextColor: "#D8C8B8",
      accentColor: "#D98F52",
      waveformColor: "#D98F52",
      fontFamily: "DejaVu Sans",
      showFontSize: 42,
      episodeFontSize: 66,
      hostFontSize: 34,
      creditFontSize: 24,
      captionFontSize: 38,
      captionBandOpacity: 0.72,
    },
    layout: {
      horizontalPadding: 155,
      showY: 124,
      episodeY: 215,
      waveformY: 580,
      waveformHeight: 155,
      hostY: 858,
      captionBottomMargin: 84,
    },
    slots: {
      show_name: true,
      episode_name: true,
      host_name: true,
      waveform: true,
      captions: true,
      user_logo: true,
      profile_photo: true,
    },
    platformCredit: REQUIRED_PLATFORM_CREDIT,
  },
] as const satisfies readonly TemplateManifest[];

const colorPattern = /^#[0-9A-F]{6}$/i;

export const validateTemplateManifest = (manifest: TemplateManifest) => {
  if (!SAFE_TEMPLATE_IDS.includes(manifest.id)) throw new Error("template_id_not_allowed");
  if (manifest.version !== 1) throw new Error("template_version_not_allowed");
  if (
    manifest.canvas.width !== 1920 ||
    manifest.canvas.height !== 1080 ||
    manifest.canvas.fps !== 30
  ) {
    throw new Error("template_canvas_not_allowed");
  }
  for (const color of [
    manifest.style.backgroundColor,
    manifest.style.textColor,
    manifest.style.mutedTextColor,
    manifest.style.accentColor,
    manifest.style.waveformColor,
  ]) {
    if (!colorPattern.test(color)) throw new Error("template_color_not_allowed");
  }
  const sizes = [
    manifest.style.showFontSize,
    manifest.style.episodeFontSize,
    manifest.style.hostFontSize,
    manifest.style.creditFontSize,
    manifest.style.captionFontSize,
  ];
  if (sizes.some((size) => !Number.isInteger(size) || size < 18 || size > 96)) {
    throw new Error("template_font_size_not_allowed");
  }
  if (
    !Number.isFinite(manifest.style.captionBandOpacity) ||
    manifest.style.captionBandOpacity < 0.4 ||
    manifest.style.captionBandOpacity > 0.9
  ) {
    throw new Error("template_caption_opacity_not_allowed");
  }
  if (
    manifest.platformCredit.text !== PLATFORM_CREDIT ||
    manifest.platformCredit.required !== true ||
    manifest.platformCredit.removable !== false ||
    manifest.platformCredit.position !== PLATFORM_CREDIT_POSITION
  ) {
    throw new Error("template_platform_credit_invalid");
  }
  return manifest;
};

export const SAFE_TEMPLATE_MANIFESTS: readonly TemplateManifest[] = Object.freeze(
  manifests.map((manifest) => validateTemplateManifest(manifest as TemplateManifest)),
);

export const DEFAULT_TEMPLATE_ID: SafeTemplateId = "hrtechify-studio-dark";

export const isSafeTemplateId = (value: unknown): value is SafeTemplateId =>
  typeof value === "string" && SAFE_TEMPLATE_IDS.includes(value as SafeTemplateId);

export const getSafeTemplateManifest = (
  id: unknown,
  version: unknown = 1,
): TemplateManifest => {
  if (!isSafeTemplateId(id)) throw new Error("template_id_not_allowed");
  if (version !== 1) throw new Error("template_version_not_allowed");
  const manifest = SAFE_TEMPLATE_MANIFESTS.find((item) => item.id === id);
  if (!manifest) throw new Error("template_id_not_allowed");
  return manifest;
};
