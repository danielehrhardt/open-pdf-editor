/**
 * Proof that a reordered document is written in the order the user dragged out.
 *
 * `buildPdf` receives pages in display order, each still carrying the slot it
 * came from in the source file. This runs the real exporter over a fixture whose
 * pages are individually identifiable (distinct sizes, distinct rotations, one
 * carrying a form widget), reorders them, and re-parses the *output* to check
 * three things that are easy to get subtly wrong:
 *
 *   1. the pages come out in the new order;
 *   2. a stamp placed on the third thumbnail lands on the third page of the
 *      output, not on the page that used to be third;
 *   3. annotations ride along with their page rather than staying behind.
 *
 * A permutation that only shuffles identical pages would prove none of this,
 * which is why every page here is different.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { build } from 'esbuild'
import { PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

installDomShims()

const workDir = await mkdtemp(path.join(process.cwd(), 'node_modules', '.inkwell-verify-'))
const bundlePath = path.join(workDir, 'bundle.mjs')
await build({
  stdin: {
    contents:
      "export { buildPdf } from './src/lib/export.ts'\n" +
      "export { viewSize, pdfToView } from './src/lib/geometry.ts'\n" +
      "export { movePageOrder } from './src/lib/pages.ts'\n",
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
const { buildPdf, viewSize, pdfToView, movePageOrder } = await import(bundlePath)

const OPS = pdfjs.OPS
const IDENTITY = [1, 0, 0, 1, 0, 0]

/** Distinct on purpose: page size is how the output is identified. */
const FIXTURE = [
  { size: [400, 500], rotation: 0 },
  { size: [420, 520], rotation: 90 },
  { size: [440, 540], rotation: 180 },
  { size: [460, 560], rotation: 270 },
]

/** Display order as 0-based indices into FIXTURE — every page moves. */
const ORDER = [2, 0, 3, 1]

/** The page that carries the form widget, as a FIXTURE index. */
const WIDGET_PAGE = 1
const WIDGET_NAME = 'rider'

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

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

const applyMatrix = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

function redSquarePng(size = 64) {
  const canvas = createCanvas(size, size)
  const g = canvas.getContext('2d')
  g.fillStyle = '#ff0000'
  g.fillRect(0, 0, size, size)
  return canvas.toDataURL('image/png')
}

async function buildFixture() {
  const doc = await PDFDocument.create()
  const form = doc.getForm()

  FIXTURE.forEach((spec, index) => {
    const page = doc.addPage(spec.size)
    page.drawRectangle({ x: 0, y: 0, width: spec.size[0], height: spec.size[1], color: rgb(1, 1, 1) })
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(spec.rotation))
    if (index === WIDGET_PAGE) {
      form.createTextField(WIDGET_NAME).addToPage(page, { x: 20, y: 20, width: 120, height: 20 })
    }
  })

  return doc.save()
}

function geometryFor(page) {
  const rotation = ((page.rotate % 360) + 360) % 360
  const view = page.view
  const { width, height } = viewSize(view, rotation)
  return { pageNumber: page.pageNumber, view, rotation, viewWidth: width, viewHeight: height }
}

/** Replays a page's operator list and returns the CTM at each image paint. */
async function imageMatrices(doc, pageNumber) {
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

  return found
}

async function widgetPages(doc) {
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const annotations = await page.getAnnotations({ intent: 'display' })
    if (annotations.some((a) => a.fieldName === WIDGET_NAME)) out.push(i)
  }
  return out
}

