/**
 * Verifies the two remaining halves of saving:
 *
 *  1. AcroForm values written by `buildPdf` survive a round trip, render
 *     through fresh appearance streams, and disappear into page content when
 *     "lock form fields" is on.
 *  2. Text elements are emitted as real (selectable) PDF text at the baseline
 *     the on-screen overlay showed.
 */
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { build } from 'esbuild'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

installDomShims()

const workDir = await mkdtemp(path.join(process.cwd(), 'node_modules', '.inkwell-verify-'))
const bundlePath = path.join(workDir, 'bundle.mjs')
await build({
  stdin: {
    contents:
      "export { buildPdf } from './src/lib/export.ts'\n" +
      "export { viewSize, pdfToView } from './src/lib/geometry.ts'\n" +
      "export { baselineOffset, lineHeightFor } from './src/lib/text.ts'\n",
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
const { buildPdf, viewSize, pdfToView, baselineOffset } = await import(bundlePath)

const OPS = pdfjs.OPS

// pdf.js needs the base-14 substitutes to extract text from a page.
const PDFJS_ASSETS = {
  standardFontDataUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
  cMapUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep,
  cMapPacked: true,
}

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
const IDENTITY = [1, 0, 0, 1, 0, 0]

/* ---------------------------------------------------------------- fixture --- */

const PAGE = [612, 792]

/** A one-page form with a text field, a checkbox and a dropdown. */
async function buildFormFixture() {
  const doc = await PDFDocument.create()
  const page = doc.addPage(PAGE)
  const form = doc.getForm()

  const name = form.createTextField('applicant.name')
  name.addToPage(page, { x: 72, y: 640, width: 260, height: 22 })

  const agree = form.createCheckBox('applicant.agree')
  agree.addToPage(page, { x: 72, y: 600, width: 14, height: 14 })

  const country = form.createDropdown('applicant.country')
  country.setOptions(['Germany', 'Austria', 'Switzerland'])
  country.addToPage(page, { x: 72, y: 560, width: 160, height: 20 })

  return doc.save()
}

/** Mirrors what `loadPdf` produces for those widgets, in view space. */
function fieldsFor(geo) {
  const rect = (x, y, w, h) => {
    // Widgets above were placed in PDF space; convert to view space the same
    // way the app does.
    const a = pdfToView({ x, y: y + h }, geo)
    return { x: a.x, y: a.y, w, h }
  }
  return [
    { name: 'applicant.name', type: 'text', page: 0, ...rect(72, 640, 260, 22), readOnly: false, multiline: false, initial: '' },
    { name: 'applicant.agree', type: 'checkbox', page: 0, ...rect(72, 600, 14, 14), readOnly: false, multiline: false, exportValue: 'Yes', initial: false },
    { name: 'applicant.country', type: 'dropdown', page: 0, ...rect(72, 560, 160, 20), readOnly: false, multiline: false, options: ['Germany', 'Austria', 'Switzerland'], initial: '' },
  ]
}

async function geometryOf(bytes, pageNumber = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSETS }).promise
  const page = await doc.getPage(pageNumber)
  const rotation = ((page.rotate % 360) + 360) % 360
  const view = page.view
  const { width, height } = viewSize(view, rotation)
  const geo = { pageNumber, view, rotation, viewWidth: width, viewHeight: height }
  await doc.destroy()
  return geo
}

/** Collects text-showing operations along with the matrix in force. */
async function textRuns(bytes, pageNumber = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSETS }).promise
  const page = await doc.getPage(pageNumber)
  const { fnArray, argsArray } = await page.getOperatorList()

  const runs = []
  const stack = []
  let ctm = IDENTITY
  let textMatrix = IDENTITY

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY
    else if (fn === OPS.transform) ctm = mul(ctm, args)
    else if (fn === OPS.beginText) textMatrix = IDENTITY
    else if (fn === OPS.setTextMatrix) {
      // pdf.js packs the matrix into a single typed-array argument.
      const first = args[0]
      const m = first && typeof first === 'object' && first.length >= 6 ? first : args
      textMatrix = [m[0], m[1], m[2], m[3], m[4], m[5]]
    } else if (fn === OPS.showText) {
      const m = mul(ctm, textMatrix)
      const glyphs = (args[0] ?? [])
        .filter((g) => g && typeof g === 'object' && 'unicode' in g)
        .map((g) => g.unicode)
        .join('')
      runs.push({ text: glyphs, x: m[4], y: m[5] })
    }
  }

  const content = await page.getTextContent()
  await doc.destroy()
  return { runs, plain: content.items.map((i) => i.str).join('') }
}

