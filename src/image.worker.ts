import { AppError, issue } from "./errors";
import { decode } from "./decode";
import { animationInfo, canvasFrom, readSequence } from "./animation";
import {
  checkDimensions,
  normalizedCrop,
  targetSize,
  drawRect,
  anchor,
} from "./geometry";
import { encode } from "./encode";
import { defaults } from "./settings";
import type {
  ConversionResult,
  Crop,
  Settings,
  WorkerRequest,
  WorkerReply,
} from "./types";
const scope = self as unknown as DedicatedWorkerGlobalScope;
async function thumbnail(source: OffscreenCanvas) {
  const k = Math.min(1, 640 / Math.max(source.width, source.height)),
    c = new OffscreenCanvas(
      Math.max(1, Math.round(source.width * k)),
      Math.max(1, Math.round(source.height * k)),
    );
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: "image/png" });
}
function transform(source: OffscreenCanvas, s: Settings, crop?: Crop) {
  const region = normalizedCrop(crop, source.width, source.height),
    swap = s.rotation % 180 !== 0;
  const canvas = new OffscreenCanvas(
      swap ? region.height : region.width,
      swap ? region.width : region.height,
    ),
    ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    -region.width / 2,
    -region.height / 2,
    region.width,
    region.height,
  );
  return canvas;
}
function render(
  source: OffscreenCanvas,
  width: number,
  height: number,
  s: Settings,
  logo?: ImageBitmap,
) {
  checkDimensions(width, height);
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (
    ["jpeg", "bmp"].includes(s.format) ||
    (s.resize === "pad" && !s.transparentPadding)
  ) {
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const r = drawRect(source, width, height, s);
  ctx.drawImage(source, r.x, r.y, r.width, r.height);
  if (s.watermark !== "none") {
    const a = anchor(s.watermarkPosition),
      margin = Math.max(4, Math.min(width, height) * 0.035);
    ctx.globalAlpha = s.watermarkOpacity;
    if (s.watermark === "image") {
      if (!logo) throw new AppError("errorWatermark");
      const w = width * s.watermarkSize,
        h = (w * logo.height) / logo.width;
      const k = Math.min(1, (height - margin * 2) / h),
        dw = Math.max(1, w * k),
        dh = Math.max(1, h * k);
      ctx.drawImage(
        logo,
        margin + (width - dw - margin * 2) * a.x,
        margin + (height - dh - margin * 2) * a.y,
        dw,
        dh,
      );
    } else if (s.watermarkText.trim()) {
      let size = Math.max(8, Math.round(width * s.watermarkSize * 0.3));
      ctx.font = "600 " + size + "px system-ui, sans-serif";
      const max = width - margin * 2;
      if (ctx.measureText(s.watermarkText).width > max) {
        size *= max / ctx.measureText(s.watermarkText).width;
        ctx.font = "600 " + size + "px system-ui, sans-serif";
      }
      const w = ctx.measureText(s.watermarkText).width,
        h = size * 1.25,
        x = margin + (width - w - margin * 2) * a.x,
        y = margin + (height - h - margin * 2) * a.y;
      ctx.textBaseline = "top";
      ctx.fillStyle = s.watermarkColor;
      ctx.shadowColor = "#00000066";
      ctx.shadowBlur = Math.max(1, size * 0.06);
      ctx.fillText(s.watermarkText, x, y);
    }
    ctx.globalAlpha = 1;
  }
  return canvas;
}
async function convert(
  file: File,
  raw: Settings,
  crop?: Crop,
): Promise<ConversionResult> {
  const s = { ...defaults, ...raw },
    sequence = await readSequence(file, s.animation === "preserve");
  if (sequence.frames.length > 1 && !["gif", "webp", "apng"].includes(s.format))
    throw new AppError("errorAnimationFormat");
  let sources = sequence.frames.map((source) => transform(source, s, crop)),
    logo: ImageBitmap | undefined;
  for (const frame of sequence.frames) {
    frame.width = 1;
    frame.height = 1;
  }
  sequence.frames = [];
  const factor = s.enhance === "4x" ? 4 : s.enhance === "2x" ? 2 : 1;
  if (
    sources.length > 1 &&
    sources[0].width * sources[0].height * factor * factor * sources.length >
      60_000_000
  )
    throw new AppError("errorAnimationLimit");
  try {
    if (s.watermark === "image") {
      if (!s.watermarkImage) throw new AppError("errorWatermark");
      logo = await decode(s.watermarkImage);
    }
    if (s.removeBackground || s.enhance !== "none") {
      const ai = await import("./ai");
      for (let i = 0; i < sources.length; i++) {
        if (s.removeBackground)
          sources[i] = await ai.removeBackground(sources[i]);
        if (s.enhance !== "none")
          sources[i] = await ai.enhance(sources[i], s.enhance === "2x" ? 2 : 4);
      }
    }
    const initial = targetSize(sources[0], s);
    let { width, height } = initial;
    const limit = s.maxBytes;
    if (width * height * sources.length > 60_000_000 && sources.length > 1)
      throw new AppError("errorAnimationLimit");
    const adjustable = ["jpeg", "avif", "webp", "gif"].includes(s.format);
    for (let attempt = 0; attempt < 32; attempt++) {
      const frames = sources.map((source) =>
        render(source, width, height, s, logo),
      );
      let quality = s.quality,
        blob = await encode(
          frames,
          s,
          quality,
          sequence.delays,
          sequence.plays,
        );
      if (limit && blob.size > limit && adjustable) {
        const minimum = await encode(
          frames,
          s,
          0.01,
          sequence.delays,
          sequence.plays,
        );
        if (minimum.size <= limit) {
          blob = minimum;
          quality = 0.01;
          let low = 0.01,
            high = s.quality;
          for (let i = 0; i < (s.format === "avif" ? 5 : 8); i++) {
            const mid = (low + high) / 2,
              candidate = await encode(
                frames,
                s,
                mid,
                sequence.delays,
                sequence.plays,
              );
            if (candidate.size <= limit) {
              low = mid;
              blob = candidate;
              quality = mid;
            } else high = mid;
          }
        } else blob = minimum;
      }
      if (!limit || blob.size <= limit)
        return {
          blob,
          width,
          height,
          quality,
          reduced: width !== initial.width || height !== initial.height,
          thumbnail: await thumbnail(frames[0]),
          frames: frames.length,
        };
      if (!s.autoResize || (width === 1 && height === 1))
        throw new AppError(
          s.autoResize ? "errorLimitTiny" : "errorLimitFixed",
          { limit },
        );
      const k = Math.max(
        0.1,
        Math.min(0.85, Math.sqrt(limit / blob.size) * 0.92),
      );
      width = Math.max(1, Math.floor(width * k));
      height = Math.max(1, Math.floor(height * k));
    }
    throw new AppError("errorLimit");
  } finally {
    logo?.close();
  }
}
async function handle(request: WorkerRequest) {
  try {
    let result;
    if (request.action === "convert")
      result = await convert(request.file, request.settings, request.crop);
    else {
      const bitmap = await decode(request.file);
      try {
        const canvas = canvasFrom(bitmap);
        result =
          request.action === "preview"
            ? {
                blob: await canvas.convertToBlob({ type: "image/png" }),
                width: bitmap.width,
                height: bitmap.height,
              }
            : {
                width: bitmap.width,
                height: bitmap.height,
                thumbnail: await thumbnail(canvas),
                frames: (await animationInfo(request.file)).frames,
              };
      } finally {
        bitmap.close();
      }
    }
    scope.postMessage({
      id: request.id,
      ok: true,
      result,
    } satisfies WorkerReply);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: issue(error),
    } satisfies WorkerReply);
  }
}
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handle(event.data));
};
