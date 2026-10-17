import type { Issue } from './errors';
export type Format = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff';
export type ResizeMode = 'original' | 'fit' | 'percentage' | 'exact';
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
}
export interface ImageInfo { width: number; height: number; thumbnail: Blob; }
export interface ConversionResult extends ImageInfo {
  blob: Blob;
  quality: number;
  reduced: boolean;
}
export type WorkerRequest = { id: number; action: 'inspect'; file: File } |
  { id: number; action: 'convert'; file: File; settings: Settings };
export type WorkerReply = { id: number; ok: true; result: ImageInfo | ConversionResult } |
  { id: number; ok: false; error: Issue };
