import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public/runtime", { recursive: true });
for (const file of [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
])
  await copyFile(
    "node_modules/onnxruntime-web/dist/" + file,
    "public/runtime/" + file,
  );

await copyFile(
  "public/models/LICENSE-ONNXRuntime.txt",
  "public/runtime/LICENSE.txt",
);