const close = (got, want, tolerance, what) =>
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${what}: expected ${want.toFixed(4)}, got ${got.toFixed(4)} (Δ ${Math.abs(got - want).toFixed(4)})`,
  )

/**
 * Every move on an 8-page document, checked against the only thing that can
 * define the answer: where each page actually ended up. The remap is what keeps
 * a signature on its page, so an off-by-one here is silent data loss.
 */
function verifyRemap() {
  const size = 8
  const pages = Array.from({ length: size }, (_, i) => `p${i}`)
  let assertions = 0

  for (let from = 0; from < size; from++) {
    for (let to = 0; to < size; to++) {
      const move = movePageOrder(pages, from, to)

      if (from === to) {
        assert.equal(move, null, `move ${from}->${to} should be a no-op`)
        assertions += 1
        continue
      }

      assert.ok(move, `move ${from}->${to} should have produced an order`)
      assert.deepEqual(
        [...move.pages].sort(),
        [...pages].sort(),
        `move ${from}->${to} lost or duplicated a page`,
      )
      assert.equal(move.pages[to], pages[from], `move ${from}->${to} did not land at ${to}`)

      for (let index = 0; index < size; index++) {
        assert.equal(
          move.remap(index),
          move.pages.indexOf(pages[index]),
          `move ${from}->${to}: page ${index} was remapped to the wrong slot`,
        )
        assertions += 1
      }
      assertions += 2
    }
  }

  // Out of range in, nothing out.
  assert.equal(movePageOrder(pages, -1, 2), null)
  assert.equal(movePageOrder(pages, size, 2), null)
  // A drop past the end clamps onto the last slot rather than dropping a page.
  assert.equal(movePageOrder(pages, 0, size + 5).pages.at(-1), pages[0])
  assertions += 3

  console.log(`  remap          ok  — ${size * size} moves on ${size} pages`)
  return assertions
}

async function main() {
  const remapAssertions = verifyRemap()

  const source = await buildFixture()

  const probe = await pdfjs.getDocument({ data: source.slice() }).promise
  const original = []
  for (let i = 1; i <= probe.numPages; i++) original.push(geometryFor(await probe.getPage(i)))
  await probe.destroy()
  assert.equal(original.length, FIXTURE.length, 'fixture did not build as expected')

  // What the rail looks like after the drags: display order, source slots kept.
  const pages = ORDER.map((from) => original[from])
  const src = redSquarePng()

  // Off-centre, non-square, and a different x per page: neither a wrong
  // rotation nor a page mix-up can hide behind symmetry.
  const elements = pages.map((_geo, index) => ({
    id: `el${index}`,
    kind: 'signature',
    page: index,
    x: 40 + index * 12,
    y: 60,
    w: 100,
    h: 50,
    src,
    aspect: 2,
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

  const out = await pdfjs.getDocument({ data: bytes.slice() }).promise
  assert.equal(out.numPages, FIXTURE.length, 'the page count changed while reordering')

  const tolerance = 1e-6
  let assertions = remapAssertions

  for (let index = 0; index < pages.length; index++) {
    const geo = pages[index]
    const spec = FIXTURE[ORDER[index]]
    const label = `slot ${index + 1} <- source page ${geo.pageNumber}`

    // 1. The right page is in this slot.
    const actual = geometryFor(await out.getPage(index + 1))
    assert.deepEqual(
      [actual.view[2] - actual.view[0], actual.view[3] - actual.view[1]],
      spec.size,
      `${label}: wrong page in this slot`,
    )
    assert.equal(actual.rotation, spec.rotation, `${label}: rotation did not travel with the page`)
    assertions += 2

    // 2. The stamp placed on this thumbnail is on this page, where it was put.
    const matrices = await imageMatrices(out, index + 1)
    assert.equal(matrices.length, 1, `${label}: expected exactly one stamp, saw ${matrices.length}`)
    const m = matrices[0]

    const want = elements[index]
    const corners = {
      'bottom-left': { u: 0, v: 0, x: want.x, y: want.y + want.h },
      'bottom-right': { u: 1, v: 0, x: want.x + want.w, y: want.y + want.h },
      'top-right': { u: 1, v: 1, x: want.x + want.w, y: want.y },
      'top-left': { u: 0, v: 1, x: want.x, y: want.y },
    }
    for (const [corner, e] of Object.entries(corners)) {
      const inView = pdfToView(applyMatrix(m, e.u, e.v), geo)
      close(inView.x, e.x, tolerance, `${label} ${corner}.x`)
      close(inView.y, e.y, tolerance, `${label} ${corner}.y`)
      assertions += 2
    }

    console.log(`  ${label}  ok`)
  }

  // 3. The form widget moved with its page.
  const expectedWidgetSlot = ORDER.indexOf(WIDGET_PAGE) + 1
  assert.deepEqual(
    await widgetPages(out),
    [expectedWidgetSlot],
    `the "${WIDGET_NAME}" widget did not follow its page to slot ${expectedWidgetSlot}`,
  )
  assertions += 1
  await out.destroy()

  // Flattening is the default on save, and it resolves widgets to pages by
  // reference — so it has to survive the pages having moved underneath it.
  const widgetSlot = ORDER.indexOf(WIDGET_PAGE)
  const flattened = await buildPdf({
    source,
    pages,
    elements: [],
    fields: [
      {
        name: WIDGET_NAME,
        type: 'text',
        page: widgetSlot,
        x: 20,
        y: 20,
        w: 120,
        h: 20,
        readOnly: false,
        multiline: false,
        initial: '',
      },
    ],
    formValues: { [WIDGET_NAME]: 'moved' },
    flattenForm: true,
  })
  assert.equal(
    flattened.warnings.length,
    0,
    `unexpected warnings while flattening a reordered file: ${flattened.warnings.join('; ')}`,
  )
  const baked = await pdfjs.getDocument({ data: flattened.bytes.slice() }).promise
  assert.equal(baked.numPages, FIXTURE.length)
  assert.deepEqual(await widgetPages(baked), [], 'the field was not flattened')
  for (let i = 0; i < FIXTURE.length; i++) {
    const geo = geometryFor(await baked.getPage(i + 1))
    assert.deepEqual(
      [geo.view[2] - geo.view[0], geo.view[3] - geo.view[1]],
      FIXTURE[ORDER[i]].size,
      `flattening disturbed the page order at slot ${i + 1}`,
    )
    assertions += 1
  }
  const bakedText = await (await baked.getPage(widgetSlot + 1)).getTextContent()
  assert.ok(
    bakedText.items.some((item) => item.str.includes('moved')),
    'the flattened value did not land on the page the field moved to',
  )
  assertions += 3
  await baked.destroy()

  // An untouched order must still write the file unchanged in structure.
  const untouched = await buildPdf({
    source,
    pages: original,
    elements: [],
    fields: [],
    formValues: {},
    flattenForm: false,
  })
  const same = await pdfjs.getDocument({ data: untouched.bytes.slice() }).promise
  assert.equal(same.numPages, FIXTURE.length)
  for (let i = 0; i < FIXTURE.length; i++) {
    const geo = geometryFor(await same.getPage(i + 1))
    assert.deepEqual(
      [geo.view[2] - geo.view[0], geo.view[3] - geo.view[1]],
      FIXTURE[i].size,
      `saving without reordering disturbed page ${i + 1}`,
    )
    assertions += 1
  }
  await same.destroy()

  await rm(workDir, { recursive: true, force: true })
  console.log(
    `page order OK — ${assertions} assertions; ${FIXTURE.length} pages written in the ` +
      'dragged order with their stamps and widgets attached',
  )
}

main().catch(async (err) => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  console.error('page order FAILED:', err.stack || err.message)
  process.exit(1)
})
