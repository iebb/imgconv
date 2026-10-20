import "./style.css";
import { icon } from "./icons";
import {
  defaults,
  cleanSettings,
  serializableSettings,
  encodeSettings,
  decodeSettings,
  outputName,
  safeFolders,
  extensions,
} from "./settings";
import { presetMarkup, settingsMarkup } from "./controls";
import { previewMarkup, setupPreview } from "./preview";
import { writeToFolder } from "./folder";
import {
  detectLocale,
  getLocale,
  languageInfo,
  languages,
  number,
  setLocale,
  t,
  type Locale,
  type MessageKey,
  type Params,
} from "./i18n";
import { AppError, issue, type Issue } from "./errors";
import type {
  ConversionResult,
  Crop,
  Format,
  ImageInfo,
  PreviewResult,
  Settings,
  WorkerReply,
} from "./types";

interface Job {
  id: number;
  file: File;
  info?: ImageInfo;
  thumbnail?: string;
  status: "loading" | "ready" | "processing" | "done" | "error";
  crop?: Crop;
  originalPreview?: string;
  resultPreview?: string;
  error?: Issue;
  result?: ConversionResult;
  outputUrl?: string;
  outputThumbnail?: string;
  outputName?: string;
}
const app = document.querySelector<HTMLDivElement>("#app")!;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let savedLanguage: string | null = null;
try {
  savedLanguage = localStorage.getItem("resz-language");
} catch {
  /* Storage can be unavailable in private browsing. */
}
setLocale(
  detectLocale(
    new URL(location.href).searchParams.get("lang"),
    savedLanguage,
    navigator.languages,
  ),
);
const tr = (key: MessageKey) =>
  `<span data-i18n="${key}">${escape(t(key))}</span>`;
const aria = (key: MessageKey) =>
  `aria-label="${escape(t(key))}" data-i18n-aria="${key}"`;
const option = (value: string, key: MessageKey) =>
  `<option value="${value}" data-i18n="${key}">${escape(t(key))}</option>`;
const bytes = (value: number) =>
  value < 1000
    ? `${number(value)} ${t("unitBytes")}`
    : value < 1e6
      ? `${number(value / 1000, value < 10000 ? 1 : 0)} KB`
      : `${number(value / 1e6, 1)} MB`;
const dimensions = (width: number, height: number) =>
  `<bdi dir="ltr">${number(width)} × ${number(height)}</bdi> ${escape(t("pixel"))}`;
const formatKeys: Record<Format, MessageKey> = {
  jpeg: "formatJpeg",
  png: "formatPng",
  webp: "formatWebp",
  gif: "formatGif",
  bmp: "formatBmp",
  tiff: "formatTiff",
  avif: "formatAvif",
  apng: "formatApng",
};
const statusKeys: Record<Job["status"], MessageKey> = {
  loading: "statusLoading",
  ready: "statusReady",
  processing: "statusProcessing",
  done: "statusDone",
  error: "statusError",
};
let jobs: Job[] = [],
  nextJobId = 0,
  busy = false,
  importing = false,
  cancelled = false,
  requestId = 0;
let zipBusy = false,
  sampleBusy = false;
let progressState = { current: 0, total: 0, completed: 0 };
let worker: Worker;
const pending = new Map<
  number,
  {
    resolve: (result: ImageInfo | ConversionResult | PreviewResult) => void;
    reject: (error: Error) => void;
  }
>();
function startWorker() {
  worker = new Worker(new URL("./image.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const message = event.data,
      handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.ok) handler.resolve(message.result);
    else handler.reject(new AppError(message.error.code, message.error.params));
  };
  worker.onerror = () => {
    for (const handler of pending.values())
      handler.reject(new AppError("errorWorker"));
    pending.clear();
    worker.terminate();
    startWorker();
  };
}
type WorkerInput =
  | { action: "inspect" | "preview"; file: File }
  | { action: "convert"; file: File; settings: Settings; crop?: Crop };
function callWorker(request: WorkerInput) {
  return new Promise<ImageInfo | ConversionResult | PreviewResult>(
    (resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id });
    },
  );
}
startWorker();

