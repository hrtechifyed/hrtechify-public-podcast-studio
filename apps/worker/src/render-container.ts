import { Container, ContainerProxy } from "@cloudflare/containers";
import { getSafeTemplateManifest, type SafeTemplateId } from "@hrtechify/templates";
import type { NormalizedApprovedEdit } from "./render-jobs";

export { ContainerProxy };

const SOURCE_PATH = "/tmp/hrtechify-source";
const EDITORIAL_PATH = "/tmp/hrtechify-editorial.flac";
const OUTPUT_PATH = "/tmp/hrtechify-technical-master.flac";
const CAPTION_PATH = "/tmp/hrtechify-final.vtt";
const SHOW_TEXT_PATH = "/tmp/hrtechify-show.txt";
const EPISODE_TEXT_PATH = "/tmp/hrtechify-episode.txt";
const HOST_TEXT_PATH = "/tmp/hrtechify-host.txt";
const CREDIT_TEXT_PATH = "/tmp/hrtechify-credit.txt";
const INTRO_SOURCE_PATH = "/tmp/hrtechify-intro-source";
const OUTRO_SOURCE_PATH = "/tmp/hrtechify-outro-source";
const INTRO_AUDIO_PATH = "/tmp/hrtechify-intro.flac";
const OUTRO_AUDIO_PATH = "/tmp/hrtechify-outro.flac";
const INTRO_SEGMENT_PATH = "/tmp/hrtechify-intro.mp4";
const BODY_SEGMENT_PATH = "/tmp/hrtechify-body.mp4";
const OUTRO_SEGMENT_PATH = "/tmp/hrtechify-outro.mp4";
const CONCAT_LIST_PATH = "/tmp/hrtechify-concat.txt";
const FINAL_MP3_PATH = "/tmp/hrtechify-final.mp3";
const FINAL_MP4_PATH = "/tmp/hrtechify-final.mp4";
const FONT_PATH = "/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf";
const LOUDNESS_TARGET = -16;
const TRUE_PEAK_TARGET = -1;
const TIMING_TOLERANCE_MS = 120;

