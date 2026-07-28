/**
 * End-to-end proof that what you place is what gets written.
 *
 * Runs the real `buildPdf` from src/lib/export.ts against a fixture with every
 * page rotation, then rasterises the *result* with pdf.js and asserts the ink
 * is inside the requested view-space rect and nowhere else. This is the check
 * that catches a wrong rotation anchor, an inverted y-axis, or a CropBox that
 * was ignored — none of which a type-checker can see.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { build } from 'esbuild'
import { PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

installDomShims()

/**
 * The app's modules use extensionless imports, which Vite resolves but Node
 * does not. Bundle exactly what the app ships rather than testing a rewritten
 * copy of it.
 */
// Emitted inside the project so Node can still resolve `pdf-lib` from it.
const workDir = await mkdtemp(path.join(process.cwd(), 'node_modules', '.inkwell-verify-'))
const bundlePath = path.join(workDir, 'bundle.mjs')
await build({
  stdin: {
    contents:
      "export { buildPdf } from './src/lib/export.ts'\n" +
      "export { viewSize } from './src/lib/geometry.ts'\n",
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
const { buildPdf, viewSize } = await import(bundlePath)

const ROTATIONS = [0, 90, 180, 270]

/** Minimal browser surface the export path touches. */
function installDomShims() {
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
      return createCanvas(1, 1)
    },
  }
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary')
  globalThis.btoa = (bin) => Buffer.from(bin, 'binary').toString('base64')
}

/** A solid red square as a PNG data URL. */
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
    // Fill white so "no ink" is unambiguous.
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
      color: rgb(1, 1, 1),
    })
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotation))
  }
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

async function renderToPixels(bytes, pageNumber, scale) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  await doc.destroy()
  return { data, width: canvas.width, height: canvas.height }
}

const isRed = (d, i) => d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90

/** Bounding box of red pixels, in view space (undo the render scale). */
function redBounds({ data, width, height }, scale) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isRed(data, (y * width + x) * 4)) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (count === 0) return null
  return {
    x: minX / scale,
    y: minY / scale,
    w: (maxX - minX + 1) / scale,
    h: (maxY - minY + 1) / scale,
    count,
  }
}

async function main() {
  const source = await buildFixture()
  const probe = await pdfjs.getDocument({ data: source.slice() }).promise

  const pages = []
  for (let i = 1; i <= probe.numPages; i++) {
    pages.push(geometryFor(await probe.getPage(i)))
  }
  await probe.destroy()

  const src = redSquarePng()

  // A deliberately off-centre, non-square rect: a wrong rotation cannot pass
  // by symmetry.
  const elements = pages.map((_geo, index) => ({
    id: `el${index}`,
    kind: 'signature',
    page: index,
    x: 60,
    y: 100,
    w: 200,
    h: 80,
    src,
    aspect: 1,
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

  const scale = 2
  const tolerance = 1.5 // points; rasterisation rounds edges

  for (let index = 0; index < pages.length; index++) {
    const geo = pages[index]
    const pixels = await renderToPixels(bytes, index + 1, scale)
    const found = redBounds(pixels, scale)

    assert.ok(found, `page ${index + 1} (rot ${geo.rotation}): nothing was drawn`)

    const want = elements[index]
    const label = `page ${index + 1} rot ${geo.rotation}`
    assert.ok(
      Math.abs(found.x - want.x) <= tolerance,
      `${label}: left edge at ${found.x.toFixed(2)}, expected ${want.x}`,
    )
    assert.ok(
      Math.abs(found.y - want.y) <= tolerance,
      `${label}: top edge at ${found.y.toFixed(2)}, expected ${want.y}`,
    )
    assert.ok(
      Math.abs(found.w - want.w) <= tolerance * 2,
      `${label}: width ${found.w.toFixed(2)}, expected ${want.w}`,
    )
    assert.ok(
      Math.abs(found.h - want.h) <= tolerance * 2,
      `${label}: height ${found.h.toFixed(2)}, expected ${want.h}`,
    )

    console.log(
      `  ${label.padEnd(22)} ok  → x=${found.x.toFixed(1)} y=${found.y.toFixed(1)} ` +
        `w=${found.w.toFixed(1)} h=${found.h.toFixed(1)}`,
    )
  }

  await rm(workDir, { recursive: true, force: true })
  console.log(`export OK — stamp landed correctly on ${pages.length} pages`)
}

main().catch((err) => {
  console.error('export FAILED:', err.stack || err.message)
  process.exit(1)
})
