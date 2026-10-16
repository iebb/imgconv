import './style.css';
import { icon } from './icons';
import type { ConversionResult, Format, ImageInfo, Settings, WorkerReply, WorkerRequest } from './types';

interface Job {
  id: number; file: File; info?: ImageInfo; thumbnail?: string;
  status: 'loading' | 'ready' | 'processing' | 'done' | 'error';
  error?: string; result?: ConversionResult; outputUrl?: string; outputThumbnail?: string; outputName?: string;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const bytes = (value: number) => value < 1000 ? `${value} B` : value < 1e6 ? `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} KB` : `${(value / 1e6).toFixed(1)} MB`;
const extensions: Record<Format, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', tiff: 'tiff' };
let jobs: Job[] = [], nextJobId = 0, busy = false, importing = false, cancelled = false, requestId = 0;
let zipBusy = false, activePreview: number | null = null;
let worker: Worker;
const pending = new Map<number, { resolve: (result: ImageInfo | ConversionResult) => void; reject: (error: Error) => void }>();

function startWorker() {
  worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const message = event.data, handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.ok) handler.resolve(message.result); else handler.reject(new Error(message.error));
  };
  worker.onerror = () => {
    for (const handler of pending.values()) handler.reject(new Error('The image worker stopped. Try a smaller image or a different format.'));
    pending.clear(); worker.terminate(); startWorker();
  };
}
function callWorker(request: Omit<Extract<WorkerRequest, { action: 'inspect' }>, 'id'> | Omit<Extract<WorkerRequest, { action: 'convert' }>, 'id'>) {
  return new Promise<ImageInfo | ConversionResult>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject }); worker.postMessage({ ...request, id });
  });
}
startWorker();

