/**
 * End-to-end proof that what you place is what gets written.
 *
 * Runs the real `buildPdf` from src/lib/export.ts over a fixture covering every
 * page rotation plus an offset CropBox, then re-parses the *output* with pdf.js
 * and reads the graphics-state matrix in force when the stamp is painted. That
 * matrix maps the unit square onto the region the image actually occupies, so
 * mapping its corners back through `pdfToView` must reproduce the rect the user
 * dragged out — exactly, with no rasterisation tolerance.
 *
 * This is the check that catches a wrong rotation anchor, an inverted y-axis,
 * or a CropBox that was ignored. None of those are visible to a type-checker.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { build } from 'esbuild'
import { PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

installDomShims()

// Emitted inside the project so Node can still resolve `pdf-lib` from it.
const workDir = await mkdtemp(path.join(process.cwd(), 'node_modules', '.inkwell-verify-'))
const bundlePath = path.join(workDir, 'bundle.mjs')
await build({
  stdin: {
    contents:
      "export { buildPdf } from './src/lib/export.ts'\n" +
      "export { viewSize, pdfToView } from './src/lib/geometry.ts'\n",
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
const { buildPdf, viewSize, pdfToView } = await import(bundlePath)

const ROTATIONS = [0, 90, 180, 270]
const OPS = pdfjs.OPS

/** The export path only needs a canvas factory and the base64 helpers. */
function installDomShims() {
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
      return createCanvas(1, 1)
    },
  }
  globalThis.atob ??= (b64) => Buffer.from(b64, 'base64').toString('binary')
  globalThis.btoa ??= (bin) => Buffer.from(bin, 'binary').toString('base64')
}

/* --------------------------------------------------------------- matrices --- */

/** `b` applied first, then `a` — pdf.js's `Util.transform` convention. */
const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

const applyMatrix = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

const IDENTITY = [1, 0, 0, 1, 0, 0]

/* ---------------------------------------------------------------- fixture --- */

function redSquarePng(size = 64) {
  const canvas = createCanvas(size, size)
  const g = canvas.getContext('2d')
  g.fillStyle = '#ff0000'
  g.fillRect(0, 0, size, size)
  return canvas.toDataURL('image/png')
}

async function buildFixture() {
  const doc = await PDFDocument.create()
  for (const rotation of ROTATIONS) {
    const page = doc.addPage([595.28, 841.89])
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) })
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotation))
  }
  // A CropBox that is both smaller than and offset within the MediaBox.
  const cropped = doc.addPage([612, 792])
  cropped.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) })
  cropped.node.set(PDFName.of('CropBox'), doc.context.obj([36, 48, 576, 744]))
  cropped.node.set(PDFName.of('Rotate'), PDFNumber.of(270))
  return doc.save()
}

function geometryFor(page) {
  const rotation = ((page.rotate % 360) + 360) % 360
  const view = page.view
  const { width, height } = viewSize(view, rotation)
  return { pageNumber: page.pageNumber, view, rotation, viewWidth: width, viewHeight: height }
}

/* ------------------------------------------------------------- inspection --- */

/**
 * Replays a page's operator list, tracking the CTM, and returns the matrix
 * active at each image paint.
 */
async function imageMatrices(bytes, pageNumber) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const page = await doc.getPage(pageNumber)
  const { fnArray, argsArray } = await page.getOperatorList()

  const found = []
  const stack = []
  let ctm = IDENTITY

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY
    else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i])
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) found.push(ctm)
  }

  await doc.destroy()
  return found
}

const close = (got, want, tolerance, what) =>
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${what}: expected ${want.toFixed(4)}, got ${got.toFixed(4)} (Δ ${Math.abs(got - want).toFixed(4)})`,
  )

/* ------------------------------------------------------------------- main --- */

async function main() {
  const source = await buildFixture()
  const probe = await pdfjs.getDocument({ data: source.slice() }).promise
  const pages = []
  for (let i = 1; i <= probe.numPages; i++) pages.push(geometryFor(await probe.getPage(i)))
  await probe.destroy()

  const src = redSquarePng()

  // Deliberately off-centre and non-square: a wrong rotation cannot slip
  // through on symmetry.
  const elements = pages.map((_geo, index) => ({
    id: `el${index}`,
    kind: 'signature',
    page: index,
    x: 60,
    y: 100,
    w: 200,
    h: 80,
    src,
    aspect: 2.5,
    opacity: 1,
  }))

  const { bytes, warnings } = await buildPdf({
    source,
    pages,
    elements,
    fields: [],
    formValues: {},
    flattenForm: false,
  })

  assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join('; ')}`)

  const tolerance = 1e-6
  let assertions = 0

  for (let index = 0; index < pages.length; index++) {
    const geo = pages[index]
    const label = `page ${index + 1} rot ${String(geo.rotation).padStart(3)}`
    const matrices = await imageMatrices(bytes, index + 1)

    assert.equal(matrices.length, 1, `${label}: expected exactly one stamp, saw ${matrices.length}`)
    const m = matrices[0]

    const want = elements[index]
    // Image space is y-up with (0,0) at the bottom-left, so the unit square's
    // corners correspond to these on-screen positions.
    const expected = {
      'bottom-left': { u: 0, v: 0, x: want.x, y: want.y + want.h },
      'bottom-right': { u: 1, v: 0, x: want.x + want.w, y: want.y + want.h },
      'top-right': { u: 1, v: 1, x: want.x + want.w, y: want.y },
      'top-left': { u: 0, v: 1, x: want.x, y: want.y },
    }

    for (const [corner, e] of Object.entries(expected)) {
      const inPdf = applyMatrix(m, e.u, e.v)
      const inView = pdfToView(inPdf, geo)
      close(inView.x, e.x, tolerance, `${label} ${corner}.x`)
      close(inView.y, e.y, tolerance, `${label} ${corner}.y`)
      assertions += 2
    }

    console.log(`  ${label}  ok`)
  }

  await rm(workDir, { recursive: true, force: true })
  console.log(
    `export OK — ${assertions} corner assertions; stamps land exactly where ` +
      `placed on ${pages.length} pages`,
  )
}

main().catch(async (err) => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  console.error('export FAILED:', err.stack || err.message)
  process.exit(1)
})
