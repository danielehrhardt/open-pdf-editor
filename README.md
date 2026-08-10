<div align="center">
  <img src="assets/icon.png" alt="" width="112" height="112">
  <h1>Inkwell</h1>
  <p><strong>Fill out PDFs and sign them. Nothing leaves your machine.</strong></p>
  <p>
    <a href="https://pdfeditor.codext.de/"><strong>Use it now → pdfeditor.codext.de</strong></a>
    ·
    <a href="https://github.com/danielehrhardt/open-pdf-editor/releases/latest">Download for macOS</a>
  </p>
  <p>
    <a href="https://github.com/danielehrhardt/open-pdf-editor/actions/workflows/ci.yml"><img src="https://github.com/danielehrhardt/open-pdf-editor/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="https://github.com/danielehrhardt/open-pdf-editor/releases/latest"><img src="https://img.shields.io/github/v/release/danielehrhardt/open-pdf-editor?color=5b5bf0" alt="Latest release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/danielehrhardt/open-pdf-editor?color=5b5bf0" alt="MIT licence"></a>
  </p>
</div>

Open a PDF, drop in a handwritten signature, type the date, tick the boxes, save.
That is the whole product. It runs as a native macOS app and as a static website
with the same code — no account, no upload, no subscription.

Nothing is ever sent anywhere. The app makes no network request after it loads,
and a Content-Security-Policy enforces that rather than merely promising it.

---

## What it does

**Signatures that look handwritten.** Draw one with a trackpad or stylus and
[perfect-freehand][pf] gives it real pen dynamics — the stroke thins as you move
faster and tapers at the ends. Or type your name in one of five handwriting
faces, or photograph a signature on paper and let Inkwell knock the white page
out from behind the ink.

**A library that remembers.** Every signature you make is saved, trimmed to its
ink, and one click away next time. Mark one as default and the Sign button uses
it straight away.

**Real form filling.** Inkwell finds a document's AcroForm fields and gives you
proper inputs on top of them — text boxes, checkboxes, radio groups, dropdowns.
On save the values are written into the file *and* their appearance streams are
regenerated, so every viewer shows them. Lock the fields on the way out and they
become permanent page content.

**Free placement anywhere.** Signatures, images, text blocks, dates and
checkmarks drop wherever you click. Drag to move, corners to resize, arrows to
nudge, ⌘Z all the way back.

**Text stays text.** Typed text is written as real PDF text in a standard font,
so the result is still selectable and searchable — not a screenshot of words.

**Pages in the order you want them.** Drag a thumbnail up or down the rail (or
press `⌥↑` / `⌥↓`) to resort the document. Anything you placed on a page travels
with it, form fields included, and the new order is what gets saved.

## Get it

### On the web

