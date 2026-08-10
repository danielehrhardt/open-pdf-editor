/** Page thumbnail rail, doubling as the page-order editor. */
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import { isCancelled, renderPage } from '../lib/pdf'
import { useApp } from '../state/store'
import type { PageGeometry } from '../types'
import { scrollToPage } from './Viewer'

const THUMB_WIDTH = 128

export function Thumbnails() {
  const pages = useApp((s) => s.pages)
  const currentPage = useApp((s) => s.currentPage)
  const elements = useApp((s) => s.elements)
  const movePage = useApp((s) => s.movePage)
  const railRef = useRef<HTMLDivElement>(null)

  /** Page being dragged, and the gap it would drop into (0…pages.length). */
  const [dragging, setDragging] = useState<number | null>(null)
  const [gap, setGap] = useState<number | null>(null)

  // Follow the viewer's current page without stealing focus.
  useEffect(() => {
    const node = railRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  const reset = () => {
    setDragging(null)
    setGap(null)
  }

  const move = (from: number, to: number) => {
    if (from === to) return
    movePage(from, to)
    // The store has moved the page the viewer was showing to a new index;
    // scrolling there keeps the reader where they were instead of silently
    // sliding a different page under them.
    const anchor = useApp.getState().currentPage
    requestAnimationFrame(() => scrollToPage(anchor))
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    if (dragging !== null && gap !== null) {
      // A gap index counts the slots between pages; dropping below your own
      // position means one fewer page sits above you afterwards.
      move(dragging, gap > dragging ? gap - 1 : gap)
    }
    reset()
  }

  return (
    <aside
      className="thumbs"
      ref={railRef}
      aria-label="Pages"
      onDragOver={(event) => {
        if (dragging === null) return
        event.preventDefault()
        // Below the last thumbnail: append.
        if (event.target === event.currentTarget) setGap(pages.length)
      }}
      onDrop={drop}
      onDragEnd={reset}
    >
      {pages.map((page, i) => (
        <Thumb
          key={page.pageNumber}
          page={page}
          index={i}
          total={pages.length}
          current={i === currentPage}
          marks={elements.filter((e) => e.page === i).length}
          dragging={dragging === i}
          drop={dragging === null ? null : dropSide(gap, i, pages.length)}
          onDragStart={() => setDragging(i)}
          onDragOverHalf={(half) => setGap(half === 'top' ? i : i + 1)}
          onMove={(to) => move(i, to)}
        />
      ))}
    </aside>
  )
}

/**
 * Which edge of thumbnail `index` carries the drop line for a given gap.
 * Every gap but the last one belongs to the page below it, so exactly one
 * thumbnail is ever marked.
 */
function dropSide(gap: number | null, index: number, total: number): 'before' | 'after' | null {
  if (gap === null) return null
  if (gap === index) return 'before'
  if (gap >= total && index === total - 1) return 'after'
  return null
}

function Thumb({
  page,
  index,
  total,
  current,
  marks,
  dragging,
  drop,
  onDragStart,
  onDragOverHalf,
  onMove,
}: {
  page: PageGeometry
  index: number
  total: number
  current: boolean
  marks: number
  dragging: boolean
  drop: 'before' | 'after' | null
  onDragStart: () => void
  onDragOverHalf: (half: 'top' | 'bottom') => void
  onMove: (to: number) => void
}) {
  const doc = useApp((s) => s.doc)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(index < 6)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    if (seen) return
    const node = frameRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [seen])

  useEffect(() => {
    if (!doc || !seen) return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let cancelRender: (() => void) | null = null

    void (async () => {
      try {
        const pdfPage = await doc.getPage(page.pageNumber)
        if (cancelled) return
        const { task, handle } = renderPage(pdfPage, canvas, THUMB_WIDTH / page.viewWidth, 2)
        cancelRender = handle.cancel
        await task.promise
        if (!cancelled) setRendered(true)
      } catch (err) {
        if (!isCancelled(err)) console.error('Could not render thumbnail', page.pageNumber, err)
      }
    })()

    return () => {
      cancelled = true
      cancelRender?.()
    }
  }, [doc, page, seen])

  /** Alt+↑/↓ is the keyboard equivalent of dragging the thumbnail. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    const to = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= total) return
    event.preventDefault()
    // The window-level shortcut handler would otherwise nudge the selected
    // element at the same time.
    event.stopPropagation()
    onMove(to)
    // The rail re-sorts under the caret, so chase the page that just moved.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-thumb="${to}"]`)?.focus()
    })
  }

  const moved = page.pageNumber !== index + 1

  return (
    <button
      type="button"
      className="thumb"
      data-thumb={index}
      data-dragging={dragging || undefined}
      data-drop={drop ?? undefined}
      aria-current={current}
      draggable
      onClick={() => scrollToPage(index)}
      onKeyDown={onKeyDown}
      onDragStart={(event) => {
        // Firefox ignores a drag that carries no payload.
        event.dataTransfer.setData('text/plain', String(index))
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        onDragOverHalf(event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom')
      }}
      title={
        moved
          ? `Page ${index + 1} (was ${page.pageNumber}) — drag to reorder`
          : `Page ${index + 1} — drag to reorder`
      }
    >
      <div className="thumb__frame" ref={frameRef}>
        {!rendered && (
          <div
            className="thumb__placeholder"
            style={{ aspectRatio: `${page.viewWidth} / ${page.viewHeight}` }}
          />
        )}
        <canvas ref={canvasRef} style={{ display: rendered ? 'block' : 'none' }} />
        {marks > 0 && <span className="thumb__badge">{marks}</span>}
      </div>
      <span className="thumb__label">{index + 1}</span>
    </button>
  )
}
