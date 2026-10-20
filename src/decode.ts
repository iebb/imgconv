import { AppError } from "./errors";
import { checkDimensions } from "./geometry";
export async function decode(file: File): Promise<ImageBitmap> {
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const signature = new TextDecoder("latin1").decode(header);
  const isTiff =
    /\.(tiff?)$/i.test(file.name) ||
    /tiff/.test(file.type) ||
    (header[0] === 0x49 && header[1] === 0x49 && header[2] === 42) ||
    (header[0] === 0x4d && header[1] === 0x4d && header[3] === 42);
  if (isTiff) {
    const { default: UTIF } = await import("utif");
    const buffer = await file.arrayBuffer();
    const page = UTIF.decode(buffer).find(
      (ifd) => ifd.t256?.[0] && ifd.t257?.[0],
    );
    if (!page) throw new AppError("errorTiff");
    checkDimensions(page.t256[0], page.t257[0]);
    UTIF.decodeImage(buffer, page);
    const canvas = new OffscreenCanvas(page.width, page.height);
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(UTIF.toRGBA8(page)),
          page.width,
          page.height,
        ),
        0,
        0,
      );
    const orientation = page.t274?.[0] || 1;
    if (orientation === 1) return createImageBitmap(canvas);
    const rotated = new OffscreenCanvas(
      orientation >= 5 ? page.height : page.width,
      orientation >= 5 ? page.width : page.height,
    );
    const ctx = rotated.getContext("2d")!;
    const transforms: Record<number, number[]> = {
      2: [-1, 0, 0, 1, page.width, 0],
      3: [-1, 0, 0, -1, page.width, page.height],
      4: [1, 0, 0, -1, 0, page.height],
      5: [0, 1, 1, 0, 0, 0],
      6: [0, 1, -1, 0, page.height, 0],
      7: [0, -1, -1, 0, page.height, page.width],
      8: [0, -1, 1, 0, 0, page.width],
    };
    const t = transforms[orientation];
    if (t) ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
    ctx.drawImage(canvas, 0, 0);
    return createImageBitmap(rotated);
  }
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      checkDimensions(bitmap.width, bitmap.height);
    } catch (error) {
      bitmap.close();
      throw error;
    }
    return bitmap;
  } catch (nativeError) {
    if (
      /\.hei[cf]$/i.test(file.name) ||
      /hei[cf]/.test(file.type) ||
      /ftyp[\s\S]*(heic|heix|hevc|hevx|mif1|msf1)/.test(signature)
    ) {
      const { heicTo } = await import("heic-to/next");
      const bitmap = await heicTo({ blob: file, type: "bitmap" });
      try {
        checkDimensions(bitmap.width, bitmap.height);
      } catch (error) {
        bitmap.close();
        throw error;
      }
      return bitmap;
    }
    if (nativeError instanceof AppError) throw nativeError;
    throw new AppError("errorDecode");
  }
}