**[pdfeditor.codext.de](https://pdfeditor.codext.de/)** — nothing to install. It
works offline once loaded, and installs as an app that opens `.pdf` files if your
browser supports that.

### macOS app

Download the `.dmg` from the [latest release][latest] and drag Inkwell to
Applications. It is a universal build — Apple silicon and Intel, macOS 11 or
later.

The app is not signed with an Apple Developer certificate, so macOS will say it
"cannot check it for malicious software" the first time. Either **right-click
Inkwell.app → Open → Open**, or clear the quarantine flag yourself:

```bash
xattr -dr com.apple.quarantine /Applications/Inkwell.app
```

### Build it yourself

```bash
npm install
npm run app:build
```

The build produces `src-tauri/target/release/bundle/macos/Inkwell.app` and a
`.dmg` beside it. Copy the app into `/Applications`:

```bash
ditto src-tauri/target/release/bundle/macos/Inkwell.app /Applications/Inkwell.app
codesign --force --deep --sign - /Applications/Inkwell.app
```

The ad-hoc signature is what a locally built, unnotarised app gets. Because the
bundle was never downloaded it carries no quarantine flag, so it opens normally.

For the web version:

```bash
npm run build          # static output in dist/
npm run web:preview    # try it at http://localhost:4173
```

`dist/` is a plain static site — put it behind any static host. This repo deploys
to Cloudflare Workers, configured in [`wrangler.jsonc`](wrangler.jsonc):

```bash
npm run web:deploy     # npm run build && wrangler deploy
```

[`public/_headers`](public/_headers) ships a strict CSP, long-lived caching for
hashed assets, and `frame-ancestors 'none'`.

## How the web version stores things

Nothing is ever uploaded. The app fetches no network resources after load — the
CSP forbids it.

|                        | Chrome / Edge / Arc / Brave     | Safari / Firefox                  |
| ---------------------- | ------------------------------- | --------------------------------- |
| Opening                | Native file picker              | File input, or drag and drop      |
| **⌘S**                 | Overwrites the original in place | Downloads a new PDF               |
| Recent documents       | Yes — reopens the actual file   | Hidden (nothing to reopen)        |
| Signature library      | IndexedDB                       | IndexedDB                         |
| Install as an app      | Yes, and handles `.pdf` files   | Add to Dock / Home Screen         |

The difference is the [File System Access API][fsa]. Where it exists, Inkwell
holds a real handle to your file, so saving writes back to the same document and
the recents list can reopen it later. Where it does not, opening is a copy and
saving is a download — which is exactly what a web page is allowed to do.

Signatures live in IndexedDB rather than `localStorage` because they are PNG data
URLs and a handful of them would exceed the 5 MB `localStorage` ceiling. Clearing
site data clears your signatures.

## Keyboard

| | |
| --- | --- |
| `V` `S` `T` `D` `C` `X` | Select · Sign · Text · Date · Check · Cross |
| `⌘O` `⌘S` `⇧⌘S` | Open · Save · Save As |
| `⌘Z` `⇧⌘Z` | Undo · Redo |
| `⌘+` `⌘-` `⌘0` | Zoom in · out · fit width |
| Drag · Arrows · `⇧`Arrows | Move · nudge 1 pt · nudge 10 pt |
| `⌥↑` `⌥↓` on a thumbnail | Move that page up · down |
| `⏎` · `⌫` · `Esc` | Edit text · delete · cancel |
| `⌘`-scroll or pinch | Zoom around the pointer |

## How it works

The interesting problem is making *what you see* equal *what gets written*.

Three coordinate spaces are in play: PDF user space (origin bottom-left, y up,
possibly with a `/Rotate` entry and a CropBox that does not start at the origin),
the rotated space the reader sees, and the screen after zoom.
[`src/lib/geometry.ts`](src/lib/geometry.ts) is the algebraic inverse of pdf.js's
`PageViewport`, and it is the only place the conversion happens. Elements are
stored in unscaled view space, which makes them zoom-independent by construction.

That claim is worth more than a comment, so it is tested four ways:

```bash
npm test
```

- **`verify-geometry.mjs`** — asserts `pdfToView` matches pdf.js's *own*
  viewport transform, and that feeding a rect through pdf-lib's drawing matrix
  reproduces the original rect. 200 assertions over all four rotations plus an
  offset CropBox.
- **`verify-export.mjs`** — runs the real export, re-parses the output with
  pdf.js, and reads the graphics-state matrix at the moment the stamp is painted.
  Every corner must land within 1e-6 of where it was dropped.
- **`verify-forms.mjs`** — field values survive a round trip, appearance streams
  are regenerated, flattening bakes them into page content, and text baselines
  match the on-screen overlay exactly.
- **`verify-page-order.mjs`** — a reordered document is written in the dragged
  order, and stamps and form widgets stay on the page they belong to. Every page
  in the fixture has a different size and rotation, so a mix-up cannot hide.

Text baselines get the same treatment: the overlay and the exporter both call
`baselineOffset()`, which reads the browser's own font metrics — the same numbers
CSS uses for half-leading — so DOM text and PDF text agree on where the baseline
sits.

### Layout

```
src/
  platform/     The seam. Everything above it is plain browser code.
    tauri.ts      Native dialogs, real paths, menu bar, Finder
    web.ts        File System Access API, with input/download fallback
  lib/
    geometry.ts   View <-> PDF coordinate math (the load-bearing file)
    export.ts     pdf-lib writer: stamps, text, form values, flattening
    pdf.ts        pdf.js loading, rendering, AcroForm discovery
    image.ts      Trimming, background removal, typed-signature rasterising
    text.ts       Shared font metrics for overlay and export
  components/   React UI
  state/        Zustand stores (document + signature library)
src-tauri/      Rust shell: file I/O, menus, file associations
scripts/        Icon generation, sample PDF, the three verifiers
```

Only `src/platform/` knows which host it is running on. The Tauri adapter is
loaded dynamically, so the web bundle splits it into a chunk it never fetches.

### Stack

[Tauri 2][tauri] · [React 19][react] · [pdf.js][pdfjs] renders · [pdf-lib][pdflib]
writes · [perfect-freehand][pf] draws · [Zustand][zustand] holds state.

## Trying it

`samples/Sample Agreement.pdf` is a small fillable form with text fields,
checkboxes, a dropdown and a signature line — generated by
`node scripts/make-sample.mjs`.

## Limitations

- **Encrypted PDFs** cannot be saved. Inkwell opens password-protected files only
  after the password is removed; pdf-lib cannot re-encrypt.
- **Text uses the standard PDF fonts** (Helvetica, Times, Courier), which cover
  Latin scripts and common typography. Characters outside that set become `?`,
  and you are told how many. Signatures are images, so handwriting in any script
  works fine.
- **Not a cryptographic signature.** Inkwell places a picture of your signature.
  That is what most forms ask for, but it is not a digital certificate.

## Contributing

Contributions are welcome — bug reports especially. If a signature lands in the
wrong place on some PDF, the file itself is the most useful thing you can send.

[CONTRIBUTING.md](CONTRIBUTING.md) covers getting set up, how the codebase is
laid out, and the one invariant to understand before changing anything that
decides where an element goes. Two things are settled and won't change: the app
makes no network requests, and there are no accounts or subscriptions.

- [Report a bug or request a feature](https://github.com/danielehrhardt/open-pdf-editor/issues/new/choose)
- [Security policy](SECURITY.md) — please report vulnerabilities privately
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## Licence

[MIT](LICENSE) © Daniel Ehrhardt.

The bundled handwriting fonts (Caveat, Dancing Script, Great Vibes, Homemade
Apple, Sacramento) are [SIL Open Font Licence 1.1][ofl]. pdf.js assets under
`public/pdfjs/` carry their own licences, included alongside them.

[latest]: https://github.com/danielehrhardt/open-pdf-editor/releases/latest
[pf]: https://github.com/steveruizok/perfect-freehand
[pdfjs]: https://mozilla.github.io/pdf.js/
[pdflib]: https://pdf-lib.js.org/
[tauri]: https://tauri.app/
[react]: https://react.dev/
[zustand]: https://zustand.docs.pmnd.rs/
[fsa]: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
[ofl]: https://openfontlicense.org/
