import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { AppError } from "./errors";
import type { Settings } from "./types";
const mimeTypes = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  avif: "image/avif",
  apng: "image/png",
};
let avif: Promise<any> | undefined;
const pixels = (canvas: OffscreenCanvas) =>
  canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(new TextEncoder().encode(type));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
const concat = (arrays: Uint8Array[]) => {
  const result = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) {
    result.set(a, i);
    i += a.length;
  }
  return result;
};
const u24 = (data: Uint8Array, offset: number, value: number) => {
  data[offset] = value & 255;
  data[offset + 1] = (value >> 8) & 255;
  data[offset + 2] = (value >> 16) & 255;
};
export async function encode(
  frames: OffscreenCanvas[],
  s: Settings,
  quality: number,
  delays: number[],
  plays: number,
): Promise<Blob> {
  const canvas = frames[0],
    { width, height } = canvas;
  if (s.format === "gif") {
    const gif = GIFEncoder();
    for (const [i, frame] of frames.entries()) {
      const rgba = pixels(frame).data,
        colors = Math.max(2, Math.round(2 + quality * 254));
      const palette = quantize(rgba, colors, {
        format: "rgba4444",
        oneBitAlpha: true,
      });
      const indices = applyPalette(rgba, palette, "rgba4444"),
        transparentIndex = palette.findIndex((color) => color[3] === 0);
      gif.writeFrame(indices, width, height, {
        palette,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        delay: delays[i] || 100,
        dispose: 2,
        repeat: plays === 0 ? 0 : plays === 1 ? -1 : plays - 1,
      });
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  }
  if (s.format === "png" || s.format === "apng") {
    const { default: UPNG } = await import("upng-js");
    const selected = s.format === "apng" ? frames : [canvas];
    const buffers = selected.map((c) => new Uint8Array(pixels(c).data).buffer);
    const data = UPNG.encode(buffers, width, height, s.pngColors, delays);
    // UPNG defaults APNG to infinite; retain the source loop count.
    const bytes = new Uint8Array(data),
      view = new DataView(data);
    if (selected.length > 1)
      for (let i = 8; i + 12 <= bytes.length; ) {
        const len = view.getUint32(i);
        if (String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === "acTL") {
          view.setUint32(i + 12, plays);
          view.setUint32(i + 8 + len, UPNG.crc.crc(bytes, i + 4, len + 4));
          break;
        }
        i += len + 12;
      }
    return new Blob([data], { type: "image/png" });
  }
  if (s.format === "avif") {
    avif ??= (async () => {
      const [{ default: factory }, { default: url }] = await Promise.all([
        import("@jsquash/avif/codec/enc/avif_enc.js"),
        import("@jsquash/avif/codec/enc/avif_enc.wasm?url"),
      ]);
      return factory({
        noInitialRun: true,
        wasmBinary: new Uint8Array(await (await fetch(url)).arrayBuffer()),
      });
    })();
    const { defaultOptions } = await import("@jsquash/avif/meta.js"),
      module = await avif;
    const data = module.encode(
      new Uint8Array(pixels(canvas).data),
      width,
      height,
      {
        ...defaultOptions,
        quality: Math.round(quality * 100),
        speed: 8,
        subsample: 1,
      },
    );
    if (!data) throw new AppError("errorEncode", { format: "AVIF" });
    return new Blob([new Uint8Array(data)], { type: "image/avif" });
  }
  if (s.format === "tiff") {
    const { default: UTIF } = await import("utif");
    return new Blob(
      [
        UTIF.encodeImage(
          new Uint8Array(pixels(canvas).data).buffer,
          width,
          height,
        ),
      ],
      { type: "image/tiff" },
    );
  }
  if (s.format === "bmp") {
    const stride = Math.ceil((width * 3) / 4) * 4,
      buffer = new ArrayBuffer(54 + stride * height),
      view = new DataView(buffer),
      rgba = pixels(canvas).data;
    view.setUint16(0, 0x4d42, true);
    view.setUint32(2, buffer.byteLength, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, stride * height, true);
    const bytes = new Uint8Array(buffer);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4,
          dst = 54 + (height - 1 - y) * stride + x * 3;
        bytes[dst] = rgba[src + 2];
        bytes[dst + 1] = rgba[src + 1];
        bytes[dst + 2] = rgba[src];
      }
    return new Blob([buffer], { type: "image/bmp" });
  }
  const blobs: Blob[] = [];
  for (const frame of frames) {
    const blob = await frame.convertToBlob({
      type: mimeTypes[s.format],
      quality,
    });
    if (blob.type !== mimeTypes[s.format])
      throw new AppError("errorEncode", { format: s.format.toUpperCase() });
    blobs.push(blob);
  }
  if (blobs.length === 1) return blobs[0];
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x12;
  u24(vp8x, 4, width - 1);
  u24(vp8x, 7, height - 1);
  const anim = new Uint8Array(6);
  new DataView(anim.buffer).setUint16(4, Math.min(65535, plays), true);
  const chunks = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  for (const [index, blob] of blobs.entries()) {
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      view = new DataView(bytes.buffer),
      parts: Uint8Array[] = [];
    for (let i = 12; i + 8 <= bytes.length; ) {
      const size = view.getUint32(i + 4, true),
        type = String.fromCharCode(...bytes.subarray(i, i + 4)),
        end = i + 8 + size + (size % 2);
      if (end > bytes.length)
        throw new AppError("errorEncode", { format: "WEBP" });
      if (["ALPH", "VP8 ", "VP8L"].includes(type))
        parts.push(bytes.slice(i, end));
      i = end;
    }
    const header = new Uint8Array(16);
    u24(header, 6, width - 1);
    u24(header, 9, height - 1);
    u24(header, 12, Math.min(0xffffff, delays[index] || 100));
    header[15] = 2;
    chunks.push(chunk("ANMF", concat([header, ...parts])));
  }
  const payload = concat(chunks),
    header = new Uint8Array(12);
  header.set(new TextEncoder().encode("RIFF"));
  new DataView(header.buffer).setUint32(4, payload.length + 4, true);
  header.set(new TextEncoder().encode("WEBP"), 8);
  return new Blob([header, payload], { type: "image/webp" });
}