app.innerHTML = `
<header class="site-header">
  <a class="brand" href="./" aria-label="Still home"><span class="brand-mark">${icon('images', 25)}</span><span>still<span class="brand-dot">.</span></span><span class="brand-caption">THE LOCAL IMAGE STUDIO</span></a>
  <div class="header-right"><span class="local-status"><span class="status-dot"></span>100% on your device</span><button class="icon-button help-button" id="help-button" aria-label="About Still">${icon('info')}</button></div>
</header>
<main class="page">
  <div class="intro"><div><p class="eyebrow">SMALLER FILES. BIG POSSIBILITIES.</p><h1>Your images, <span>all set.</span></h1><p class="intro-copy">Convert, resize, and lighten the whole batch. Keep it all to yourself.</p></div><div class="intro-note">${icon('shield', 23)}<span>No uploads.<br><strong>Just your browser.</strong></span></div></div>
  <div class="workspace">
    <section class="image-workspace" aria-label="Image workspace">
      <div class="section-heading"><div class="section-label"><span class="step">01</span><h2>Your images</h2><span class="count-badge" id="file-count">0</span></div><div class="workspace-actions"><button class="text-button" id="clear-button" hidden>Clear all</button><button class="button button-small button-outline" id="add-button">${icon('plus',16)} Add images</button></div></div>
      <input type="file" id="file-input" multiple accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp" hidden />
      <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Choose images or drag and drop them here">
        <div class="image-stack" aria-hidden="true"><div class="art-card art-back"><span>HEIC</span></div><div class="art-card art-middle"><span>PNG</span></div><div class="art-card art-front"><svg viewBox="0 0 176 128"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#e5edda"/><stop offset="1" stop-color="#cbd6bf"/></linearGradient></defs><rect width="176" height="128" fill="url(#sky)"/><circle cx="127" cy="33" r="14" fill="#f8f2c9"/><path d="M0 100 59 40l65 88H0Z" fill="#85957a"/><path d="m59 40-18 45 18-10 22 22Z" fill="#e9eadb"/><path d="m57 128 60-69 59 61v8Z" fill="#4a6750"/><path d="m117 59-19 40 20-9 17 17Z" fill="#bccbb0"/><path d="M0 115q39-10 75 3t101-6v16H0Z" fill="#304d39"/></svg><div class="art-card-bottom"><span>JPG</span><span>✦</span></div></div><span class="stack-plus">${icon('plus',20)}</span></div>
        <h3>A fresh start for your files.</h3><p>Drop your images here, or <span class="inline-link">browse files</span></p><span class="supported">HEIC, JPG, PNG, WebP, GIF, TIFF, AVIF & more</span>
        <span class="drop-caption">One image or a whole folder’s worth. You’re in control.</span>
      </div>
      <div class="batch-toolbar" id="batch-toolbar" hidden><span id="batch-description"></span><span class="view-label">${icon('grid',14)} Grid view</span></div>
      <div class="image-grid" id="image-grid"></div>
      <div class="progress-panel" id="progress-panel" hidden><div><span id="progress-label"></span><button class="text-button" id="cancel-button">Cancel</button></div><progress id="progress-bar" max="100" value="0"></progress></div>
      <div class="batch-summary" id="batch-summary" hidden></div>
      <div class="sample-row" id="sample-row"><span>Just looking around?</span><button class="text-button" id="sample-button">Try a sample batch ${icon('arrow',15)}</button></div>
      <div class="privacy-card">${icon('lock',19)}<div><strong>Your files don’t leave this tab.</strong><p>Everything happens locally. No account, no uploads, no waiting in line.</p></div><span class="privacy-check">${icon('check',15)}</span></div>
      <div class="how-it-works"><div><span>01</span><strong>Drop it in</strong><p>A few files or the full batch.</p></div><div><span>02</span><strong>Make it fit</strong><p>Your format, size, and quality.</p></div><div><span>03</span><strong>Take it with you</strong><p>One tidy ZIP. All done.</p></div></div>
    </section>
    <aside class="settings-panel" aria-label="Export settings">
      <div class="settings-heading"><div class="section-label"><span class="step">02</span><h2>Make it yours</h2></div><button class="icon-button" id="reset-button" aria-label="Reset settings" title="Reset settings">${icon('refresh',17)}</button></div>
      <form id="settings-form">
        <fieldset class="settings-section"><legend>Convert to</legend><div class="format-options" role="group" aria-label="Output format">${(['jpeg','png','webp','gif','bmp','tiff'] as Format[]).map(format => `<button type="button" class="format-button ${format === 'jpeg' ? 'selected' : ''}" data-format="${format}" aria-pressed="${format === 'jpeg'}">${extensions[format].toUpperCase()}</button>`).join('')}</div><p class="field-hint" id="format-hint">The everyday favorite. Small files, ready for anything.</p></fieldset>
        <div class="settings-section quality-section"><div class="field-label"><label for="quality">Quality</label><output for="quality" id="quality-value">85<span>%</span></output></div><input type="range" id="quality" min="1" max="100" value="85"/><div class="range-labels"><span>Smaller file</span><span>Better quality</span></div></div>
        <fieldset class="settings-section"><legend>${icon('resize',16)} Resize</legend><div class="select-wrap"><select id="resize" aria-label="Resize mode"><option value="original">Keep original dimensions</option><option value="fit">Fit within dimensions</option><option value="percentage">Scale by percentage</option><option value="exact">Exact dimensions (stretch)</option></select>${icon('chevron',16)}</div><div class="dimension-controls" id="dimension-controls" hidden><div class="dimensions"><label>Width<div class="input-unit"><input id="width" type="number" value="1920" min="1" max="32767" step="1"/><span>px</span></div></label><span class="dimension-times">×</span><label>Height<div class="input-unit"><input id="height" type="number" value="1080" min="1" max="32767" step="1"/><span>px</span></div></label></div><p class="field-hint" id="resize-hint">Keeps the aspect ratio. Fits inside this box.</p></div><div id="percentage-control" hidden><label class="input-unit percentage-input"><input id="percentage" aria-label="Scale percentage" type="number" min="1" max="400" step="1" value="50"/><span>%</span></label></div><label class="checkbox-label" id="upscale-control" hidden><input type="checkbox" id="upscale"/> Allow enlarging smaller images</label></fieldset>
        <fieldset class="settings-section size-section"><div class="field-label"><label class="toggle-label" for="limit-enabled">${icon('compress',16)} Limit file size</label><label class="switch"><input type="checkbox" id="limit-enabled" aria-label="Limit file size"/><span></span></label></div><p class="field-hint">A little lighter. A perfect fit.</p><div id="limit-controls" hidden><div class="size-input"><input id="max-size" aria-label="Maximum file size" type="number" min="1" max="1000000000" value="500" step="1"/><select id="size-unit" aria-label="File size unit"><option value="1">bytes</option><option value="1000" selected>KB</option><option value="1000000">MB</option></select></div><label class="checkbox-label"><input type="checkbox" id="auto-resize" checked/> Reduce dimensions if needed</label><p class="field-hint">At most this many bytes per image. 1 KB = 1,000 bytes.</p></div></fieldset>
        <details class="advanced settings-section"><summary>Finishing touches ${icon('chevron',16)}</summary><div class="advanced-content"><label for="suffix">Add to file names</label><input type="text" id="suffix" value="-still" placeholder="e.g. -web" maxlength="60"/><label class="background-label" for="background">JPG & BMP background<input type="color" id="background" value="#ffffff"/></label><p class="field-hint">Transparent areas use this color in JPG and BMP.</p></div></details>
      </form>
      <div class="export-section"><div class="export-detail"><span id="export-count">Your batch, ready when you are.</span><span>.zip</span></div><button class="button button-primary" id="convert-button" disabled>${icon('spark',18)} Convert images ${icon('arrow',18)}</button><button class="button button-download" id="download-button" hidden>${icon('download',18)} Download ZIP <span id="zip-size"></span></button><p class="export-note" id="export-note">Add a few images to get started.</p><p class="animation-note">Animated images & multi-page files export as a still image (first frame or page). Metadata is removed.</p></div>
    </aside>
  </div>
  <footer><span>Made for your images. Mindful of your privacy.</span><span class="footer-local">${icon('leaf',14)} <span id="offline-status">A little less cloud. A little more you.</span></span></footer>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="about-dialog" class="dialog about-dialog"><button class="icon-button dialog-close" data-close="about-dialog" aria-label="Close about">${icon('close')}</button><span class="brand-mark">${icon('images',25)}</span><h2>A little studio.<br>All yours.</h2><p>Still converts and resizes your images entirely in your browser. Your images are never uploaded, and there are no analytics or accounts.</p><p>Import HEIC/HEIF, JPG, PNG, WebP, GIF, TIFF, AVIF, BMP, or other browser-supported images. Export JPG, PNG, WebP, GIF, BMP, and TIFF.</p><p>Size limits are verified against the final file. Quality may be lowered and dimensions may be reduced if you allow it. Files that can’t meet your limit are marked with an error and excluded from downloads.</p><p>Animated images use the first frame. TIFF and HEIC collections use the first image. Exports remove metadata and use 8-bit browser color. Keep your originals for HDR or print workflows.</p><p class="field-hint">Your images live only in this tab. Refreshing or closing it clears the batch. <a href="https://github.com/iebb/imgconv" target="_blank" rel="noopener noreferrer">View source on GitHub ↗</a></p></dialog>
<dialog id="preview-dialog" class="dialog preview-dialog"><div class="preview-header"><div><h2 id="preview-title"></h2><p id="preview-description"></p></div><button class="icon-button" data-close="preview-dialog" aria-label="Close preview">${icon('close')}</button></div><div class="preview-tabs"><button id="preview-original" class="selected">Original</button><button id="preview-result">Converted</button></div><div class="preview-image-wrap"><img id="preview-image" alt=""/></div><div class="preview-footer"><span>Preview · scaled to fit</span><button class="button button-small button-outline" id="preview-download">${icon('download',16)} Download image</button></div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
let format: Format = 'jpeg', toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
function settings(): Settings {
  const resize = $<HTMLSelectElement>('#resize').value as Settings['resize'];
  const number = (id: string, min: number, max: number) => {
    const value = Number(input(id).value);
    if (!input(id).value || !Number.isInteger(value) || value < min || value > max) throw new Error(`Enter a ${id.replace('-', ' ')} between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
    return value;
  };
  const width = resize === 'fit' || resize === 'exact' ? number('width', 1, 32767) : 1920;
  const height = resize === 'fit' || resize === 'exact' ? number('height', 1, 32767) : 1080;
  const percentage = resize === 'percentage' ? number('percentage', 1, 400) : 50;
  const maxBytes = input('limit-enabled').checked ? number('max-size', 1, 1e9) * Number($<HTMLSelectElement>('#size-unit').value) : null;
  return { format, quality: Number(input('quality').value) / 100, resize, width, height, percentage, upscale: input('upscale').checked, maxBytes, autoResize: input('auto-resize').checked, background: input('background').value, suffix: input('suffix').value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() };
}

