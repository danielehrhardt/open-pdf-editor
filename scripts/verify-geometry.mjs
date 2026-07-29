/**
 * Proves the view <-> PDF coordinate math in src/lib/geometry.ts.
 *
 * Two independent checks, over every page rotation and a page whose CropBox
 * origin is not (0,0) — the cases that silently misplace signatures:
 *
 *  1. `pdfToView` must agree with pdf.js's own PageViewport transform.
 *  2. Feeding `drawAnchorForRect` through pdf-lib's actual drawing transform
 *     (translate -> rotate -> scale of the unit square) must land the four
 *     corners exactly back on the view-space rect we asked for.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { PDFDocument, PDFName, PDFNumber, PDFArray } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

// geometry.ts is compiled rather than imported directly: Node strips types
// unflagged only from 22.18, and .node-version pins 22.16. Same approach as
// verify-export.mjs and verify-forms.mjs.
// Emitted inside the project so Node can still resolve `pdf-lib` from it.
const workDir = await mkdtemp(path.join(process.cwd(), 'node_modules', '.inkwell-verify-'))
const bundlePath = path.join(workDir, 'bundle.mjs')
await build({
  stdin: {
    contents:
      "export { drawAnchorForRect, pdfToView, viewToPdf, viewSize } from './src/lib/geometry.ts'\n",
    resolveDir: process.cwd(),
    sourcefile: 'verify-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  external: ['pdf-lib'],
  logLevel: 'warning',
})
const { drawAnchorForRect, pdfToView, viewToPdf, viewSize } = await import(bundlePath)

const EPSILON = 1e-6
const ROTATIONS = [0, 90, 180, 270]

/** Pages 1-4: rotations on a plain A4 box. Page 5: an offset CropBox. */
async function buildFixture() {
  const doc = await PDFDocument.create()

  for (const rotation of ROTATIONS) {
    const page = doc.addPage([595.28, 841.89])
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotation))
  }

  const offset = doc.addPage([612, 792])
  // CropBox smaller than, and offset within, the MediaBox.
  offset.node.set(
    PDFName.of('CropBox'),
    doc.context.obj([36, 48, 576, 744]),
  )
  offset.node.set(PDFName.of('Rotate'), PDFNumber.of(90))

  return doc.save()
}

function geometryFor(page) {
  const rotation = ((page.rotate % 360) + 360) % 360
  const view = page.view
  const { width, height } = viewSize(view, rotation)
  return { pageNumber: page.pageNumber, view, rotation, viewWidth: width, viewHeight: height }
}

/** Replays pdf-lib's `drawImage` operator sequence on the unit square. */
function pdfLibCorners(anchor, w, h) {
  const rad = (anchor.rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // q; translate(x,y); rotate(t); scale(w,h); unit square; Q
  const map = (u, v) => {
    const sx = u * w
    const sy = v * h
    return {
      x: anchor.x + sx * cos - sy * sin,
      y: anchor.y + sx * sin + sy * cos,
    }
  }
  return {
    bottomLeft: map(0, 0),
    bottomRight: map(1, 0),
    topRight: map(1, 1),
    topLeft: map(0, 1),
  }
}

const close = (a, b, what) =>
  assert.ok(
    Math.abs(a - b) < 1e-6,
    `${what}: expected ${b}, got ${a} (delta ${Math.abs(a - b)})`,
  )

async function main() {
  const bytes = await buildFixture()
  const doc = await pdfjs.getDocument({ data: bytes }).promise

  let checks = 0

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const geo = geometryFor(page)
    const viewport = page.getViewport({ scale: 1 })

    // --- viewport dimensions ------------------------------------------------
    close(geo.viewWidth, viewport.width, `page ${i} view width`)
    close(geo.viewHeight, viewport.height, `page ${i} view height`)

    // --- check 1: agreement with pdf.js -------------------------------------
    const [x0, y0, x1, y1] = geo.view
    const samples = [
      [x0, y0],
      [x1, y1],
      [x0 + (x1 - x0) * 0.23, y0 + (y1 - y0) * 0.71],
      [x0 + (x1 - x0) * 0.9, y0 + (y1 - y0) * 0.05],
    ]

    for (const [px, py] of samples) {
      const mine = pdfToView({ x: px, y: py }, geo)
      const [ex, ey] = viewport.convertToViewportPoint(px, py)
      close(mine.x, ex, `page ${i} rot ${geo.rotation} pdfToView.x`)
      close(mine.y, ey, `page ${i} rot ${geo.rotation} pdfToView.y`)

      // Round trip must be lossless.
      const back = viewToPdf(mine, geo)
      close(back.x, px, `page ${i} round-trip x`)
      close(back.y, py, `page ${i} round-trip y`)
      checks += 4
    }

    // --- check 2: drawing anchor lands on the requested rect -----------------
    const rects = [
      { x: 40, y: 60, w: 180, h: 70 },
      { x: geo.viewWidth - 150, y: geo.viewHeight - 90, w: 120, h: 45 },
      { x: 0, y: 0, w: geo.viewWidth, h: geo.viewHeight },
    ]

    for (const rect of rects) {
      const anchor = drawAnchorForRect(rect, geo)
      const corners = pdfLibCorners(anchor, rect.w, rect.h)

      // The image's own bottom-left must show up at the rect's bottom-left on
      // screen, its top-left at the rect's top-left, and so on.
      const expected = {
        bottomLeft: { x: rect.x, y: rect.y + rect.h },
        bottomRight: { x: rect.x + rect.w, y: rect.y + rect.h },
        topRight: { x: rect.x + rect.w, y: rect.y },
        topLeft: { x: rect.x, y: rect.y },
      }

      for (const key of Object.keys(expected)) {
        const got = pdfToView(corners[key], geo)
        close(got.x, expected[key].x, `page ${i} rot ${geo.rotation} ${key}.x`)
        close(got.y, expected[key].y, `page ${i} rot ${geo.rotation} ${key}.y`)
        checks += 2
      }
    }
  }

  await doc.destroy()
  await rm(workDir, { recursive: true, force: true })
  console.log(`geometry OK — ${checks} assertions across ${doc.numPages} pages`)
}

main().catch(async (err) => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  console.error('geometry FAILED:', err.stack || err.message)
  process.exit(1)
})

// Silence an unused-import lint: PDFArray documents intent for future fixtures.
void PDFArray
void EPSILON