app.innerHTML = `
<header class="site-header">
  <a class="brand" href="./" ${aria("home")}><span class="brand-mark">${icon("images", 25)}</span><bdi dir="ltr">resz<span class="brand-dot">.im</span></bdi><span class="brand-caption">${tr("brandCaption")}</span></a>
  <div class="header-right"><span class="local-status"><span class="status-dot"></span>${tr("localOnly")}</span><label class="language-picker">${icon("globe")}<span class="sr-only">${tr("language")}</span><select id="language" ${aria("language")}>${languages.map((language) => `<option value="${language.code}" lang="${language.code}" dir="${language.direction}">${language.name}</option>`).join("")}</select></label><button class="icon-button help-button" id="help-button" ${aria("about")}>${icon("info")}</button></div>
</header>
<main class="page">
  <div class="intro"><div><p class="eyebrow">${tr("eyebrow")}</p><h1>${tr("heroTitle")}</h1><p class="intro-copy">${tr("heroSubtitle")}</p></div><div class="intro-note">${icon("shield", 26)}<span>${tr("noUpload")}<br><strong>${tr("browserOnly")}</strong></span></div></div>
  ${presetMarkup()}
  <div class="workspace">
    <section class="image-workspace" ${aria("workspace")}>
      <div class="section-heading"><div class="section-label"><span class="step" aria-hidden="true">01</span><h2>${tr("images")}</h2><span class="count-badge" id="file-count">0</span></div><div class="workspace-actions"><button class="text-button" id="clear-button" hidden>${tr("clearAll")}</button><button class="button button-small button-outline" id="add-button">${icon("plus")} ${tr("addImages")}</button><button class="button button-small folder-add" id="add-folder">${icon("folder")} ${tr("folder")}</button></div></div>
      <input type="file" id="folder-input" multiple webkitdirectory hidden/><input type="file" id="file-input" multiple accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp" hidden />
      <div class="dropzone" id="dropzone" role="button" tabindex="0" ${aria("chooseImages")}>
        <div class="image-stack" aria-hidden="true"><div class="art-card art-back"></div><div class="art-card art-middle"></div><div class="art-card art-front"><svg viewBox="0 0 176 128"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#e5edda"/><stop offset="1" stop-color="#cbd6bf"/></linearGradient></defs><rect width="176" height="128" fill="url(#sky)"/><circle cx="127" cy="33" r="14" fill="#f8f2c9"/><path d="M0 100 59 40l65 88H0Z" fill="#85957a"/><path d="m59 40-18 45 18-10 22 22Z" fill="#e9eadb"/><path d="m57 128 60-69 59 61v8Z" fill="#4a6750"/><path d="m117 59-19 40 20-9 17 17Z" fill="#bccbb0"/><path d="M0 115q39-10 75 3t101-6v16H0Z" fill="#304d39"/></svg></div><span class="stack-plus">${icon("plus")}</span></div>
        <h3>${tr("dropTitle")}</h3><p>${tr("dropLead")} <span class="inline-link">${tr("browseFiles")}</span></p><span class="supported">${tr("supported")}</span><span class="drop-caption">${tr("dropCaption")}</span><span class="paste-hint">${tr("pasteHint")}</span>
      </div>
      <div class="batch-toolbar" id="batch-toolbar" hidden><span id="batch-description"></span><span class="view-label">${icon("grid", 18)} ${tr("gridView")}</span></div>
      <div class="image-grid" id="image-grid"></div>
      <div class="progress-panel" id="progress-panel" hidden><div><span id="progress-label"></span><button class="text-button" id="cancel-button">${tr("cancel")}</button></div><progress id="progress-bar" max="100" value="0" ${aria("statusProcessing")}></progress></div>
      <div class="batch-summary" id="batch-summary" hidden></div>
      <div class="sample-row" id="sample-row"><span>${tr("samplePrompt")}</span><button class="text-button" id="sample-button">${tr("sampleButton")} ${icon("arrow", 18)}</button></div>
      <div class="privacy-card">${icon("lock", 24)}<div><strong>${tr("privacyTitle")}</strong><p>${tr("privacyBody")}</p></div><span class="privacy-check">${icon("check", 20)}</span></div>
      <div class="how-it-works"><div><span aria-hidden="true">01</span><strong>${tr("stepImport")}</strong><p>${tr("stepImportHint")}</p></div><div><span aria-hidden="true">02</span><strong>${tr("stepAdjust")}</strong><p>${tr("stepAdjustHint")}</p></div><div><span aria-hidden="true">03</span><strong>${tr("stepExport")}</strong><p>${tr("stepExportHint")}</p></div></div>
    </section>
    ${settingsMarkup()}
  </div>
  <footer><span>${tr("footer")}</span><span class="footer-local">${icon("leaf", 20)} ${tr("footerLocal")}</span></footer>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="about-dialog" class="dialog about-dialog"><button class="icon-button dialog-close" data-close="about-dialog" ${aria("closeAbout")}>${icon("close")}</button><span class="brand-mark">${icon("images", 25)}</span><h2>${tr("aboutTitle")}</h2><p>${tr("aboutPrivacy")}</p><p>${tr("aboutFormats")}</p><p>${tr("aboutLimits")}</p><p>${tr("aboutColor")}</p><p>${tr("aboutSession")}</p><p><a href="https://github.com/iebb/imgconv" target="_blank" rel="noopener noreferrer">${tr("source")} ↗</a></p></dialog>
${previewMarkup()}`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
let format: Format = "jpeg",
  toastTimer: ReturnType<typeof setTimeout>;
