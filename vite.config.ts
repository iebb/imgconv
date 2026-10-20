import { defineConfig } from "vite";
export default defineConfig({
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@jsquash/avif", "onnxruntime-web"] },
});