interface LoudnormMeasurement {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

export interface TechnicalMasterResult {
  sizeBytes: number;
  sourceDurationMs: number;
  outputDurationMs: number;
  approvedRemovedDurationMs: number;
  appliedAdjustments: readonly ["level_balancing", "peak_protection"];
}

export interface BrandMediaProbe {
  present: boolean;
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface FinalPublicationResult {
  mp3SizeBytes: number;
  mp4SizeBytes: number;
  bodyDurationMs: number;
  introDurationMs: number;
  outroDurationMs: number;
  totalDurationMs: number;
}

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer).trim();
const msToSeconds = (value: number) => (value / 1000).toFixed(3);
const ffColor = (value: string) => `0x${value.slice(1)}`;

const assColor = (hex: string, alpha = "00") => {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H${alpha}${b}${g}${r}&`;
};

const parseFinite = (value: unknown, code: string) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(code);
  return number;
};

const parseDurationMs = (text: string) => {
  const seconds = Number(text.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("render_duration_invalid");
  return Math.round(seconds * 1000);
};

const cleanDisplayText = (value: string, maxLength: number) => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > maxLength) throw new Error("render_display_text_invalid");
  return cleaned;
};

const wrapDisplayText = (value: string, width = 42) => {
  const words = value.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\n");
};

export const validateRenderRangesAgainstDuration = (
  ranges: readonly NormalizedApprovedEdit[],
  sourceDurationMs: number,
) => {
  if (!Number.isSafeInteger(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new Error("render_duration_invalid");
  }
  const validated: Array<{ startMs: number; endMs: number }> = [];
  let previousEnd = 0;
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.startMs) ||
      !Number.isSafeInteger(range.endMs) ||
      range.startMs < 0 ||
      range.endMs <= range.startMs ||
      range.startMs < previousEnd ||
      range.startMs >= sourceDurationMs
    ) {
      throw new Error("render_approved_edit_invalid");
    }
    const endMs = Math.min(range.endMs, sourceDurationMs);
    if (endMs <= range.startMs) throw new Error("render_approved_edit_invalid");
    validated.push({ startMs: range.startMs, endMs });
    previousEnd = endMs;
  }
  const removedDurationMs = validated.reduce((sum, range) => sum + range.endMs - range.startMs, 0);
  if (removedDurationMs >= sourceDurationMs) throw new Error("render_would_remove_all_audio");
  return { ranges: validated, removedDurationMs };
};

export const buildEditorialFilterGraph = (
  ranges: readonly { startMs: number; endMs: number }[],
  sourceDurationMs: number,
) => {
  if (ranges.length === 0) return null;
  const segments: Array<{ startMs: number; endMs: number | null }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.startMs > cursor) segments.push({ startMs: cursor, endMs: range.startMs });
    cursor = range.endMs;
  }
  if (cursor < sourceDurationMs) segments.push({ startMs: cursor, endMs: null });
  if (segments.length === 0) throw new Error("render_would_remove_all_audio");

  const filters = segments.map((segment, index) => {
    const end = segment.endMs === null ? "" : `:end=${msToSeconds(segment.endMs)}`;
    return `[0:a:0]atrim=start=${msToSeconds(segment.startMs)}${end},asetpts=PTS-STARTPTS[s${index}]`;
  });
  if (segments.length === 1) {
    filters.push("[s0]anull[editorial]");
  } else {
    filters.push(`${segments.map((_, index) => `[s${index}]`).join("")}concat=n=${segments.length}:v=0:a=1[editorial]`);
  }
  return filters.join(";");
};

export const parseLoudnormMeasurement = (stderr: string): LoudnormMeasurement => {
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/m);
  if (!match) throw new Error("render_loudness_measurement_missing");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error("render_loudness_measurement_invalid");
  }
  return {
    input_i: parseFinite(parsed.input_i, "render_loudness_measurement_invalid"),
    input_tp: parseFinite(parsed.input_tp, "render_loudness_measurement_invalid"),
    input_lra: parseFinite(parsed.input_lra, "render_loudness_measurement_invalid"),
    input_thresh: parseFinite(parsed.input_thresh, "render_loudness_measurement_invalid"),
    target_offset: parseFinite(parsed.target_offset, "render_loudness_measurement_invalid"),
  };
};

const loudnormSecondPass = (measurement: LoudnormMeasurement) => [
  `I=${LOUDNESS_TARGET}`,
  `TP=${TRUE_PEAK_TARGET}`,
  `measured_I=${measurement.input_i}`,
  `measured_TP=${measurement.input_tp}`,
  `measured_LRA=${measurement.input_lra}`,
  `measured_thresh=${measurement.input_thresh}`,
  `offset=${measurement.target_offset}`,
  "linear=true",
  "print_format=summary",
].join(":");

export class PodcastRenderContainer extends Container {
  sleepAfter = "2m";
  enableInternet = false;
  entrypoint = ["sh", "-c", "sleep infinity"];

  private requireRuntime() {
    const runtime = this.ctx.container;
    if (!runtime) throw new Error("render_container_runtime_unavailable");
    return runtime;
  }

  private async ensureRunning() {
    const runtime = this.ctx.container;
    if (!runtime?.running) await this.start({ enableInternet: false });
    this.requireRuntime();
  }

  private async execText(args: string[]) {
    const process = await this.requireRuntime().exec(args);
    const output = await process.output();
    return {
      exitCode: output.exitCode,
      stdout: decode(output.stdout),
      stderr: decode(output.stderr),
    };
  }

  private async writeStream(path: string, source: ReadableStream<Uint8Array>, code: string) {
    const write = await this.requireRuntime().exec(["tee", path], { stdin: source, stdout: "ignore" });
    if ((await write.exitCode) !== 0) throw new Error(code);
  }

  private async writeText(path: string, value: string) {
    const body = new Response(value).body;
    if (!body) throw new Error("render_text_stream_unavailable");
    await this.writeStream(path, body, "render_text_write_failed");
  }

  private async probeDurationMs(path: string) {
    const result = await this.execText([
      "ffprobe", "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path,
    ]);
    if (result.exitCode !== 0) throw new Error("render_probe_failed");
    return parseDurationMs(result.stdout);
  }

  private async hasStream(path: string, stream: "a" | "v") {
    const result = await this.execText([
      "ffprobe", "-v", "error", "-select_streams", `${stream}:0`,
      "-show_entries", "stream=index", "-of", "csv=p=0", path,
    ]);
    return result.exitCode === 0 && Boolean(result.stdout.trim());
  }

  private async fileSize(path: string) {
    const stat = await this.execText(["stat", "-c", "%s", path]);
    if (stat.exitCode !== 0) throw new Error("render_output_stat_failed");
    const size = Number(stat.stdout);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("render_output_size_invalid");
    return size;
  }

  async renderTechnicalMaster(
    source: ReadableStream<Uint8Array>,
    approvedEdits: readonly NormalizedApprovedEdit[],
  ): Promise<TechnicalMasterResult> {
    await this.ensureRunning();
    await this.cleanupFiles();
    await this.writeStream(SOURCE_PATH, source, "render_source_write_failed");

    const sourceDurationMs = await this.probeDurationMs(SOURCE_PATH);
    const validated = validateRenderRangesAgainstDuration(approvedEdits, sourceDurationMs);
    const filterGraph = buildEditorialFilterGraph(validated.ranges, sourceDurationMs);

    const editorialArgs = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", SOURCE_PATH];
    if (filterGraph) {
      editorialArgs.push("-filter_complex", filterGraph, "-map", "[editorial]");
    } else {
      editorialArgs.push("-map", "0:a:0");
    }
    editorialArgs.push("-vn", "-c:a", "flac", "-y", EDITORIAL_PATH);
    const editorial = await this.execText(editorialArgs);
    if (editorial.exitCode !== 0) throw new Error("render_editorial_pass_failed");

    const measure = await this.execText([
      "ffmpeg", "-hide_banner", "-i", EDITORIAL_PATH,
      "-af", `loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK_TARGET}:print_format=json`,
      "-f", "null", "-",
    ]);
    if (measure.exitCode !== 0) throw new Error("render_loudness_measurement_failed");
    const measurement = parseLoudnormMeasurement(measure.stderr);

    const normalize = await this.execText([
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", EDITORIAL_PATH,
      "-af", `loudnorm=${loudnormSecondPass(measurement)}`,
      "-c:a", "flac", "-compression_level", "5", "-y", OUTPUT_PATH,
    ]);
    if (normalize.exitCode !== 0) throw new Error("render_technical_cleanup_failed");

    const sizeBytes = await this.fileSize(OUTPUT_PATH);
    const outputDurationMs = await this.probeDurationMs(OUTPUT_PATH);
    const expectedDurationMs = sourceDurationMs - validated.removedDurationMs;
    if (Math.abs(outputDurationMs - expectedDurationMs) > TIMING_TOLERANCE_MS) {
      throw new Error("render_timing_integrity_failed");
    }

    return {
      sizeBytes,
      sourceDurationMs,
      outputDurationMs,
      approvedRemovedDurationMs: validated.removedDurationMs,
      appliedAdjustments: ["level_balancing", "peak_protection"],
    };
  }

  async importTechnicalMaster(source: ReadableStream<Uint8Array>) {
    await this.ensureRunning();
    await this.writeStream(OUTPUT_PATH, source, "render_technical_master_import_failed");
    const sizeBytes = await this.fileSize(OUTPUT_PATH);
    const durationMs = await this.probeDurationMs(OUTPUT_PATH);
    return { sizeBytes, durationMs };
  }

  async loadBrandMedia(kind: "intro" | "outro", source: ReadableStream<Uint8Array> | null): Promise<BrandMediaProbe> {
    await this.ensureRunning();
    const path = kind === "intro" ? INTRO_SOURCE_PATH : OUTRO_SOURCE_PATH;
    if (!source) {
      await this.execText(["rm", "-f", path]);
      return { present: false, durationMs: 0, hasAudio: false, hasVideo: false };
    }
    await this.writeStream(path, source, `render_${kind}_write_failed`);
    const durationMs = await this.probeDurationMs(path);
    const [hasAudio, hasVideo] = await Promise.all([this.hasStream(path, "a"), this.hasStream(path, "v")]);
    if (!hasAudio && !hasVideo) throw new Error(`render_${kind}_media_invalid`);
    return { present: true, durationMs, hasAudio, hasVideo };
  }

  private async normalizeBrandAudio(kind: "intro" | "outro", probe: BrandMediaProbe) {
    if (!probe.present) return null;
    const input = kind === "intro" ? INTRO_SOURCE_PATH : OUTRO_SOURCE_PATH;
    const output = kind === "intro" ? INTRO_AUDIO_PATH : OUTRO_AUDIO_PATH;
    let result;
    if (probe.hasAudio) {
      result = await this.execText([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", input,
        "-map", "0:a:0", "-vn", "-af", "aresample=48000",
        "-c:a", "flac", "-y", output,
      ]);
    } else {
      result = await this.execText([
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", msToSeconds(probe.durationMs), "-c:a", "flac", "-y", output,
      ]);
    }
    if (result.exitCode !== 0) throw new Error(`render_${kind}_audio_prepare_failed`);
    return output;
  }

  private async renderBrandVideoSegment(
    kind: "intro" | "outro",
    probe: BrandMediaProbe,
    templateId: SafeTemplateId,
  ) {
    if (!probe.present) return null;
    const template = getSafeTemplateManifest(templateId, 1);
    const source = kind === "intro" ? INTRO_SOURCE_PATH : OUTRO_SOURCE_PATH;
    const audio = kind === "intro" ? INTRO_AUDIO_PATH : OUTRO_AUDIO_PATH;
    const output = kind === "intro" ? INTRO_SEGMENT_PATH : OUTRO_SEGMENT_PATH;
    const common = [
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-r", String(template.canvas.fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", "-y", output,
    ];
    let args: string[];
    if (probe.hasVideo) {
      const videoFilter = `scale=${template.canvas.width}:${template.canvas.height}:force_original_aspect_ratio=decrease,pad=${template.canvas.width}:${template.canvas.height}:(ow-iw)/2:(oh-ih)/2:color=${ffColor(template.style.backgroundColor)},fps=${template.canvas.fps},format=yuv420p`;
      args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", source, "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0", "-vf", videoFilter,
        ...common,
      ];
    } else {
      args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=${ffColor(template.style.backgroundColor)}:s=${template.canvas.width}x${template.canvas.height}:r=${template.canvas.fps}`,
        "-i", audio, "-map", "0:v:0", "-map", "1:a:0", ...common,
      ];
    }
    const result = await this.execText(args);
    if (result.exitCode !== 0) throw new Error(`render_${kind}_video_prepare_failed`);
    return output;
  }

  private async renderBodyVideo(input: {
    templateId: SafeTemplateId;
    captionsEnabled: boolean;
    captionsVtt: string;
    showName: string;
    episodeName: string;
    hostName: string;
    platformCredit: string;
  }) {
    const template = getSafeTemplateManifest(input.templateId, 1);
    const showName = cleanDisplayText(input.showName, 120);
    const episodeName = cleanDisplayText(input.episodeName, 160);
    const hostName = cleanDisplayText(input.hostName, 120);
    const credit = cleanDisplayText(input.platformCredit, 80);
    await this.writeText(SHOW_TEXT_PATH, showName);
    await this.writeText(EPISODE_TEXT_PATH, wrapDisplayText(episodeName));
    await this.writeText(HOST_TEXT_PATH, `With ${hostName}`);
    await this.writeText(CREDIT_TEXT_PATH, credit);
    if (input.captionsEnabled) {
      if (!input.captionsVtt.startsWith("WEBVTT")) throw new Error("render_captions_invalid");
      await this.writeText(CAPTION_PATH, input.captionsVtt);
    }

    const t = template;
    const baseFilters = [
      `[1:a]asplit=2[aout][awave]`,
      `[awave]showwaves=s=${t.canvas.width - t.layout.horizontalPadding * 2}x${t.layout.waveformHeight}:mode=line:rate=${t.canvas.fps}:colors=${ffColor(t.style.waveformColor)}[waves]`,
      `[0:v][waves]overlay=${t.layout.horizontalPadding}:${t.layout.waveformY}[v0]`,
      `[v0]drawtext=fontfile=${FONT_PATH}:textfile=${SHOW_TEXT_PATH}:fontcolor=${ffColor(t.style.mutedTextColor)}:fontsize=${t.style.showFontSize}:x=${t.layout.horizontalPadding}:y=${t.layout.showY}:expansion=none[v1]`,
      `[v1]drawtext=fontfile=${FONT_PATH}:textfile=${EPISODE_TEXT_PATH}:fontcolor=${ffColor(t.style.textColor)}:fontsize=${t.style.episodeFontSize}:x=${t.layout.horizontalPadding}:y=${t.layout.episodeY}:line_spacing=12:expansion=none[v2]`,
      `[v2]drawtext=fontfile=${FONT_PATH}:textfile=${HOST_TEXT_PATH}:fontcolor=${ffColor(t.style.mutedTextColor)}:fontsize=${t.style.hostFontSize}:x=${t.layout.horizontalPadding}:y=${t.layout.hostY}:expansion=none[v3]`,
      `[v3]drawtext=fontfile=${FONT_PATH}:textfile=${CREDIT_TEXT_PATH}:fontcolor=${ffColor(t.style.mutedTextColor)}:fontsize=${t.style.creditFontSize}:x=w-tw-48:y=h-th-36:expansion=none[v4]`,
    ];
    let videoLabel = "v4";
    if (input.captionsEnabled) {
      const alpha = Math.round((1 - t.style.captionBandOpacity) * 255).toString(16).padStart(2, "0").toUpperCase();
      const style = [
        `FontName=${t.style.fontFamily}`,
        `FontSize=${t.style.captionFontSize}`,
        `PrimaryColour=${assColor(t.style.textColor)}`,
        `BackColour=${assColor(t.style.backgroundColor, alpha)}`,
        "BorderStyle=3",
        "Outline=0",
        "Shadow=0",
        "Alignment=2",
        `MarginV=${t.layout.captionBottomMargin}`,
      ].join(",");
      baseFilters.push(`[v4]subtitles=filename='${CAPTION_PATH}':force_style='${style}'[v5]`);
      videoLabel = "v5";
    }
    const result = await this.execText([
      "ffmpeg", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${ffColor(t.style.backgroundColor)}:s=${t.canvas.width}x${t.canvas.height}:r=${t.canvas.fps}`,
      "-i", OUTPUT_PATH,
      "-filter_complex", baseFilters.join(";"),
      "-map", `[${videoLabel}]`, "-map", "[aout]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-r", String(t.canvas.fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", "-y", BODY_SEGMENT_PATH,
    ]);
    if (result.exitCode !== 0) throw new Error("render_body_video_failed");
  }

  private async renderFinalMp4(paths: string[]) {
    if (paths.length === 1) {
      const copy = await this.execText(["cp", paths[0], FINAL_MP4_PATH]);
      if (copy.exitCode !== 0) throw new Error("render_final_mp4_failed");
      return;
    }
    await this.writeText(CONCAT_LIST_PATH, paths.map((path) => `file '${path}'`).join("\n"));
    const copyConcat = await this.execText([
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
      "-i", CONCAT_LIST_PATH, "-c", "copy", "-movflags", "+faststart", "-y", FINAL_MP4_PATH,
    ]);
    if (copyConcat.exitCode === 0) return;

    const args = ["ffmpeg", "-hide_banner", "-loglevel", "error"];
    paths.forEach((path) => args.push("-i", path));
    const inputs = paths.map((_, index) => `[${index}:v:0][${index}:a:0]`).join("");
    args.push(
      "-filter_complex", `${inputs}concat=n=${paths.length}:v=1:a=1[v][a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", "-y", FINAL_MP4_PATH,
    );
    const fallback = await this.execText(args);
    if (fallback.exitCode !== 0) throw new Error("render_final_mp4_failed");
  }

  private async renderFinalMp3(audioPaths: string[]) {
    const args = ["ffmpeg", "-hide_banner", "-loglevel", "error"];
    audioPaths.forEach((path) => args.push("-i", path));
    if (audioPaths.length === 1) {
      args.push("-map", "0:a:0");
    } else {
      const labels = audioPaths.map((_, index) => `[${index}:a:0]`).join("");
      args.push("-filter_complex", `${labels}concat=n=${audioPaths.length}:v=0:a=1[a]`, "-map", "[a]");
    }
    args.push(
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000",
      "-id3v2_version", "3", "-y", FINAL_MP3_PATH,
    );
    const result = await this.execText(args);
    if (result.exitCode !== 0) throw new Error("render_final_mp3_failed");
  }

  async renderFinalPublication(input: {
    templateId: SafeTemplateId;
    captionsEnabled: boolean;
    captionsVtt: string;
    showName: string;
    episodeName: string;
    hostName: string;
    platformCredit: string;
    intro: BrandMediaProbe;
    outro: BrandMediaProbe;
  }): Promise<FinalPublicationResult> {
    await this.ensureRunning();
    const template = getSafeTemplateManifest(input.templateId, 1);
    const bodyDurationMs = await this.probeDurationMs(OUTPUT_PATH);
    const introAudio = await this.normalizeBrandAudio("intro", input.intro);
    const outroAudio = await this.normalizeBrandAudio("outro", input.outro);
    const introVideo = await this.renderBrandVideoSegment("intro", input.intro, template.id);
    const outroVideo = await this.renderBrandVideoSegment("outro", input.outro, template.id);
    await this.renderBodyVideo(input);

    const videoPaths = [introVideo, BODY_SEGMENT_PATH, outroVideo].filter((path): path is string => Boolean(path));
    const audioPaths = [introAudio, OUTPUT_PATH, outroAudio].filter((path): path is string => Boolean(path));
    await this.renderFinalMp4(videoPaths);
    await this.renderFinalMp3(audioPaths);

    const [mp3SizeBytes, mp4SizeBytes, finalDurationMs] = await Promise.all([
      this.fileSize(FINAL_MP3_PATH),
      this.fileSize(FINAL_MP4_PATH),
      this.probeDurationMs(FINAL_MP4_PATH),
    ]);
    const expectedDurationMs = input.intro.durationMs + bodyDurationMs + input.outro.durationMs;
    if (Math.abs(finalDurationMs - expectedDurationMs) > 350) {
      throw new Error("render_final_timing_integrity_failed");
    }
    return {
      mp3SizeBytes,
      mp4SizeBytes,
      bodyDurationMs,
      introDurationMs: input.intro.durationMs,
      outroDurationMs: input.outro.durationMs,
      totalDurationMs: finalDurationMs,
    };
  }

  async streamTechnicalMaster(): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning();
    const process = await this.requireRuntime().exec(["cat", OUTPUT_PATH], { stderr: "ignore" });
    if (!process.stdout) throw new Error("render_output_stream_missing");
    return process.stdout;
  }

  async streamFinalMp3(): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning();
    const process = await this.requireRuntime().exec(["cat", FINAL_MP3_PATH], { stderr: "ignore" });
    if (!process.stdout) throw new Error("render_final_mp3_stream_missing");
    return process.stdout;
  }

  async streamFinalMp4(): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning();
    const process = await this.requireRuntime().exec(["cat", FINAL_MP4_PATH], { stderr: "ignore" });
    if (!process.stdout) throw new Error("render_final_mp4_stream_missing");
    return process.stdout;
  }

  async cleanupFiles() {
    const runtime = this.ctx.container;
    if (!runtime?.running) return;
    const process = await runtime.exec([
      "rm", "-f",
      SOURCE_PATH, EDITORIAL_PATH, OUTPUT_PATH, CAPTION_PATH,
      SHOW_TEXT_PATH, EPISODE_TEXT_PATH, HOST_TEXT_PATH, CREDIT_TEXT_PATH,
      INTRO_SOURCE_PATH, OUTRO_SOURCE_PATH, INTRO_AUDIO_PATH, OUTRO_AUDIO_PATH,
      INTRO_SEGMENT_PATH, BODY_SEGMENT_PATH, OUTRO_SEGMENT_PATH,
      CONCAT_LIST_PATH, FINAL_MP3_PATH, FINAL_MP4_PATH,
    ], { stdout: "ignore", stderr: "ignore" });
    await process.exitCode;
  }
}