function releaseResult(job: Job) {
  if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
  if (job.outputThumbnail) URL.revokeObjectURL(job.outputThumbnail);
  job.result = undefined; job.outputUrl = undefined; job.outputThumbnail = undefined; job.outputName = undefined;
}
function invalidate() {
  for (const job of jobs) {
    releaseResult(job);
    if (job.info) { job.status = 'ready'; job.error = undefined; }
  }
  render();
}
function updateControls() {
  const mode = $<HTMLSelectElement>('#resize').value;
  $('#dimension-controls').hidden = !['fit','exact'].includes(mode);
  $('#percentage-control').hidden = mode !== 'percentage';
  $('#upscale-control').hidden = mode === 'original';
  $('#resize-hint').textContent = mode === 'exact' ? 'Stretches to these dimensions. May change the aspect ratio.' : 'Keeps the aspect ratio. Fits inside this box.';
  $('#limit-controls').hidden = !input('limit-enabled').checked;
  const lossless = ['png','bmp','tiff'].includes(format);
  input('quality').disabled = lossless;
  $('.quality-section').classList.toggle('is-disabled', lossless);
  $('#quality-value').innerHTML = lossless ? '<span>Lossless</span>' : `${input('quality').value}<span>%</span>`;
  $('#format-hint').textContent = ({ jpeg: 'The everyday favorite. Small files, ready for anything.', png: 'Lossless detail, with room for transparency.', webp: 'Made for the web. Light, sharp, and transparent.', gif: 'A still image with up to 256 colors. Quality sets the palette size.', bmp: 'Uncompressed pixels. Broad compatibility, larger files.', tiff: 'Lossless, uncompressed images with transparency.' })[format];
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-format]')) {
    const selected = button.dataset.format === format; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
}

