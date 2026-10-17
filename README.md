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

- Multi-file selection and drag and drop; local thumbnails and previews.
- HEIC/HEIF and TIFF decoding bundled with the app. JPG, PNG, GIF, WebP, AVIF, BMP, and other inputs use the browser's image decoder.
- JPG, PNG, WebP, GIF, BMP, and TIFF export. Unsupported native WebP encoding fails clearly instead of silently returning a mislabeled PNG.
- Keep dimensions, fit inside a box, scale by percentage, or stretch to exact dimensions. Enlarging images is disabled by default.
- Quality controls for JPG and WebP; palette quality for GIF. PNG and TIFF preserve full pixel values; BMP flattens transparency.
- Optional maximum bytes per output image. JPG/WebP quality and GIF palette size are adjusted first. If enabled, dimensions are progressively reduced. The app only accepts an output whose **actual encoded size is at most the configured limit**. Impossible limits show per-file errors and never export oversized files. KB and MB use decimal units (1,000 and 1,000,000 bytes).
- Export completed files individually or as a ZIP, with safe, collision-free filenames.
- Settings changes clear old results; cancellation stops the worker and preserves completed files.
- No metadata is copied from originals; transparency is preserved where the output supports it. Choose the fill color for JPG/BMP.
- Ten languages: English, Simplified Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Indonesian, and Urdu. Language selection follows the browser, can be changed without losing the batch, and is remembered locally. Share a language using `?lang=ar` (or any supported code). Arabic and Urdu use right-to-left layouts.
- Readable typography: controls use 16 px or larger, with helper text at least 14 px. No remote fonts or runtime internet dependencies; responsive layout and keyboard-accessible controls.

## Cloudflare Pages

This is a static Cloudflare Pages site. The production project is `imgconv` in the Kitta Labs account, the production branch is `master`, and the published directory is `dist/`. There are no Pages Functions, API endpoints, or image uploads.

To publish an update after committing the source on `master`:

```sh
npx wrangler login
npm run deploy
```

If Wrangler has access to multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the Kitta Labs account ID before deploying. Deployment is manual through `npm run deploy`. The same files in `dist/` can be hosted on any static web server. Hosting serves the app and codecs; selected images stay in browser memory.

## Boundaries

Animations become still images using the first frame. Multi-page TIFF and HEIC collections use the first image. This is an 8-bit browser image workflow; HDR, wide-gamut source values, and print metadata are not preserved. Keep the originals for archival or print work. Output is re-encoded even when choosing the same format.

Images are processed sequentially in a dedicated worker, holding full pixel data for only the active image. Original Files and exported Blobs remain in tab memory until removed or the page closes. Maximum dimensions are 32,767 pixels per side and 80 megapixels; practical limits also depend on device memory. ZIP creation needs additional memory proportional to the output batch. Some HEIC compression variants and browser-dependent input formats may be unsupported; these show per-file errors.

## Verify

`npm run build` performs TypeScript checks and builds the production app.

`npm test` opens the local browser verification page. Or run `npm run dev` and visit `/tests/runner.html`. The suite exercises the actual image worker in the browser: real HEIC and TIFF inputs; all six output signatures, dimensions, and alpha handling; quality and byte caps; impossible-size failures; resizing policies; corrupt-file recovery; and byte-for-byte ZIP round trips. Test images contain no user data and are excluded from the production build. Fixture provenance is in `tests/fixtures/README.md`.

`npm run test:locales` checks translation coverage, interpolation, and language selection. With the dev server running, `/tests/localization.html` checks all ten languages at mobile, tablet, and desktop widths, plus conversion, errors, and language changes with a batch in memory.

## Libraries

- [heic-to](https://github.com/hoppergee/heic-to), LGPL-3.0, with the bundled libheif decoder; lazily loaded for HEIC files.
- [UTIF](https://github.com/photopea/UTIF.js), MIT; lazily loaded for TIFF.
- [gifenc](https://github.com/mattdesl/gifenc), MIT.
- [fflate](https://github.com/101arrowz/fflate), MIT; ZIP packaging.
- [Vite](https://github.com/vitejs/vite), MIT; build tooling.

The dependency versions and source distributions are recorded in `package-lock.json`. Preserve their license notices when redistributing. The application does not need any of these services at runtime.

The hosted build includes the runtime dependency license texts at [`/third-party-notices.txt`](https://imgconv-9y8.pages.dev/third-party-notices.txt).
