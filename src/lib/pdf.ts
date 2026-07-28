/** pdf.js integration: document loading, page geometry, rendering and
 *  AcroForm field discovery. */
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { pdfRectToView, viewSize } from './geometry'
import type { FormFieldInfo, PageGeometry, Rotation } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Served from the bundle root — see scripts/sync-pdfjs-assets.mjs.
const ASSETS = {
  cMapUrl: 'pdfjs/cmaps/',
  standardFontDataUrl: 'pdfjs/standard_fonts/',
  wasmUrl: 'pdfjs/wasm/',
  iccUrl: 'pdfjs/iccs/',
}

export interface LoadedPdf {
  doc: PDFDocumentProxy
  pages: PageGeometry[]
  fields: FormFieldInfo[]
  /** Values already present in the file's form fields. */
  initialValues: Record<string, string | boolean | string[]>
  encrypted: boolean
  title: string | null
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('This PDF is password protected.')
    this.name = 'PasswordRequiredError'
  }
}

/**
 * pdf.js transfers the buffer it is handed to its worker, which detaches it.
 * We keep the pristine bytes for pdf-lib, so always hand over a copy.
 */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...ASSETS,
    password,
    // Interactive fields are drawn by our own overlay, so keep them off the
    // raster; everything else (stamps, drawn shapes) stays baked in.
    enableXfa: false,
  })

  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'PasswordException') throw new PasswordRequiredError()
    throw err
  }

  const pages: PageGeometry[] = []
  const fields: FormFieldInfo[] = []
  const initialValues: Record<string, string | boolean | string[]> = {}

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const rotation = (((page.rotate % 360) + 360) % 360) as Rotation
    const view = page.view as [number, number, number, number]
    const { width, height } = viewSize(view, rotation)
    const geo: PageGeometry = {
      pageNumber: i,
      view,
      rotation,
      viewWidth: width,
      viewHeight: height,
    }
    pages.push(geo)
    await collectFields(page, geo, i - 1, fields, initialValues)
  }

  let title: string | null = null
  try {
    const meta = await doc.getMetadata()
    const info = meta.info as { Title?: string } | undefined
    if (info?.Title && info.Title.trim()) title = info.Title.trim()
  } catch {
    // Metadata is optional; a malformed Info dictionary must not block opening.
  }

  return { doc, pages, fields, initialValues, encrypted: false, title }
}

interface RawAnnotation {
  subtype?: string
  fieldType?: string
  fieldName?: string
  rect?: number[]
  readOnly?: boolean
  hidden?: boolean
  multiLine?: boolean
  maxLen?: number | null
  options?: { exportValue: string; displayValue: string }[]
  fieldValue?: string | string[] | null
  buttonValue?: string | null
  exportValue?: string
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  combo?: boolean
}

async function collectFields(
  page: PDFPageProxy,
  geo: PageGeometry,
  pageIndex: number,
  out: FormFieldInfo[],
  values: Record<string, string | boolean | string[]>,
) {
  let annotations: RawAnnotation[] = []
  try {
    annotations = (await page.getAnnotations({ intent: 'display' })) as RawAnnotation[]
  } catch {
    return
  }

  for (const a of annotations) {
    if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue
    if (a.pushButton) continue

    const rect = pdfRectToView(a.rect ?? [0, 0, 0, 0], geo)
    if (rect.w < 2 || rect.h < 2) continue

    let type: FormFieldInfo['type']
    if (a.fieldType === 'Tx') type = 'text'
    else if (a.fieldType === 'Ch') type = a.combo ? 'dropdown' : 'optionlist'
    else if (a.checkBox) type = 'checkbox'
    else if (a.radioButton) type = 'radio'
    else continue

    const options = a.options?.map((o) => o.exportValue ?? o.displayValue) ?? undefined

    let initial: FormFieldInfo['initial']
    if (type === 'checkbox' || type === 'radio') {
      const on = a.exportValue ?? a.buttonValue ?? 'On'
      initial = a.fieldValue != null && a.fieldValue !== 'Off' && a.fieldValue === on
      if (!(a.fieldName in values)) {
        values[a.fieldName] = type === 'radio' ? String(a.fieldValue ?? 'Off') : Boolean(initial)
      }
    } else {
      initial = (a.fieldValue as string | string[]) ?? ''
      if (!(a.fieldName in values)) values[a.fieldName] = initial
    }

    out.push({
      name: a.fieldName,
      type,
      page: pageIndex,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      readOnly: Boolean(a.readOnly),
      multiline: Boolean(a.multiLine),
      maxLen: a.maxLen ?? undefined,
      options,
      exportValue: a.exportValue ?? a.buttonValue ?? undefined,
      initial,
    })
  }
}

export interface RenderHandle {
  cancel(): void
}

/**
 * Draws a page onto a canvas at `scale` CSS px per point, sized for `dpr`.
 * Returns a handle so a superseded render can be aborted — scrolling a long
 * document otherwise queues dozens of stale rasterisations.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  dpr: number,
): { task: RenderTask; handle: RenderHandle } {
  const viewport = page.getViewport({ scale: scale * dpr })
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is unavailable')

  const task = page.render({
    canvas,
    canvasContext: context,
    viewport,
    // Widgets get interactive overlays of our own, so exclude them from the
    // raster to avoid drawing every value twice.
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
    background: '#ffffff',
  })

  return { task, handle: { cancel: () => task.cancel() } }
}

export function isCancelled(err: unknown): boolean {
  return (err as { name?: string })?.name === 'RenderingCancelledException'
}

export type { PDFDocumentProxy, PDFPageProxy }
