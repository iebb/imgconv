import { AppError } from "./errors";
import { checkDimensions } from "./geometry";
type Ort = typeof import("onnxruntime-web/wasm");
let runtime: Promise<Ort> | undefined;
const sessions = new Map<
  string,
  Promise<import("onnxruntime-web").InferenceSession>
>();
function ort() {
  return (runtime ??= (async () => {
    const module = await import("onnxruntime-web/wasm");
    module.env.wasm.numThreads = 1;
    module.env.wasm.proxy = false;
    module.env.wasm.wasmPaths = {
      wasm: new URL(
        "/runtime/ort-wasm-simd-threaded.wasm",
        self.location.origin,
      ).href,
      mjs: new URL("/runtime/ort-wasm-simd-threaded.mjs", self.location.origin)
        .href,
    };
    return module;
  })());
}
async function session(name: string) {
  if (!sessions.has(name))
    sessions.set(
      name,
      (async () => {
        const module = await ort();
        return module.InferenceSession.create("/models/" + name + ".onnx", {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        });
      })(),
    );
  try {
    return await sessions.get(name)!;
  } catch (error) {
    sessions.delete(name);
    throw error;
  }
}
export async function removeBackground(source: OffscreenCanvas) {
  try {
    const module = await ort(),
      model = await session("u2netp");
    const small = new OffscreenCanvas(320, 320),
      ctx = small.getContext("2d")!;
    ctx.drawImage(source, 0, 0, 320, 320);
    const image = ctx.getImageData(0, 0, 320, 320).data,
      plane = 320 * 320,
      input = new Float32Array(plane * 3);
    let max = 1;
    for (let i = 0; i < image.length; i += 4)
      for (let c = 0; c < 3; c++) max = Math.max(max, image[i + c]);
    const mean = [0.485, 0.456, 0.406],
      std = [0.229, 0.224, 0.225];
    for (let i = 0; i < plane; i++)
      for (let c = 0; c < 3; c++)
        input[c * plane + i] = (image[i * 4 + c] / max - mean[c]) / std[c];
    const output = await model.run({
      [model.inputNames[0]]: new module.Tensor(
        "float32",
        input,
        [1, 3, 320, 320],
      ),
    });
    const mask = output[model.outputNames[0]].data as Float32Array;
    let min = Infinity,
      high = -Infinity;
    for (const v of mask) {
      min = Math.min(min, v);
      high = Math.max(high, v);
    }
    const rgba = new Uint8ClampedArray(plane * 4);
    for (let i = 0; i < plane; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = Math.round(
        ((mask[i] - min) / Math.max(1e-6, high - min)) * 255,
      );
    }
    ctx.putImageData(new ImageData(rgba, 320, 320), 0, 0);
    const expanded = new OffscreenCanvas(source.width, source.height),
      ec = expanded.getContext("2d")!;
    ec.drawImage(small, 0, 0, source.width, source.height);
    const original = source
        .getContext("2d")!
        .getImageData(0, 0, source.width, source.height),
      alpha = ec.getImageData(0, 0, source.width, source.height).data;
    for (let i = 0; i < original.data.length; i += 4)
      original.data[i + 3] = Math.round(
        (original.data[i + 3] * alpha[i + 3]) / 255,
      );
    source.getContext("2d")!.putImageData(original, 0, 0);
    return source;
  } catch {
    throw new AppError("errorAI");
  }
}
export async function enhance(source: OffscreenCanvas, factor: number) {
  checkDimensions(source.width * factor, source.height * factor);
  // Keep CPU inference bounded on phones; never substitute ordinary scaling for AI.
  if (source.width * source.height > 4_000_000) throw new AppError("errorAI");
  try {
    const module = await ort(),
      model = await session("realesr-general-x4v3");
    const target = new OffscreenCanvas(
        source.width * factor,
        source.height * factor,
      ),
      ctx = target.getContext("2d")!;
    const tile = 128,
      pad = 12;
    for (let y = 0; y < source.height; y += tile)
      for (let x = 0; x < source.width; x += tile) {
        const x0 = Math.max(0, x - pad),
          y0 = Math.max(0, y - pad),
          x1 = Math.min(source.width, x + tile + pad),
          y1 = Math.min(source.height, y + tile + pad);
        const w = x1 - x0,
          h = y1 - y0,
          small = new OffscreenCanvas(w, h),
          sc = small.getContext("2d")!;
        sc.drawImage(source, -x0, -y0);
        const pixels = sc.getImageData(0, 0, w, h).data,
          plane = w * h,
          input = new Float32Array(plane * 3);
        for (let i = 0; i < plane; i++)
          for (let c = 0; c < 3; c++)
            input[c * plane + i] = pixels[i * 4 + c] / 255;
        const out = await model.run({
          [model.inputNames[0]]: new module.Tensor("float32", input, [
            1,
            3,
            h,
            w,
          ]),
        });
        const tensor = out[model.outputNames[0]],
          values = tensor.data as Float32Array,
          ow = w * 4,
          oh = h * 4,
          op = ow * oh,
          rgba = new Uint8ClampedArray(op * 4);
        for (let i = 0; i < op; i++) {
          for (let c = 0; c < 3; c++)
            rgba[i * 4 + c] = Math.round(
              Math.max(0, Math.min(1, values[c * op + i])) * 255,
            );
          rgba[i * 4 + 3] = 255;
        }
        const result = new OffscreenCanvas(ow, oh),
          rc = result.getContext("2d")!;
        rc.putImageData(new ImageData(rgba, ow, oh), 0, 0);
        // Preserve transparency independently of the RGB model.
        rc.globalCompositeOperation = "destination-in";
        rc.drawImage(small, 0, 0, ow, oh);
        rc.globalCompositeOperation = "source-over";
        const cw = Math.min(tile, source.width - x),
          ch = Math.min(tile, source.height - y);
        ctx.drawImage(
          result,
          (x - x0) * 4,
          (y - y0) * 4,
          cw * 4,
          ch * 4,
          x * factor,
          y * factor,
          cw * factor,
          ch * factor,
        );
      }
    return target;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errorAI");
  }
}
