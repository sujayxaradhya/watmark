import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

const CORE_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

const getExtension = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot !== -1 ? filename.slice(dot) : ".mp4";
};

export const loadFFmpeg = async (
  onProgress?: (pct: number) => void,
  onStatus?: (msg: string) => void
): Promise<FFmpeg> => {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    await loadPromise;
    if (!ffmpegInstance) {
      throw new Error("FFmpeg failed to load");
    }
    return ffmpegInstance;
  }

  ffmpegInstance = new FFmpeg();

  ffmpegInstance.on("log", ({ message }) => {
    console.log("[ffmpeg]", message);
  });

  ffmpegInstance.on("progress", ({ progress }) => {
    if (progress > 0 && onProgress) {
      onProgress(Math.min(progress, 0.99));
    }
  });

  loadPromise = (async () => {
    const instance = ffmpegInstance;
    if (!instance) {
      return;
    }
    onStatus?.("Loading ffmpeg core (~30MB)...");
    await instance.load({
      coreURL: await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.js`,
        "text/javascript"
      ),
      wasmURL: await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });
    onStatus?.("FFmpeg loaded");
  })();

  await loadPromise;
  if (!ffmpegInstance) {
    throw new Error("FFmpeg failed to load");
  }
  return ffmpegInstance;
};

export type MaskBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const computeMaskBounds = (
  maskCanvas: HTMLCanvasElement
): MaskBounds | null => {
  const ctx = maskCanvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const { width, height } = maskCanvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha !== undefined && alpha > 128) {
        found = true;
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }

  if (!found) {
    return null;
  }

  const padding = 5;
  return {
    height: Math.min(
      height - Math.max(0, minY - padding),
      maxY - minY + padding * 2
    ),
    width: Math.min(
      width - Math.max(0, minX - padding),
      maxX - minX + padding * 2
    ),
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
  };
};

export const processVideo = async (
  inputFile: File,
  maskCanvas: HTMLCanvasElement,
  videoWidth: number,
  videoHeight: number,
  onProgress?: (pct: number) => void,
  onStatus?: (msg: string) => void
): Promise<Blob> => {
  const ffmpeg = await loadFFmpeg(onProgress, onStatus);

  const bounds = computeMaskBounds(maskCanvas);
  if (!bounds) {
    throw new Error("No mask drawn. Please paint over the watermark.");
  }

  const scaleX = videoWidth / maskCanvas.width;
  const scaleY = videoHeight / maskCanvas.height;

  const vx = Math.round(bounds.x * scaleX);
  const vy = Math.round(bounds.y * scaleY);
  const vw = Math.round(bounds.width * scaleX);
  const vh = Math.round(bounds.height * scaleY);

  onStatus?.("Writing input file...");
  const inputName = `input${getExtension(inputFile.name)}`;
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

  onStatus?.("Processing video...");
  onProgress?.(0.05);

  const outputName = "output.mp4";
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vf",
    `delogo=x=${vx}:y=${vy}:w=${vw}:h=${vh}:show=0`,
    "-c:a",
    "copy",
    outputName,
  ]);

  onStatus?.("Reading output...");
  onProgress?.(0.95);

  const data = await ffmpeg.readFile(outputName);
  const uint8 = new Uint8Array(data as Uint8Array);
  const blob = new Blob([uint8], { type: "video/mp4" });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  onProgress?.(1);
  onStatus?.("Done!");
  return blob;
};
