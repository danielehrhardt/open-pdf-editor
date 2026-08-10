/**
 * Writes the edited document back out with pdf-lib.
 *
 * Everything the user placed lives in *view space* (see geometry.ts); this
 * module is the single place that converts to PDF user space, so rotation and
 * CropBox handling is solved once.
 */
import {
  PDFArray,
  PDFDocument,
  PDFFont,
  PDFName,
  degrees,
  rgb,
} from 'pdf-lib'

import { drawAnchorForPoint, drawAnchorForRect } from './geometry'
import { hexToRgb, dataUrlToBytes } from './image'
import {
  FONTS,
  baselineOffset,
  lineHeightFor,
  sanitizeForFont,
  splitLines,
} from './text'
import type { FontKey, FormFieldInfo, PageGeometry, PdfElement } from '../types'

export interface ExportInput {
  /** Pristine bytes of the file as opened. */
  source: Uint8Array
  /**
   * Pages in the order they are shown, which is the order they are written in.
   * Each entry's `pageNumber` still points at its slot in `source`, so this
   * array doubles as the permutation to apply.
   */
  pages: PageGeometry[]
  elements: PdfElement[]
  fields: FormFieldInfo[]
  formValues: Record<string, string | boolean | string[]>
  /** Bake form fields into the page so the result is no longer editable. */
  flattenForm: boolean
}

export interface ExportResult {
  bytes: Uint8Array
  warnings: string[]
}

export class EncryptedPdfError extends Error {
  constructor() {
    super('This PDF is encrypted and cannot be saved with changes.')
    this.name = 'EncryptedPdfError'
  }
}

export async function buildPdf(input: ExportInput): Promise<ExportResult> {
  const warnings: string[] = []

  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(input.source, { updateMetadata: false })
  } catch (err) {
    if ((err as Error)?.name === 'EncryptedPDFError') throw new EncryptedPdfError()
    throw err
  }

  const fontCache = new Map<FontKey, PDFFont>()
  const charsets = new Map<FontKey, Set<number>>()
  const getFont = async (key: FontKey): Promise<PDFFont> => {
    const cached = fontCache.get(key)
    if (cached) return cached
    const font = await doc.embedFont(FONTS[key].standard)
    fontCache.set(key, font)
    charsets.set(key, new Set(font.getCharacterSet()))
    return font
  }

  await applyFormValues(doc, input, warnings, getFont)
  await drawElements(doc, input, warnings, getFont, charsets)
  applyPageOrder(doc, input.pages)

  if (input.flattenForm && input.fields.length > 0) {
    try {
      doc.getForm().flatten()
    } catch {
      warnings.push('Form fields could not be flattened, so they stay editable.')
    }
  }

  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false })
  return { bytes, warnings }
}

async function applyFormValues(
  doc: PDFDocument,
  input: ExportInput,
  warnings: string[],
  getFont: (key: FontKey) => Promise<PDFFont>,
) {
  if (input.fields.length === 0) return

  let form
  try {
    form = doc.getForm()
  } catch {
    warnings.push('The interactive form could not be read; field values were skipped.')
    return
  }

  const seen = new Set<string>()
  for (const field of input.fields) {
    if (field.readOnly || seen.has(field.name)) continue
    seen.add(field.name)

    const value = input.formValues[field.name]
    if (value === undefined) continue

    try {
      switch (field.type) {
        case 'text': {
          const target = form.getTextField(field.name)
          target.setText(String(value ?? ''))
          break
        }
        case 'checkbox': {
          const target = form.getCheckBox(field.name)
          if (value) target.check()
          else target.uncheck()
          break
        }
        case 'radio': {
          const target = form.getRadioGroup(field.name)
          const choice = String(value ?? '')
          if (!choice || choice === 'Off') target.clear()
          else target.select(choice)
          break
        }
        case 'dropdown': {
          const target = form.getDropdown(field.name)
          const choice = String(value ?? '')
          if (choice) target.select(choice)
          break
        }
        case 'optionlist': {
          const target = form.getOptionList(field.name)
          const choices = Array.isArray(value) ? value : value ? [String(value)] : []
          if (choices.length) target.select(choices)
          break
        }
      }
    } catch {
      warnings.push(`Could not set the field "${field.name}".`)
    }
  }

  // Appearance streams must be regenerated or viewers show stale text. Doing it
  // here (rather than letting save() do it) lets us pin a font we know embeds.
  try {
    form.updateFieldAppearances(await getFont('helvetica'))
  } catch {
    try {
      form.updateFieldAppearances()
    } catch {
      warnings.push('Some filled fields may not display until clicked.')
    }
  }
}

