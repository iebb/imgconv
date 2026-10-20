# resz.im — your local image studio

A browser-only batch image converter. No backend, image uploads, analytics, accounts, CDN scripts, or remote fonts. File decoding, resizing, encoding, and ZIP creation happen on your device.

**Use the app:** [imgconv-9y8.pages.dev](https://imgconv-9y8.pages.dev/) · **Source:** [iebb/imgconv](https://github.com/iebb/imgconv)

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://127.0.0.1:5173`).

For an optimized local build:

```sh
npm run build
npm run preview
```

Open the printed URL (usually `http://127.0.0.1:4173`). Keep the local server running while using the app. After installing dependencies, no internet connection is needed: the app, worker, and every codec are bundled and served from your computer. Serve `dist/` on any static server to use another host; there is no image-processing service to deploy.

## Features

- Select multiple images, add or drop whole folders, or paste images from the clipboard. Non-image files in folders are skipped.
- Import HEIC/HEIF, TIFF, JPG, PNG, GIF, WebP, AVIF, BMP and other browser-supported inputs. HEIC and TIFF decoders are bundled locally.
- Export JPG, optimized PNG, WebP, AVIF, GIF, APNG, BMP and TIFF. PNG/APNG support lossless full-color encoding or palette reduction. Unsupported native WebP encoding reports an error instead of returning a mislabeled PNG.
- Resize by percentage, width, height, bounding box, exact dimensions, fill-and-crop, or fit-and-pad. Crop/padding position is adjustable; padding can be transparent or a chosen color. Enlargement is off by default.
- Draw a custom crop for each image, move it, resize it, or enter precise percentages. Rotate in 90-degree steps and flip horizontally or vertically across the batch.
- Full-resolution before/after comparison with a split slider, fit and 100% views, zoom up to 400%, and drag-to-pan. HEIC/TIFF previews are decoded on demand; thumbnails are not used for detail inspection.
- Text and image/logo watermarks with size, opacity, color and position controls.
- Local background removal (U²-Net small) and real 2×/4× AI upscaling (Real-ESRGAN). The models and CPU WebAssembly runtime are served from this site only when needed; selected images never leave the device.
- GIF, WebP and APNG output preserves supported animated inputs, frame timing, loops and transparency. Other output formats require choosing First frame explicitly.
- Strict per-image byte limits include the final encoded file, including all animation frames. JPG/WebP/AVIF quality and GIF palettes are adjusted first; optional resizing follows. Impossible limits show per-file errors and are excluded from exports. KB and MB are decimal units.
- Built-in recipes, automatic settings restoration, named local presets and shareable settings links. Links contain settings in the URL fragment, including watermark text, and never include images. Image/logo files stay in the current tab and must be reselected after a reload.
- Filename patterns support `{name}`, `{n}`, `{width}`, `{height}`, and `{format}`, plus prefixes, suffixes, numbering and safe collision handling. Optionally retain imported folder structure.
- Download individual results, export ZIP, or save directly into a folder in supported browsers. Folder export adds a numeric suffix when a target file already exists.
- Cancellation stops processing and keeps completed results. Changing settings clears old results; applying a manual crop clears only that image's result.
- Ten complete languages: English, Simplified Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Indonesian and Urdu. Arabic/Urdu use RTL. Language changes preserve the batch; share a language with `?lang=ar`.
- Responsive workspace with three settings tabs, keyboard navigation, readable controls and text at least 14 px. No remote fonts, analytics or accounts.

## Cloudflare Pages

This is a static Cloudflare Pages site. The production project is `imgconv` in the Kitta Labs account, the production branch is `master`, and the published directory is `dist/`. There are no Pages Functions, API endpoints, or image uploads.

To publish an update after committing the source on `master`:

```sh
npx wrangler login
npm run deploy
```

If Wrangler has access to multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the Kitta Labs account ID before deploying. Deployment is manual through `npm run deploy`. The same files in `dist/` can be hosted on any static web server. Hosting serves the app and codecs; selected images stay in browser memory.

## Boundaries

Animated GIF, WebP and APNG inputs can retain their frames when exported as GIF, WebP or APNG. GIF/APNG decoding has bundled fallbacks; animated WebP and AVIF decoding depends on browser ImageDecoder support. Unsupported animation reports an error rather than silently flattening. AVIF export is still-image only. Multi-page TIFF and HEIC collections use the first image.

Exports remove metadata and use an 8-bit browser image workflow. HDR, wide-gamut source values and print metadata are not preserved. Keep originals for archival and print work. Output is re-encoded even when selecting the original format.

Maximum dimensions are 32,767 pixels per side and 80 megapixels. Animations are limited to 300 frames and 60 million total pixels; practical limits depend on device memory. Frames are composited before encoding, and animation/ZIP export needs additional memory. Files and export blobs remain in tab memory until removed or the tab closes.

AI upscaling accepts at most 4 megapixels per input frame and can be slow for large batches. Background masks and reconstructed details vary with the subject; the app does not promise exact restoration. AI model provenance, licenses, hashes and preprocessing are in [public/models/manifest.json](public/models/manifest.json). Models and runtime files are included in the static build and require no external service. The app is not an offline-installed PWA.

Direct folder export requires the File System Access API and a secure context (HTTPS or localhost). ZIP remains available in other browsers. If folder export is interrupted, files already written remain in the chosen folder.

## Verify

`npm run build` checks TypeScript, prepares the bundled AI runtime, and creates the static production build.

`npm run test:unit` checks all translation keys and placeholders, locale selection, saved/shared settings validation, filename safety, geometry policies and folder collision handling.

With the dev server running, open `/tests/runner.html` for browser engine verification: real HEIC/TIFF inputs; output signatures and transparency; AVIF and PNG palette encoding; byte caps; crop/pad/rotate/flip; text and logo watermarks; animated GIF/WebP/APNG timing, loops and compositing; fallback decoding; full-resolution previews; actual local AI inference; and ZIP byte round trips.

Open `/tests/localization.html` for all ten languages at mobile, tablet and desktop widths, including all settings tabs, crop/comparison dialogs, translated errors, preset restoration, naming and shared settings. Tests use synthetic images and public fixtures and are excluded from production. Fixture provenance is in `tests/fixtures/README.md`.

## Libraries

- [heic-to](https://github.com/hoppergee/heic-to), LGPL-3.0, with the bundled libheif decoder; lazily loaded for HEIC files.
- [UTIF](https://github.com/photopea/UTIF.js), MIT; lazily loaded for TIFF.
- [gifenc](https://github.com/mattdesl/gifenc), MIT.
- [fflate](https://github.com/101arrowz/fflate), MIT; ZIP packaging.
- [jSquash AVIF](https://github.com/jamsinclair/jSquash), Apache-2.0, with its single-thread libavif/libaom encoder.
- [UPNG.js](https://github.com/photopea/UPNG.js), MIT; PNG/APNG encoding and fallback decoding.
- [gifuct-js](https://github.com/matt-way/gifuct-js), MIT; GIF fallback decoding.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT; local CPU inference.
- [U²-Net](https://github.com/xuebinqin/U-2-Net), Apache-2.0, and [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN), BSD-3-Clause; self-hosted models.
- [Vite](https://github.com/vitejs/vite), MIT; build tooling.

The dependency versions and source distributions are recorded in `package-lock.json`. Preserve their license notices when redistributing. The application does not need any of these services at runtime.

The hosted build includes the runtime dependency license texts at [`/third-party-notices.txt`](https://imgconv-9y8.pages.dev/third-party-notices.txt).
