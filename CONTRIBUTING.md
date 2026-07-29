# Contributing to Inkwell

Thanks for taking an interest. Inkwell is a small, deliberately focused app:
open a PDF, sign it, fill it in, save it, and nothing leaves the machine. The
most useful contributions are the ones that keep it that way.

Bug reports and small fixes need no discussion — just open them. For anything
larger, please open an issue first so we can agree on the shape before you spend
an evening on it.

## Getting set up

You need [Node 22.16.0](.node-version) (any 22.x works; `nvm use` picks up the
pinned version) and, for the desktop app, a [Rust toolchain][rustup] and Xcode
command line tools.

```bash
git clone https://github.com/danielehrhardt/open-pdf-editor.git
cd open-pdf-editor
npm install
```

`npm run dev` and `npm run build` both start by running `sync-pdfjs`, which
copies pdf.js's cmaps, standard fonts and WASM decoders out of `node_modules`
into `public/pdfjs/`. That directory is generated and git-ignored — if PDFs ever
render without their fonts, run `npm run sync-pdfjs` on its own.

| | |
| --- | --- |
| `npm run dev` | Web app on http://localhost:1420 |
| `npm run app:dev` | macOS app with hot reload |
| `npm test` | The three verifiers — run this before pushing |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run build` | Static site into `dist/` |
| `npm run app:build` | `.app` + `.dmg` into `src-tauri/target/release/bundle/` |

`samples/Sample Agreement.pdf` is a fillable form with text fields, checkboxes,
a dropdown and a signature line — handy for manual testing. Regenerate it with
`node scripts/make-sample.mjs`.

## The one rule: what you see is what gets written

Inkwell's central invariant is that an element's position on screen equals its
position in the saved file — at any zoom, on rotated pages, and on pages whose
CropBox does not start at the origin.

[`src/lib/geometry.ts`](src/lib/geometry.ts) is the only place that conversion
is allowed to happen. It is the algebraic inverse of pdf.js's `PageViewport`.
Elements are stored in unscaled view space, which is what makes them
zoom-independent by construction. **Please do not do coordinate arithmetic
anywhere else** — if you find yourself multiplying by `zoom` or flipping a `y`
outside that file, the abstraction is leaking and the fix belongs in geometry.

This is enforced by tests, not by trust:

```bash
npm test
```

- **`verify-geometry.mjs`** — asserts `pdfToView` agrees with pdf.js's *own*
  viewport transform, and that a rect fed through pdf-lib's drawing matrix comes
  back unchanged. 200 assertions over all four rotations plus an offset CropBox.
- **`verify-export.mjs`** — runs the real exporter, re-parses the output with
  pdf.js, and reads the graphics-state matrix at the moment each stamp is
  painted. Every corner must land within 1e-6 of where it was dropped.
- **`verify-forms.mjs`** — field values survive a round trip, appearance streams
  are regenerated, flattening bakes them into page content, and text baselines
  match the on-screen overlay exactly.

If you change placement, export, or form handling, add an assertion to the
matching verifier. A PR that moves geometry without touching the verifiers is
the one thing likely to get pushback.

## Where things live

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

Only `src/platform/` may know which host it is running on. Components and `lib/`
import from `src/platform/index.ts` and get an adapter. The Tauri adapter is
loaded dynamically so the web bundle splits it into a chunk it never fetches —
please keep it that way, and don't `import` from `platform/tauri.ts` directly.

## Two constraints worth knowing before you code

**Nothing may go over the network.** No analytics, no fonts from a CDN, no
telemetry, no "check for updates" ping. This is the product, not a preference.
[`public/_headers`](public/_headers) sets a CSP with `connect-src 'self'` and the
Tauri config sets the equivalent, so a stray `fetch()` fails at runtime rather
than shipping quietly. New assets get vendored into the repo.

**Typed text stays real text.** Text is written as PDF text operators in a
standard font, so output remains selectable and searchable. Please don't
"simplify" it into a rasterised image.

## Style

There is no linter config, on purpose — match the surrounding code. In practice
that means no semicolons, single quotes, two-space indent, `type`/`interface`
over inline shapes, and comments that explain *why* rather than restating the
line. `cargo fmt` governs the Rust side and CI checks it, along with
`cargo clippy -D warnings`.

## Pull requests

1. Branch off `main`.
2. Make sure `npm run typecheck`, `npm test` and `npm run build` pass.
3. Write a commit message that says what changed and why.
4. Open the PR and fill in the template.

CI runs typecheck, the verifiers, the web build, and `cargo fmt`/`clippy`/`check`
on macOS. Both jobs must be green.

If your change affects what the user sees, a before/after screenshot in the PR
saves a review round trip.

## Reporting bugs

Please use the [issue templates][issues]. For a rendering or placement bug, the
single most useful thing you can attach is the PDF itself — or, if it is
confidential, a redacted file that still misbehaves. Include your browser and OS;
the File System Access API differences between Chromium and Safari/Firefox
explain a surprising share of reports.

Found a security problem? Don't open an issue — see [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the [MIT Licence](LICENSE), the same terms the
project ships under.

[rustup]: https://rustup.rs/
[issues]: https://github.com/danielehrhardt/open-pdf-editor/issues/new/choose
