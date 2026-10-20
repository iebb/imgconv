import type { Issue } from "./errors";
export type Format =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "bmp"
  | "tiff"
  | "avif"
  | "apng";
export type ResizeMode =
  | "original"
  | "fit"
  | "percentage"
  | "exact"
  | "crop"
  | "pad"
  | "width"
  | "height";
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Position =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";
export interface Settings {
  format: Format;
  quality: number;
  resize: ResizeMode;
  width: number;
  height: number;
  percentage: number;
  upscale: boolean;
  maxBytes: number | null;
  autoResize: boolean;
  background: string;
  suffix: string;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  anchor: Position;
  transparentPadding: boolean;
  pngColors: number;
  animation: "preserve" | "first";
  watermark: "none" | "text" | "image";
  watermarkText: string;
  watermarkColor: string;
  watermarkOpacity: number;
  watermarkSize: number;
  watermarkPosition: Position;
  watermarkImage?: File;
  namePattern: string;
  prefix: string;
  startNumber: number;
  numberPadding: number;
  keepFolders: boolean;
  removeBackground: boolean;
  enhance: "none" | "2x" | "4x";
}
export interface ImageInfo {
  width: number;
  height: number;
  thumbnail: Blob;
  frames: number;
}
export interface ConversionResult extends ImageInfo {
  blob: Blob;
  quality: number;
  reduced: boolean;
}
export interface PreviewResult {
  blob: Blob;
  width: number;
  height: number;
}
export type WorkerRequest =
  | { id: number; action: "inspect" | "preview"; file: File }
  | {
      id: number;
      action: "convert";
      file: File;
      settings: Settings;
      crop?: Crop;
    };
export type WorkerReply =
  | {
      id: number;
      ok: true;
      result: ImageInfo | ConversionResult | PreviewResult;
    }
  | { id: number; ok: false; error: Issue };
