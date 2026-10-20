import { readSequence } from "../src/animation";
(globalThis as any).ImageDecoder = undefined;
self.onmessage = async ({ data }) => {
  try {
    const sequence = await readSequence(data, true);
    self.postMessage({
      ok: true,
      total: sequence.total,
      plays: sequence.plays,
      delays: sequence.delays,
      pixels: sequence.frames.map((c) =>
        Array.from(c.getContext("2d")!.getImageData(5, 5, 1, 1).data),
      ),
    });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
