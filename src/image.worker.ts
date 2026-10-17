import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { AppError, issue } from './errors';
import type { ConversionResult, Settings, WorkerRequest, WorkerReply } from './types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const mimeTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff' };

function checkDimensions(width: number, height: number) {
  if (!Number.isFinite(width * height) || width < 1 || height < 1 || width > 32767 || height > 32767 || width * height > 80_000_000) {
    throw new AppError('errorDimensions');
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const signature = new TextDecoder('latin1').decode(header);
  const isTiff = /\.(tiff?)$/i.test(file.name) || /tiff/.test(file.type) ||
    (header[0] === 0x49 && header[1] === 0x49 && header[2] === 42) ||
    (header[0] === 0x4d && header[1] === 0x4d && header[3] === 42);
  if (isTiff) {
    const { default: UTIF } = await import('utif');
    const buffer = await file.arrayBuffer();
    const page = UTIF.decode(buffer).find(ifd => ifd.t256?.[0] && ifd.t257?.[0]);
    if (!page) throw new AppError('errorTiff');
    checkDimensions(page.t256[0], page.t257[0]);
    UTIF.decodeImage(buffer, page);
    const canvas = new OffscreenCanvas(page.width, page.height);
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(page)), page.width, page.height), 0, 0);
    const orientation = page.t274?.[0] || 1;
    if (orientation === 1) return createImageBitmap(canvas);
    const rotated = new OffscreenCanvas(orientation >= 5 ? page.height : page.width, orientation >= 5 ? page.width : page.height);
    const ctx = rotated.getContext('2d')!;
    const transforms: Record<number, number[]> = { 2: [-1,0,0,1,page.width,0], 3: [-1,0,0,-1,page.width,page.height], 4: [1,0,0,-1,0,page.height], 5: [0,1,1,0,0,0], 6: [0,1,-1,0,page.height,0], 7: [0,-1,-1,0,page.height,page.width], 8: [0,-1,1,0,0,page.width] };
    const t = transforms[orientation];
    if (t) ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
    ctx.drawImage(canvas, 0, 0);
    return createImageBitmap(rotated);
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try { checkDimensions(bitmap.width, bitmap.height); } catch (error) { bitmap.close(); throw error; }
    return bitmap;
  } catch (nativeError) {
    if (/\.hei[cf]$/i.test(file.name) || /hei[cf]/.test(file.type) || /ftyp[\s\S]*(heic|heix|hevc|hevx|mif1|msf1)/.test(signature)) {
      const { heicTo } = await import('heic-to/next');
      const bitmap = await heicTo({ blob: file, type: 'bitmap' });
      try { checkDimensions(bitmap.width, bitmap.height); } catch (error) { bitmap.close(); throw error; }
      return bitmap;
    }
    if (nativeError instanceof AppError) throw nativeError;
    throw new AppError('errorDecode');
  }
}

