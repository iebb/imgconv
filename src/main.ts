import './style.css';
import { icon } from './icons';
import { detectLocale, getLocale, languageInfo, languages, number, setLocale, t, type Locale, type MessageKey, type Params } from './i18n';
import { AppError, issue, type Issue } from './errors';
import type { ConversionResult, Format, ImageInfo, Settings, WorkerReply, WorkerRequest } from './types';

interface Job {
  id: number; file: File; info?: ImageInfo; thumbnail?: string;
  status: 'loading' | 'ready' | 'processing' | 'done' | 'error';
  error?: Issue; result?: ConversionResult; outputUrl?: string; outputThumbnail?: string; outputName?: string;
}
const app = document.querySelector<HTMLDivElement>('#app')!;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let savedLanguage: string | null = null;
try { savedLanguage = localStorage.getItem('resz-language'); } catch { /* Storage can be unavailable in private browsing. */ }
setLocale(detectLocale(new URL(location.href).searchParams.get('lang'), savedLanguage, navigator.languages));
const tr = (key: MessageKey) => `<span data-i18n="${key}">${escape(t(key))}</span>`;
const aria = (key: MessageKey) => `aria-label="${escape(t(key))}" data-i18n-aria="${key}"`;
const option = (value: string, key: MessageKey) => `<option value="${value}" data-i18n="${key}">${escape(t(key))}</option>`;
const bytes = (value: number) => value < 1000 ? `${number(value)} ${t('unitBytes')}` : value < 1e6 ? `${number(value / 1000, value < 10000 ? 1 : 0)} KB` : `${number(value / 1e6, 1)} MB`;
const dimensions = (width: number, height: number) => `<bdi dir="ltr">${number(width)} × ${number(height)}</bdi> ${escape(t('pixel'))}`;
const extensions: Record<Format, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', tiff: 'tiff' };
const formatKeys: Record<Format, MessageKey> = { jpeg: 'formatJpeg', png: 'formatPng', webp: 'formatWebp', gif: 'formatGif', bmp: 'formatBmp', tiff: 'formatTiff' };
const statusKeys: Record<Job['status'], MessageKey> = { loading: 'statusLoading', ready: 'statusReady', processing: 'statusProcessing', done: 'statusDone', error: 'statusError' };
let jobs: Job[] = [], nextJobId = 0, busy = false, importing = false, cancelled = false, requestId = 0;
let zipBusy = false, sampleBusy = false, activePreview: number | null = null, previewConverted = false;
let progressState = { current: 0, total: 0, completed: 0 };
let worker: Worker;
const pending = new Map<number, { resolve: (result: ImageInfo | ConversionResult) => void; reject: (error: Error) => void }>();
function startWorker() {
  worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const message = event.data, handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.ok) handler.resolve(message.result);
    else handler.reject(new AppError(message.error.code, message.error.params));
  };
  worker.onerror = () => {
    for (const handler of pending.values()) handler.reject(new AppError('errorWorker'));
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
  <a class="brand" href="./" ${aria('home')}><span class="brand-mark">${icon('images', 25)}</span><bdi dir="ltr">resz<span class="brand-dot">.im</span></bdi><span class="brand-caption">${tr('brandCaption')}</span></a>
  <div class="header-right"><span class="local-status"><span class="status-dot"></span>${tr('localOnly')}</span><label class="language-picker">${icon('globe')}<span class="sr-only">${tr('language')}</span><select id="language" ${aria('language')}>${languages.map(language => `<option value="${language.code}" lang="${language.code}" dir="${language.direction}">${language.name}</option>`).join('')}</select></label><button class="icon-button help-button" id="help-button" ${aria('about')}>${icon('info')}</button></div>
</header>
<main class="page">
  <div class="intro"><div><p class="eyebrow">${tr('eyebrow')}</p><h1>${tr('heroTitle')}</h1><p class="intro-copy">${tr('heroSubtitle')}</p></div><div class="intro-note">${icon('shield', 26)}<span>${tr('noUpload')}<br><strong>${tr('browserOnly')}</strong></span></div></div>
  <div class="workspace">
    <section class="image-workspace" ${aria('workspace')}>
      <div class="section-heading"><div class="section-label"><span class="step" aria-hidden="true">01</span><h2>${tr('images')}</h2><span class="count-badge" id="file-count">0</span></div><div class="workspace-actions"><button class="text-button" id="clear-button" hidden>${tr('clearAll')}</button><button class="button button-small button-outline" id="add-button">${icon('plus')} ${tr('addImages')}</button></div></div>
      <input type="file" id="file-input" multiple accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp" hidden />
      <div class="dropzone" id="dropzone" role="button" tabindex="0" ${aria('chooseImages')}>
        <div class="image-stack" aria-hidden="true"><div class="art-card art-back"></div><div class="art-card art-middle"></div><div class="art-card art-front"><svg viewBox="0 0 176 128"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#e5edda"/><stop offset="1" stop-color="#cbd6bf"/></linearGradient></defs><rect width="176" height="128" fill="url(#sky)"/><circle cx="127" cy="33" r="14" fill="#f8f2c9"/><path d="M0 100 59 40l65 88H0Z" fill="#85957a"/><path d="m59 40-18 45 18-10 22 22Z" fill="#e9eadb"/><path d="m57 128 60-69 59 61v8Z" fill="#4a6750"/><path d="m117 59-19 40 20-9 17 17Z" fill="#bccbb0"/><path d="M0 115q39-10 75 3t101-6v16H0Z" fill="#304d39"/></svg></div><span class="stack-plus">${icon('plus')}</span></div>
        <h3>${tr('dropTitle')}</h3><p>${tr('dropLead')} <span class="inline-link">${tr('browseFiles')}</span></p><span class="supported">${tr('supported')}</span><span class="drop-caption">${tr('dropCaption')}</span>
      </div>
      <div class="batch-toolbar" id="batch-toolbar" hidden><span id="batch-description"></span><span class="view-label">${icon('grid',18)} ${tr('gridView')}</span></div>
      <div class="image-grid" id="image-grid"></div>
      <div class="progress-panel" id="progress-panel" hidden><div><span id="progress-label"></span><button class="text-button" id="cancel-button">${tr('cancel')}</button></div><progress id="progress-bar" max="100" value="0" ${aria('statusProcessing')}></progress></div>
      <div class="batch-summary" id="batch-summary" hidden></div>
      <div class="sample-row" id="sample-row"><span>${tr('samplePrompt')}</span><button class="text-button" id="sample-button">${tr('sampleButton')} ${icon('arrow',18)}</button></div>
      <div class="privacy-card">${icon('lock',24)}<div><strong>${tr('privacyTitle')}</strong><p>${tr('privacyBody')}</p></div><span class="privacy-check">${icon('check',20)}</span></div>
      <div class="how-it-works"><div><span aria-hidden="true">01</span><strong>${tr('stepImport')}</strong><p>${tr('stepImportHint')}</p></div><div><span aria-hidden="true">02</span><strong>${tr('stepAdjust')}</strong><p>${tr('stepAdjustHint')}</p></div><div><span aria-hidden="true">03</span><strong>${tr('stepExport')}</strong><p>${tr('stepExportHint')}</p></div></div>
    </section>
    <aside class="settings-panel" ${aria('exportSettings')}>
      <div class="settings-heading"><div class="section-label"><span class="step" aria-hidden="true">02</span><h2>${tr('exportSettings')}</h2></div><button class="icon-button" id="reset-button" ${aria('resetSettings')}>${icon('refresh')}</button></div>
      <form id="settings-form">
        <fieldset class="settings-section"><legend>${tr('convertTo')}</legend><div class="format-options" role="group" ${aria('convertTo')}>${(['jpeg','png','webp','gif','bmp','tiff'] as Format[]).map(format => `<button type="button" class="format-button ${format === 'jpeg' ? 'selected' : ''}" data-format="${format}" aria-pressed="${format === 'jpeg'}">${extensions[format].toUpperCase()}</button>`).join('')}</div><p class="field-hint" id="format-hint"></p></fieldset>
        <div class="settings-section quality-section"><div class="field-label"><label for="quality">${tr('quality')}</label><output for="quality" id="quality-value"></output></div><input type="range" id="quality" min="1" max="100" value="85" ${aria('quality')}/><div class="range-labels"><span>${tr('smallerFile')}</span><span>${tr('betterQuality')}</span></div></div>
        <fieldset class="settings-section"><legend>${icon('resize')} ${tr('resize')}</legend><div class="select-wrap"><select id="resize" ${aria('resizeMode')}>${option('original','resizeOriginal')}${option('fit','resizeFit')}${option('percentage','resizePercentage')}${option('exact','resizeExact')}</select>${icon('chevron')}</div><div class="dimension-controls" id="dimension-controls" hidden><div class="dimensions"><label for="width">${tr('width')}<span class="input-unit"><input id="width" type="number" value="1920" min="1" max="32767" step="1"/><span>${tr('pixel')}</span></span></label><span class="dimension-times" aria-hidden="true">×</span><label for="height">${tr('height')}<span class="input-unit"><input id="height" type="number" value="1080" min="1" max="32767" step="1"/><span>${tr('pixel')}</span></span></label></div><p class="field-hint" id="resize-hint"></p></div><div id="percentage-control" hidden><label class="input-unit percentage-input"><span class="sr-only">${tr('scalePercentage')}</span><input id="percentage" type="number" min="1" max="400" step="1" value="50"/><span>%</span></label></div><label class="checkbox-label" id="upscale-control" hidden><input type="checkbox" id="upscale"/>${tr('allowUpscale')}</label></fieldset>
        <fieldset class="settings-section size-section"><div class="field-label"><label class="toggle-label" for="limit-enabled">${icon('compress')} ${tr('limitSize')}</label><label class="switch"><input type="checkbox" id="limit-enabled" ${aria('limitSize')}/><span></span></label></div><p class="field-hint">${tr('limitHint')}</p><div id="limit-controls" hidden><div class="size-input"><input id="max-size" ${aria('maxSize')} type="number" min="1" max="1000000000" value="500" step="1"/><select id="size-unit" ${aria('sizeUnit')}>${option('1','unitBytes')}<option value="1000" selected>KB</option><option value="1000000">MB</option></select></div><label class="checkbox-label"><input type="checkbox" id="auto-resize" checked/>${tr('autoResize')}</label><p class="field-hint">${tr('limitHelp')}</p></div></fieldset>
        <details class="advanced settings-section"><summary>${tr('advanced')} ${icon('chevron')}</summary><div class="advanced-content"><label for="suffix">${tr('suffix')}</label><input type="text" id="suffix" value="-resz" placeholder="${escape(t('suffixPlaceholder'))}" data-i18n-placeholder="suffixPlaceholder" maxlength="60"/><label class="background-label" for="background">${tr('background')}<input type="color" id="background" value="#ffffff"/></label><p class="field-hint">${tr('backgroundHint')}</p></div></details>
      </form>
      <div class="export-section"><div class="export-detail"><span id="export-count"></span><bdi dir="ltr">.zip</bdi></div><button class="button button-primary" id="convert-button" disabled></button><button class="button button-download" id="download-button" hidden></button><p class="export-note" id="export-note"></p><p class="animation-note">${tr('animationNote')}</p></div>
    </aside>
  </div>
  <footer><span>${tr('footer')}</span><span class="footer-local">${icon('leaf',20)} ${tr('footerLocal')}</span></footer>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="about-dialog" class="dialog about-dialog"><button class="icon-button dialog-close" data-close="about-dialog" ${aria('closeAbout')}>${icon('close')}</button><span class="brand-mark">${icon('images',25)}</span><h2>${tr('aboutTitle')}</h2><p>${tr('aboutPrivacy')}</p><p>${tr('aboutFormats')}</p><p>${tr('aboutLimits')}</p><p>${tr('aboutColor')}</p><p>${tr('aboutSession')}</p><p><a href="https://github.com/iebb/imgconv" target="_blank" rel="noopener noreferrer">${tr('source')} ↗</a></p></dialog>
<dialog id="preview-dialog" class="dialog preview-dialog"><div class="preview-header"><div><h2 id="preview-title" dir="auto"></h2><p id="preview-description"></p></div><button class="icon-button" data-close="preview-dialog" ${aria('closePreview')}>${icon('close')}</button></div><div class="preview-tabs"><button id="preview-original" class="selected">${tr('original')}</button><button id="preview-result">${tr('converted')}</button></div><div class="preview-image-wrap"><img id="preview-image" alt=""/></div><div class="preview-footer"><span>${tr('previewHint')}</span><button class="button button-small button-outline" id="preview-download">${icon('download')} ${tr('downloadImage')}</button></div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
let format: Format = 'jpeg', toastTimer: ReturnType<typeof setTimeout>;
let currentToast: { key: MessageKey; params: Params } | null = null;
function translatedParams(params: Params): Params {
  return typeof params.field === 'string' ? { ...params, field: t(params.field as MessageKey) } : params;
}
function toast(key: MessageKey, params: Params = {}) {
  currentToast = { key, params };
  clearTimeout(toastTimer); $('#toast').textContent = t(key, translatedParams(params)); $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; currentToast = null; }, 6500);
}
function errorText(error: Issue) { return t(error.code, translatedParams(error.params)); }
function applyLanguage() {
  document.documentElement.lang = getLocale(); document.documentElement.dir = languageInfo().direction;
  document.title = t('appTitle'); document.querySelector('meta[name="description"]')?.setAttribute('content', t('metaDescription'));
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.dataset.i18n as MessageKey);
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.dataset.i18nAria as MessageKey));
  for (const element of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder as MessageKey);
  $<HTMLSelectElement>('#language').value = getLocale();
  if (currentToast) $('#toast').textContent = t(currentToast.key, translatedParams(currentToast.params));
  render();
  if ($<HTMLDialogElement>('#preview-dialog').open && activePreview !== null) preview(activePreview, previewConverted);
}
function validNumber(id: string, field: MessageKey, min: number, max: number) {
  const value = Number(input(id).value);
  if (!input(id).value || !Number.isInteger(value) || value < min || value > max) throw new AppError('invalidNumber', { field, min, max });
  return value;
}
function settings(): Settings {
  const resize = $<HTMLSelectElement>('#resize').value as Settings['resize'];
  const width = ['fit','exact'].includes(resize) ? validNumber('width','width',1,32767) : 1920;
  const height = ['fit','exact'].includes(resize) ? validNumber('height','height',1,32767) : 1080;
  const percentage = resize === 'percentage' ? validNumber('percentage','scalePercentage',1,400) : 50;
  const maxBytes = input('limit-enabled').checked ? validNumber('max-size','maxSize',1,1e9) * Number($<HTMLSelectElement>('#size-unit').value) : null;
  return { format, quality: Number(input('quality').value) / 100, resize, width, height, percentage, upscale: input('upscale').checked, maxBytes, autoResize: input('auto-resize').checked, background: input('background').value, suffix: input('suffix').value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() };
}
function releaseResult(job: Job) {
  if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
  if (job.outputThumbnail) URL.revokeObjectURL(job.outputThumbnail);
  job.result = undefined; job.outputUrl = undefined; job.outputThumbnail = undefined; job.outputName = undefined;
}
function invalidate() {
  for (const job of jobs) { releaseResult(job); if (job.info) { job.status = 'ready'; job.error = undefined; } }
  render();
}
function updateControls() {
  const mode = $<HTMLSelectElement>('#resize').value;
  $('#dimension-controls').hidden = !['fit','exact'].includes(mode);
  $('#percentage-control').hidden = mode !== 'percentage'; $('#upscale-control').hidden = mode === 'original';
  $('#resize-hint').textContent = t(mode === 'exact' ? 'exactHint' : 'fitHint');
  $('#limit-controls').hidden = !input('limit-enabled').checked;
  const lossless = ['png','bmp','tiff'].includes(format);
  input('quality').disabled = lossless || busy || importing || zipBusy || sampleBusy; $('.quality-section').classList.toggle('is-disabled', lossless);
  $('#quality-value').textContent = lossless ? t('lossless') : new Intl.NumberFormat(languageInfo().numberLocale, { style: 'percent' }).format(Number(input('quality').value) / 100);
  $('#format-hint').textContent = t(formatKeys[format]);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-format]')) {
    const selected = button.dataset.format === format; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
}
function render() {
  const done = jobs.filter(job => job.status === 'done'), ready = jobs.filter(job => job.info);
  const locked = busy || importing || zipBusy || sampleBusy;
  $('#file-count').textContent = number(jobs.length); $('#clear-button').hidden = jobs.length === 0;
  for (const id of ['clear-button','add-button','sample-button','reset-button']) $<HTMLButtonElement>(`#${id}`).disabled = locked;
  $('#dropzone').classList.toggle('compact', jobs.length > 0); $('#dropzone').setAttribute('aria-disabled', String(locked));
  $('#batch-toolbar').hidden = jobs.length === 0; $('#sample-row').hidden = jobs.length > 0;
  $('#batch-description').textContent = `${t('countImages',{count:jobs.length})} · ${t('originalSize',{size:bytes(jobs.reduce((sum,job) => sum + job.file.size,0))})}`;
  $('#image-grid').innerHTML = jobs.map(job => {
    const title = job.file.name, label = t(statusKeys[job.status]);
    return `<article class="image-card ${job.status}" data-id="${job.id}"><div class="image-card-art checkerboard">${job.thumbnail ? `<button class="image-preview-button" data-preview="${job.id}" aria-label="${escape(t('previewFile',{file:title}))}"><img src="${job.outputThumbnail || job.thumbnail}" alt="${escape(title)}"/><span class="preview-affordance">${icon('expand')}</span></button>` : `<span class="file-placeholder">${icon('images',32)}</span>`}<bdi class="file-type" dir="ltr">${escape(job.result ? extensions[format].toUpperCase() : title.split('.').pop()?.toUpperCase().slice(0,6) || '—')}</bdi><button class="remove-image icon-button" data-remove="${job.id}" aria-label="${escape(t('removeFile',{file:title}))}" ${locked ? 'disabled' : ''}>${icon('close',18)}</button></div><div class="image-card-details"><h3 dir="auto" title="${escape(title)}">${escape(title)}</h3><p>${job.info ? dimensions(job.info.width,job.info.height) : escape(t('readingDimensions'))} · <bdi>${bytes(job.file.size)}</bdi></p><div class="image-status"><span class="status-${job.status}">${job.status === 'done' ? icon('check',18) : ['processing','loading'].includes(job.status) ? '<span class="spinner"></span>' : '<span class="tiny-dot"></span>'}${escape(label)}</span>${job.result ? `<button class="card-download" data-download="${job.id}" aria-label="${escape(t('downloadFile',{file:job.outputName || title}))}"><bdi>${bytes(job.result.blob.size)}</bdi> ${icon('download',18)}</button>` : ''}</div>${job.result ? `<p class="result-dimensions">${dimensions(job.result.width,job.result.height)}${job.result.reduced ? ` · ${escape(t('resultResized'))}` : ''}</p>` : ''}${job.error ? `<p class="image-error">${escape(errorText(job.error))}</p>` : ''}</div></article>`;
  }).join('');
  $('#export-count').textContent = jobs.length ? t('exportCount',{count:ready.length}) : t('exportEmpty');
  const convertButton = $<HTMLButtonElement>('#convert-button');
  convertButton.disabled = locked || ready.length === 0;
  convertButton.innerHTML = busy ? `<span class="spinner"></span> ${escape(t('statusProcessing'))}` : `${icon('spark')} ${escape(done.length ? t('convertAgain') : ready.length ? t('convertCount',{count:ready.length}) : t('convert'))} ${icon('arrow')}`;
  const downloadButton = $<HTMLButtonElement>('#download-button');
  downloadButton.hidden = done.length === 0 || busy; downloadButton.disabled = locked;
  downloadButton.innerHTML = zipBusy ? `<span class="spinner"></span> ${escape(t('packing'))}` : `${icon('download')} ${escape(t('downloadZip'))} <bdi class="zip-size">${bytes(done.reduce((sum,job) => sum + job.result!.blob.size,0))}</bdi>`;
  $('#export-note').textContent = importing || sampleBusy ? t('readingLocal') : done.length ? t('exportReady',{count:done.length}) + (jobs.length > done.length ? ` ${t('excluded',{count:jobs.length - done.length})}` : '') : ready.length ? t('sameSettings') : t('addToStart');
  $('#batch-summary').hidden = !done.length || busy;
  if (done.length && !busy) {
    const original = done.reduce((sum,job) => sum + job.file.size,0), output = done.reduce((sum,job) => sum + job.result!.blob.size,0);
    const savings = original ? Math.round((1 - output / original) * 100) : 0;
    $('#batch-summary').innerHTML = `<span class="summary-icon">${icon('check',24)}</span><div><strong>${escape(t('batchReady'))}</strong><p><bdi>${bytes(original)}</bdi> ${icon('arrow',18)} <bdi>${bytes(output)}</bdi>${savings > 0 ? `<span class="savings">${escape(t('savings',{percent:savings}))}</span>` : ''}</p></div><bdi class="summary-format" dir="ltr">${extensions[format].toUpperCase()}</bdi>`;
  }
  $('#progress-panel').hidden = !busy;
  $('#progress-label').textContent = t('progress', { current: progressState.current, total: progressState.total });
  $<HTMLProgressElement>('#progress-bar').value = progressState.total ? progressState.completed / progressState.total * 100 : 0;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#settings-form input, #settings-form select, #settings-form button')) el.disabled = locked;
  updateControls();
}
async function addFiles(files: File[]) {
  if (busy || importing || zipBusy || !files.length) return;
  importing = true; render(); let duplicates = 0;
  for (const file of files) {
    if (jobs.some(job => job.file.name === file.name && job.file.size === file.size && job.file.lastModified === file.lastModified)) { duplicates++; continue; }
    const job: Job = { id: ++nextJobId, file, status: 'loading' }; jobs.push(job); render();
    try { job.info = await callWorker({action:'inspect',file}) as ImageInfo; job.thumbnail = URL.createObjectURL(job.info.thumbnail); job.status = 'ready'; }
    catch (error) { job.status = 'error'; job.error = issue(error); }
    render();
  }
  importing = false; render(); if (duplicates) toast('duplicatesSkipped',{count:duplicates});
}
function uniqueName(file: File, s: Settings, names: Set<string>) {
  const base = (file.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'image') + s.suffix;
  const ext = extensions[s.format]; let name = `${base}.${ext}`, i = 2;
  while (names.has(name.toLowerCase())) name = `${base}-${i++}.${ext}`;
  names.add(name.toLowerCase()); return name;
}
async function convertBatch() {
  let s: Settings;
  try { s = settings(); } catch (error) { const problem = issue(error); toast(problem.code,problem.params); return; }
  busy = true; cancelled = false;
  for (const job of jobs) { releaseResult(job); if (job.info) { job.status = 'ready'; job.error = undefined; } }
  const batch = jobs.filter(job => job.info), names = new Set<string>();
  progressState = {current:0,total:batch.length,completed:0}; render();
  for (const job of batch) {
    if (cancelled) break;
    job.status = 'processing'; progressState.current = progressState.completed + 1; render();
    try {
      const result = await callWorker({action:'convert',file:job.file,settings:s}) as ConversionResult;
      job.result = result; job.outputUrl = URL.createObjectURL(result.blob); job.outputThumbnail = URL.createObjectURL(result.thumbnail);
      job.outputName = uniqueName(job.file,s,names); job.status = 'done';
    } catch (error) {
      if (cancelled) job.status = 'ready'; else { job.status = 'error'; job.error = issue(error); }
    }
    progressState.completed++; render();
  }
  busy = false; render();
  if (cancelled) toast('cancelled'); else if (jobs.some(job => job.status === 'error')) toast('attention');
}
function download(url: string, name: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
}
async function downloadZip() {
  const converted = jobs.filter(job => job.result); if (!converted.length || zipBusy || busy) return;
  zipBusy = true; render();
  try {
    const { zip } = await import('fflate');
    // A null-prototype map preserves filenames such as __proto__ safely.
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const job of converted) entries[job.outputName!] = new Uint8Array(await job.result!.blob.arrayBuffer());
    const result = await new Promise<Uint8Array<ArrayBuffer>>((resolve,reject) => {
      zip(entries,{level:0},(error,data) => error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>));
    });
    const url = URL.createObjectURL(new Blob([result],{type:'application/zip'}));
    download(url,`resz-images-${new Date().toISOString().slice(0,10)}.zip`); setTimeout(() => URL.revokeObjectURL(url),60000);
    toast('zipDone',{count:converted.length});
  } catch { toast('zipError'); } finally { zipBusy = false; render(); }
}
function preview(id: number, converted = false) {
  const job = jobs.find(job => job.id === id); if (!job?.thumbnail) return;
  activePreview = id; previewConverted = converted;
  $('#preview-title').textContent = converted && job.outputName ? job.outputName : job.file.name;
  const info = converted && job.result ? job.result : job.info!;
  $('#preview-description').innerHTML = `${dimensions(info.width,info.height)} · <bdi>${bytes(converted && job.result ? job.result.blob.size : job.file.size)}</bdi>`;
  $<HTMLImageElement>('#preview-image').src = converted && job.outputThumbnail ? job.outputThumbnail : job.thumbnail;
  $<HTMLImageElement>('#preview-image').alt = job.file.name;
  $('#preview-original').classList.toggle('selected',!converted); $('#preview-result').classList.toggle('selected',converted);
  $<HTMLButtonElement>('#preview-result').disabled = !job.result; $('#preview-download').hidden = !job.result;
  if (!$<HTMLDialogElement>('#preview-dialog').open) $<HTMLDialogElement>('#preview-dialog').showModal();
}