async function drawElements(
  doc: PDFDocument,
  input: ExportInput,
  warnings: string[],
  getFont: (key: FontKey) => Promise<PDFFont>,
  charsets: Map<FontKey, Set<number>>,
) {
  if (input.elements.length === 0) return

  const pages = doc.getPages()
  const byPage = new Map<number, PdfElement[]>()
  for (const el of input.elements) {
    if (el.page < 0 || el.page >= input.pages.length) continue
    const list = byPage.get(el.page)
    if (list) list.push(el)
    else byPage.set(el.page, [el])
  }

  const imageCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  let droppedChars = 0

  for (const [pageIndex, elements] of byPage) {
    // `pageIndex` is a position on screen; the page it names may sit elsewhere
    // in the source file once the user has reordered the document.
    const geo = input.pages[pageIndex]
    const page = geo ? pages[geo.pageNumber - 1] : undefined
    if (!geo || !page) continue

    isolateExistingContent(doc, page)

    for (const el of elements) {
      if (el.kind === 'text') {
        const font = await getFont(el.font)
        const supported = charsets.get(el.font)!
        const { r, g, b } = hexToRgb(el.color)
        const color = rgb(r / 255, g / 255, b / 255)
        const lineHeight = lineHeightFor(el.fontSize)
        const firstBaseline = baselineOffset(el.font, el.fontSize)
        const lines = splitLines(el.text)

        for (let i = 0; i < lines.length; i++) {
          const { text, dropped } = sanitizeForFont(lines[i], supported)
          droppedChars += dropped
          if (!text.trim()) continue

          const baselineY = el.y + firstBaseline + i * lineHeight

          if (el.letterSpacing > 0) {
            // Comb fields need per-glyph placement; walking the baseline in
            // view space keeps rotation handling identical to the simple case.
            let dx = 0
            for (const ch of text) {
              if (ch !== ' ') {
                const at = drawAnchorForPoint({ x: el.x + dx, y: baselineY }, geo)
                page.drawText(ch, {
                  x: at.x,
                  y: at.y,
                  size: el.fontSize,
                  font,
                  color,
                  rotate: degrees(at.rotate),
                })
              }
              dx += font.widthOfTextAtSize(ch, el.fontSize) + el.letterSpacing
            }
          } else {
            const at = drawAnchorForPoint({ x: el.x, y: baselineY }, geo)
            page.drawText(text, {
              x: at.x,
              y: at.y,
              size: el.fontSize,
              font,
              color,
              rotate: degrees(at.rotate),
            })
          }
        }
        continue
      }

      // Signature / image stamp.
      let embedded = imageCache.get(el.src)
      if (!embedded) {
        try {
          embedded = await doc.embedPng(dataUrlToBytes(el.src))
        } catch {
          warnings.push('One image could not be embedded and was skipped.')
          continue
        }
        imageCache.set(el.src, embedded)
      }

      const anchor = drawAnchorForRect({ x: el.x, y: el.y, w: el.w, h: el.h }, geo)
      page.drawImage(embedded, {
        x: anchor.x,
        y: anchor.y,
        width: el.w,
        height: el.h,
        rotate: degrees(anchor.rotate),
        opacity: el.opacity ?? 1,
      })
    }
  }

  if (droppedChars > 0) {
    warnings.push(
      `${droppedChars} character${droppedChars === 1 ? '' : 's'} could not be written with the ` +
        'selected font and became "?".',
    )
  }
}

/**
 * Rewrites the page tree so the file comes out in the order shown on screen.
 *
 * Pages are moved one at a time rather than by emptying the tree and refilling
 * it: the document stays valid at every step, and a page keeps its identity, so
 * annotations, form widgets and links that point at it survive the move.
 */
function applyPageOrder(doc: PDFDocument, order: PageGeometry[]) {
  const original = doc.getPages()
  if (order.length !== original.length) return

  const desired = order.map((geo) => original[geo.pageNumber - 1])
  if (desired.some((page) => !page)) return
  // Untouched order: nothing to do, and nothing to risk.
  if (desired.every((page, i) => page === original[i])) return

  for (let target = 0; target < desired.length; target++) {
    // Re-read each round: every move shifts the pages after it.
    const current = doc.getPages()
    if (current[target] === desired[target]) continue
    const at = current.indexOf(desired[target])
    // Unreachable for a well-formed permutation. Throwing beats saving a file
    // whose pages are half-sorted, which the user would have no way to spot.
    if (at < 0) throw new Error('The pages could not be reordered.')
    doc.removePage(at)
    doc.insertPage(target, desired[target])
  }
}

/**
 * Brackets a page's original content stream in `q`/`Q`.
 *
 * PDF concatenates a page's content streams, so a source document that leaves
 * the graphics state modified (an unbalanced `cm` or `q`) would otherwise drag
 * our appended stamps along with it. Balancing it first pins our drawing to
 * plain user space. Purely defensive — a no-op for well-formed files.
 */
function isolateExistingContent(doc: PDFDocument, page: ReturnType<PDFDocument['getPages']>[0]) {
  try {
    const key = PDFName.of('Contents')
    const raw = page.node.get(key)
    if (!raw) return

    const open = doc.context.register(doc.context.stream('q'))
    const close = doc.context.register(doc.context.stream('Q'))

    const resolved = doc.context.lookup(raw)
    if (resolved instanceof PDFArray) {
      resolved.insert(0, open)
      resolved.push(close)
    } else {
      page.node.set(key, doc.context.obj([open, raw, close]))
    }
  } catch {
    // Never let a hardening step block a save.
  }
}
