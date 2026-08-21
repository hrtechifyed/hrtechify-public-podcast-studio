import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import {
  buildWebVtt,
  parseCaptionTimingDocument,
  transformCaptionWordsForApprovedCuts,
} from "@hrtechify/renderer";
import type { TemplateManifest } from "@hrtechify/templates";

const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const VIDEO_BITRATE = "900k";
const AUDIO_BITRATE = "128k";

export interface BrowserRenderAsset {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
}

export interface BrowserRenderManifest {
  mode: "local-browser";
  jobId: string;
  episodeId: string;
  provider: "google-drive" | "dropbox";
  source: BrowserRenderAsset & { immutable: true };
  captionTiming: BrowserRenderAsset;
  intro: BrowserRenderAsset | null;
  outro: BrowserRenderAsset | null;
  plan: {
    version: "render-plan-v2";
    analysisRunId: string;
    approvedEdits: Array<{ startMs: number; endMs: number }>;
    cleanup: {
      targetIntegratedLoudnessLkfs: number;
      maxTruePeakDbfs: number;
      preserveWords: true;
      preserveTiming: true;
      preservePitch: true;
      preserveSpeakingSpeed: true;
    };
    publication: {
      template: TemplateManifest;
      captionsEnabled: boolean;
      display: { showName: string; episodeName: string; hostName: string };
      platformCredit: { text: string; required: true; removable: false; position: string };
    };
  };
}

export interface BrowserRenderResult {
  technicalMaster: Blob;
  captions: Blob;
  mp3: Blob;
  mp4: Blob;
  warnings: string[];
}

type ProgressCallback = (message: string) => void;

const fetchBlob = async (asset: BrowserRenderAsset) => {
  const response = await fetch(asset.downloadUrl, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("browser_source_download_failed");
  return response.blob();
};

const writeBlob = async (ffmpeg: FFmpeg, name: string, blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.byteLength) throw new Error("browser_source_empty");
  await ffmpeg.writeFile(name, bytes);
};

const readBlob = async (ffmpeg: FFmpeg, name: string, type: string) => {
  const value = await ffmpeg.readFile(name);
  if (typeof value === "string") throw new Error("browser_render_output_invalid");
  const bytes = Uint8Array.from(value);
  if (!bytes.byteLength) throw new Error("browser_render_output_empty");
  return new Blob([bytes], { type });
};

const mediaDurationMs = (blob: Blob, mimeType: string | null) =>
  new Promise<number>((resolve, reject) => {
    const element = document.createElement(mimeType?.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(blob);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = element.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("browser_media_duration_invalid"));
      else resolve(Math.round(duration * 1000));
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("browser_media_duration_invalid"));
    };
    element.src = url;
  });

const validateCuts = (cuts: Array<{ startMs: number; endMs: number }>, durationMs: number) => {
  const output: Array<{ startMs: number; endMs: number }> = [];
  let previousEnd = 0;
  for (const cut of cuts) {
    if (
      !Number.isSafeInteger(cut.startMs) ||
      !Number.isSafeInteger(cut.endMs) ||
      cut.startMs < 0 ||
      cut.endMs <= cut.startMs ||
      cut.startMs < previousEnd ||
      cut.startMs >= durationMs
    ) throw new Error("browser_approved_edit_invalid");
    const endMs = Math.min(cut.endMs, durationMs);
    output.push({ startMs: cut.startMs, endMs });
    previousEnd = endMs;
  }
  const removed = output.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  if (removed >= durationMs) throw new Error("browser_edit_would_remove_all_audio");
  return output;
};

const seconds = (ms: number) => (ms / 1000).toFixed(3);