let currentToast: { key: MessageKey; params: Params } | null = null;
function translatedParams(params: Params): Params {
  return typeof params.field === "string"
    ? { ...params, field: t(params.field as MessageKey) }
    : params;
}
function toast(key: MessageKey, params: Params = {}) {
  currentToast = { key, params };
  clearTimeout(toastTimer);
  $("#toast").textContent = t(key, translatedParams(params));
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
    currentToast = null;
  }, 6500);
}
function errorText(error: Issue) {
  return t(error.code, translatedParams(error.params));
}
function applyLanguage() {
  document.documentElement.lang = getLocale();
  document.documentElement.dir = languageInfo().direction;
  document.title = t("appTitle");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", t("metaDescription"));
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    element.textContent = t(element.dataset.i18n as MessageKey);
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-i18n-aria]",
  ))
    element.setAttribute(
      "aria-label",
      t(element.dataset.i18nAria as MessageKey),
    );
  for (const element of document.querySelectorAll<HTMLInputElement>(
    "[data-i18n-placeholder]",
  ))
    element.placeholder = t(element.dataset.i18nPlaceholder as MessageKey);
  $<HTMLSelectElement>("#language").value = getLocale();
  if (currentToast)
    $("#toast").textContent = t(
      currentToast.key,
      translatedParams(currentToast.params),
    );
  render();
  viewer?.localize();
  refreshPresetOptions();
}
function validNumber(id: string, field: MessageKey, min: number, max: number) {
  const value = Number(input(id).value);
  if (
    !input(id).value ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new AppError("invalidNumber", { field, min, max });
  return value;
}
let logoFile: File | undefined;
const fields: Record<string, keyof Settings> = {
  rotation: "rotation",
  "flip-x": "flipX",
  "flip-y": "flipY",
  anchor: "anchor",
  "transparent-padding": "transparentPadding",
  "png-colors": "pngColors",
  animation: "animation",
  watermark: "watermark",
  "watermark-text": "watermarkText",
  "watermark-color": "watermarkColor",
  "watermark-position": "watermarkPosition",
  "name-pattern": "namePattern",
  prefix: "prefix",
  "start-number": "startNumber",
  "number-padding": "numberPadding",
  "keep-folders": "keepFolders",
  "remove-background": "removeBackground",
  enhance: "enhance",
};
function settings(): Settings {
  const resize = $<HTMLSelectElement>("#resize").value as Settings["resize"];
  const width = ["fit", "exact", "crop", "pad", "width"].includes(resize)
    ? validNumber("width", "width", 1, 32767)
    : 1920;
  const height = ["fit", "exact", "crop", "pad", "height"].includes(resize)
    ? validNumber("height", "height", 1, 32767)
    : 1080;
  const percentage =
    resize === "percentage"
      ? validNumber("percentage", "scalePercentage", 1, 400)
      : 50;
  const maxBytes = input("limit-enabled").checked
    ? validNumber("max-size", "maxSize", 1, 1e9) *
      Number($<HTMLSelectElement>("#size-unit").value)
    : null;
  const extra: Record<string, unknown> = {};
  for (const [id, key] of Object.entries(fields)) {
    const el = $<HTMLInputElement>("#" + id);
    extra[key] =
      el.type === "checkbox"
        ? el.checked
        : typeof defaults[key] === "number"
          ? Number(el.value)
          : el.value;
  }
  extra.startNumber = validNumber("start-number", "numbering", 0, 999999999);
  extra.numberPadding = validNumber("number-padding", "digits", 1, 9);
  return {
    ...defaults,
    ...extra,
    format,
    quality: Number(input("quality").value) / 100,
    resize,
    width,
    height,
    percentage,
    maxBytes,
    autoResize: input("auto-resize").checked,
    upscale: input("upscale").checked,
    background: input("background").value,
    suffix: input("suffix").value,
    watermarkOpacity: Number(input("watermark-opacity").value) / 100,
    watermarkSize: Number(input("watermark-size").value) / 100,
    watermarkImage: logoFile,
  } as Settings;
}
function applySettings(s: Settings) {
  markCustom();
  format = s.format;
  for (const [id, key] of Object.entries(fields)) {
    const el = $<HTMLInputElement>("#" + id);
    if (el.type === "checkbox") el.checked = Boolean(s[key]);
    else el.value = String(s[key]);
  }
  for (const [id, key] of [
    ["resize", "resize"],
    ["width", "width"],
    ["height", "height"],
    ["percentage", "percentage"],
    ["background", "background"],
    ["suffix", "suffix"],
  ] as const)
    input(id).value = String(s[key]);
  input("quality").value = String(s.quality * 100);
  input("watermark-opacity").value = String(s.watermarkOpacity * 100);
  input("watermark-size").value = String(s.watermarkSize * 100);
  input("limit-enabled").checked = s.maxBytes !== null;
  $<HTMLSelectElement>("#size-unit").value = "1";
  input("max-size").value = String(s.maxBytes || 500000);
  input("upscale").checked = s.upscale;
  input("auto-resize").checked = s.autoResize;
  invalidate();
  rememberSettings();
}
function markCustom() {
  $<HTMLSelectElement>("#saved-presets").value = "";
  $<HTMLButtonElement>("#delete-preset").disabled = true;
  for (const button of document.querySelectorAll("[data-recipe]"))
    button.classList.remove("active");
}
function rememberSettings() {
  try {
    localStorage.setItem(
      "resz-settings",
      JSON.stringify(serializableSettings(settings())),
    );
  } catch {
    /* Invalid partial input is not saved. */
  }
}

function releaseResult(job: Job) {
  if (job.resultPreview) URL.revokeObjectURL(job.resultPreview);
  job.resultPreview = undefined;
  if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
  if (job.outputThumbnail) URL.revokeObjectURL(job.outputThumbnail);
  job.result = undefined;
  job.outputUrl = undefined;
  job.outputThumbnail = undefined;
  job.outputName = undefined;
}
function invalidate() {
  for (const job of jobs) {
    releaseResult(job);
    if (job.info) {
      job.status = "ready";
      job.error = undefined;
    }
  }
  render();
}
function updateControls() {
  const mode = $<HTMLSelectElement>("#resize").value;
  $("#dimension-controls").hidden = ![
    "fit",
    "exact",
    "crop",
    "pad",
    "width",
    "height",
  ].includes(mode);
  $("#percentage-control").hidden = mode !== "percentage";
  input("upscale").closest("label")!.hidden = mode === "original";
  $("#width-control").hidden = mode === "height";
  $("#height-control").hidden = mode === "width";
  $(".dimension-times").hidden = ["width", "height"].includes(mode);
  $(".dimensions").classList.toggle(
    "single-dimension",
    ["width", "height"].includes(mode),
  );
  $("#anchor-control").hidden = !["crop", "pad"].includes(mode);
  $("#padding-control").hidden = mode !== "pad";
  $("#resize-hint").textContent = t(
    mode === "exact"
      ? "exactHint"
      : mode === "crop"
        ? "cropHint"
        : mode === "pad"
          ? "padHint"
          : ["width", "height"].includes(mode)
            ? "autoDimensionHint"
            : "fitHint",
  );
  $("#limit-controls").hidden = !input("limit-enabled").checked;
  const lossless = ["png", "apng", "bmp", "tiff"].includes(format);
  input("quality").disabled =
    lossless || busy || importing || zipBusy || sampleBusy;
  $(".quality-section").classList.toggle("is-disabled", lossless);
  $("#quality-value").textContent = lossless
    ? ["png", "apng"].includes(format) && Number(input("png-colors").value) > 0
      ? t("colors", { count: Number(input("png-colors").value) })
      : t("lossless")
    : number(Number(input("quality").value)) + "%";
  $("#format-hint").textContent = t(formatKeys[format]);
  $("#palette-control").hidden = !["png", "apng"].includes(format);
  for (const o of document.querySelectorAll<HTMLOptionElement>(
    "[data-color-count]",
  ))
    o.textContent = t("colors", { count: Number(o.dataset.colorCount) });
  for (const o of document.querySelectorAll<HTMLOptionElement>(
    "#rotation option",
  ))
    if (o.value !== "0") o.textContent = number(Number(o.value)) + "°";
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-format]",
  )) {
    const selected = button.dataset.format === format;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  const kind = $<HTMLSelectElement>("#watermark").value;
  $("#watermark-controls").hidden = kind === "none";
  $("#watermark-text-control").hidden = kind !== "text";
  $("#watermark-image-control").hidden = kind !== "image";
  $("#logo-status").textContent = logoFile
    ? t("logoLoaded") + " · " + logoFile.name
    : "";
  $("#opacity-value").textContent =
    number(Number(input("watermark-opacity").value)) + "%";
  $("#watermark-size-value").textContent =
    number(Number(input("watermark-size").value)) + "%";
  try {
    $("#name-example").textContent = t("fileNamePreview", {
      name: outputName(
        { name: "photo.jpg" },
        settings(),
        0,
        { width: 1200, height: 800 },
        new Set(),
      ),
    });
  } catch {
    $("#name-example").textContent = "";
  }
}

