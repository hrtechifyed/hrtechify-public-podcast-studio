import {
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";

export interface RenderSnapshot {
  showName: string;
  episodeName: string;
  hostName: string;
  templateId: string;
  templateVersion: number;
  selectedLogoRef?: string;
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

export interface TimedCaptionWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface CaptionCutRange {
  startMs: number;
  endMs: number;
}

const validateCaptionWord = (word: TimedCaptionWord) => {
  if (
    typeof word.word !== "string" ||
    !word.word.trim() ||
    !Number.isSafeInteger(word.startMs) ||
    !Number.isSafeInteger(word.endMs) ||
    word.startMs < 0 ||
    word.endMs <= word.startMs
  ) {
    throw new Error("caption_word_invalid");
  }
  return word;
};

const validateCutRanges = (ranges: readonly CaptionCutRange[]) => {
  let previousEnd = 0;
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.startMs) ||
      !Number.isSafeInteger(range.endMs) ||
      range.startMs < 0 ||
      range.endMs <= range.startMs ||
      range.startMs < previousEnd
    ) {
      throw new Error("caption_cut_range_invalid");
    }
    previousEnd = range.endMs;
  }
  return ranges;
};

const overlapMs = (word: TimedCaptionWord, range: CaptionCutRange) =>
  Math.max(0, Math.min(word.endMs, range.endMs) - Math.max(word.startMs, range.startMs));

const removedBefore = (timeMs: number, ranges: readonly CaptionCutRange[]) => {
  let removed = 0;
  for (const range of ranges) {
    if (range.endMs <= timeMs) {
      removed += range.endMs - range.startMs;
      continue;
    }
    if (range.startMs < timeMs) removed += timeMs - range.startMs;
    break;
  }
  return removed;
};

export const transformCaptionWordsForApprovedCuts = (
  words: readonly TimedCaptionWord[],
  cuts: readonly CaptionCutRange[],
  offsetMs = 0,
): TimedCaptionWord[] => {
  if (!Number.isSafeInteger(offsetMs) || offsetMs < 0) throw new Error("caption_offset_invalid");
  validateCutRanges(cuts);
  const output: TimedCaptionWord[] = [];
  let previousEnd = 0;
  for (const raw of words) {
    const word = validateCaptionWord(raw);
    if (cuts.some((cut) => overlapMs(word, cut) > 0)) continue;
    const startMs = word.startMs - removedBefore(word.startMs, cuts) + offsetMs;
    const endMs = word.endMs - removedBefore(word.endMs, cuts) + offsetMs;
    if (endMs <= startMs || startMs < previousEnd) throw new Error("caption_timing_transform_invalid");
    output.push({ word: word.word, startMs, endMs });
    previousEnd = endMs;
  }
  return output;
};

export const formatWebVttTimestamp = (valueMs: number) => {
  if (!Number.isSafeInteger(valueMs) || valueMs < 0) throw new Error("caption_timestamp_invalid");
  const hours = Math.floor(valueMs / 3_600_000);
  const minutes = Math.floor((valueMs % 3_600_000) / 60_000);
  const seconds = Math.floor((valueMs % 60_000) / 1000);
  const milliseconds = valueMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

const escapeVttText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export const buildWebVtt = (
  words: readonly TimedCaptionWord[],
  options: { maxWordsPerCue?: number; maxCueDurationMs?: number } = {},
) => {
  const maxWordsPerCue = options.maxWordsPerCue ?? 8;
  const maxCueDurationMs = options.maxCueDurationMs ?? 3500;
  if (!Number.isInteger(maxWordsPerCue) || maxWordsPerCue < 1 || maxWordsPerCue > 12) {
    throw new Error("caption_cue_word_limit_invalid");
  }
  if (!Number.isInteger(maxCueDurationMs) || maxCueDurationMs < 1000 || maxCueDurationMs > 6000) {
    throw new Error("caption_cue_duration_invalid");
  }

  const validated = words.map((word) => validateCaptionWord(word));
  const cues: TimedCaptionWord[][] = [];
  let current: TimedCaptionWord[] = [];
  for (const word of validated) {
    const candidateStart = current[0]?.startMs ?? word.startMs;
    const wouldExceedDuration = word.endMs - candidateStart > maxCueDurationMs;
    if (current.length > 0 && (current.length >= maxWordsPerCue || wouldExceedDuration)) {
      cues.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length) cues.push(current);

  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    const first = cue[0];
    const last = cue[cue.length - 1];
    lines.push(String(index + 1));
    lines.push(`${formatWebVttTimestamp(first.startMs)} --> ${formatWebVttTimestamp(last.endMs)}`);
    lines.push(escapeVttText(cue.map((word) => word.word).join(" ")));
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
};

export interface CaptionTimingDocument {
  version: "hrtechify-caption-words-v1";
  episodeId: string;
  sourceFileId: string;
  analysisRunId: string;
  words: TimedCaptionWord[];
}

export const createCaptionTimingDocument = (input: Omit<CaptionTimingDocument, "version">): CaptionTimingDocument => ({
  version: "hrtechify-caption-words-v1",
  episodeId: input.episodeId,
  sourceFileId: input.sourceFileId,
  analysisRunId: input.analysisRunId,
  words: input.words.map((word) => ({ ...validateCaptionWord(word) })),
});

export const parseCaptionTimingDocument = (value: unknown): CaptionTimingDocument => {
  if (!value || typeof value !== "object") throw new Error("caption_timing_document_invalid");
  const document = value as Partial<CaptionTimingDocument>;
  if (
    document.version !== "hrtechify-caption-words-v1" ||
    typeof document.episodeId !== "string" || !document.episodeId ||
    typeof document.sourceFileId !== "string" || !document.sourceFileId ||
    typeof document.analysisRunId !== "string" || !document.analysisRunId ||
    !Array.isArray(document.words)
  ) {
    throw new Error("caption_timing_document_invalid");
  }
  return {
    version: document.version,
    episodeId: document.episodeId,
    sourceFileId: document.sourceFileId,
    analysisRunId: document.analysisRunId,
    words: document.words.map((word) => validateCaptionWord(word as TimedCaptionWord)),
  };
};