function render() {
  const done = jobs.filter(job => job.status === 'done'), ready = jobs.filter(job => job.info);
  const locked = busy || importing || zipBusy;
  $('#file-count').textContent = String(jobs.length);
  $('#clear-button').hidden = jobs.length === 0;
  $<HTMLButtonElement>('#clear-button').disabled = locked;
  $<HTMLButtonElement>('#add-button').disabled = locked;
  $<HTMLButtonElement>('#sample-button').disabled = locked;
  $<HTMLButtonElement>('#reset-button').disabled = locked;
  $('#dropzone').classList.toggle('compact', jobs.length > 0);
  $('#dropzone').setAttribute('aria-disabled', String(locked));
  $('#batch-toolbar').hidden = jobs.length === 0;
  $('#sample-row').hidden = jobs.length > 0;
  $('#batch-description').textContent = `${jobs.length} ${jobs.length === 1 ? 'image' : 'images'} · ${bytes(jobs.reduce((sum, job) => sum + job.file.size, 0))} original`;
  $('#image-grid').innerHTML = jobs.map(job => {
    const title = job.file.name;
    const label = { loading: 'Reading image…', ready: 'Ready to convert', processing: 'Converting…', done: 'All set', error: 'Needs attention' }[job.status];
    return `<article class="image-card ${job.status}" data-id="${job.id}"><div class="image-card-art checkerboard">${job.thumbnail ? `<button class="image-preview-button" data-preview="${job.id}" aria-label="Preview ${escape(title)}"><img src="${job.outputThumbnail || job.thumbnail}" alt="${escape(title)}"/><span class="preview-affordance">${icon('expand',17)}</span></button>` : `<span class="file-placeholder">${icon('images',32)}</span>`}<span class="file-type">${escape(job.result ? extensions[format].toUpperCase() : title.split('.').pop()?.toUpperCase().slice(0,6) || 'IMAGE')}</span><button class="remove-image icon-button" data-remove="${job.id}" aria-label="Remove ${escape(title)}" ${locked ? 'disabled' : ''}>${icon('close',14)}</button></div><div class="image-card-details"><h3 title="${escape(title)}">${escape(title)}</h3><p>${job.info ? `${job.info.width.toLocaleString()} × ${job.info.height.toLocaleString()}` : 'Reading dimensions'} <span>·</span> ${bytes(job.file.size)}</p><div class="image-status"><span class="status-${job.status}">${job.status === 'done' ? icon('check',12) : job.status === 'processing' || job.status === 'loading' ? '<span class="spinner"></span>' : '<span class="tiny-dot"></span>'}${label}</span>${job.result ? `<button class="card-download" data-download="${job.id}" aria-label="Download ${escape(job.outputName || title)}">${bytes(job.result.blob.size)} ${icon('download',13)}</button>` : ''}</div>${job.result ? `<p class="result-dimensions">${job.result.width} × ${job.result.height} px${job.result.reduced ? ' · resized to fit limit' : ''}</p>` : ''}${job.error ? `<p class="image-error">${escape(job.error)}</p>` : ''}</div></article>`;
  }).join('');
  $('#export-count').textContent = jobs.length ? `${ready.length} ${ready.length === 1 ? 'image' : 'images'} · one tidy download` : 'Your batch, ready when you are.';
  const convertButton = $<HTMLButtonElement>('#convert-button');
  convertButton.disabled = locked || ready.length === 0;
  convertButton.innerHTML = busy ? '<span class="spinner"></span> Converting images…' : `${icon('spark',18)} ${done.length ? 'Convert again' : `Convert${ready.length ? ' ' + ready.length : ''} ${ready.length === 1 ? 'image' : 'images'}`} ${icon('arrow',18)}`;
  const downloadButton = $<HTMLButtonElement>('#download-button');
  downloadButton.hidden = done.length === 0 || busy; downloadButton.disabled = locked;
  $('#zip-size').textContent = bytes(done.reduce((sum, job) => sum + job.result!.blob.size, 0));
  $('#export-note').textContent = importing ? 'Reading your images locally…' : done.length ? `${done.length} converted${jobs.length > done.length ? ` · ${jobs.length - done.length} excluded` : ''}. Your ZIP is ready.` : ready.length ? 'Same settings for every image. Originals stay untouched.' : 'Add a few images to get started.';
  $('#batch-summary').hidden = !done.length || busy;
  if (done.length && !busy) {
    const original = done.reduce((sum, job) => sum + job.file.size, 0), output = done.reduce((sum, job) => sum + job.result!.blob.size, 0);
    const savings = original ? Math.round((1 - output / original) * 100) : 0;
    $('#batch-summary').innerHTML = `<span class="summary-icon">${icon('check',20)}</span><div><strong>${done.length === jobs.length ? 'Good things come in batches.' : `${done.length} images are ready.`}</strong><p>${bytes(original)} ${icon('arrow',12)} ${bytes(output)}${savings > 0 ? ` <span class="savings">${savings}% lighter</span>` : ''}</p></div><span class="summary-format">${extensions[format].toUpperCase()}</span>`;
  }
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#settings-form input, #settings-form select, #settings-form button')) el.disabled = locked;
  if (!locked) updateControls();
}

