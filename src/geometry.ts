import { AppError } from "./errors";
import type { Crop, Settings } from "./types";
export function checkDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width * height) ||
    width < 1 ||
    height < 1 ||
    width > 32767 ||
    height > 32767 ||
    width * height > 80_000_000
  )
    throw new AppError("errorDimensions");
}
export function normalizedCrop(
  crop: Crop | undefined,
  width: number,
  height: number,
) {
  const clamp = (v: number, min: number, max: number) =>
    Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
  const x = Math.floor(clamp(crop?.x ?? 0, 0, 1 - 1 / width) * width);
  const y = Math.floor(clamp(crop?.y ?? 0, 0, 1 - 1 / height) * height);
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(
        width - x,
        Math.round(clamp(crop?.width ?? 1, 1 / width, 1) * width),
      ),
    ),
    height: Math.max(
      1,
      Math.min(
        height - y,
        Math.round(clamp(crop?.height ?? 1, 1 / height, 1) * height),
      ),
    ),
  };
}
export function targetSize(
  source: { width: number; height: number },
  s: Settings,
) {
  let width = source.width,
    height = source.height;
  if (s.resize === "fit") {
    const k = Math.min(
      s.width / width,
      s.height / height,
      s.upscale ? Infinity : 1,
    );
    width *= k;
    height *= k;
  } else if (s.resize === "percentage") {
    const k = Math.min(s.percentage / 100, s.upscale ? Infinity : 1);
    width *= k;
    height *= k;
  } else if (s.resize === "width") {
    const k = Math.min(s.width / width, s.upscale ? Infinity : 1);
    width *= k;
    height *= k;
  } else if (s.resize === "height") {
    const k = Math.min(s.height / height, s.upscale ? Infinity : 1);
    width *= k;
    height *= k;
  } else if (["exact", "crop", "pad"].includes(s.resize)) {
    width = s.width;
    height = s.height;
    if (s.resize === "exact" && !s.upscale) {
      const k = Math.min(source.width / width, source.height / height, 1);
      width *= k;
      height *= k;
    }
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  checkDimensions(width, height);
  return { width, height };
}
export function anchor(position: string) {
  return {
    x: position.includes("left") ? 0 : position.includes("right") ? 1 : 0.5,
    y: position.includes("top") ? 0 : position.includes("bottom") ? 1 : 0.5,
  };
}
export function drawRect(
  source: { width: number; height: number },
  width: number,
  height: number,
  s: Settings,
) {
  if (s.resize !== "crop" && s.resize !== "pad")
    return { x: 0, y: 0, width, height };
  let scale = (s.resize === "crop" ? Math.max : Math.min)(
    width / source.width,
    height / source.height,
  );
  if (!s.upscale) scale = Math.min(scale, 1);
  const a = anchor(s.anchor),
    w = source.width * scale,
    h = source.height * scale;
  return { x: (width - w) * a.x, y: (height - h) * a.y, width: w, height: h };
}