function render() {
  const done = jobs.filter((job) => job.status === "done"),
    ready = jobs.filter((job) => job.info);
  const locked = busy || importing || zipBusy || sampleBusy;
  $("#file-count").textContent = number(jobs.length);
  $("#clear-button").hidden = jobs.length === 0;
  for (const id of [
    "clear-button",
    "add-button",
    "add-folder",
    "sample-button",
    "reset-button",
    "save-preset",
    "share-settings",
  ])
    $<HTMLButtonElement>(`#${id}`).disabled = locked;
  $("#dropzone").classList.toggle("compact", jobs.length > 0);
  $("#dropzone").setAttribute("aria-disabled", String(locked));
  $("#batch-toolbar").hidden = jobs.length === 0;
  $("#sample-row").hidden = jobs.length > 0;
  $("#batch-description").textContent =
    `${t("countImages", { count: jobs.length })} · ${t("originalSize", { size: bytes(jobs.reduce((sum, job) => sum + job.file.size, 0)) })}`;
  $("#image-grid").innerHTML = jobs
    .map((job) => {
      const title = job.file.name,
        label = t(statusKeys[job.status]);
      return `<article class="image-card ${job.status}" data-id="${job.id}"><div class="image-card-art checkerboard">${job.thumbnail ? `<button class="image-preview-button" data-preview="${job.id}" aria-label="${escape(t("previewFile", { file: title }))}"><img src="${job.outputThumbnail || job.thumbnail}" alt="${escape(title)}"/><span class="preview-affordance">${icon("expand")}</span></button>` : `<span class="file-placeholder">${icon("images", 32)}</span>`}${job.thumbnail ? `<button class="card-crop icon-button" ${locked ? "disabled" : ""} data-crop="${job.id}" aria-label="${escape(t("cropImage"))}">${icon("crop", 18)}</button>` : ""}<bdi class="file-type" dir="ltr">${escape(job.result ? (format === "apng" ? "APNG" : extensions[format].toUpperCase()) : title.split(".").pop()?.toUpperCase().slice(0, 6) || "—")}</bdi><button class="remove-image icon-button" data-remove="${job.id}" aria-label="${escape(t("removeFile", { file: title }))}" ${locked ? "disabled" : ""}>${icon("close", 18)}</button></div><div class="image-card-details"><h3 dir="auto" title="${escape(title)}">${escape(title)}</h3>${job.crop ? `<span class="crop-badge">${escape(t("cropped"))}</span>` : ""}<p>${job.info ? dimensions(job.info.width, job.info.height) : escape(t("readingDimensions"))}${job.info && job.info.frames > 1 ? " · " + escape(t("frames", { count: job.info.frames })) : ""} · <bdi>${bytes(job.file.size)}</bdi></p><div class="image-status"><span class="status-${job.status}">${job.status === "done" ? icon("check", 18) : ["processing", "loading"].includes(job.status) ? '<span class="spinner"></span>' : '<span class="tiny-dot"></span>'}${escape(label)}</span>${job.result ? `<button class="card-download" data-download="${job.id}" aria-label="${escape(t("downloadFile", { file: job.outputName || title }))}"><bdi>${bytes(job.result.blob.size)}</bdi> ${icon("download", 18)}</button>` : ""}</div>${job.result ? `<p class="result-dimensions">${dimensions(job.result.width, job.result.height)}${job.result.reduced ? ` · ${escape(t("resultResized"))}` : ""}</p>` : ""}${job.error ? `<p class="image-error">${escape(errorText(job.error))}</p>` : ""}</div></article>`;
    })
    .join("");
  $("#export-count").textContent = jobs.length
    ? t("exportCount", { count: ready.length })
    : t("exportEmpty");
  const convertButton = $<HTMLButtonElement>("#convert-button");
  convertButton.disabled = locked || ready.length === 0;
  convertButton.innerHTML = busy
    ? `<span class="spinner"></span> ${escape(t("statusProcessing"))}`
    : `${icon("spark")} ${escape(done.length ? t("convertAgain") : ready.length ? t("convertCount", { count: ready.length }) : t("convert"))} ${icon("arrow")}`;
  const downloadButton = $<HTMLButtonElement>("#download-button");
  downloadButton.hidden = done.length === 0 || busy;
  downloadButton.disabled = locked;
  downloadButton.innerHTML = zipBusy
    ? `<span class="spinner"></span> ${escape(t("packing"))}`
    : `${icon("download")} ${escape(t("downloadZip"))} <bdi class="zip-size">${bytes(done.reduce((sum, job) => sum + job.result!.blob.size, 0))}</bdi>`;
  $("#export-note").textContent =
    importing || sampleBusy
      ? t("readingLocal")
      : done.length
        ? t("exportReady", { count: done.length }) +
          (jobs.length > done.length
            ? ` ${t("excluded", { count: jobs.length - done.length })}`
            : "")
        : ready.length
          ? t("sameSettings")
          : t("addToStart");
  const folderButton = $<HTMLButtonElement>("#folder-export");
  folderButton.hidden =
    !done.length || busy || !("showDirectoryPicker" in window);
  folderButton.disabled = locked;
  for (const el of document.querySelectorAll<HTMLButtonElement>(
    "[data-recipe], [data-panel]",
  ))
    el.disabled = locked;
  $<HTMLSelectElement>("#saved-presets").disabled = locked;
  $("#batch-summary").hidden = !done.length || busy;
  if (done.length && !busy) {
    const original = done.reduce((sum, job) => sum + job.file.size, 0),
      output = done.reduce((sum, job) => sum + job.result!.blob.size, 0);
    const savings = original ? Math.round((1 - output / original) * 100) : 0;
    $("#batch-summary").innerHTML =
      `<span class="summary-icon">${icon("check", 24)}</span><div><strong>${escape(t("batchReady"))}</strong><p><bdi>${bytes(original)}</bdi> ${icon("arrow", 18)} <bdi>${bytes(output)}</bdi>${savings > 0 ? `<span class="savings">${escape(t("savings", { percent: savings }))}</span>` : ""}</p></div><bdi class="summary-format" dir="ltr">${format === "apng" ? "APNG" : extensions[format].toUpperCase()}</bdi>`;
  }
  $("#progress-panel").hidden = !busy;
  $("#progress-label").textContent = t("progress", {
    current: progressState.current,
    total: progressState.total,
  });
  $<HTMLProgressElement>("#progress-bar").value = progressState.total
    ? (progressState.completed / progressState.total) * 100
    : 0;
  for (const el of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLSelectElement
  >("#settings-form input, #settings-form select, #settings-form button"))
    el.disabled = locked;
  updateControls();
}
async function addFiles(files: File[]) {
  if (busy || importing || zipBusy || !files.length) return;
  importing = true;
  render();
  let duplicates = 0;
  for (const file of files) {
    if (
      jobs.some(
        (job) =>
          job.file.name === file.name &&
          job.file.size === file.size &&
          job.file.lastModified === file.lastModified &&
          job.file.webkitRelativePath === file.webkitRelativePath,
      )
    ) {
      duplicates++;
      continue;
    }
    const job: Job = { id: ++nextJobId, file, status: "loading" };
    jobs.push(job);
    render();
    try {
      job.info = (await callWorker({ action: "inspect", file })) as ImageInfo;
      job.thumbnail = URL.createObjectURL(job.info.thumbnail);
      job.status = "ready";
    } catch (error) {
      job.status = "error";
      job.error = issue(error);
    }
    render();
  }
  importing = false;
  render();
  if (duplicates) toast("duplicatesSkipped", { count: duplicates });
}

