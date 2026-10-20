import { defaults } from "../src/settings";
import { GIFEncoder } from "gifenc";
import { parseGIF, decompressFrames } from "gifuct-js";
import UPNG from "upng-js";
import { unzipSync, zipSync } from "fflate";
import UTIF from "utif";
import type {
  ConversionResult,
  Format,
  ImageInfo,
  Settings,
} from "../src/types";

const base: Settings = {
  ...defaults,
  format: "jpeg",
  quality: 0.85,
  resize: "original",
  width: 1920,
  height: 1080,
  percentage: 50,
  upscale: false,
  maxBytes: null,
  autoResize: true,
  background: "#ffffff",
  suffix: "-resz",
};
const worker = new Worker(new URL("../src/image.worker.ts", import.meta.url), {
  type: "module",
});
let id = 0,
  passed = 0,
  failed = 0;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
worker.onmessage = ({ data }) => {
  const handler = pending.get(data.id)!;
  pending.delete(data.id);
  data.ok
    ? handler.resolve(data.result)
    : handler.reject(new Error(data.error.code));
};
const request = (
  file: File,
  settings?: Partial<Settings>,
  crop?: import("../src/types").Crop,
) =>
  new Promise<ImageInfo | ConversionResult>((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    worker.postMessage({
      id: next,
      action: settings ? "convert" : "inspect",
      file,
      crop,
      settings: settings ? { ...base, ...settings } : undefined,
    });
  });
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
async function test(name: string, action: () => Promise<void>) {
  const item = document.createElement("li");
  item.textContent = `Running: ${name}`;
  document.querySelector("#results")!.append(item);
  try {
    await action();
    item.textContent = `PASS — ${name}`;
    passed++;
  } catch (error) {
    item.textContent = `FAIL — ${name}: ${error}`;
    item.className = "fail";
    failed++;
  }
  document.querySelector("#summary")!.textContent =
    `${passed} passed, ${failed} failed (running)`;
}
const canvas = new OffscreenCanvas(480, 320),
  ctx = canvas.getContext("2d")!;
const rgba = ctx.createImageData(480, 320);
let seed = 7;
for (let i = 0; i < rgba.data.length; i += 4) {
  seed = (seed * 16807) % 2147483647;
  rgba.data[i] = seed % 256;
  rgba.data[i + 1] = (seed >>> 8) % 256;
  rgba.data[i + 2] = (seed >>> 16) % 256;
  rgba.data[i + 3] = i % 480 < 240 ? 255 : 0;
}
ctx.putImageData(rgba, 0, 0);
const original = new File(
  [await canvas.convertToBlob({ type: "image/png" })],
  "test.png",
  { type: "image/png" },
);
const heic = new File(
  [await (await fetch("./fixtures/example.heic")).blob()],
  "example.heic",
  { type: "image/heic" },
);
const tiff = new File(
  [await (await fetch("./fixtures/transparency.tiff")).blob()],
  "transparency.tiff",
  { type: "image/tiff" },
);
const results: Record<string, Uint8Array> = Object.create(null);

