import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  cleanSettings,
  encodeSettings,
  decodeSettings,
  outputName,
  safeFolders,
} from "../src/settings";
import { targetSize, normalizedCrop, drawRect } from "../src/geometry";
import { writeToFolder } from "../src/folder";
test("Shared settings preserve Unicode and reject arbitrary fields, files, and invalid values", () => {
  const settings = {
    ...defaults,
    watermarkText: "東京 · مرحبا",
    namePattern: "{name}-{n}-{width}",
    removeBackground: true,
  };
  assert.deepEqual(decodeSettings(encodeSettings(settings)), settings);
  assert.equal(decodeSettings("!invalid-base64"), null);
  const cleaned = cleanSettings({
    format: "html",
    quality: Infinity,
    width: -20,
    watermarkImage: "remote image",
    background: "url(https://example.com)",
    flipX: "true",
  });
  assert.equal(cleaned.format, "jpeg");
  assert.equal(cleaned.width, 1);
  assert.equal(cleaned.quality, 0.85);
  assert.equal(cleaned.background, "#ffffff");
  assert.equal(cleaned.flipX, false);
  assert.equal(cleaned.watermarkImage, undefined);
});
test("Names support tokens, numbering, portable safe paths, and collisions", () => {
  const settings = {
    ...defaults,
    prefix: "shop-",
    namePattern: "{name}-{n}-{width}x{height}",
    suffix: "",
    startNumber: 8,
  };
  const names = new Set<string>();
  assert.equal(
    outputName(
      { name: "東京.jpg" },
      settings,
      0,
      { width: 100, height: 80 },
      names,
    ),
    "shop-東京-008-100x80.jpg",
  );
  assert.equal(
    outputName(
      { name: "東京.png" },
      settings,
      0,
      { width: 100, height: 80 },
      names,
    ),
    "shop-東京-008-100x80-2.jpg",
  );
  assert.ok(
    !outputName(
      { name: "../../oops.png" },
      { ...defaults, namePattern: "../../{name}" },
      0,
      { width: 1, height: 1 },
      new Set(),
    ).includes("/"),
  );
  assert.equal(
    outputName(
      { name: "CON.png" },
      { ...defaults, suffix: "" },
      0,
      { width: 1, height: 1 },
      new Set(),
    ),
    "_CON.jpg",
  );
  assert.deepEqual(safeFolders("photos/../summer/shot.jpg"), [
    "photos",
    "summer",
  ]);
});
test("Fit, crop, padding, one-axis resize and crop bounds are explicit", () => {
  assert.deepEqual(
    targetSize(
      { width: 400, height: 200 },
      { ...defaults, resize: "width", width: 100 },
    ),
    { width: 100, height: 50 },
  );
  assert.deepEqual(
    targetSize(
      { width: 400, height: 200 },
      { ...defaults, resize: "height", height: 100 },
    ),
    { width: 200, height: 100 },
  );
  assert.deepEqual(
    drawRect({ width: 400, height: 200 }, 100, 100, {
      ...defaults,
      resize: "crop",
      anchor: "right",
    }),
    { x: -100, y: 0, width: 200, height: 100 },
  );
  assert.deepEqual(
    drawRect({ width: 400, height: 200 }, 100, 100, {
      ...defaults,
      resize: "pad",
    }),
    { x: 0, y: 25, width: 100, height: 50 },
  );
  assert.deepEqual(
    normalizedCrop({ x: 0.9, y: 0.9, width: 1, height: 1 }, 100, 100),
    { x: 90, y: 90, width: 10, height: 10 },
  );
});
test("Folder export creates subfolders and avoids overwriting existing files", async () => {
  const written = new Map<string, Blob>([
      ["existing.jpg", new Blob(["original"])],
    ]),
    dirs = new Map<string, any>();
  function dir(prefix = ""): any {
    return {
      async getDirectoryHandle(name: string) {
        if (!dirs.has(prefix + name))
          dirs.set(prefix + name, dir(prefix + name + "/"));
        return dirs.get(prefix + name);
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const key = prefix + name;
        if (!options?.create && !written.has(key))
          throw Object.assign(new Error(), { name: "NotFoundError" });
        return {
          async createWritable() {
            return {
              async write(blob: Blob) {
                written.set(key, blob);
              },
              async close() {},
            };
          },
        };
      },
    };
  }
  const count = await writeToFolder(dir(), [
    { name: "existing.jpg", folders: [], blob: new Blob(["new"]) },
    { name: "other.png", folders: ["album"], blob: new Blob(["png"]) },
  ]);
  assert.equal(count, 2);
  assert.equal(await written.get("existing.jpg")!.text(), "original");
  assert.equal(await written.get("existing-2.jpg")!.text(), "new");
  assert.equal(await written.get("album/other.png")!.text(), "png");
});
