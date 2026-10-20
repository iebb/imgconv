import { icon } from "./icons";
import { t, number, type MessageKey } from "./i18n";
import type { ConversionResult, Crop, ImageInfo, PreviewResult } from "./types";
const tr = (key: MessageKey) => `<span data-i18n="${key}">${t(key)}</span>`;
const aria = (key: MessageKey) =>
  `aria-label="${t(key)}" data-i18n-aria="${key}"`;
interface PreviewJob {
  id: number;
  file: File;
  info?: ImageInfo;
  result?: ConversionResult;
  outputUrl?: string;
  outputName?: string;
  originalPreview?: string;
  resultPreview?: string;
  crop?: Crop;
}
interface Options {
  getJob: (id: number) => PreviewJob | undefined;
  load: (file: File) => Promise<PreviewResult>;
  crop: (id: number, crop?: Crop) => void;
  download: (id: number) => void;
  error: () => void;
}
export function previewMarkup() {
  return `
<dialog id="preview-dialog" class="dialog preview-dialog">
 <div class="preview-header"><div><p class="eyebrow">${tr("selected")}</p><h2 id="preview-title" dir="auto"></h2><p id="preview-description"></p></div><button class="icon-button" data-close="preview-dialog" ${aria("closePreview")}>${icon("close")}</button></div>
 <div class="preview-toolbar"><div class="preview-tabs"><button id="preview-original">${tr("original")}</button><button id="preview-result">${tr("converted")}</button><button id="preview-compare">${tr("compare")}</button></div><div class="zoom-controls"><button id="preview-fit" class="text-button">${tr("previewFit")}</button><button id="preview-actual" class="text-button">${tr("previewActual")}</button><label class="sr-only" for="preview-zoom">${tr("zoom")}</label><input id="preview-zoom" type="range" min="10" max="400" value="100"/><output id="preview-zoom-value">100%</output></div></div>
 <div id="preview-loading" class="preview-loading"><span class="spinner"></span>${tr("previewLoading")}</div>
 <div class="preview-viewport checkerboard" id="preview-viewport"><div class="compare-stage" id="compare-stage"><img id="preview-before" alt="" draggable="false"/><img id="preview-image" alt="" draggable="false"/><span class="compare-line" id="compare-line"></span></div></div>
 <label class="comparison-control" id="comparison-control"><span>${tr("comparisonSplit")}</span><input id="comparison-split" type="range" min="0" max="100" value="50"/></label>
 <div class="preview-footer"><div><p>${tr("previewHelp")}</p><p id="preview-animation-note" hidden>${tr("previewAnimated")}</p></div><button class="button button-outline" id="preview-download">${icon("download")}${tr("downloadImage")}</button></div>
</dialog>
<dialog id="crop-dialog" class="dialog crop-dialog">
 <div class="preview-header"><div><p class="eyebrow">${tr("cropImage")}</p><h2>${tr("cropTitle")}</h2><p>${tr("cropHelp")}</p></div><button class="icon-button" data-close="crop-dialog" ${aria("closePreview")}>${icon("close")}</button></div>
 <div class="crop-workspace checkerboard"><div class="crop-stage" id="crop-stage"><img id="crop-source" alt="" draggable="false"/><div class="crop-selection" id="crop-selection"><span class="crop-handle"></span></div></div></div>
 <div class="crop-fields">${(
   [
     ["x", "cropX"],
     ["y", "cropY"],
     ["width", "cropWidth"],
     ["height", "cropHeight"],
   ] as [string, MessageKey][]
 )
   .map(
     ([id, key]) =>
       `<label class="form-field" for="crop-${id}">${tr(key)}<input type="number" id="crop-${id}" min="0" max="100" step=".1"/></label>`,
   )
   .join("")}</div>
 <div class="preview-footer"><button class="text-button" id="crop-reset">${tr("resetCrop")}</button><button class="button button-primary" id="crop-apply">${tr("applyCrop")}</button></div>
</dialog>`;
}
export function setupPreview(options: Options) {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  let current: number | null = null,
    mode: "original" | "result" | "compare" = "original",
    zoom: "fit" | number = "fit",
    token = 0,
    cropId: number | null = null;
  let selection: Crop = { x: 0, y: 0, width: 1, height: 1 };
  const preview = $<HTMLDialogElement>("#preview-dialog"),
    cropDialog = $<HTMLDialogElement>("#crop-dialog");
  async function full(job: PreviewJob, converted = false) {
    const key = converted ? "resultPreview" : "originalPreview";
    if (job[key]) return job[key]!;
    const file = converted
      ? new File([job.result!.blob], job.outputName!, {
          type: job.result!.blob.type,
        })
      : job.file;
    const data = await options.load(file);
    return (job[key] = URL.createObjectURL(data.blob));
  }
  function layout() {
    const job = current === null ? undefined : options.getJob(current);
    if (!job?.info) return;
    const info = mode === "original" || !job.result ? job.info : job.result,
      viewport = $("#preview-viewport");
    const scale =
      zoom === "fit"
        ? Math.min(
            (viewport.clientWidth - 32) / info.width,
            Math.max(180, window.innerHeight * 0.55) / info.height,
            1,
          )
        : zoom / 100;
    const stage = $("#compare-stage");
    stage.style.width = Math.max(1, Math.round(info.width * scale)) + "px";
    stage.style.height = Math.max(1, Math.round(info.height * scale)) + "px";
    $("#preview-zoom-value").textContent =
      number(Math.round(scale * 100)) + "%";
    $<HTMLInputElement>("#preview-zoom").value = String(
      Math.max(10, Math.min(400, scale * 100)),
    );
  }
  function paint() {
    const job = current === null ? undefined : options.getJob(current);
    if (!job?.info) return;
    $("#preview-title").textContent =
      mode !== "original" && job.outputName ? job.outputName : job.file.name;
    const data = mode === "original" || !job.result ? job.info : job.result;
    $("#preview-description").textContent =
      number(data.width) +
      " × " +
      number(data.height) +
      " " +
      t("pixel") +
      (data.frames > 1 ? " · " + t("frames", { count: data.frames }) : "");
    const before = $<HTMLImageElement>("#preview-before"),
      after = $<HTMLImageElement>("#preview-image");
    before.src = job.originalPreview || "";
    after.src =
      mode === "result" && job.result && job.result.frames > 1
        ? job.outputUrl!
        : job.resultPreview || job.originalPreview || "";
    before.alt = job.file.name;
    after.alt = job.outputName || job.file.name;
    before.hidden = mode === "result";
    after.hidden = mode === "original";
    const split = Number($<HTMLInputElement>("#comparison-split").value);
    after.style.clipPath =
      mode === "compare" ? "inset(0 " + (100 - split) + "% 0 0)" : "none";
    $("#compare-line").hidden = mode !== "compare";
    $("#compare-line").style.left = split + "%";
    $("#comparison-control").hidden = mode !== "compare";
    for (const [id, value] of [
      ["preview-original", "original"],
      ["preview-result", "result"],
      ["preview-compare", "compare"],
    ])
      $("#" + id).classList.toggle("selected", mode === value);
    $<HTMLButtonElement>("#preview-result").disabled = !job.result;
    $<HTMLButtonElement>("#preview-compare").disabled = !job.result;
    $("#preview-download").hidden = !job.result;
    $("#preview-animation-note").hidden = !(
      job.result && job.result.frames > 1
    );
    layout();
  }
  async function open(id: number, converted = false) {
    const job = options.getJob(id);
    if (!job?.info) return;
    current = id;
    mode = converted && job.result ? "compare" : "original";
    zoom = "fit";
    const request = ++token;
    $("#preview-loading").hidden = false;
    $("#preview-viewport").hidden = true;
    if (!preview.open) preview.showModal();
    $("#preview-title").textContent = job.file.name;
    try {
      await full(job);
      if (job.result) await full(job, true);
      if (request !== token || !preview.open) return;
      $("#preview-loading").hidden = true;
      $("#preview-viewport").hidden = false;
      paint();
    } catch {
      if (request === token) {
        preview.close();
        options.error();
      }
    }
  }
  for (const [id, value] of [
    ["preview-original", "original"],
    ["preview-result", "result"],
    ["preview-compare", "compare"],
  ] as const)
    $("#" + id).addEventListener("click", () => {
      mode = value;
      zoom = "fit";
      paint();
    });
  $("#preview-fit").addEventListener("click", () => {
    zoom = "fit";
    layout();
  });
  $("#preview-actual").addEventListener("click", () => {
    zoom = 100;
    layout();
  });
  $("#preview-zoom").addEventListener("input", () => {
    zoom = Number($<HTMLInputElement>("#preview-zoom").value);
    layout();
  });
  $("#comparison-split").addEventListener("input", paint);
  $("#preview-download").addEventListener("click", () => {
    if (current !== null) options.download(current);
  });
  preview.addEventListener("close", () => {
    token++;
  });
  window.addEventListener("resize", () => {
    if (preview.open) layout();
  });
  const viewport = $("#preview-viewport");
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  viewport.addEventListener("pointerdown", (event) => {
    pan = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (pan) {
      viewport.scrollLeft = pan.left + pan.x - event.clientX;
      viewport.scrollTop = pan.top + pan.y - event.clientY;
    }
  });
  viewport.addEventListener("pointerup", () => {
    pan = null;
  });
  viewport.addEventListener("pointercancel", () => {
    pan = null;
  });
  const stage = $("#crop-stage");
  function cropPaint() {
    const overlay = $("#crop-selection");
    overlay.style.left = selection.x * 100 + "%";
    overlay.style.top = selection.y * 100 + "%";
    overlay.style.width = selection.width * 100 + "%";
    overlay.style.height = selection.height * 100 + "%";
    for (const key of ["x", "y", "width", "height"] as const)
      $<HTMLInputElement>("#crop-" + key).value = String(
        Math.round(selection[key] * 1000) / 10,
      );
  }
  async function crop(id: number) {
    const job = options.getJob(id);
    if (!job?.info) return;
    cropId = id;
    selection = job.crop
      ? { ...job.crop }
      : { x: 0, y: 0, width: 1, height: 1 };
    try {
      const url = await full(job);
      $<HTMLImageElement>("#crop-source").src = url;
      $<HTMLImageElement>("#crop-source").alt = job.file.name;
      stage.style.aspectRatio = job.info.width + " / " + job.info.height;
      stage.style.width =
        Math.min(
          900,
          window.innerWidth - 80,
          (window.innerHeight * 0.55 * job.info.width) / job.info.height,
        ) + "px";
      cropPaint();
      if (!cropDialog.open) cropDialog.showModal();
    } catch {
      options.error();
    }
  }
  let gesture: {
    type: "draw" | "move" | "resize";
    x: number;
    y: number;
    start: Crop;
  } | null = null;
  const point = (event: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  };
  stage.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const p = point(event),
      target = event.target as HTMLElement;
    gesture = {
      type: target.closest(".crop-handle")
        ? "resize"
        : target.closest(".crop-selection") &&
            !(
              selection.x === 0 &&
              selection.y === 0 &&
              selection.width === 1 &&
              selection.height === 1
            )
          ? "move"
          : "draw",
      ...p,
      start: { ...selection },
    };
    if (gesture.type === "draw")
      selection = { ...p, width: 0.001, height: 0.001 };
    stage.setPointerCapture(event.pointerId);
    cropPaint();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!gesture) return;
    const p = point(event),
      g = gesture;
    if (g.type === "move")
      selection = {
        ...g.start,
        x: Math.max(0, Math.min(1 - g.start.width, g.start.x + p.x - g.x)),
        y: Math.max(0, Math.min(1 - g.start.height, g.start.y + p.y - g.y)),
      };
    else if (g.type === "resize")
      selection = {
        ...g.start,
        width: Math.max(
          0.001,
          Math.min(1 - g.start.x, g.start.width + p.x - g.x),
        ),
        height: Math.max(
          0.001,
          Math.min(1 - g.start.y, g.start.height + p.y - g.y),
        ),
      };
    else
      selection = {
        x: Math.min(g.x, p.x),
        y: Math.min(g.y, p.y),
        width: Math.max(0.001, Math.abs(g.x - p.x)),
        height: Math.max(0.001, Math.abs(g.y - p.y)),
      };
    cropPaint();
  });
  stage.addEventListener("pointerup", () => {
    gesture = null;
  });
  stage.addEventListener("pointercancel", () => {
    gesture = null;
  });
  for (const key of ["x", "y", "width", "height"] as const)
    $<HTMLInputElement>("#crop-" + key).addEventListener("input", () => {
      const val = Number($<HTMLInputElement>("#crop-" + key).value);
      if (!Number.isFinite(val)) return;
      selection[key] = Math.max(
        key === "width" || key === "height" ? 0.001 : 0,
        Math.min(1, val / 100),
      );
      selection.x = Math.min(selection.x, 1 - 0.001);
      selection.y = Math.min(selection.y, 1 - 0.001);
      selection.width = Math.min(selection.width, 1 - selection.x);
      selection.height = Math.min(selection.height, 1 - selection.y);
      cropPaint();
    });
  $("#crop-reset").addEventListener("click", () => {
    selection = { x: 0, y: 0, width: 1, height: 1 };
    cropPaint();
  });
  $("#crop-apply").addEventListener("click", () => {
    if (cropId !== null)
      options.crop(
        cropId,
        selection.x === 0 &&
          selection.y === 0 &&
          selection.width === 1 &&
          selection.height === 1
          ? undefined
          : selection,
      );
    cropDialog.close();
  });
  return {
    open,
    crop,
    localize: () => {
      if (preview.open) paint();
    },
  };
}