await test("PNG import: correct dimensions and thumbnail", async () => {
  const info = await request(original);
  assert(info.width === 480 && info.height === 320, "incorrect dimensions");
  assert(info.thumbnail.size > 0, "missing thumbnail");
});
await test("Real HEIC import and JPEG conversion", async () => {
  const result = (await request(heic, {
    format: "jpeg",
    resize: "fit",
    width: 400,
    height: 400,
  })) as ConversionResult;
  assert(
    result.width === 400 && result.height === 267,
    `unexpected HEIC dimensions ${result.width}x${result.height}`,
  );
  assert(result.blob.type === "image/jpeg", "not JPEG");
});
await test("TIFF import with RGBA transparency", async () => {
  const info = await request(tiff);
  assert(
    info.width === 320 && info.height === 240,
    "incorrect TIFF dimensions",
  );
});
for (const format of ["jpeg", "png", "webp", "gif", "bmp", "tiff"] as Format[])
  await test(`${format.toUpperCase()} exports correct bytes, dimensions, and transparency`, async () => {
    const result = (await request(original, {
      format,
      resize: "fit",
      width: 120,
      height: 120,
    })) as ConversionResult;
    assert(result.width === 120 && result.height === 80, "bad resize");
    const buffer = await result.blob.arrayBuffer(),
      bytes = new Uint8Array(buffer);
    results[`test.${format}`] = bytes;
    const signatures: Record<Format, boolean> = {
      jpeg: bytes[0] === 255 && bytes[1] === 216,
      png: bytes[0] === 137 && bytes[1] === 80,
      webp: String.fromCharCode(...bytes.slice(8, 12)) === "WEBP",
      gif: String.fromCharCode(...bytes.slice(0, 3)) === "GIF",
      bmp: bytes[0] === 66 && bytes[1] === 77,
      tiff:
        (bytes[0] === 77 && bytes[1] === 77) ||
        (bytes[0] === 73 && bytes[1] === 73),
    };
    assert(signatures[format], `wrong ${format} file signature`);
    let pixels: Uint8ClampedArray | Uint8Array;
    if (format === "tiff") {
      const page = UTIF.decode(buffer)[0];
      UTIF.decodeImage(buffer, page);
      assert(page.width === 120 && page.height === 80, "bad TIFF dimensions");
      pixels = UTIF.toRGBA8(page);
    } else {
      const bitmap = await createImageBitmap(result.blob);
      assert(
        bitmap.width === 120 && bitmap.height === 80,
        "bad decoded dimensions",
      );
      const decoded = new OffscreenCanvas(120, 80);
      decoded.getContext("2d")!.drawImage(bitmap, 0, 0);
      pixels = decoded.getContext("2d")!.getImageData(0, 0, 120, 80).data;
      bitmap.close();
    }
    // Original's right half of each 120-pixel-wide strip is fully transparent.
    assert(
      ["jpeg", "bmp"].includes(format)
        ? pixels[29 * 4 + 3] === 255
        : pixels[29 * 4 + 3] === 0,
      "unexpected alpha",
    );
  });
await test("Hard byte cap checks actual JPG bytes and reduces quality", async () => {
  const result = (await request(original, {
    maxBytes: 6000,
    autoResize: false,
  })) as ConversionResult;
  assert(result.blob.size <= 6000, "over byte cap");
  assert(result.width === 480 && result.height === 320, "unexpected resize");
  assert(result.quality < 0.85, "quality not adjusted");
});
await test("PNG byte cap automatically reduces dimensions", async () => {
  const result = (await request(original, {
    format: "png",
    maxBytes: 3000,
  })) as ConversionResult;
  assert(result.blob.size <= 3000, "over byte cap");
  assert(result.reduced, "not reduced");
});
await test("Impossible cap fails instead of exporting oversized file", async () => {
  let error = "";
  try {
    await request(original, { maxBytes: 1 });
  } catch (e) {
    error = (e as Error).message;
  }
  assert(error === "errorLimitTiny", "missing size failure");
});
await test("Cap with automatic resize disabled preserves dimensions or fails", async () => {
  let error = "";
  try {
    await request(original, {
      format: "png",
      maxBytes: 100,
      autoResize: false,
    });
  } catch (e) {
    error = (e as Error).message;
  }
  assert(error === "errorLimitFixed", "unexpected cap behavior");
});
await test("Fit never upscales by default", async () => {
  const result = await request(original, {
    resize: "fit",
    width: 1200,
    height: 1200,
  });
  assert(result.width === 480 && result.height === 320, "upscaled");
});
await test("Percentage and exact resize", async () => {
  const percent = await request(original, {
    resize: "percentage",
    percentage: 25,
  });
  assert(percent.width === 120 && percent.height === 80, "wrong percent");
  const exact = await request(original, {
    resize: "exact",
    width: 100,
    height: 100,
  });
  assert(exact.width === 100 && exact.height === 100, "wrong exact dimensions");
});
await test("Corrupt input fails and worker recovers for the next file", async () => {
  let errored = false;
  try {
    await request(new File(["broken"], "bad.heic"));
  } catch {
    errored = true;
  }
  assert(errored, "accepted corrupt image");
  assert((await request(original)).width === 480, "worker did not recover");
});
await test("ZIP round trip preserves every output byte", async () => {
  const zip = zipSync(results, { level: 0 }),
    entries = unzipSync(zip);
  assert(Object.keys(entries).length === 6, "missing ZIP entries");
  for (const name of Object.keys(results))
    assert(
      entries[name].every((value, i) => value === results[name][i]),
      `ZIP bytes differ for ${name}`,
    );
});
const colors = new OffscreenCanvas(120, 80),
  cc = colors.getContext("2d")!;
