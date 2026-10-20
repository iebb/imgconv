import type { ConversionResult, Format, Settings } from "./types";
export const formats: Format[] = [
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "apng",
  "bmp",
  "tiff",
];
export const extensions: Record<Format, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  apng: "png",
  bmp: "bmp",
  tiff: "tiff",
};
export const defaults: Settings = {
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
  rotation: 0,
  flipX: false,
  flipY: false,
  anchor: "center",
  transparentPadding: true,
  pngColors: 0,
  animation: "preserve",
  watermark: "none",
  watermarkText: "",
  watermarkColor: "#ffffff",
  watermarkOpacity: 0.65,
  watermarkSize: 0.2,
  watermarkPosition: "bottom-right",
  namePattern: "{name}",
  prefix: "",
  startNumber: 1,
  numberPadding: 3,
  keepFolders: false,
  removeBackground: false,
  enhance: "none",
};
const positions = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];
// Treat saved/shared settings as untrusted input. Files are always session-only.
export function cleanSettings(value: unknown): Settings {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;
  const choices: Partial<Record<keyof Settings, readonly unknown[]>> = {
    format: formats,
    resize: [
      "original",
      "fit",
      "percentage",
      "exact",
      "crop",
      "pad",
      "width",
      "height",
    ],
    rotation: [0, 90, 180, 270],
    anchor: positions,
    watermarkPosition: positions,
    pngColors: [0, 256, 128, 64, 32],
    animation: ["preserve", "first"],
    watermark: ["none", "text", "image"],
    enhance: ["none", "2x", "4x"],
  };
  const ranges: Partial<Record<keyof Settings, [number, number]>> = {
    quality: [0.01, 1],
    width: [1, 32767],
    height: [1, 32767],
    percentage: [1, 400],
    maxBytes: [1, 1e15],
    watermarkOpacity: [0.01, 1],
    watermarkSize: [0.02, 0.8],
    startNumber: [0, 999999999],
    numberPadding: [1, 9],
  };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const val = v[key];
    if (choices[key]) {
      if (choices[key]!.includes(val)) (out as any)[key] = val;
    } else if (ranges[key]) {
      if (typeof val === "number" && Number.isFinite(val))
        (out as any)[key] = Math.min(
          ranges[key]![1],
          Math.max(ranges[key]![0], val),
        );
    } else if (typeof defaults[key] === "boolean") {
      if (typeof val === "boolean") (out as any)[key] = val;
    } else if (typeof defaults[key] === "string" && typeof val === "string") {
      if (["background", "watermarkColor"].includes(key)) {
        if (/^#[\da-f]{6}$/i.test(val)) (out as any)[key] = val;
      } else
        (out as any)[key] = val.slice(0, key === "watermarkText" ? 240 : 120);
    }
  }
  for (const key of [
    "width",
    "height",
    "percentage",
    "startNumber",
    "numberPadding",
  ] as const)
    out[key] = Math.round(out[key]);
  if (v.maxBytes === null) out.maxBytes = null;
  return out;
}
export function serializableSettings(settings: Settings) {
  const { watermarkImage: _file, ...plain } = settings;
  return plain;
}
export function encodeSettings(settings: Settings) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(serializableSettings(settings)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function decodeSettings(value: string): Settings | null {
  if (value.length > 12000) return null;
  try {
    const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return cleanSettings(
      JSON.parse(
        new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))),
      ),
    );
  } catch {
    return null;
  }
}
const safe = (name: string) =>
  name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[ .]+$/, "")
    .trim();
export function outputName(
  file: Pick<File, "name">,
  settings: Settings,
  index: number,
  result: Pick<ConversionResult, "width" | "height">,
  names: Set<string>,
) {
  const stem = safe(file.name.replace(/\.[^.]+$/, "")) || "image";
  const tokens: Record<string, string> = {
    name: stem,
    n: String(settings.startNumber + index).padStart(
      settings.numberPadding,
      "0",
    ),
    width: String(result.width),
    height: String(result.height),
    format: extensions[settings.format],
  };
  let base =
    safe(
      settings.prefix +
        (settings.namePattern || "{name}").replace(
          /\{(name|n|width|height|format)\}/g,
          (_, key: string) => tokens[key],
        ) +
        settings.suffix,
    ) || "image";
  let clipped = "";
  for (const char of base) {
    if (new TextEncoder().encode(clipped + char).length > 180) break;
    clipped += char;
  }
  base = clipped || "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))
    base = "_" + base;
  const extension = extensions[settings.format];
  let candidate = base + "." + extension,
    collision = 2;
  while (names.has(candidate.toLowerCase()))
    candidate = base + "-" + collision++ + "." + extension;
  names.add(candidate.toLowerCase());
  return candidate;
}
export function safeFolders(path: string) {
  return path
    .split(/[\\/]/)
    .slice(0, -1)
    .map(safe)
    .filter((part) => part && part !== "." && part !== "..");
}