async function convertBatch() {
  let s: Settings;
  try {
    s = settings();
  } catch (error) {
    const problem = issue(error);
    toast(problem.code, problem.params);
    return;
  }
  busy = true;
  cancelled = false;
  for (const job of jobs) {
    releaseResult(job);
    if (job.info) {
      job.status = "ready";
      job.error = undefined;
    }
  }
  const batch = jobs.filter((job) => job.info),
    names = new Set<string>();
  progressState = { current: 0, total: batch.length, completed: 0 };
  render();
  for (const [index, job] of batch.entries()) {
    if (cancelled) break;
    job.status = "processing";
    progressState.current = progressState.completed + 1;
    render();
    try {
      const result = (await callWorker({
        action: "convert",
        file: job.file,
        settings: s,
        crop: job.crop,
      })) as ConversionResult;
      job.result = result;
      job.outputUrl = URL.createObjectURL(result.blob);
      job.outputThumbnail = URL.createObjectURL(result.thumbnail);
      job.outputName = outputName(job.file, s, index, result, names);
      job.status = "done";
    } catch (error) {
      if (cancelled) job.status = "ready";
      else {
        job.status = "error";
        job.error = issue(error);
      }
    }
    progressState.completed++;
    render();
  }
  busy = false;
  render();
  if (cancelled) toast("cancelled");
  else if (jobs.some((job) => job.status === "error")) toast("attention");
}
function download(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
async function downloadZip() {
  const converted = jobs.filter((job) => job.result);
  if (!converted.length || zipBusy || busy) return;
  zipBusy = true;
  render();
  try {
    const { zip } = await import("fflate");
    // A null-prototype map preserves filenames such as __proto__ safely.
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const job of converted)
      entries[
        (input("keep-folders").checked
          ? safeFolders(job.file.webkitRelativePath)
              .map((part) => part + "/")
              .join("")
          : "") + job.outputName!
      ] = new Uint8Array(await job.result!.blob.arrayBuffer());
    const result = await new Promise<Uint8Array<ArrayBuffer>>(
      (resolve, reject) => {
        zip(entries, { level: 0 }, (error, data) =>
          error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>),
        );
      },
    );
    const url = URL.createObjectURL(
      new Blob([result], { type: "application/zip" }),
    );
    download(
      url,
      `resz-images-${new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0")}.zip`,
    );
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast("zipDone", { count: converted.length });
  } catch {
    toast("zipError");
  } finally {
    zipBusy = false;
    render();
  }
}
function preview(id: number, converted = false) {
  void viewer.open(id, converted);
}
const viewer = setupPreview({
  getJob: (id: number) => jobs.find((job) => job.id === id),
  load: async (file: File) =>
    (await callWorker({ action: "preview", file })) as PreviewResult,
  crop: (id: number, crop?: Crop) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    job.crop = crop;
    releaseResult(job);
    job.status = "ready";
    render();
    toast("cropSaved");
  },
  download: (id: number) => {
    const job = jobs.find((j) => j.id === id);
    if (job?.outputUrl) download(job.outputUrl, job.outputName!);
  },
  error: () => toast("errorDecode"),
});

