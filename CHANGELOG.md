# Changelog

All notable changes to Inkwell are documented here. The format follows
[Keep a Changelog][kac] and versions follow [Semantic Versioning][semver].

## [Unreleased]

## [1.0.0] — 2026-07-29

First public release. Inkwell runs as a native macOS app and as a static website
from the same source, and is live at
[pdfeditor.codext.de](https://pdfeditor.codext.de/).

### Signatures

- Draw a signature with a trackpad, mouse or stylus, rendered with
  [perfect-freehand][pf] so the stroke thins with speed and tapers at the ends.
- Type your name in one of five bundled handwriting faces (Caveat, Dancing
  Script, Great Vibes, Homemade Apple, Sacramento).
- Photograph a signature on paper and have the white page knocked out from
  behind the ink.
- A signature library persisted in IndexedDB: every signature is trimmed to its
  ink, reusable in one click, and one can be marked as the default.

### Filling documents

- AcroForm discovery with real inputs rendered over the page — text fields,
  checkboxes, radio groups and dropdowns. On save, values are written into the
  file *and* their appearance streams regenerated, so every viewer shows them.
- Optionally lock fields on the way out, flattening them into permanent page
  content.
- Free placement of signatures, images, text blocks, dates and checkmarks
  anywhere on the page: drag to move, corner handles to resize, arrow keys to
  nudge by 1 pt (10 pt with shift), and full undo/redo.
- Typed text is written as real PDF text in a standard font, so output stays
  selectable and searchable.

### The app

- Multi-page viewer with a thumbnail rail, zoom to fit width, and
  ⌘-scroll/pinch zoom around the pointer.
- Keyboard-first: single-key tool switching and the usual ⌘O/⌘S/⇧⌘S/⌘Z shortcuts.
- Light and dark themes that follow the system.
- macOS: native file dialogs, a real menu bar, `.pdf` file associations, and a
  recents list that reopens the actual file.
- Web: the [File System Access API][fsa] where it exists, so ⌘S overwrites the
  original in place; a file input and download fallback in Safari and Firefox.
  Installable as a PWA that handles `.pdf` files.

### Privacy

- Nothing is uploaded and no network request is made after load. The
  Content-Security-Policy in `public/_headers` and in the Tauri config enforces
  this rather than merely promising it: `connect-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`. All fonts and pdf.js assets are vendored.

### Correctness

- Coordinate conversion between PDF user space, view space and screen space is
  confined to `src/lib/geometry.ts`, the algebraic inverse of pdf.js's
  `PageViewport`, so placement survives page rotation and an offset CropBox.
- Three verifier suites run in CI: `verify-geometry` (200 assertions against
  pdf.js's own viewport transform), `verify-export` (re-parses real output and
  reads the graphics-state matrix at paint time; corners must match within
  1e-6), and `verify-forms` (value round-trip, appearance streams, flattening,
  and text baselines).

### Known limitations

- Encrypted PDFs cannot be saved — pdf-lib cannot re-encrypt, so a
  password-protected file has to have its password removed first.
- Text uses the standard PDF fonts (Helvetica, Times, Courier). Characters
  outside that set become `?`, and you are told how many. Signatures are images,
  so handwriting in any script works.
- Signatures are pictures, not cryptographic certificates.

[Unreleased]: https://github.com/danielehrhardt/open-pdf-editor/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/danielehrhardt/open-pdf-editor/releases/tag/v1.0.0
[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html
[pf]: https://github.com/steveruizok/perfect-freehand
[fsa]: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