const editorialFilter = (cuts: Array<{ startMs: number; endMs: number }>, durationMs: number) => {
  if (!cuts.length) return null;
  const segments: Array<{ startMs: number; endMs: number | null }> = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.startMs > cursor) segments.push({ startMs: cursor, endMs: cut.startMs });
    cursor = cut.endMs;
  }
  if (cursor < durationMs) segments.push({ startMs: cursor, endMs: null });
  if (!segments.length) throw new Error("browser_edit_would_remove_all_audio");
  const filters = segments.map((segment, index) => {
    const end = segment.endMs === null ? "" : `:end=${seconds(segment.endMs)}`;
    return `[0:a:0]atrim=start=${seconds(segment.startMs)}${end},asetpts=PTS-STARTPTS[s${index}]`;
  });
  if (segments.length === 1) filters.push("[s0]anull[editorial]");
  else filters.push(`${segments.map((_, index) => `[s${index}]`).join("")}concat=n=${segments.length}:v=0:a=1[editorial]`);
  return filters.join(";");
};

const wrapCanvasText = (context: CanvasRenderingContext2D, value: string, maxWidth: number) => {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

const makeCover = async (manifest: BrowserRenderManifest) => {
  const template = manifest.plan.publication.template;
  const canvas = document.createElement("canvas");
  canvas.width = template.canvas.width;
  canvas.height = template.canvas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("browser_canvas_unavailable");
  const { style, layout } = template;
  context.fillStyle = style.backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "top";
  context.fillStyle = style.mutedTextColor;
  context.font = `600 ${style.showFontSize}px sans-serif`;
  context.fillText(manifest.plan.publication.display.showName, layout.horizontalPadding, layout.showY);
  context.fillStyle = style.textColor;
  context.font = `700 ${style.episodeFontSize}px sans-serif`;
  const maxWidth = canvas.width - layout.horizontalPadding * 2;
  wrapCanvasText(context, manifest.plan.publication.display.episodeName, maxWidth)
    .forEach((line, index) => context.fillText(line, layout.horizontalPadding, layout.episodeY + index * (style.episodeFontSize + 10)));

  context.strokeStyle = style.waveformColor;
  context.lineWidth = 8;
  context.beginPath();
  const center = layout.waveformY + layout.waveformHeight / 2;
  for (let x = layout.horizontalPadding; x <= canvas.width - layout.horizontalPadding; x += 18) {
    const amplitude = 18 + Math.abs(Math.sin(x * 0.017)) * layout.waveformHeight * 0.36;
    context.moveTo(x, center - amplitude);
    context.lineTo(x, center + amplitude);
  }
  context.stroke();

  context.fillStyle = style.mutedTextColor;
  context.font = `500 ${style.hostFontSize}px sans-serif`;
  context.fillText(manifest.plan.publication.display.hostName, layout.horizontalPadding, layout.hostY);
  context.textAlign = "right";
  context.font = `500 ${style.creditFontSize}px sans-serif`;
  context.fillText(manifest.plan.publication.platformCredit.text, canvas.width - layout.horizontalPadding, canvas.height - 58);
  context.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("browser_cover_generation_failed")), "image/png");
  });
};

const normalizeOptionalAudio = async (
  ffmpeg: FFmpeg,
  sourceName: string,
  outputName: string,
) => ffmpeg.exec([
  "-hide_banner", "-loglevel", "error", "-i", sourceName,
  "-map", "0:a:0", "-vn", "-ar", "48000", "-ac", "2",
  "-c:a", "flac", "-compression_level", "5", "-y", outputName,
]);

const createVideoSegment = async (
  ffmpeg: FFmpeg,
  sourceName: string,
  mimeType: string | null,
  outputName: string,
) => {
  if (mimeType?.startsWith("video/")) {
    return ffmpeg.exec([
      "-hide_banner", "-loglevel", "error", "-i", sourceName,
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
      "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "ultrafast",
      "-b:v", VIDEO_BITRATE, "-maxrate", "1100k", "-bufsize", "1800k", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", "48000", "-ac", "2", "-y", outputName,
    ]);
  }
  return ffmpeg.exec([
    "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", "cover.png", "-i", sourceName,
    "-map", "0:v:0", "-map", "1:a:0", "-shortest",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage",
    "-b:v", VIDEO_BITRATE, "-maxrate", "1100k", "-bufsize", "1800k", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", "48000", "-ac", "2", "-y", outputName,
  ]);
};