for (const [color, x, y] of [
  ["#ff0000", 0, 0],
  ["#00ff00", 60, 0],
  ["#0000ff", 0, 40],
  ["#ffff00", 60, 40],
] as const) {
  cc.fillStyle = color;
  cc.fillRect(x, y, 60, 40);
}
const colorful = new File(
  [await colors.convertToBlob({ type: "image/png" })],
  "quarters.png",
  { type: "image/png" },
);
async function decoded(blob: Blob) {
  const bitmap = await createImageBitmap(blob),
    c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}
const rgbaAt = (c: OffscreenCanvas, x: number, y: number) =>
  Array.from(c.getContext("2d")!.getImageData(x, y, 1, 1).data);
await test("AVIF output has actual AVIF bytes and decodes with transparency", async () => {
  const result = (await request(original, {
    format: "avif",
    resize: "fit",
    width: 120,
    height: 120,
  })) as ConversionResult;
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert(
    new TextDecoder().decode(bytes.subarray(4, 32)).includes("avif"),
    "not AVIF",
  );
  const c = await decoded(result.blob);
  assert(c.width === 120 && c.height === 80, "wrong size");
  assert(rgbaAt(c, 29, 0)[3] === 0, "lost alpha");
});
await test("PNG palette reduction produces at most 32 palette colors", async () => {
  const result = (await request(original, {
    format: "png",
    pngColors: 32,
  })) as ConversionResult;
  const png = UPNG.decode(await result.blob.arrayBuffer());
  assert(png.tabs.PLTE?.length <= 32 * 3, "missing or excessive palette");
  assert(result.blob.size < original.size, "palette did not reduce size");
});
await test("Rotation and horizontal / vertical flips transform the actual pixels", async () => {
  const rotated = (await request(colorful, {
      format: "png",
      rotation: 90,
    })) as ConversionResult,
    c = await decoded(rotated.blob);
  assert(c.width === 80 && c.height === 120, "rotation dimensions");
  assert(rgbaAt(c, 10, 10)[2] === 255, "rotation pixels");
  const horizontal = await decoded(
    (
      (await request(colorful, {
        format: "png",
        flipX: true,
      })) as ConversionResult
    ).blob,
  );
  assert(rgbaAt(horizontal, 10, 10)[1] === 255, "horizontal flip");
  const vertical = await decoded(
    (
      (await request(colorful, {
        format: "png",
        flipY: true,
      })) as ConversionResult
    ).blob,
  );
  assert(rgbaAt(vertical, 10, 10)[2] === 255, "vertical flip");
});
await test("Fill crop honors anchor and padding preserves transparency or chosen background", async () => {
  const left = await decoded(
    (
      (await request(colorful, {
        format: "png",
        resize: "crop",
        width: 40,
        height: 80,
        anchor: "left",
      })) as ConversionResult
    ).blob,
  );
  const right = await decoded(
    (
      (await request(colorful, {
        format: "png",
        resize: "crop",
        width: 40,
        height: 80,
        anchor: "right",
      })) as ConversionResult
    ).blob,
  );
  assert(
    rgbaAt(left, 10, 10)[0] === 255 && rgbaAt(right, 10, 10)[1] === 255,
    "crop anchors ignored",
  );
  const pad = await decoded(
    (
      (await request(colorful, {
        format: "png",
        resize: "pad",
        width: 100,
        height: 100,
      })) as ConversionResult
    ).blob,
  );
  assert(
    pad.width === 100 && pad.height === 100 && rgbaAt(pad, 50, 2)[3] === 0,
    "transparent padding failed",
  );
  const solid = await decoded(
    (
      (await request(colorful, {
        format: "png",
        resize: "pad",
        width: 100,
        height: 100,
        transparentPadding: false,
        background: "#ff00ff",
      })) as ConversionResult
    ).blob,
  );
  assert(
    rgbaAt(solid, 50, 2).join(",") === "255,0,255,255",
    "padding color failed",
  );
});
await test("Per-image manual crop is applied before resize", async () => {
  const result = (await request(
      colorful,
      { format: "png" },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    )) as ConversionResult,
    c = await decoded(result.blob);
  assert(c.width === 60 && c.height === 80, "custom crop dimensions");
  assert(rgbaAt(c, 10, 10)[1] === 255, "custom crop pixels");
});
await test("Text and logo watermarks alter selected region with opacity", async () => {
  const logoCanvas = new OffscreenCanvas(20, 20),
    ctx = logoCanvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 20, 20);
  const logo = new File(
    [await logoCanvas.convertToBlob({ type: "image/png" })],
    "logo.png",
    { type: "image/png" },
  );
  const image = await decoded(
    (
      (await request(colorful, {
        format: "png",
        watermark: "image",
        watermarkImage: logo,
        watermarkOpacity: 0.5,
        watermarkSize: 0.4,
        watermarkPosition: "top-left",
      })) as ConversionResult
    ).blob,
  );
  const pixel = rgbaAt(image, 10, 10);
  assert(
    pixel[0] === 255 && pixel[1] > 100 && pixel[1] < 200,
    "logo or opacity ignored",
  );
  const text = await decoded(
    (
      (await request(colorful, {
        format: "png",
        watermark: "text",
        watermarkText: "TEST",
        watermarkColor: "#ffffff",
        watermarkSize: 0.8,
        watermarkPosition: "center",
      })) as ConversionResult
    ).blob,
  );
  let changed = 0;
  const a = cc.getImageData(0, 0, 120, 80).data,
    b = text.getContext("2d")!.getImageData(0, 0, 120, 80).data;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  assert(changed > 20, "text watermark did not render");
});
const animation = GIFEncoder();
animation.writeFrame(new Uint8Array(32 * 24).fill(0), 32, 24, {
  palette: [
    [255, 0, 0],
    [0, 0, 255],
  ],
  delay: 80,
  repeat: 2,
});
animation.writeFrame(new Uint8Array(32 * 24).fill(1), 32, 24, {
  palette: [
    [255, 0, 0],
    [0, 0, 255],
  ],
  delay: 160,
  repeat: 2,
});
animation.finish();
const animated = new File([animation.bytes()], "animation.gif", {
  type: "image/gif",
});
await test("Animated input is detected and static output needs explicit first-frame choice", async () => {
  assert(
    ((await request(animated)) as ImageInfo).frames === 2,
    "frame count not detected",
  );
  let error = "";
  try {
    await request(animated, { format: "jpeg" });
  } catch (e) {
    error = (e as Error).message;
  }
  assert(error === "errorAnimationFormat", "animation silently flattened");
  const first = (await request(animated, {
    format: "jpeg",
    animation: "first",
  })) as ConversionResult;
  assert(first.frames === 1, "first-frame mode failed");
});
for (const format of ["gif", "webp", "apng"] as const)
  await test(
    "Animated " +
      format.toUpperCase() +
      " retains frames, timing, loops and final byte cap",
    async () => {
      const result = (await request(animated, {
        format,
        resize: "fit",
        width: 16,
        height: 16,
        maxBytes: 10000,
      })) as ConversionResult;
      assert(
        result.frames === 2 && result.width === 16 && result.height === 12,
        "animation dimensions/frames",
      );
      assert(result.blob.size <= 10000, "over animation byte cap");
      const buffer = await result.blob.arrayBuffer();
      if (format === "gif") {
        const gif = parseGIF(buffer),
          frames = decompressFrames(gif, true);
        assert(
          frames.length === 2 &&
            frames[0].delay === 80 &&
            frames[1].delay === 160,
          "GIF frame delays",
        );
      }
      if (format === "apng") {
        const png = UPNG.decode(buffer);
        assert(
          png.frames.length === 2 &&
            png.frames[0].delay === 80 &&
            png.frames[1].delay === 160,
          "APNG frame delays",
        );
        assert(png.tabs.acTL.num_plays === 3, "APNG loop count");
      }
      const Decoder = (globalThis as any).ImageDecoder;
      if (Decoder) {
        const decoder = new Decoder({
          data: new Uint8Array(buffer),
          type: format === "apng" ? "image/png" : result.blob.type,
          preferAnimation: true,
        });
        await decoder.tracks.ready;
        await decoder.completed;
        assert(
          decoder.tracks.selectedTrack.frameCount === 2,
          "browser frame count",
        );
        assert(
          decoder.tracks.selectedTrack.repetitionCount === 2,
          "loop count",
        );
        for (let i = 0; i < 2; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          const c = new OffscreenCanvas(16, 12);
          c.getContext("2d")!.drawImage(image, 0, 0);
          const p = rgbaAt(c, 5, 5);
          assert(i === 0 ? p[0] > 200 : p[2] > 200, "frame color/compositing");
          assert(
            Math.round(image.duration / 1000) === (i === 0 ? 80 : 160),
            "browser frame duration",
          );
          image.close();
        }
        decoder.close();
      }
    },
  );