async function addFiles(files: File[]) {
  if (busy || importing || zipBusy || !files.length) return;
  importing = true; render();
  let duplicates = 0;
  for (const file of files) {
    if (jobs.some(job => job.file.name === file.name && job.file.size === file.size && job.file.lastModified === file.lastModified)) { duplicates++; continue; }
    const job: Job = { id: ++nextJobId, file, status: 'loading' };
    jobs.push(job); render();
    try {
      job.info = await callWorker({ action: 'inspect', file }) as ImageInfo;
      job.thumbnail = URL.createObjectURL(job.info.thumbnail); job.status = 'ready';
    } catch (error) { job.status = 'error'; job.error = error instanceof Error ? error.message : 'Could not read this image.'; }
    render();
  }
  importing = false; render();
  if (duplicates) toast(`${duplicates} duplicate ${duplicates === 1 ? 'file was' : 'files were'} skipped.`);
}

function uniqueName(file: File, s: Settings, names: Set<string>) {
  const base = (file.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'image') + s.suffix;
  const ext = extensions[s.format];
  let name = `${base}.${ext}`, i = 2;
  while (names.has(name.toLocaleLowerCase())) name = `${base}-${i++}.${ext}`;
  names.add(name.toLocaleLowerCase()); return name;
}

async function convertBatch() {
  let s: Settings;
  try { s = settings(); } catch (error) { toast((error as Error).message); return; }
  busy = true; cancelled = false;
  for (const job of jobs) { releaseResult(job); if (job.info) { job.status = 'ready'; job.error = undefined; } }
  const batch = jobs.filter(job => job.info), names = new Set<string>();
  $('#progress-panel').hidden = false; input('progress-bar').value = '0'; render();
  let completed = 0;
  for (const job of batch) {
    if (cancelled) break;
    job.status = 'processing'; $('#progress-label').textContent = `Giving image ${completed + 1} of ${batch.length} a fresh start…`; render();
    try {
      const result = await callWorker({ action: 'convert', file: job.file, settings: s }) as ConversionResult;
      job.result = result; job.outputUrl = URL.createObjectURL(result.blob); job.outputThumbnail = URL.createObjectURL(result.thumbnail);
      job.outputName = uniqueName(job.file, s, names); job.status = 'done';
    } catch (error) {
      if (cancelled) job.status = 'ready';
      else { job.status = 'error'; job.error = (error as Error).message; }
    }
    completed++; input('progress-bar').value = String(completed / batch.length * 100); render();
  }
  busy = false; $('#progress-panel').hidden = true; render();
  if (cancelled) toast('Batch stopped. Completed images are still available.');
  else if (jobs.some(job => job.status === 'error')) toast('Some images need attention. See the message below each file.');
}