export const renderPodcastOnDevice = async (
  manifest: BrowserRenderManifest,
  onProgress: ProgressCallback = () => undefined,
): Promise<BrowserRenderResult> => {
  if (manifest.mode !== "local-browser" || !manifest.source.immutable) throw new Error("browser_render_manifest_invalid");
  if (
    manifest.plan.cleanup.preserveWords !== true ||
    manifest.plan.cleanup.preserveTiming !== true ||
    manifest.plan.cleanup.preservePitch !== true ||
    manifest.plan.cleanup.preserveSpeakingSpeed !== true ||
    manifest.plan.publication.platformCredit.required !== true ||
    manifest.plan.publication.platformCredit.removable !== false
  ) throw new Error("browser_render_policy_invalid");

  const ffmpeg = new FFmpeg();
  const warnings: string[] = [];
  try {
    onProgress("Loading the on-device renderer…");
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });

    onProgress("Downloading your source from your connected storage…");
    const [sourceBlob, timingBlob, introBlob, outroBlob] = await Promise.all([
      fetchBlob(manifest.source),
      fetchBlob(manifest.captionTiming),
      manifest.intro ? fetchBlob(manifest.intro) : Promise.resolve(null),
      manifest.outro ? fetchBlob(manifest.outro) : Promise.resolve(null),
    ]);
    const sourceDurationMs = await mediaDurationMs(sourceBlob, manifest.source.mimeType);
    const cuts = validateCuts(manifest.plan.approvedEdits, sourceDurationMs);
    const introDurationMs = introBlob && manifest.intro ? await mediaDurationMs(introBlob, manifest.intro.mimeType).catch(() => 0) : 0;

    await writeBlob(ffmpeg, "source.media", sourceBlob);
    if (introBlob) await writeBlob(ffmpeg, "intro.media", introBlob);
    if (outroBlob) await writeBlob(ffmpeg, "outro.media", outroBlob);

    onProgress("Creating the technical master on this device…");
    const graph = editorialFilter(cuts, sourceDurationMs);
    const loudnorm = `loudnorm=I=${manifest.plan.cleanup.targetIntegratedLoudnessLkfs}:TP=${manifest.plan.cleanup.maxTruePeakDbfs}:LRA=11`;
    let technicalExit: number;
    if (graph) {
      technicalExit = await ffmpeg.exec([
        "-hide_banner", "-loglevel", "error", "-i", "source.media",
        "-filter_complex", `${graph};[editorial]${loudnorm}[master]`, "-map", "[master]",
        "-vn", "-ar", "48000", "-ac", "2", "-c:a", "flac", "-compression_level", "5", "-y", "technical.flac",
      ]);
    } else {
      technicalExit = await ffmpeg.exec([
        "-hide_banner", "-loglevel", "error", "-i", "source.media", "-map", "0:a:0", "-vn",
        "-af", loudnorm, "-ar", "48000", "-ac", "2", "-c:a", "flac", "-compression_level", "5", "-y", "technical.flac",
      ]);
    }
    if (technicalExit !== 0) throw new Error("browser_technical_master_failed");

    onProgress("Preparing captions and the HRTechify video template…");
    const timingText = await timingBlob.text();
    const timing = parseCaptionTimingDocument(JSON.parse(timingText) as unknown);
    if (
      timing.episodeId !== manifest.episodeId ||
      timing.sourceFileId !== manifest.source.fileId ||
      timing.analysisRunId !== manifest.plan.analysisRunId
    ) throw new Error("browser_caption_timing_mismatch");
    const words = transformCaptionWordsForApprovedCuts(timing.words, cuts, introDurationMs);
    const vtt = buildWebVtt(words);
    await ffmpeg.writeFile("final.vtt", new TextEncoder().encode(vtt));
    const cover = await makeCover(manifest);
    await writeBlob(ffmpeg, "cover.png", cover);

    const audioParts: string[] = [];
    if (introBlob) {
      if ((await normalizeOptionalAudio(ffmpeg, "intro.media", "intro.flac")) === 0) audioParts.push("intro.flac");
      else warnings.push("The intro had no usable audio track, so it was omitted from the MP3 audio sequence.");
    }
    audioParts.push("technical.flac");
    if (outroBlob) {
      if ((await normalizeOptionalAudio(ffmpeg, "outro.media", "outro.flac")) === 0) audioParts.push("outro.flac");
      else warnings.push("The outro had no usable audio track, so it was omitted from the MP3 audio sequence.");
    }
    await ffmpeg.writeFile("audio-concat.txt", new TextEncoder().encode(audioParts.map((name) => `file '${name}'`).join("\n")));

    onProgress("Creating the final MP3 on this device…");
    const mp3Exit = await ffmpeg.exec([
      "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "audio-concat.txt",
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-y", "final.mp3",
    ]);
    if (mp3Exit !== 0) throw new Error("browser_mp3_render_failed");

    onProgress("Creating the final MP4 on this device…");
    const bodyBase = [
      "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", "cover.png", "-i", "technical.flac",
      "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-b:v", VIDEO_BITRATE,
      "-maxrate", "1100k", "-bufsize", "1800k", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", "48000", "-ac", "2",
    ];
    let bodyExit = manifest.plan.publication.captionsEnabled
      ? await ffmpeg.exec([...bodyBase, "-vf", "subtitles=final.vtt", "-y", "body.mp4"])
      : await ffmpeg.exec([...bodyBase, "-y", "body.mp4"]);
    if (bodyExit !== 0 && manifest.plan.publication.captionsEnabled) {
      warnings.push("Burned-in captions are not supported by this browser renderer build; the downloadable WebVTT is still included.");
      bodyExit = await ffmpeg.exec([...bodyBase, "-y", "body.mp4"]);
    }
    if (bodyExit !== 0) throw new Error("browser_mp4_body_render_failed");

    const videoParts: string[] = [];
    if (introBlob && manifest.intro) {
      if ((await createVideoSegment(ffmpeg, "intro.media", manifest.intro.mimeType, "intro.mp4")) === 0) videoParts.push("intro.mp4");
      else warnings.push("The intro could not be converted for the final MP4 and was omitted from the video output.");
    }
    videoParts.push("body.mp4");
    if (outroBlob && manifest.outro) {
      if ((await createVideoSegment(ffmpeg, "outro.media", manifest.outro.mimeType, "outro.mp4")) === 0) videoParts.push("outro.mp4");
      else warnings.push("The outro could not be converted for the final MP4 and was omitted from the video output.");
    }
    await ffmpeg.writeFile("video-concat.txt", new TextEncoder().encode(videoParts.map((name) => `file '${name}'`).join("\n")));
    const mp4Exit = await ffmpeg.exec([
      "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "video-concat.txt", "-c", "copy", "-movflags", "+faststart", "-y", "final.mp4",
    ]);
    if (mp4Exit !== 0) throw new Error("browser_mp4_render_failed");

    onProgress("Final files are ready on this device.");
    return {
      technicalMaster: await readBlob(ffmpeg, "technical.flac", "audio/flac"),
      captions: new Blob([vtt], { type: "text/vtt" }),
      mp3: await readBlob(ffmpeg, "final.mp3", "audio/mpeg"),
      mp4: await readBlob(ffmpeg, "final.mp4", "video/mp4"),
      warnings,
    };
  } finally {
    ffmpeg.terminate();
  }
};
