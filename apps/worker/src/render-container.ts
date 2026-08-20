import { Container, ContainerProxy } from "@cloudflare/containers";
import type { NormalizedApprovedEdit } from "./render-jobs";

export { ContainerProxy };

const SOURCE_PATH = "/tmp/hrtechify-source";
const EDITORIAL_PATH = "/tmp/hrtechify-editorial.flac";
const OUTPUT_PATH = "/tmp/hrtechify-technical-master.flac";
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

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer).trim();

const msToSeconds = (value: number) => (value / 1000).toFixed(3);

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

  private async probeDurationMs(path: string) {
    const result = await this.execText([
      "ffprobe",
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    if (result.exitCode !== 0) throw new Error("render_probe_failed");
    return parseDurationMs(result.stdout);
  }

  async renderTechnicalMaster(
    source: ReadableStream<Uint8Array>,
    approvedEdits: readonly NormalizedApprovedEdit[],
  ): Promise<TechnicalMasterResult> {
    await this.ensureRunning();
    await this.cleanupFiles();

    const write = await this.requireRuntime().exec(["tee", SOURCE_PATH], {
      stdin: source,
      stdout: "ignore",
    });
    if ((await write.exitCode) !== 0) throw new Error("render_source_write_failed");

    const sourceDurationMs = await this.probeDurationMs(SOURCE_PATH);
    const validated = validateRenderRangesAgainstDuration(approvedEdits, sourceDurationMs);
    const filterGraph = buildEditorialFilterGraph(validated.ranges, sourceDurationMs);

    const editorialArgs = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", SOURCE_PATH];
    if (filterGraph) {
      editorialArgs.push(
        "-filter_complex", filterGraph,
        "-map", "[editorial]",
      );
    } else {
      editorialArgs.push("-map", "0:a:0");
    }
    editorialArgs.push("-vn", "-c:a", "flac", "-y", EDITORIAL_PATH);
    const editorial = await this.execText(editorialArgs);
    if (editorial.exitCode !== 0) throw new Error("render_editorial_pass_failed");

    const measure = await this.execText([
      "ffmpeg",
      "-hide_banner",
      "-i", EDITORIAL_PATH,
      "-af", `loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK_TARGET}:print_format=json`,
      "-f", "null",
      "-",
    ]);
    if (measure.exitCode !== 0) throw new Error("render_loudness_measurement_failed");
    const measurement = parseLoudnormMeasurement(measure.stderr);

    const normalize = await this.execText([
      "ffmpeg",
      "-hide_banner",
      "-loglevel", "error",
      "-i", EDITORIAL_PATH,
      "-af", `loudnorm=${loudnormSecondPass(measurement)}`,
      "-c:a", "flac",
      "-compression_level", "5",
      "-y", OUTPUT_PATH,
    ]);
    if (normalize.exitCode !== 0) throw new Error("render_technical_cleanup_failed");

    const stat = await this.execText(["stat", "-c", "%s", OUTPUT_PATH]);
    if (stat.exitCode !== 0) throw new Error("render_output_stat_failed");
    const sizeBytes = Number(stat.stdout);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error("render_output_size_invalid");

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

  async streamTechnicalMaster(): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning();
    const process = await this.requireRuntime().exec(["cat", OUTPUT_PATH], { stderr: "ignore" });
    if (!process.stdout) throw new Error("render_output_stream_missing");
    return process.stdout;
  }

  async cleanupFiles() {
    const runtime = this.ctx.container;
    if (!runtime?.running) return;
    const process = await runtime.exec([
      "rm", "-f", SOURCE_PATH, EDITORIAL_PATH, OUTPUT_PATH,
    ], { stdout: "ignore", stderr: "ignore" });
    await process.exitCode;
  }
}