$("#language").addEventListener("change", () => {
  setLocale($<HTMLSelectElement>("#language").value as Locale);
  try {
    localStorage.setItem("resz-language", getLocale());
  } catch {
    /* Language selection still works without storage. */
  }
  const url = new URL(location.href);
  url.searchParams.set("lang", getLocale());
  history.replaceState(null, "", url);
  applyLanguage();
});
$("#add-button").addEventListener("click", () => input("file-input").click());
input("file-input").addEventListener("change", (event) => {
  void addFiles(Array.from((event.target as HTMLInputElement).files || []));
  input("file-input").value = "";
});
$("#dropzone").addEventListener("click", () => {
  if (!busy && !importing && !zipBusy && !sampleBusy)
    input("file-input").click();
});
$("#dropzone").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("#dropzone").click();
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (event.dataTransfer?.types.includes("Files")) {
    dragDepth++;
    $("#dropzone").classList.add("dragging");
  }
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#dropzone").classList.remove("dragging");
  }
});
function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(heic|heif|tiff?|avif|bmp|gif|png|jpe?g|webp|svg|apng)$/i.test(file.name)
  );
}
async function entryFiles(entry: any): Promise<File[]> {
  if (entry.isFile)
    return new Promise((resolve, reject) =>
      entry.file((file: File) => {
        Object.defineProperty(file, "webkitRelativePath", {
          value: String(entry.fullPath).replace(/^\//, ""),
        });
        resolve(isImageFile(file) ? [file] : []);
      }, reject),
    );
  const reader = entry.createReader(),
    all: any[] = [];
  while (true) {
    const batch: any[] = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    all.push(...batch);
  }
  const result: File[] = [];
  for (const child of all) result.push(...(await entryFiles(child)));
  return result;
}
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#dropzone").classList.remove("dragging");
  if (!event.dataTransfer || busy || importing || zipBusy || sampleBusy) return;
  const entries = Array.from(event.dataTransfer.items)
    .map((item) => (item as any).webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.some((entry) => entry.isDirectory)) {
    importing = true;
    render();
    void (async () => {
      try {
        const files: File[] = [];
        for (const entry of entries) files.push(...(await entryFiles(entry)));
        importing = false;
        await addFiles(files);
      } catch {
        importing = false;
        render();
        toast("errorDecode");
      }
    })();
  } else void addFiles(Array.from(event.dataTransfer.files));
});
$("#clear-button").addEventListener("click", () => {
  for (const job of jobs) {
    if (job.originalPreview) URL.revokeObjectURL(job.originalPreview);
    if (job.thumbnail) URL.revokeObjectURL(job.thumbnail);
    releaseResult(job);
  }
  jobs = [];
  render();
});
$("#image-grid").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const cropButton = target.closest<HTMLElement>("[data-crop]");
  if (cropButton && !busy && !importing && !zipBusy && !sampleBusy) {
    void viewer.crop(Number(cropButton.dataset.crop));
    return;
  }
  const remove = target.closest<HTMLElement>("[data-remove]"),
    previewButton = target.closest<HTMLElement>("[data-preview]"),
    downloadButton = target.closest<HTMLElement>("[data-download]");
  if (remove && !busy && !importing && !zipBusy && !sampleBusy) {
    const job = jobs.find((item) => item.id === Number(remove.dataset.remove))!;
    if (job.originalPreview) URL.revokeObjectURL(job.originalPreview);
    if (job.thumbnail) URL.revokeObjectURL(job.thumbnail);
    releaseResult(job);
    jobs = jobs.filter((item) => item !== job);
    render();
  } else if (previewButton)
    preview(
      Number(previewButton.dataset.preview),
      Boolean(
        jobs.find((job) => job.id === Number(previewButton.dataset.preview))
          ?.result,
      ),
    );
  else if (downloadButton) {
    const job = jobs.find(
      (item) => item.id === Number(downloadButton.dataset.download),
    )!;
    if (job.outputUrl) download(job.outputUrl, job.outputName!);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-format]",
))
  button.addEventListener("click", () => {
    format = button.dataset.format as Format;
    markCustom();
    updateControls();
    invalidate();
    rememberSettings();
  });