function download(url: string, name: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
}
async function downloadZip() {
  const converted = jobs.filter(job => job.result);
  if (!converted.length || zipBusy || busy) return;
  zipBusy = true; render();
  const button = $('#download-button'), original = button.innerHTML; button.innerHTML = '<span class="spinner"></span> Packing your images…';
  try {
    const { zip } = await import('fflate');
    // A null-prototype map preserves filenames such as __proto__ safely.
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const job of converted) entries[job.outputName!] = new Uint8Array(await job.result!.blob.arrayBuffer());
    const result = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      zip(entries, { level: 0 }, (error, data) => error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>));
    });
    const url = URL.createObjectURL(new Blob([result], { type: 'application/zip' }));
    download(url, `still-images-${new Date().toISOString().slice(0, 10)}.zip`); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`${converted.length} ${converted.length === 1 ? 'image' : 'images'}, neatly zipped. Enjoy!`);
  } catch (error) { toast(`Could not create ZIP: ${(error as Error).message}`); }
  finally { zipBusy = false; button.innerHTML = original; render(); }
}

function preview(id: number, converted = false) {
  const job = jobs.find(job => job.id === id); if (!job?.thumbnail) return;
  activePreview = id;
  $('#preview-title').textContent = converted && job.outputName ? job.outputName : job.file.name;
  const info = converted && job.result ? job.result : job.info!;
  $('#preview-description').textContent = `${info.width} × ${info.height} px · ${bytes(converted && job.result ? job.result.blob.size : job.file.size)}`;
  $<HTMLImageElement>('#preview-image').src = converted && job.outputThumbnail ? job.outputThumbnail : job.thumbnail;
  $<HTMLImageElement>('#preview-image').alt = job.file.name;
  $('#preview-original').classList.toggle('selected', !converted); $('#preview-result').classList.toggle('selected', converted);
  $<HTMLButtonElement>('#preview-result').disabled = !job.result; $('#preview-download').hidden = !job.result;
  if (!$<HTMLDialogElement>('#preview-dialog').open) $<HTMLDialogElement>('#preview-dialog').showModal();
}

$('#add-button').addEventListener('click', () => input('file-input').click());
input('file-input').addEventListener('change', event => { void addFiles(Array.from((event.target as HTMLInputElement).files || [])); input('file-input').value = ''; });
$('#dropzone').addEventListener('click', () => { if (!busy && !importing && !zipBusy) input('file-input').click(); });
$('#dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#dropzone').click(); } });
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropzone').classList.add('dragging'); } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('dragging'); } });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('dragging'); if (event.dataTransfer) void addFiles(Array.from(event.dataTransfer.files)); });
$('#clear-button').addEventListener('click', () => { for (const job of jobs) { if (job.thumbnail) URL.revokeObjectURL(job.thumbnail); releaseResult(job); } jobs = []; render(); });
$('#image-grid').addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const remove = target.closest<HTMLElement>('[data-remove]'), previewButton = target.closest<HTMLElement>('[data-preview]'), downloadButton = target.closest<HTMLElement>('[data-download]');
  if (remove && !busy && !importing && !zipBusy) {
    const job = jobs.find(item => item.id === Number(remove.dataset.remove))!;
    if (job.thumbnail) URL.revokeObjectURL(job.thumbnail); releaseResult(job); jobs = jobs.filter(item => item !== job); render();
  } else if (previewButton) preview(Number(previewButton.dataset.preview), Boolean(jobs.find(job => job.id === Number(previewButton.dataset.preview))?.result));
  else if (downloadButton) { const job = jobs.find(item => item.id === Number(downloadButton.dataset.download))!; if (job.outputUrl) download(job.outputUrl, job.outputName!); }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-format]')) button.addEventListener('click', () => { format = button.dataset.format as Format; updateControls(); invalidate(); });
