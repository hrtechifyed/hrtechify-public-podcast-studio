import {
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";

export type TemplateSlot =
  | "show_name"
  | "episode_name"
  | "host_name"
  | "user_logo"
  | "waveform"
  | "captions";

export type LiteraryMotif =
  | "ink-wash"
  | "pressed-flower"
  | "coffee-margin"
  | "moon-verse"
  | "ocean-notebook"
  | "paper-ribbon";

export interface TemplateSafeArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  canvas: {
    width: 1920;
    height: 1080;
    fps: number;
  };
  slots: Partial<Record<TemplateSlot, TemplateSafeArea>>;
  artDirection: {
    motif: LiteraryMotif;
    background: string;
    ink: string;
    accent: string;
    secondary: string;
    scriptFontStack: string;
    bodyFontStack: string;
    boxesAllowed: false;
    profilePhotoAllowed: false;
  };
  musicTrackIds: readonly [string, string, string];
  platformCredit: {
    text: typeof PLATFORM_CREDIT;
    required: true;
    removable: false;
    position: typeof PLATFORM_CREDIT_POSITION;
  };
}

const sharedSlots: TemplateManifest["slots"] = {
  show_name: { x: 120, y: 118, width: 1180, height: 170 },
  episode_name: { x: 120, y: 295, width: 1320, height: 250 },
  host_name: { x: 122, y: 565, width: 980, height: 90 },
  user_logo: { x: 1510, y: 90, width: 270, height: 180 },
  waveform: { x: 120, y: 700, width: 1160, height: 120 },
  captions: { x: 210, y: 845, width: 1320, height: 145 },
};

const credit = {
  text: PLATFORM_CREDIT,
  required: true,
  removable: false,
  position: PLATFORM_CREDIT_POSITION,
} as const;

export const TEMPLATE_CATALOG: readonly TemplateManifest[] = [
  {
    id: "poets-dawn",
    name: "Poet's Dawn",
    description: "Warm paper, loose ink and a quiet sunrise mood.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "paper-ribbon",
      background: "#f4ead9",
      ink: "#2f2926",
      accent: "#b15f48",
      secondary: "#d5a96c",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["paper-lantern", "open-window", "quiet-room"],
    platformCredit: credit,
  },
  {
    id: "midnight-manuscript",
    name: "Midnight Manuscript",
    description: "Deep indigo, hand-written energy and moonlit ink.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "ink-wash",
      background: "#161725",
      ink: "#f3ebdc",
      accent: "#bba6d8",
      secondary: "#6472a1",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["velvet-pages", "moon-notes", "quiet-room"],
    platformCredit: credit,
  },
  {
    id: "wildflower-pages",
    name: "Wildflower Pages",
    description: "Soft sage, botanical gestures and a lived-in notebook feel.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "pressed-flower",
      background: "#edf0df",
      ink: "#28352d",
      accent: "#738b65",
      secondary: "#c79773",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["open-window", "paper-lantern", "ink-ripple"],
    platformCredit: credit,
  },
  {
    id: "coffee-and-margins",
    name: "Coffee & Margins",
    description: "Sepia paper, imperfect margin marks and coffeehouse warmth.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "coffee-margin",
      background: "#ead9be",
      ink: "#3d2f27",
      accent: "#8d5f43",
      secondary: "#b98d62",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["paper-lantern", "velvet-pages", "open-window"],
    platformCredit: credit,
  },
  {
    id: "moonlit-verse",
    name: "Moonlit Verse",
    description: "Plum-black atmosphere with soft luminous flourishes.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "moon-verse",
      background: "#211827",
      ink: "#f7eee2",
      accent: "#d4a4c7",
      secondary: "#8e709f",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["moon-notes", "velvet-pages", "ink-ripple"],
    platformCredit: credit,
  },
  {
    id: "ocean-notebook",
    name: "Ocean Notebook",
    description: "Washed blue, handwritten movement and open-air calm.",
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    slots: sharedSlots,
    artDirection: {
      motif: "ocean-notebook",
      background: "#dcebed",
      ink: "#233842",
      accent: "#4c8090",
      secondary: "#88aab2",
      scriptFontStack: '"Segoe Script", "Apple Chancery", "URW Chancery L", cursive',
      bodyFontStack: 'Georgia, "Times New Roman", serif',
      boxesAllowed: false,
      profilePhotoAllowed: false,
    },
    musicTrackIds: ["quiet-room", "ink-ripple", "open-window"],
    platformCredit: credit,
  },
] as const;

export const templateById = (templateId: string) =>
  TEMPLATE_CATALOG.find((template) => template.id === templateId) ?? null;

export const REQUIRED_PLATFORM_CREDIT = credit;
