import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegSingleton: FFmpeg | null = null;

export type Mp4ToGifOptions = {
  maxSeconds: number;
  fps: number;
  maxWidth: number;
};

export async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton?.loaded) return ffmpegSingleton;
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

export async function readOutputBlob(
  ffmpeg: FFmpeg,
  path: string,
  mimeType: string
): Promise<Blob> {
  const data = await ffmpeg.readFile(path);
  if (typeof data === "string") {
    throw new Error("Unexpected output from FFmpeg.");
  }
  // Copy so Blob accepts a plain ArrayBuffer-backed view (TS lib + wasm types).
  return new Blob([new Uint8Array(data)], { type: mimeType });
}

/**
 * Encodes the start of an MP4 to GIF in the browser via ffmpeg.wasm.
 */
export async function convertMp4ToGifBlob(
  file: File,
  options: Mp4ToGifOptions,
  callbacks?: {
    onStatus?: (message: string) => void;
    onProgress?: (ratio: number) => void;
  }
): Promise<Blob> {
  const { fetchFile } = await import("@ffmpeg/util");
  const ffmpeg = await getFfmpeg();
  callbacks?.onStatus?.("Preparing video…");

  const input = "input.mp4";
  const output = "output.gif";

  await ffmpeg.writeFile(input, await fetchFile(file));

  const vf = `fps=${options.fps},scale=${options.maxWidth}:-1:flags=lanczos`;

  const onProgress = (event: { progress: number }) => {
    callbacks?.onProgress?.(event.progress);
  };
  ffmpeg.on("progress", onProgress);
  callbacks?.onStatus?.("Encoding GIF (this can take a while)…");

  let code: number;
  try {
    code = await ffmpeg.exec([
      "-i",
      input,
      "-t",
      String(options.maxSeconds),
      "-vf",
      vf,
      "-y",
      output,
    ]);
  } finally {
    ffmpeg.off("progress", onProgress);
  }

  if (code !== 0) {
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
    throw new Error("Could not create GIF (encoding failed). Try a shorter clip or lower resolution.");
  }

  const blob = await readOutputBlob(ffmpeg, output, "image/gif");
  await ffmpeg.deleteFile(input).catch(() => {});
  await ffmpeg.deleteFile(output).catch(() => {});
  return blob;
}