$('#language').addEventListener('change', () => {
  setLocale($<HTMLSelectElement>('#language').value as Locale);
  try { localStorage.setItem('resz-language',getLocale()); } catch { /* Language selection still works without storage. */ }
  const url = new URL(location.href); url.searchParams.set('lang',getLocale()); history.replaceState(null,'',url); applyLanguage();
});
$('#add-button').addEventListener('click', () => input('file-input').click());
input('file-input').addEventListener('change', event => { void addFiles(Array.from((event.target as HTMLInputElement).files || [])); input('file-input').value = ''; });
$('#dropzone').addEventListener('click', () => { if (!busy && !importing && !zipBusy && !sampleBusy) input('file-input').click(); });
$('#dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#dropzone').click(); } });
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropzone').classList.add('dragging'); } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('dragging'); } });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('dragging'); if (event.dataTransfer && !sampleBusy) void addFiles(Array.from(event.dataTransfer.files)); });
$('#clear-button').addEventListener('click', () => { for (const job of jobs) { if (job.thumbnail) URL.revokeObjectURL(job.thumbnail); releaseResult(job); } jobs = []; render(); });
$('#image-grid').addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const remove = target.closest<HTMLElement>('[data-remove]'), previewButton = target.closest<HTMLElement>('[data-preview]'), downloadButton = target.closest<HTMLElement>('[data-download]');
  if (remove && !busy && !importing && !zipBusy && !sampleBusy) {
    const job = jobs.find(item => item.id === Number(remove.dataset.remove))!;
    if (job.thumbnail) URL.revokeObjectURL(job.thumbnail); releaseResult(job); jobs = jobs.filter(item => item !== job); render();
  } else if (previewButton) preview(Number(previewButton.dataset.preview),Boolean(jobs.find(job => job.id === Number(previewButton.dataset.preview))?.result));
  else if (downloadButton) { const job = jobs.find(item => item.id === Number(downloadButton.dataset.download))!; if (job.outputUrl) download(job.outputUrl,job.outputName!); }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-format]')) button.addEventListener('click', () => { format = button.dataset.format as Format; updateControls(); invalidate(); });