/** Reads the text a field's normal appearance stream actually paints. */
function appearanceText(doc, fieldName) {
  const field = doc.getForm().getField(fieldName)
  let out = ''
  for (const widget of field.acroField.getWidgets()) {
    const ref = widget.getNormalAppearance()
    const stream = doc.context.lookup(ref)
    if (!stream || typeof stream.getContents !== 'function') continue
    let bytes = Buffer.from(stream.getContents())
    // Saved streams are Flate-compressed; decode before looking for operators.
    try {
      bytes = inflateSync(bytes)
    } catch {
      /* already plain */
    }
    out += bytes.toString('latin1')
  }
  return out
}

/**
 * Pulls the readable text out of a content stream. pdf-lib writes strings for
 * standard fonts as hex (`<44616e...> Tj`), so decode those as well as literal
 * `( ... ) Tj` runs.
 */
function readableText(content) {
  let out = ''
  for (const [, hex] of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    const clean = hex.replace(/\s+/g, '')
    for (let i = 0; i + 1 < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
    }
  }
  for (const [, literal] of content.matchAll(/\(((?:\\.|[^()])*)\)\s*Tj/g)) {
    out += literal.replace(/\\([()\\])/g, '$1')
  }
  return out
}

const close = (got, want, tol, what) =>
  assert.ok(
    Math.abs(got - want) <= tol,
    `${what}: expected ${want.toFixed(3)}, got ${got.toFixed(3)} (Δ ${Math.abs(got - want).toFixed(3)})`,
  )

/* ------------------------------------------------------------------- main --- */

async function main() {
  const source = await buildFormFixture()
  const geo = await geometryOf(source)
  const fields = fieldsFor(geo)

  const formValues = {
    'applicant.name': 'Daniel Ehrhardt',
    'applicant.agree': true,
    'applicant.country': 'Germany',
  }

  /* --- 1a. keeping fields editable ------------------------------------- */
  {
    const { bytes, warnings } = await buildPdf({
      source,
      pages: [geo],
      elements: [],
      fields,
      formValues,
      flattenForm: false,
    })
    assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join('; ')}`)

    const out = await PDFDocument.load(bytes)
    const form = out.getForm()
    assert.equal(form.getTextField('applicant.name').getText(), 'Daniel Ehrhardt')
    assert.equal(form.getCheckBox('applicant.agree').isChecked(), true)
    assert.equal(form.getDropdown('applicant.country').getSelected()[0], 'Germany')

    // Stored values are not enough: without a regenerated appearance stream
    // most viewers draw an empty box. Field text lives in the widget's /AP,
    // not in the page content, so inspect it directly.
    const painted = readableText(appearanceText(out, 'applicant.name'))
    assert.ok(
      painted.includes('Daniel Ehrhardt'),
      `no appearance stream paints the value; it painted ${JSON.stringify(painted)}`,
    )
    console.log('  editable form   ok  — values stored and drawn into /AP')
  }

  /* --- 1b. locking fields ----------------------------------------------- */
  {
    const { bytes } = await buildPdf({
      source,
      pages: [geo],
      elements: [],
      fields,
      formValues,
      flattenForm: true,
    })

    const out = await PDFDocument.load(bytes)
    assert.equal(
      out.getForm().getFields().length,
      0,
      'fields should be gone after locking',
    )
    const { plain } = await textRuns(bytes)
    assert.ok(plain.includes('Daniel Ehrhardt'), 'locked value must stay visible')
    console.log('  locked form     ok  — fields flattened, text preserved')
  }

  /* --- 2. text elements -------------------------------------------------- */
  {
    const element = {
      id: 'text1',
      kind: 'text',
      page: 0,
      x: 120,
      y: 300,
      w: 200,
      h: 20,
      text: 'Munich, 28.07.2026',
      fontSize: 12,
      font: 'helvetica',
      color: '#111827',
      letterSpacing: 0,
    }

    const { bytes, warnings } = await buildPdf({
      source,
      pages: [geo],
      elements: [element],
      fields: [],
      formValues: {},
      flattenForm: false,
    })
    assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join('; ')}`)

    const { runs, plain } = await textRuns(bytes)
    assert.ok(plain.includes('Munich, 28.07.2026'), `text missing; got ${JSON.stringify(plain)}`)

    const run = runs.find((r) => r.text.startsWith('Munich'))
    assert.ok(run, 'could not locate the drawn text run')

    // The baseline must sit where the overlay drew it.
    const expectedBaselineY = element.y + baselineOffset(element.font, element.fontSize)
    const got = pdfToView({ x: run.x, y: run.y }, geo)
    close(got.x, element.x, 0.01, 'text left edge')
    close(got.y, expectedBaselineY, 0.01, 'text baseline')

    console.log(
      `  text element    ok  — baseline at y=${got.y.toFixed(2)} ` +
        `(expected ${expectedBaselineY.toFixed(2)}), searchable in the output`,
    )
  }

  await rm(workDir, { recursive: true, force: true })
  console.log('forms + text OK')
}

main().catch(async (err) => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
  console.error('forms FAILED:', err.stack || err.message)
  process.exit(1)
})
