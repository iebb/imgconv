import { icon } from "./icons";
import { t, type MessageKey } from "./i18n";
import { formats, extensions } from "./settings";
const tr = (key: MessageKey) => `<span data-i18n="${key}">${t(key)}</span>`;
const aria = (key: MessageKey) =>
  `aria-label="${t(key)}" data-i18n-aria="${key}"`;
const options = (items: [string, MessageKey][]) =>
  items
    .map(([v, k]) => `<option value="${v}" data-i18n="${k}">${t(k)}</option>`)
    .join("");
const positionOptions = () =>
  options([
    ["top-left", "posTopLeft"],
    ["top", "posTop"],
    ["top-right", "posTopRight"],
    ["left", "posLeft"],
    ["center", "posCenter"],
    ["right", "posRight"],
    ["bottom-left", "posBottomLeft"],
    ["bottom", "posBottom"],
    ["bottom-right", "posBottomRight"],
  ]);
const select = (id: string, key: MessageKey, items: string) =>
  `<label class="form-field" for="${id}">${tr(key)}<select id="${id}">${items}</select></label>`;
const check = (id: string, key: MessageKey, checked = false) =>
  `<label class="checkbox-label"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}/>${tr(key)}</label>`;
const text = (id: string, key: MessageKey, value = "") =>
  `<label class="form-field" for="${id}">${tr(key)}<input id="${id}" value="${value}" type="text" maxlength="120"/></label>`;
