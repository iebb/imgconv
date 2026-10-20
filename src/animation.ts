import { AppError } from "./errors";
import { decode } from "./decode";
import { checkDimensions } from "./geometry";
export interface Sequence {
  frames: OffscreenCanvas[];
  delays: number[];
  plays: number;
  total: number;
}
export function canvasFrom(
  image: CanvasImageSource & {
    width?: number;
    height?: number;
    displayWidth?: number;
    displayHeight?: number;
  },
) {
  const width = image.displayWidth || image.width!,
    height = image.displayHeight || image.height!;
  checkDimensions(width, height);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}
export async function animationInfo(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    text = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  let mime = file.type,
    frames = 1,
    plays = 1,
    unknownAnimation = false;
  const view = new DataView(bytes.buffer);
  if (text.startsWith("GIF8")) {
    mime = "image/gif";
    const { parseGIF } = await import("gifuct-js");
    const parsed = parseGIF(bytes.buffer);
    frames = parsed.frames.filter((f: any) => f.image).length;
    const marker = new TextEncoder().encode("NETSCAPE2.0");
    for (let i = 0; i < bytes.length - 16; i++)
      if (
        marker.every((v, j) => bytes[i + j] === v) &&
        bytes[i + 11] === 3 &&
        bytes[i + 12] === 1
      ) {
        const repeats = bytes[i + 13] | (bytes[i + 14] << 8);
        plays = repeats === 0 ? 0 : repeats + 1;
        break;
      }
  } else if (bytes[0] === 137 && text.slice(1, 4) === "PNG") {
    mime = "image/png";
    for (let i = 8; i + 12 <= bytes.length; ) {
      const size = view.getUint32(i);
      if (i + 12 + size > bytes.length) break;
      if (String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === "acTL") {
        frames = view.getUint32(i + 8);
        plays = view.getUint32(i + 12);
        break;
      }
      i += size + 12;
    }
  } else if (text.slice(8, 12) === "WEBP") {
    mime = "image/webp";
    let count = 0;
    for (let i = 12; i + 8 <= bytes.length; ) {
      const size = view.getUint32(i + 4, true);
      if (i + 8 + size > bytes.length) break;
      const type = String.fromCharCode(...bytes.subarray(i, i + 4));
      if (type === "ANMF") count++;
      if (type === "ANIM" && size >= 6) plays = view.getUint16(i + 12, true);
      i += 8 + size + (size % 2);
    }
    frames = Math.max(1, count);
  }
  if (
    text.slice(4, 8) === "ftyp" &&
    new TextDecoder("latin1").decode(bytes.subarray(8, 64)).includes("avis")
  ) {
    mime = "image/avif";
    const Decoder = (globalThis as any).ImageDecoder;
    if (Decoder && (await Decoder.isTypeSupported(mime))) {
      const decoder = new Decoder({
        data: bytes,
        type: mime,
        preferAnimation: true,
      });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        const track = decoder.tracks.selectedTrack;
        frames = track.frameCount;
        plays = Number.isFinite(track.repetitionCount)
          ? track.repetitionCount + 1
          : 0;
      } finally {
        decoder.close();
      }
    } else unknownAnimation = true;
  }
  return { mime, frames: Math.max(1, frames), plays, bytes, unknownAnimation };
}
function budget(width: number, height: number, count: number) {
  checkDimensions(width, height);
  if (count > 300 || width * height * count > 60_000_000)
    throw new AppError("errorAnimationLimit");
}
export async function readSequence(
  file: File,
  preserve: boolean,
): Promise<Sequence> {
  const info = await animationInfo(file);
  if (preserve && info.unknownAnimation) throw new AppError("errorAnimation");
  if (!preserve || info.frames === 1) {
    const bitmap = await decode(file);
    try {
      return {
        frames: [canvasFrom(bitmap)],
        delays: [100],
        plays: info.plays,
        total: info.frames,
      };
    } finally {
      bitmap.close();
    }
  }
  if (info.frames > 300) throw new AppError("errorAnimationLimit");
  const Decoder = (globalThis as any).ImageDecoder;
  if (Decoder && (await Decoder.isTypeSupported(info.mime))) {
    const decoder = new Decoder({
      data: info.bytes,
      type: info.mime,
      preferAnimation: true,
    });
    const frames: OffscreenCanvas[] = [],
      delays: number[] = [];
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const count = track.frameCount;
      if (count > 300) throw new AppError("errorAnimationLimit");
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({
          frameIndex: i,
          completeFramesOnly: true,
        });
        try {
          budget(image.displayWidth, image.displayHeight, count);
          frames.push(canvasFrom(image));
          delays.push(
            Math.max(10, Math.round((image.duration ?? 100000) / 1000)),
          );
        } finally {
          image.close();
        }
      }
      return { frames, delays, plays: info.plays, total: count };
    } finally {
      decoder.close();
    }
  }
  if (info.mime === "image/png") {
    const { default: UPNG } = await import("upng-js"),
      png = UPNG.decode(info.bytes.buffer);
    budget(png.width, png.height, info.frames);
    const frames = UPNG.toRGBA8(png).map((buffer: ArrayBuffer) => {
      const c = new OffscreenCanvas(png.width, png.height);
      c.getContext("2d")!.putImageData(
        new ImageData(new Uint8ClampedArray(buffer), png.width, png.height),
        0,
        0,
      );
      return c;
    });
    return {
      frames,
      delays: png.frames.map((f: any) => Math.max(10, f.delay || 100)),
      plays: info.plays,
      total: frames.length,
    };
  }
  if (info.mime === "image/gif") {
    const { parseGIF, decompressFrames } = await import("gifuct-js"),
      gif = parseGIF(info.bytes.buffer);
    budget(gif.lsd.width, gif.lsd.height, info.frames);
    const decoded = decompressFrames(gif, true),
      canvas = new OffscreenCanvas(gif.lsd.width, gif.lsd.height),
      ctx = canvas.getContext("2d")!;
    const frames: OffscreenCanvas[] = [],
      delays: number[] = [];
    let previous: any, restore: ImageData | undefined;
    for (const f of decoded) {
      if (previous?.disposalType === 2)
        ctx.clearRect(
          previous.dims.left,
          previous.dims.top,
          previous.dims.width,
          previous.dims.height,
        );
      else if (previous?.disposalType === 3 && restore)
        ctx.putImageData(restore, 0, 0);
      restore =
        f.disposalType === 3
          ? ctx.getImageData(0, 0, canvas.width, canvas.height)
          : undefined;
      const patch = new OffscreenCanvas(f.dims.width, f.dims.height);
      patch
        .getContext("2d")!
        .putImageData(
          new ImageData(
            new Uint8ClampedArray(f.patch),
            f.dims.width,
            f.dims.height,
          ),
          0,
          0,
        );
      ctx.drawImage(patch, f.dims.left, f.dims.top);
      frames.push(canvasFrom(canvas));
      delays.push(Math.max(10, f.delay));
      previous = f;
    }
    return { frames, delays, plays: info.plays, total: frames.length };
  }
  throw new AppError("errorAnimation");
}
