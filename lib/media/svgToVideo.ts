import { fetchFile } from "@ffmpeg/util";
import { getFfmpeg, readOutputBlob } from "@/lib/media/mp4ToGif";

type SvgRender = {
  pngBytes: Uint8Array;
  width: number;
  height: number;
};

async function renderSvgToPng(svgFile: File, maxWidth: number): Promise<SvgRender> {
  const svgText = await svgFile.text();
  const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = "async";
    img.src = svgUrl;
    await img.decode();

    const sourceW = img.width || 1200;
    const sourceH = img.height || 1200;
    const scale = Math.min(1, maxWidth / sourceW);
    const width = Math.max(2, Math.round(sourceW * scale));
    const height = Math.max(2, Math.round(sourceH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to rasterize SVG."))),
        "image/png"
      );
    });

    const arr = await fetchFile(pngBlob);
    return { pngBytes: arr, width, height };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function convertSvgToGifBlob(
  file: File,
  options: { maxWidth: number },
  callbacks?: { onStatus?: (message: string) => void }
): Promise<{ blob: Blob; width: number; height: number }> {
  callbacks?.onStatus?.("Rasterizing SVG…");
  const ffmpeg = await getFfmpeg();
  const { pngBytes, width, height } = await renderSvgToPng(file, options.maxWidth);

  const input = "svg-frame.png";
  const output = "output.gif";
  await ffmpeg.writeFile(input, pngBytes);
  callbacks?.onStatus?.("Encoding GIF…");
  const code = await ffmpeg.exec(["-loop", "1", "-i", input, "-frames:v", "1", "-y", output]);
  if (code !== 0) {
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
    throw new Error("Could not create GIF from SVG.");
  }
  const blob = await readOutputBlob(ffmpeg, output, "image/gif");
  await ffmpeg.deleteFile(input).catch(() => {});
  await ffmpeg.deleteFile(output).catch(() => {});
  return { blob, width, height };
}

export async function convertSvgToMp4Blob(
  file: File,
  options: { maxWidth: number; seconds: number },
  callbacks?: { onStatus?: (message: string) => void }
): Promise<{ blob: Blob; width: number; height: number; seconds: number }> {
  callbacks?.onStatus?.("Rasterizing SVG…");
  const ffmpeg = await getFfmpeg();
  const { pngBytes, width, height } = await renderSvgToPng(file, options.maxWidth);

  const evenW = width % 2 === 0 ? width : width + 1;
  const evenH = height % 2 === 0 ? height : height + 1;

  const input = "svg-frame.png";
  const output = "output.mp4";
  await ffmpeg.writeFile(input, pngBytes);
  callbacks?.onStatus?.("Encoding MP4…");
  const code = await ffmpeg.exec([
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    input,
    "-t",
    String(options.seconds),
    "-vf",
    `scale=${evenW}:${evenH}`,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ]);
  if (code !== 0) {
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
    throw new Error("Could not create MP4 from SVG.");
  }
  const blob = await readOutputBlob(ffmpeg, output, "video/mp4");
  await ffmpeg.deleteFile(input).catch(() => {});
  await ffmpeg.deleteFile(output).catch(() => {});
  return { blob, width: evenW, height: evenH, seconds: options.seconds };
}