function draw(source: ImageBitmap, width: number, height: number, settings?: Settings) {
  checkDimensions(width, height);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  if (settings && ['jpeg', 'bmp'].includes(settings.format)) {
    context.fillStyle = settings.background;
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function thumbnail(source: ImageBitmap | OffscreenCanvas) {
  const ratio = Math.min(1, 640 / Math.max(source.width, source.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(source.width * ratio)), Math.max(1, Math.round(source.height * ratio)));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}

function dimensions(source: ImageBitmap, s: Settings) {
  let width = source.width, height = source.height;
  if (s.resize === 'fit') {
    const scale = Math.min(s.width / width, s.height / height, s.upscale ? Infinity : 1);
    width *= scale; height *= scale;
  } else if (s.resize === 'percentage') {
    const scale = Math.min(s.percentage / 100, s.upscale ? Infinity : 1);
    width *= scale; height *= scale;
  } else if (s.resize === 'exact') {
    // Exact dimensions are intentionally independent of the aspect ratio.
    width = s.width; height = s.height;
    if (!s.upscale && (width > source.width || height > source.height)) {
      const scale = Math.min(source.width / width, source.height / height, 1);
      width *= scale; height *= scale;
    }
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

async function encode(canvas: OffscreenCanvas, s: Settings, quality: number): Promise<Blob> {
  if (s.format === 'gif') {
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = Math.max(2, Math.round(2 + quality * 254));
    const palette = quantize(rgba, colors, { format: 'rgba4444', oneBitAlpha: true });
    const indices = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = palette.findIndex(color => color[3] === 0);
    const gif = GIFEncoder();
    gif.writeFrame(indices, canvas.width, canvas.height, { palette, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }
  if (s.format === 'tiff') {
    const { default: UTIF } = await import('utif');
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return new Blob([UTIF.encodeImage(new Uint8Array(pixels).buffer, canvas.width, canvas.height)], { type: 'image/tiff' });
  }
  if (s.format === 'bmp') {
    const { width, height } = canvas;
    const stride = Math.ceil(width * 3 / 4) * 4;
    const buffer = new ArrayBuffer(54 + stride * height);
    const view = new DataView(buffer);
    view.setUint16(0, 0x4d42, true); view.setUint32(2, buffer.byteLength, true); view.setUint32(10, 54, true);
    view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
    view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, stride * height, true);
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const bytes = new Uint8Array(buffer);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = 54 + (height - 1 - y) * stride + x * 3;
      bytes[dst] = pixels[src + 2]; bytes[dst + 1] = pixels[src + 1]; bytes[dst + 2] = pixels[src];
    }
    return new Blob([buffer], { type: 'image/bmp' });
  }
  const blob = await canvas.convertToBlob({ type: mimeTypes[s.format], quality });
  if (blob.type !== mimeTypes[s.format]) throw new AppError('errorEncode', { format: s.format.toUpperCase() });
  return blob;
}

async function convert(source: ImageBitmap, settings: Settings): Promise<ConversionResult> {
  const initial = dimensions(source, settings);
  let { width, height } = initial;
  let canvas = draw(source, width, height, settings);
  let finalQuality = settings.quality;
  const canAdjustQuality = ['jpeg', 'webp', 'gif'].includes(settings.format);
  const limit = settings.maxBytes;
  // Each candidate is checked by its actual encoded byte count, including headers.
  for (let attempt = 0; attempt < 32; attempt++) {
    let blob = await encode(canvas, settings, settings.quality);
    finalQuality = settings.quality;
    if (limit && blob.size > limit && canAdjustQuality) {
      const minimum = await encode(canvas, settings, 0.01);
      if (minimum.size <= limit) {
        blob = minimum; finalQuality = 0.01;
        let low = 0.01, high = settings.quality;
        for (let i = 0; i < 8; i++) {
          const mid = (low + high) / 2;
          const candidate = await encode(canvas, settings, mid);
          if (candidate.size <= limit) { low = mid; blob = candidate; finalQuality = mid; }
          else high = mid;
        }
      } else blob = minimum;
    }
    if (!limit || blob.size <= limit) {
      return { blob, width, height, quality: finalQuality, reduced: width !== initial.width || height !== initial.height, thumbnail: await thumbnail(canvas) };
    }
    if (!settings.autoResize || (width === 1 && height === 1)) {
      throw new AppError(settings.autoResize ? 'errorLimitTiny' : 'errorLimitFixed', { limit });
    }
    const scale = Math.max(0.1, Math.min(0.85, Math.sqrt(limit / blob.size) * 0.92));
    width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
    canvas.width = 1; canvas.height = 1;
    canvas = draw(source, width, height, settings);
  }
  throw new AppError('errorLimit');
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await decode(request.file);
    const result = request.action === 'inspect'
      ? { width: bitmap.width, height: bitmap.height, thumbnail: await thumbnail(bitmap) }
      : await convert(bitmap, request.settings);
    scope.postMessage({ id: request.id, ok: true, result } satisfies WorkerReply);
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: issue(error) } satisfies WorkerReply);
  } finally { bitmap?.close(); }
};