$('#settings-form').addEventListener('submit', event => event.preventDefault());
$('#settings-form').addEventListener('input', () => { updateControls(); invalidate(); });
$('#reset-button').addEventListener('click', () => { $<HTMLFormElement>('#settings-form').reset(); format = 'jpeg'; updateControls(); invalidate(); toast('Back to a fresh set of settings.'); });
$('#convert-button').addEventListener('click', () => void convertBatch());
$('#download-button').addEventListener('click', () => void downloadZip());
$('#cancel-button').addEventListener('click', () => { cancelled = true; worker.terminate(); for (const handler of pending.values()) handler.reject(new Error('Cancelled')); pending.clear(); startWorker(); });
$('#help-button').addEventListener('click', () => $<HTMLDialogElement>('#about-dialog').showModal());
for (const button of document.querySelectorAll<HTMLElement>('[data-close]')) button.addEventListener('click', () => $<HTMLDialogElement>(`#${button.dataset.close}`).close());
for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
$('#preview-original').addEventListener('click', () => activePreview !== null && preview(activePreview));
$('#preview-result').addEventListener('click', () => activePreview !== null && preview(activePreview, true));
$('#preview-download').addEventListener('click', () => { const job = jobs.find(job => job.id === activePreview); if (job?.outputUrl) download(job.outputUrl, job.outputName!); });

async function sampleBatch() {
  $<HTMLButtonElement>('#sample-button').disabled = true;
  const samples = [
    { name: 'alpine-morning.png', sky: '#d8e5dc', sun: '#fff3c1', far: '#8ca18d', near: '#3e6554', style: 0 },
    { name: 'slow-afternoon.png', sky: '#f1d9c2', sun: '#fff2cd', far: '#bc8e71', near: '#7a5c43', style: 1 },
    { name: 'coastal-notes.png', sky: '#d9e7e6', sun: '#fdf4d4', far: '#92b3b2', near: '#4c777d', style: 2 },
  ];
  const files: File[] = [];
  for (const [index, s] of samples.entries()) {
    const canvas = document.createElement('canvas'); canvas.width = index === 1 ? 1200 : 1600; canvas.height = 1200;
    const ctx = canvas.getContext('2d')!, w = canvas.width, h = canvas.height;
    const gradient = ctx.createLinearGradient(0,0,0,h); gradient.addColorStop(0,s.sky); gradient.addColorStop(1,'#f4edda'); ctx.fillStyle=gradient; ctx.fillRect(0,0,w,h);
    ctx.fillStyle=s.sun; ctx.beginPath();ctx.arc(w*.74,h*.26,90,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=s.far; ctx.beginPath();ctx.moveTo(0,h*.75);ctx.lineTo(w*.33,h*.23);ctx.lineTo(w*.69,h*.8);ctx.lineTo(w,h*.44);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
    ctx.fillStyle='#e9e7d7';ctx.beginPath();ctx.moveTo(w*.33,h*.23);ctx.lineTo(w*.23,h*.48);ctx.lineTo(w*.33,h*.42);ctx.lineTo(w*.44,h*.51);ctx.fill();
    ctx.fillStyle=s.near;ctx.beginPath();ctx.moveTo(0,h*.89);ctx.bezierCurveTo(w*.35,h*.45,w*.61,h*1.1,w,h*.65);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
    if(s.style===2){ctx.fillStyle='#b2ccc8';ctx.fillRect(0,h*.8,w,h*.2);ctx.fillStyle='#d4e3da';for(let i=0;i<8;i++){ctx.fillRect(w*.1+i*117,h*.84+i*17,80+i*8,2);}}
    // A subtle deterministic grain also gives compression a realistic workload.
    const data=ctx.getImageData(0,0,w,h);let seed=73+index;for(let i=0;i<data.data.length;i+=4){seed=(seed*16807)%2147483647;const grain=(seed%9)-4;for(let c=0;c<3;c++)data.data[i+c]+=grain;}ctx.putImageData(data,0,0);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    files.push(new File([blob],s.name,{type:'image/png',lastModified:1}));
  }
  await addFiles(files);
}
$('#sample-button').addEventListener('click', () => void sampleBatch());

render();
