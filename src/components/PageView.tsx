/** One rendered PDF page plus its interactive overlays. */
import { useEffect, useRef, useState } from 'react'

import { isCancelled, renderPage } from '../lib/pdf'
import { measureBlock } from '../lib/text'
import { newElementId, useApp } from '../state/store'
import type { FormFieldInfo, ImageElement, PageGeometry, PdfElement, TextElement } from '../types'
import { ElementBar } from './ElementBar'
import { ElementBox } from './ElementBox'
import { FormLayer } from './FormLayer'

/** Safari refuses canvases beyond ~16.7M pixels, so cap the raster and let CSS
 *  scale the last stretch at very high zoom. */
const MAX_CANVAS_PIXELS = 15_000_000

interface Props {
  index: number
  page: PageGeometry
  zoom: number
  active: boolean
  fields: FormFieldInfo[]
  elements: PdfElement[]
  onPlace: (pageIndex: number, x: number, y: number) => void
}

export function PageView({ index, page, zoom, active, fields, elements, onPlace }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  const doc = useApp((s) => s.doc)
  const tool = useApp((s) => s.tool)
  const pending = useApp((s) => s.pending)
  const selectedId = useApp((s) => s.selectedId)
  const editingId = useApp((s) => s.editingId)
  const select = useApp((s) => s.select)

  const width = page.viewWidth * zoom
  const height = page.viewHeight * zoom
  const selectedElement = elements.find((el) => el.id === selectedId) ?? null

  useEffect(() => {
    if (!doc || !active) return
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const budget = Math.sqrt(MAX_CANVAS_PIXELS / (page.viewWidth * page.viewHeight))
    const effective = Math.min(zoom * dpr, budget)

    let cancelRender: (() => void) | null = null

    void (async () => {
      try {
        const pdfPage = await doc.getPage(page.pageNumber)
        if (cancelled) return
        const { task, handle } = renderPage(pdfPage, canvas, effective / dpr, dpr)
        cancelRender = handle.cancel
        await task.promise
        if (!cancelled) setRendered(true)
      } catch (err) {
        if (!isCancelled(err)) console.error('Could not render page', page.pageNumber, err)
      }
    })()

    return () => {
      cancelled = true
      cancelRender?.()
    }
  }, [doc, page, zoom, active])

  const placing = tool !== 'select' && (tool !== 'signature' || Boolean(pending))

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!placing) {
      // Clicking empty page area clears the selection.
      if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'CANVAS') {
        select(null)
      }
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    onPlace(index, (e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom)
  }

  return (
    <div
      className="page"
      data-page={index}
      data-placing={placing}
      style={{ width, height }}
      onPointerDown={handlePointerDown}
    >
      <canvas ref={canvasRef} className="page__canvas" style={{ width, height }} />

      {!rendered && (
        <div className="page__skeleton">
          <div className="page__spinner" />
        </div>
      )}

      {!placing && fields.length > 0 && <FormLayer fields={fields} zoom={zoom} />}

      {elements.map((el) => (
        <ElementBox
          key={el.id}
          element={el}
          zoom={zoom}
          selected={el.id === selectedId}
          editing={el.id === editingId}
        />
      ))}

      {selectedElement && !editingId && <ElementBar element={selectedElement} zoom={zoom} />}
    </div>
  )
}

/**
 * Builds the element for a click on the page, sized so it reads well at 100%
 * without the user having to resize it first.
 */
export function createElementForTool(
  tool: string,
  pageIndex: number,
  page: PageGeometry,
  x: number,
  y: number,
  options: {
    pending: { src: string; aspect: number; kind: 'signature' | 'image'; sourceId?: string; width: number } | null
    text?: { value: string; font: TextElement['font']; fontSize: number; color: string }
  },
): PdfElement | null {
  if (tool === 'signature' || tool === 'image' || tool === 'check') {
    const p = options.pending
    if (!p) return null
    const w = Math.min(p.width, page.viewWidth * 0.8)
    const h = w / (p.aspect || 1)
    const el: ImageElement = {
      id: newElementId(),
      kind: p.kind,
      page: pageIndex,
      // Drop centred on the cursor: that is where the user is looking.
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      src: p.src,
      aspect: p.aspect || 1,
      sourceId: p.sourceId,
      opacity: 1,
    }
    return el
  }

  if (tool === 'text' || tool === 'date') {
    const t = options.text
    if (!t) return null
    const size = measureBlock(t.font, t.fontSize, t.value || ' ', 0)
    const el: TextElement = {
      id: newElementId(),
      kind: 'text',
      page: pageIndex,
      x,
      // Centre the first line on the cursor so the caret lands where you click.
      y: y - size.h / 2,
      w: size.w,
      h: size.h,
      text: t.value,
      fontSize: t.fontSize,
      font: t.font,
      color: t.color,
      letterSpacing: 0,
    }
    return el
  }

  return null
}