$('#settings-form').addEventListener('submit', event => event.preventDefault());
$('#settings-form').addEventListener('input', () => { updateControls(); invalidate(); });
$('#reset-button').addEventListener('click', () => { $<HTMLFormElement>('#settings-form').reset(); format = 'jpeg'; updateControls(); invalidate(); toast('settingsReset'); });
$('#convert-button').addEventListener('click', () => void convertBatch());
$('#download-button').addEventListener('click', () => void downloadZip());
$('#cancel-button').addEventListener('click', () => { cancelled = true; worker.terminate(); for (const handler of pending.values()) handler.reject(new AppError('errorWorker')); pending.clear(); startWorker(); });
$('#help-button').addEventListener('click', () => $<HTMLDialogElement>('#about-dialog').showModal());
for (const button of document.querySelectorAll<HTMLElement>('[data-close]')) button.addEventListener('click', () => $<HTMLDialogElement>(`#${button.dataset.close}`).close());
for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
$('#preview-original').addEventListener('click', () => activePreview !== null && preview(activePreview));
$('#preview-result').addEventListener('click', () => activePreview !== null && preview(activePreview,true));
$('#preview-download').addEventListener('click', () => { const job = jobs.find(job => job.id === activePreview); if (job?.outputUrl) download(job.outputUrl,job.outputName!); });

async function sampleBatch() {
  sampleBusy = true; render();
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
  sampleBusy = false;
  await addFiles(files);
}

$('#sample-button').addEventListener('click', () => { void sampleBatch().catch(() => { sampleBusy = false; render(); toast('errorWorker'); }); });
applyLanguage();