$("#settings-form").addEventListener("submit", (event) =>
  event.preventDefault(),
);
$("#settings-form").addEventListener("input", () => {
  markCustom();
  updateControls();
  invalidate();
  rememberSettings();
});
$("#reset-button").addEventListener("click", () => {
  $<HTMLFormElement>("#settings-form").reset();
  logoFile = undefined;
  applySettings({ ...defaults });
  toast("settingsReset");
});
$("#convert-button").addEventListener("click", () => void convertBatch());
$("#download-button").addEventListener("click", () => void downloadZip());
$("#cancel-button").addEventListener("click", () => {
  cancelled = true;
  worker.terminate();
  for (const handler of pending.values())
    handler.reject(new AppError("errorWorker"));
  pending.clear();
  startWorker();
});
$("#help-button").addEventListener("click", () =>
  $<HTMLDialogElement>("#about-dialog").showModal(),
);
for (const button of document.querySelectorAll<HTMLElement>("[data-close]"))
  button.addEventListener("click", () =>
    $<HTMLDialogElement>(`#${button.dataset.close}`).close(),
  );
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog"))
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close();
    }
  });

async function sampleBatch() {
  sampleBusy = true;
  render();
  const samples = [
    {
      name: "alpine-morning.png",
      sky: "#d8e5dc",
      sun: "#fff3c1",
      far: "#8ca18d",
      near: "#3e6554",
      style: 0,
    },
    {
      name: "slow-afternoon.png",
      sky: "#f1d9c2",
      sun: "#fff2cd",
      far: "#bc8e71",
      near: "#7a5c43",
      style: 1,
    },
    {
      name: "coastal-notes.png",
      sky: "#d9e7e6",
      sun: "#fdf4d4",
      far: "#92b3b2",
      near: "#4c777d",
      style: 2,
    },
  ];
  const files: File[] = [];
  for (const [index, s] of samples.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = index === 1 ? 1200 : 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d")!,
      w = canvas.width,
      h = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, s.sky);
    gradient.addColorStop(1, "#f4edda");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.sun;
    ctx.beginPath();
    ctx.arc(w * 0.74, h * 0.26, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.far;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.75);
    ctx.lineTo(w * 0.33, h * 0.23);
    ctx.lineTo(w * 0.69, h * 0.8);
    ctx.lineTo(w, h * 0.44);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    ctx.fillStyle = "#e9e7d7";
    ctx.beginPath();
    ctx.moveTo(w * 0.33, h * 0.23);
    ctx.lineTo(w * 0.23, h * 0.48);
    ctx.lineTo(w * 0.33, h * 0.42);
    ctx.lineTo(w * 0.44, h * 0.51);
    ctx.fill();
    ctx.fillStyle = s.near;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.89);
    ctx.bezierCurveTo(w * 0.35, h * 0.45, w * 0.61, h * 1.1, w, h * 0.65);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    if (s.style === 2) {
      ctx.fillStyle = "#b2ccc8";
      ctx.fillRect(0, h * 0.8, w, h * 0.2);
      ctx.fillStyle = "#d4e3da";
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(w * 0.1 + i * 117, h * 0.84 + i * 17, 80 + i * 8, 2);
      }
    }
    // A subtle deterministic grain also gives compression a realistic workload.
    const data = ctx.getImageData(0, 0, w, h);
    let seed = 73 + index;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const grain = (seed % 9) - 4;
      for (let c = 0; c < 3; c++) data.data[i + c] += grain;
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    files.push(
      new File([blob], s.name, { type: "image/png", lastModified: 1 }),
    );
  }
  sampleBusy = false;
  await addFiles(files);
}