export function presetMarkup() {
  return `<section class="preset-bar" ${aria("presets")}>
  <div class="preset-recipes"><span class="preset-label">${icon("spark", 18)}${tr("presets")}</span>${(["presetWeb", "presetSquare", "presetSmall", "presetSocial"] as MessageKey[]).map((key, i) => `<button class="recipe-button" data-recipe="${i}">${tr(key)}</button>`).join("")}</div>
  <div class="preset-actions"><select id="saved-presets" ${aria("presets")}><option value="" data-i18n="presetCustom">${t("presetCustom")}</option></select><details class="preset-manager"><summary class="icon-button" ${aria("savePreset")}>${icon("plus")}</summary><div class="preset-popover">${text("preset-name", "presetName")}<button class="button button-primary" id="save-preset">${tr("savePreset")}</button><button class="text-button" id="delete-preset" disabled>${tr("deletePreset")}</button><p class="field-hint">${tr("presetHelp")}</p></div></details><button class="icon-button share-button" id="share-settings" ${aria("shareSettings")}>${icon("link")}</button></div>
</section>`;
}
export function settingsMarkup() {
  return `
<aside class="settings-panel" ${aria("exportSettings")}>
 <div class="settings-heading"><h2>${tr("exportSettings")}</h2><button class="icon-button" id="reset-button" ${aria("resetSettings")}>${icon("refresh")}</button></div>
 <div class="settings-tabs" role="tablist" ${aria("batchTools")}>${(
   [
     ["output", "outputTab", "download"],
     ["geometry", "geometryTab", "resize"],
     ["style", "styleTab", "spark"],
   ] as [string, MessageKey, string][]
 )
   .map(
     ([id, key, ico], i) =>
       `<button role="tab" id="tab-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" aria-controls="panel-${id}" data-panel="${id}">${icon(ico, 18)}${tr(key)}</button>`,
   )
   .join("")}</div>
 <form id="settings-form">
 <div id="panel-output" role="tabpanel" aria-labelledby="tab-output">
  <fieldset class="settings-section"><legend>${tr("convertTo")}</legend><div class="format-options" role="group" ${aria("convertTo")}>${formats.map((format) => `<button type="button" class="format-button ${format === "jpeg" ? "selected" : ""}" data-format="${format}" aria-pressed="${format === "jpeg"}">${format === "apng" ? "APNG" : extensions[format].toUpperCase()}</button>`).join("")}</div><p class="field-hint" id="format-hint"></p></fieldset>
  <div class="settings-section quality-section"><div class="field-label"><label for="quality">${tr("quality")}</label><output for="quality" id="quality-value"></output></div><input type="range" id="quality" min="1" max="100" value="85" ${aria("quality")}/><div class="range-labels"><span>${tr("smallerFile")}</span><span>${tr("betterQuality")}</span></div></div>
  <div class="settings-section" id="palette-control" hidden><label class="form-field" for="png-colors">${tr("pngPalette")}<select id="png-colors"><option value="0" data-i18n="fullColor">${t("fullColor")}</option>${[256, 128, 64, 32].map((n) => `<option value="${n}" data-color-count="${n}">${t("colors", { count: n })}</option>`).join("")}</select></label></div>
  <fieldset class="settings-section size-section"><div class="field-label"><label class="toggle-label" for="limit-enabled">${icon("compress")}${tr("limitSize")}</label><label class="switch"><input type="checkbox" id="limit-enabled" ${aria("limitSize")}/><span></span></label></div><p class="field-hint">${tr("limitHint")}</p><div id="limit-controls" hidden><div class="size-input"><input id="max-size" ${aria("maxSize")} type="number" min="1" max="1000000000" value="500" step="1"/><select id="size-unit" ${aria("sizeUnit")}><option value="1" data-i18n="unitBytes">${t("unitBytes")}</option><option value="1000" selected>KB</option><option value="1000000">MB</option></select></div>${check("auto-resize", "autoResize", true)}<p class="field-hint">${tr("limitHelp")}</p></div></fieldset>
  <div class="settings-section">${select(
    "animation",
    "animation",
    [
      ["preserve", "preserveAnimation"],
      ["first", "firstFrame"],
    ]
      .map(
        ([v, k]) =>
          `<option value="${v}" data-i18n="${k}">${t(k as MessageKey)}</option>`,
      )
      .join(""),
  )}<p class="field-hint">${tr("animationHelp")}</p></div>
  <details class="settings-section advanced" id="naming-details"><summary>${tr("naming")}${icon("chevron")}</summary><div class="advanced-content">
   ${text("name-pattern", "pattern", "{name}")}<p class="field-hint">${tr("namingHelp")}</p><div class="form-columns">${text("prefix", "prefix")}${text("suffix", "suffix", "-resz")}</div>
   <div class="form-columns"><label class="form-field" for="start-number">${tr("numbering")}<input type="number" id="start-number" min="0" max="999999999" value="1"/></label><label class="form-field" for="number-padding">${tr("digits")}<input type="number" id="number-padding" min="1" max="9" value="3"/></label></div>
   ${check("keep-folders", "keepFolders")}<p id="name-example" class="field-hint" dir="auto"></p>
  </div></details>
 </div>
 <div id="panel-geometry" role="tabpanel" aria-labelledby="tab-geometry" hidden>
  <fieldset class="settings-section"><legend>${tr("resize")}</legend><div class="select-wrap"><select id="resize" ${aria("resizeMode")}>${options(
    [
      ["original", "resizeOriginal"],
      ["fit", "resizeFit"],
      ["crop", "resizeCrop"],
      ["pad", "resizePad"],
      ["width", "resizeWidth"],
      ["height", "resizeHeight"],
      ["percentage", "resizePercentage"],
      ["exact", "resizeExact"],
    ],
  )}</select>${icon("chevron")}</div>
   <div id="dimension-controls" hidden><div class="dimensions"><label id="width-control" for="width">${tr("width")}<span class="input-unit"><input id="width" type="number" value="1920" min="1" max="32767" step="1"/><span>${tr("pixel")}</span></span></label><span class="dimension-times" aria-hidden="true">×</span><label id="height-control" for="height">${tr("height")}<span class="input-unit"><input id="height" type="number" value="1080" min="1" max="32767" step="1"/><span>${tr("pixel")}</span></span></label></div><p class="field-hint" id="resize-hint"></p></div>
   <div id="percentage-control" hidden><label class="input-unit percentage-input"><span class="sr-only">${tr("scalePercentage")}</span><input id="percentage" type="number" min="1" max="400" step="1" value="50"/><span>%</span></label></div>
   ${check("upscale", "allowUpscale")}
   <div id="anchor-control" hidden>${select("anchor", "position", positionOptions())}</div>
   <div id="padding-control" hidden>${check("transparent-padding", "transparentPadding", true)}</div>
  </fieldset>
  <div class="settings-section">${select(
    "rotation",
    "rotation",
    options([
      ["0", "rotationNone"],
      ["90", "rotation"],
      ["180", "rotation"],
      ["270", "rotation"],
    ]),
  )}<div class="flip-controls">${check("flip-x", "flipHorizontal")}${check("flip-y", "flipVertical")}</div></div>
  <div class="settings-section"><label class="background-label" for="background">${tr("paddingColor")}<input type="color" id="background" value="#ffffff"/></label><p class="field-hint">${tr("backgroundHint")}</p></div>
 </div>
 <div id="panel-style" role="tabpanel" aria-labelledby="tab-style" hidden>
  <div class="settings-section">${select(
    "watermark",
    "watermark",
    options([
      ["none", "watermarkNone"],
      ["text", "watermarkText"],
      ["image", "watermarkImage"],
    ]),
  )}
   <div id="watermark-controls" hidden><div id="watermark-text-control">${text("watermark-text", "watermarkWords")}<label class="background-label" for="watermark-color">${tr("textColor")}<input type="color" id="watermark-color" value="#ffffff"/></label></div>
    <div id="watermark-image-control" hidden><input type="file" id="logo-input" accept="image/*,.heic,.tif,.tiff" hidden/><button type="button" class="button button-outline" id="choose-logo">${icon("images")}${tr("chooseLogo")}</button><p id="logo-status" class="field-hint"></p></div>
    <label class="form-field" for="watermark-opacity">${tr("opacity")}<div class="range-row"><input type="range" id="watermark-opacity" min="1" max="100" value="65"/><output id="opacity-value"></output></div></label>
    <label class="form-field" for="watermark-size">${tr("watermarkSize")}<div class="range-row"><input type="range" id="watermark-size" min="2" max="80" value="20"/><output id="watermark-size-value"></output></div></label>
    ${select("watermark-position", "position", positionOptions())}
   </div>
  </div>
  <div class="settings-section"><div class="section-label"><h3>${tr("aiTools")}</h3>${icon("spark", 18)}</div>${check("remove-background", "aiBackground")}
   ${select(
     "enhance",
     "aiEnhance",
     options([
       ["none", "aiNone"],
       ["2x", "ai2x"],
       ["4x", "ai4x"],
     ]),
   )}<p class="field-hint">${tr("aiHelp")}</p><p class="field-hint">${tr("aiQuality")}</p>
  </div>
 </div>
 </form>
 <div class="export-section"><div class="export-detail"><span id="export-count"></span><span class="live-dot" aria-hidden="true"></span></div><button class="button button-primary" id="convert-button" disabled></button><div class="download-actions"><button class="button button-download" id="download-button" hidden></button><button class="button button-outline" id="folder-export" hidden>${icon("folder")}${tr("saveFolder")}</button></div><p class="export-note" id="export-note"></p></div>
</aside>`;
}
