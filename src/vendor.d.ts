declare module 'gifenc' {
  export function quantize(data: Uint8ClampedArray, colors: number, options?: Record<string, unknown>): number[][];
  export function applyPalette(data: Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
  export function GIFEncoder(): { writeFrame(data: Uint8Array, width: number, height: number, options: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array<ArrayBuffer> };
}
declare module 'utif' {
  interface IFD { width: number; height: number; [key: string]: any }
  const UTIF: { decode(buffer: ArrayBuffer): IFD[]; decodeImage(buffer: ArrayBuffer, ifd: IFD): void; toRGBA8(ifd: IFD): Uint8Array<ArrayBuffer>; encodeImage(data: ArrayBuffer, width: number, height: number): ArrayBuffer };
  export default UTIF;
}
declare module 'heic-to/next' {
  export function heicTo(options: { blob: Blob; type: 'bitmap'; options?: ImageBitmapOptions }): Promise<ImageBitmap>;
}
interface ImportMeta { env: { DEV: boolean; BASE_URL: string } }