$("#sample-button").addEventListener("click", () => {
  void sampleBatch().catch(() => {
    sampleBusy = false;
    render();
    toast("errorWorker");
  });
});
interface SavedPreset {
  id: string;
  name: string;
  settings: Settings;
}
let presets: SavedPreset[] = [];
function refreshPresetOptions() {
  const select = $<HTMLSelectElement>("#saved-presets"),
    selected = select.value;
  select.innerHTML =
    '<option value="">' +
    escape(t("presetCustom")) +
    "</option>" +
    presets
      .map(
        (p) => '<option value="' + p.id + '">' + escape(p.name) + "</option>",
      )
      .join("");
  select.value = presets.some((p) => p.id === selected) ? selected : "";
  $<HTMLButtonElement>("#delete-preset").disabled = !select.value;
}
function initializeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("resz-presets") || "[]");
    if (Array.isArray(saved))
      presets = saved
        .slice(0, 30)
        .filter(
          (p) =>
            p &&
            typeof p.id === "string" &&
            /^[\w-]{1,80}$/.test(p.id) &&
            typeof p.name === "string",
        )
        .map((p) => ({
          id: p.id,
          name: p.name.slice(0, 80),
          settings: cleanSettings(p.settings),
        }));
    const shared = new URLSearchParams(location.hash.slice(1)).get("settings");
    const settingsFromLink = shared ? decodeSettings(shared) : null;
    applySettings(
      settingsFromLink ||
        cleanSettings(
          JSON.parse(localStorage.getItem("resz-settings") || "null"),
        ),
    );
  } catch {
    applySettings({ ...defaults });
  }
  refreshPresetOptions();
}
function storePresets() {
  try {
    localStorage.setItem(
      "resz-presets",
      JSON.stringify(
        presets.map((p) => ({
          ...p,
          settings: serializableSettings(p.settings),
        })),
      ),
    );
  } catch {
    /* Selection works even when storage is full. */
  }
}
$("#save-preset").addEventListener("click", () => {
  try {
    const name = input("preset-name").value.trim();
    if (!name) {
      input("preset-name").focus();
      return;
    }
    const saved = {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      settings: cleanSettings(serializableSettings(settings())),
    };
    presets = [...presets.filter((p) => p.name !== saved.name), saved].slice(
      -30,
    );
    storePresets();
    refreshPresetOptions();
    $<HTMLSelectElement>("#saved-presets").value = saved.id;
    $<HTMLButtonElement>("#delete-preset").disabled = false;
    toast("presetSaved");
    $<HTMLDetailsElement>(".preset-manager").open = false;
  } catch (error) {
    const problem = issue(error);
    toast(problem.code, problem.params);
  }
});
$("#delete-preset").addEventListener("click", () => {
  const id = $<HTMLSelectElement>("#saved-presets").value;
  presets = presets.filter((p) => p.id !== id);
  storePresets();
  refreshPresetOptions();
  toast("presetDeleted");
});
$("#saved-presets").addEventListener("change", () => {
  const saved = presets.find(
    (p) => p.id === $<HTMLSelectElement>("#saved-presets").value,
  );
  if (saved) {
    applySettings(saved.settings);
    $<HTMLSelectElement>("#saved-presets").value = saved.id;
  }
  $<HTMLButtonElement>("#delete-preset").disabled = !saved;
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-recipe]",
))
  button.addEventListener("click", () => {
    const recipes: Partial<Settings>[] = [
      { format: "webp", resize: "fit", width: 1920, height: 1920 },
      {
        format: "jpeg",
        resize: "pad",
        width: 1200,
        height: 1200,
        transparentPadding: false,
      },
      { format: "jpeg", maxBytes: 200000 },
      { format: "jpeg", resize: "crop", width: 1080, height: 1350 },
    ];
    applySettings({ ...defaults, ...recipes[Number(button.dataset.recipe)] });
    $<HTMLSelectElement>("#saved-presets").value = "";
    for (const b of document.querySelectorAll("[data-recipe]"))
      b.classList.toggle("active", b === button);
  });
$("#share-settings").addEventListener("click", async () => {
  try {
    const url = new URL(location.href);
    url.hash = new URLSearchParams({
      settings: encodeSettings(settings()),
    }).toString();
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.href);
      toast("linkCopied");
    } catch {
      toast("linkError");
    }
  } catch (error) {
    const problem = issue(error);
    toast(problem.code, problem.params);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-panel]",
)) {
  button.addEventListener("click", () => {
    for (const tab of document.querySelectorAll<HTMLButtonElement>(
      "[data-panel]",
    )) {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $("#panel-" + tab.dataset.panel).hidden = !selected;
    }
  });
  button.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(
          document.querySelectorAll<HTMLButtonElement>("[data-panel]"),
        ),
        index = tabs.indexOf(button),
        next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
      tabs[next].click();
      tabs[next].focus();
    }
  });
}
$("#choose-logo").addEventListener("click", () => input("logo-input").click());
input("logo-input").addEventListener("change", () => {
  logoFile = input("logo-input").files?.[0];
  input("logo-input").value = "";
  invalidate();
  rememberSettings();
});
$("#add-folder").addEventListener("click", () => input("folder-input").click());
input("folder-input").addEventListener("change", () => {
  void addFiles(
    Array.from(input("folder-input").files || []).filter(isImageFile),
  );
  input("folder-input").value = "";
});
document.addEventListener("paste", (event) => {
  if (
    (event.target as HTMLElement).closest(
      "input,textarea,select,[contenteditable=true]",
    ) ||
    busy ||
    importing ||
    zipBusy ||
    sampleBusy
  )
    return;
  const files = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length) {
    event.preventDefault();
    void addFiles(files);
  }
});
$("#folder-export").addEventListener("click", async () => {
  const done = jobs.filter((j) => j.result);
  if (!done.length || busy || zipBusy) return;
  let count = 0;
  zipBusy = true;
  render();
  try {
    const directory = await (window as any).showDirectoryPicker({
      mode: "readwrite",
    });
    const keep = input("keep-folders").checked;
    await writeToFolder(
      directory,
      done.map((job) => ({
        name: job.outputName!,
        folders: keep ? safeFolders(job.file.webkitRelativePath) : [],
        blob: job.result!.blob,
      })),
      (n) => {
        count = n;
      },
    );
    toast("folderSaved", { count });
  } catch (error) {
    if ((error as DOMException).name !== "AbortError")
      toast("folderError", { count });
  } finally {
    zipBusy = false;
    render();
  }
});

initializeSettings();
applyLanguage();
