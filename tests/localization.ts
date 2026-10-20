import { languages, t, type Locale } from "../src/i18n";
let passed = 0,
  failed = 0;
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, message: string, timeout = 20000) {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error(message);
    await pause(40);
  }
}
async function test(name: string, action: () => Promise<void>) {
  const row = document.createElement("li");
  row.textContent = "Running: " + name;
  document.querySelector("#results")!.append(row);
  try {
    await action();
    row.textContent = "PASS — " + name;
    passed++;
  } catch (error) {
    row.textContent = "FAIL — " + name + ": " + error;
    row.className = "fail";
    failed++;
  }
  document.querySelector("#summary")!.textContent =
    `${passed} passed, ${failed} failed (running)`;
}
let frame: HTMLIFrameElement;
async function load(locale: Locale, width: number) {
  frame?.remove();
  frame = document.createElement("iframe");
  frame.width = String(width);
  frame.src = "/?lang=" + locale;
  document.querySelector("#fixture")!.append(frame);
  await until(
    () => Boolean(frame.contentDocument?.querySelector("#language")),
    "App did not load",
  );
  await pause(80);
  frame
    .contentDocument!.querySelector<HTMLButtonElement>("#reset-button")!
    .click();
  return frame.contentDocument!;
}
function checkLayout(doc: Document) {
  const root = doc.documentElement,
    win = doc.defaultView!;
  assert(
    root.scrollWidth <= root.clientWidth + 1,
    `Horizontal overflow: ${root.scrollWidth} / ${root.clientWidth}`,
  );
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    if (!textNode.textContent?.trim()) continue;
    const parent = textNode.parentElement!;
    if (parent.closest(".sr-only,script,style,option")) continue;
    const style = win.getComputedStyle(parent);
    if (!parent.getClientRects().length || style.visibility === "hidden")
      continue;
    assert(
      parseFloat(style.fontSize) >= 14,
      `Small text: ${parent.className} ${style.fontSize}`,
    );
  }
  for (const element of doc.querySelectorAll<HTMLElement>(
    "button,.field-hint,.export-note,.animation-note,.settings-heading,.intro-copy",
  )) {
    if (!element.getClientRects().length) continue;
    assert(
      element.scrollWidth <= element.clientWidth + 2,
      "Clipped width: " + element.className + " " + element.textContent,
    );
    assert(
      element.scrollHeight <= element.clientHeight + 2,
      "Clipped height: " + element.className,
    );
  }
}
function change(doc: Document, selector: string, value: string) {
  const element = doc.querySelector<HTMLInputElement | HTMLSelectElement>(
    selector,
  )!;
  element.value = value;
  element.dispatchEvent(
    new Event(selector === "#language" ? "change" : "input", { bubbles: true }),
  );
}
async function add(doc: Document, file: File) {
  const input = doc.querySelector<HTMLInputElement>("#file-input")!,
    transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => Boolean(doc.querySelector(".image-card.ready,.image-card.error")),
    "Import did not finish",
  );
}
for (const language of languages) {
  for (const width of [390, 820, 1280]) {
    await test(
      language.code +
        " at " +
        width +
        "px: complete UI, readable text, no overflow",
      async () => {
        const doc = await load(language.code, width);
        assert(doc.documentElement.lang === language.code, "Wrong lang");
        assert(
          doc.documentElement.dir === language.direction,
          "Wrong direction",
        );
        assert(doc.title === t("appTitle", {}, language.code), "Wrong title");
        assert(
          doc.querySelector("h1")!.textContent ===
            t("heroTitle", {}, language.code),
          "Hero not translated",
        );
        assert(
          doc
            .querySelector("#add-button")!
            .textContent!.includes(t("addImages", {}, language.code)),
          "Button not translated",
        );
        checkLayout(doc);
        doc.querySelector<HTMLButtonElement>("#tab-geometry")!.click();
        change(doc, "#resize", "pad");
        checkLayout(doc);
        doc.querySelector<HTMLButtonElement>("#tab-style")!.click();
        change(doc, "#watermark", "text");
        checkLayout(doc);
        change(doc, "#watermark", "image");
        checkLayout(doc);
        doc.querySelector<HTMLButtonElement>("#tab-output")!.click();
        doc.querySelector<HTMLInputElement>("#limit-enabled")!.click();
        doc.querySelector<HTMLDetailsElement>("#naming-details")!.open = true;
        checkLayout(doc);
        doc.querySelector<HTMLButtonElement>("#help-button")!.click();
        assert(
          doc.querySelector("#about-dialog h2")!.textContent ===
            t("aboutTitle", {}, language.code),
          "About not translated",
        );
        checkLayout(doc);
        doc.querySelector<HTMLDialogElement>("#about-dialog")!.close();
      },
    );
  }
}
await test("Conversion survives language switching; RTL preview, ZIP controls and validation translate", async () => {
  const doc = await load("en", 390);
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#638b53";
  ctx.fillRect(0, 0, 240, 160);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), "image/png"),
  );
  await add(doc, new File([blob], "日本語-photo.png", { type: "image/png" }));
  change(doc, "#resize", "fit");
  change(doc, "#width", "120");
  change(doc, "#height", "120");
  doc.querySelector<HTMLButtonElement>("#convert-button")!.click();
  await until(
    () => Boolean(doc.querySelector(".image-card.done")),
    "Conversion did not finish",
  );
  change(doc, "#language", "ar");
  assert(
    doc.querySelectorAll(".image-card.done").length === 1,
    "Result lost on language switch",
  );
  assert(
    doc.querySelector<HTMLInputElement>("#width")!.value === "120",
    "Settings lost",
  );
  assert(
    doc.querySelector(".status-done")!.textContent ===
      t("statusDone", {}, "ar"),
    "Status not translated",
  );
  assert(
    doc
      .querySelector("#download-button")!
      .textContent!.includes(t("downloadZip", {}, "ar")),
    "Download not translated",
  );
  checkLayout(doc);
  doc.querySelector<HTMLButtonElement>("[data-preview]")!.click();
  await until(
    () => doc.querySelector<HTMLElement>("#preview-loading")!.hidden,
    "Preview did not finish",
  );
  assert(
    doc.querySelector("#preview-title")!.textContent ===
      "日本語-photo-resz.jpg",
    "Export name is not branded",
  );
  assert(
    doc.querySelector("#preview-result")!.textContent ===
      t("converted", {}, "ar"),
    "Preview not translated",
  );
  assert(
    doc.querySelector("#preview-description")!.textContent!.includes("120") ||
      doc.querySelector("#preview-description")!.textContent!.includes("١٢٠"),
    "Wrong output size",
  );
  checkLayout(doc);
  doc.querySelector<HTMLDialogElement>("#preview-dialog")!.close();
  change(doc, "#language", "zh-Hans");
  assert(
    doc.querySelectorAll(".image-card.done").length === 1,
    "Result lost after second switch",
  );
  change(doc, "#width", "0");
  doc.querySelector<HTMLButtonElement>("#convert-button")!.click();
  assert(
    doc
      .querySelector("#toast")!
      .textContent!.includes(t("width", {}, "zh-Hans")),
    "Validation not translated",
  );
  change(doc, "#language", "ur");
  assert(
    doc.querySelector("#toast")!.textContent!.includes(t("width", {}, "ur")),
    "Visible error did not translate",
  );
  checkLayout(doc);
});
await test("Corrupt-file worker errors translate when switching languages", async () => {
  const doc = await load("fr", 820);
  await add(doc, new File(["broken"], "bad.png", { type: "image/png" }));
  assert(
    doc.querySelector(".image-error")!.textContent ===
      t("errorDecode", {}, "fr"),
    "Worker error not translated",
  );
  change(doc, "#language", "bn");
  assert(
    doc.querySelector(".image-error")!.textContent ===
      t("errorDecode", {}, "bn"),
    "Existing worker error not translated",
  );
  checkLayout(doc);
});
await test("Remembered language and URL override survive reload", async () => {
  let doc = await load("en", 820);
  change(doc, "#language", "id");
  frame.src = "/";
  await until(
    () =>
      Boolean(frame.contentDocument?.querySelector("#language")) &&
      frame.contentDocument!.documentElement.lang === "id",
    "Saved preference not applied",
  );
  doc = await load("es", 820);
  assert(doc.documentElement.lang === "es", "URL did not override preference");
});
await studioTests();
frame.remove();
document.querySelector("#summary")!.textContent =
  `Finished: ${passed} passed, ${failed} failed.`;