await test("Full-resolution HEIC preview is not the 640px thumbnail", async () => {
  const result = await new Promise<any>((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    worker.postMessage({ id: next, action: "preview", file: heic });
  });
  const bitmap = await createImageBitmap(result.blob);
  assert(
    bitmap.width === 1280 && bitmap.height === 854,
    "preview was downsampled",
  );
  bitmap.close();
});
await test("Local background removal runs the real model and preserves existing transparency", async () => {
  const result = (await request(original, {
    format: "png",
    removeBackground: true,
    resize: "fit",
    width: 120,
    height: 120,
  })) as ConversionResult;
  const c = await decoded(result.blob),
    data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let partial = 0;
  for (let i = 3; i < data.length; i += 4)
    if (data[i] > 0 && data[i] < 255) partial++;
  assert(partial > 0, "background model mask missing");
  assert(rgbaAt(c, 29, 0)[3] === 0, "existing alpha lost");
});
await test("Local Real-ESRGAN inference provides real 2x and 4x outputs", async () => {
  const tinyCanvas = new OffscreenCanvas(12, 8);
  tinyCanvas.getContext("2d")!.drawImage(colors, 0, 0, 12, 8);
  const file = new File(
    [await tinyCanvas.convertToBlob({ type: "image/png" })],
    "small.png",
    { type: "image/png" },
  );
  for (const [enhance, w, h] of [
    ["2x", 24, 16],
    ["4x", 48, 32],
  ] as const) {
    const result = (await request(file, {
      format: "png",
      enhance,
    })) as ConversionResult;
    assert(result.width === w && result.height === h, "wrong AI output size");
    const c = await decoded(result.blob);
    assert(rgbaAt(c, 1, 1)[3] === 255, "AI lost opacity");
  }
});
await test("GIF and APNG decoding also work without browser ImageDecoder", async () => {
  const fallback = new Worker(
    new URL("./fallback.worker.ts", import.meta.url),
    { type: "module" },
  );
  const check = (file: File) =>
    new Promise<any>((resolve) => {
      fallback.onmessage = ({ data }) => resolve(data);
      fallback.postMessage(file);
    });
  for (const file of [
    animated,
    new File(
      [
        ((await request(animated, { format: "apng" })) as ConversionResult)
          .blob,
      ],
      "animated.png",
      { type: "image/png" },
    ),
  ]) {
    const result = await check(file);
    assert(result.ok && result.total === 2, "fallback failed: " + result.error);
    assert(result.plays === 3, "fallback loops");
    assert(result.delays.join(",") === "80,160", "fallback timing");
    assert(
      result.pixels[0][0] === 255 && result.pixels[1][2] === 255,
      "fallback compositing",
    );
  }
  fallback.terminate();
});
await test("Strict byte cap applies to encoded AVIF output", async () => {
  const result = (await request(original, {
    format: "avif",
    maxBytes: 3000,
  })) as ConversionResult;
  assert(result.blob.size <= 3000, "AVIF exceeded limit");
  assert(result.width > 0 && result.height > 0, "invalid AVIF dimensions");
  await decoded(result.blob);
});
await test("Folder export uses the real browser file-writing API", async () => {
  const { writeToFolder } = await import("../src/folder");
  const root = await navigator.storage.getDirectory(),
    name = "resz-qa-" + crypto.randomUUID();
  const directory = await root.getDirectoryHandle(name, { create: true }),
    existing = await directory.getFileHandle("photo.txt", { create: true }),
    stream = await existing.createWritable();
  await stream.write("original");
  await stream.close();
  try {
    await writeToFolder(directory as any, [
      { name: "photo.txt", folders: [], blob: new Blob(["new"]) },
      { name: "result.txt", folders: ["album"], blob: new Blob(["nested"]) },
    ]);
    assert(
      (await (await existing.getFile()).text()) === "original",
      "existing file overwritten",
    );
    assert(
      (await (
        await (await directory.getFileHandle("photo-2.txt")).getFile()
      ).text()) === "new",
      "collision export absent",
    );
    const album = await directory.getDirectoryHandle("album");
    assert(
      (await (
        await (await album.getFileHandle("result.txt")).getFile()
      ).text()) === "nested",
      "subfolder export absent",
    );
  } finally {
    await root.removeEntry(name, { recursive: true });
  }
});
worker.terminate();
document.querySelector("#summary")!.textContent =
  "Finished: " + passed + " passed, " + failed + " failed.";
document.title = "resz.im tests: " + passed + " passed, " + failed + " failed";