document.title = `resz.im localization: ${passed} passed, ${failed} failed`;

async function studioTests() {
  await test("Preset save/restore, settings URL, naming and per-image crop work together", async () => {
    let doc = await load("en", 1280);
    doc.querySelector<HTMLButtonElement>('[data-recipe="1"]')!.click();
    assert(
      doc.querySelector<HTMLSelectElement>("#resize")!.value === "pad",
      "Recipe did not set pad mode",
    );
    assert(
      doc.querySelector<HTMLInputElement>("#width")!.value === "1200",
      "Recipe dimensions",
    );
    change(doc, "#name-pattern", "{name}-{n}-{width}");
    change(doc, "#prefix", "catalog-");
    change(doc, "#start-number", "7");
    doc.querySelector<HTMLDetailsElement>(".preset-manager")!.open = true;
    change(doc, "#preset-name", "QA preset");
    doc.querySelector<HTMLButtonElement>("#save-preset")!.click();
    const saved = doc.querySelector<HTMLSelectElement>("#saved-presets")!.value;
    assert(Boolean(saved), "Preset not saved");
    doc.querySelector<HTMLButtonElement>("#reset-button")!.click();
    change(doc, "#saved-presets", saved);
    // A native select fires change, unlike normal settings inputs.
    doc
      .querySelector("#saved-presets")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    assert(
      doc.querySelector<HTMLInputElement>("#prefix")!.value === "catalog-",
      "Preset did not restore naming",
    );
    doc.querySelector<HTMLButtonElement>("#share-settings")!.click();
    assert(
      frame.contentWindow!.location.hash.includes("settings="),
      "No settings URL",
    );
    const shared = frame.contentWindow!.location.href;
    frame.src = shared;
    await until(
      () =>
        Boolean(frame.contentDocument?.querySelector("#language")) &&
        frame.contentDocument!.querySelector<HTMLInputElement>("#prefix")!
          .value === "catalog-",
      "Shared settings not loaded",
    );
    doc = frame.contentDocument!;
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c55e39";
    ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await add(doc, new File([blob], "product.png", { type: "image/png" }));
    doc.querySelector<HTMLButtonElement>("[data-crop]")!.click();
    await until(
      () => doc.querySelector<HTMLDialogElement>("#crop-dialog")!.open,
      "Crop editor not open",
    );
    change(doc, "#crop-x", "25");
    change(doc, "#crop-width", "50");
    doc.querySelector<HTMLButtonElement>("#crop-apply")!.click();
    assert(Boolean(doc.querySelector(".crop-badge")), "Crop not applied");
    doc.querySelector<HTMLButtonElement>("#convert-button")!.click();
    await until(
      () => Boolean(doc.querySelector(".image-card.done")),
      "Cropped conversion failed",
    );
    assert(
      doc
        .querySelector("[data-download]")!
        .getAttribute("aria-label")!
        .includes("catalog-product-007-1200-resz.jpg"),
      "Naming tokens not used",
    );
    doc.querySelector<HTMLButtonElement>("[data-preview]")!.click();
    await until(
      () => doc.querySelector<HTMLElement>("#preview-loading")!.hidden,
      "Comparison not loaded",
    );
    doc.querySelector<HTMLButtonElement>("#preview-actual")!.click();
    assert(
      parseInt(
        (doc.querySelector("#compare-stage") as HTMLElement).style.width,
      ) === 1200,
      "100% preview was not full resolution",
    );
    doc.querySelector<HTMLDialogElement>("#preview-dialog")!.close();
  });
}
