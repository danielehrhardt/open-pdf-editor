/** Page thumbnail rail. */
import { useEffect, useRef, useState } from 'react'

import { isCancelled, renderPage } from '../lib/pdf'
import { useApp } from '../state/store'
import type { PageGeometry } from '../types'
import { scrollToPage } from './Viewer'

const THUMB_WIDTH = 128

export function Thumbnails() {
  const pages = useApp((s) => s.pages)
  const currentPage = useApp((s) => s.currentPage)
  const elements = useApp((s) => s.elements)
  const railRef = useRef<HTMLDivElement>(null)

  // Follow the viewer's current page without stealing focus.
  useEffect(() => {
    const node = railRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  return (
    <aside className="thumbs" ref={railRef} aria-label="Pages">
      {pages.map((page, i) => (
        <Thumb
          key={page.pageNumber}
          page={page}
          index={i}
          current={i === currentPage}
          marks={elements.filter((e) => e.page === i).length}
        />
      ))}
    </aside>
  )
}

function Thumb({
  page,
  index,
  current,
  marks,
}: {
  page: PageGeometry
  index: number
  current: boolean
  marks: number
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

  return (
    <button
      type="button"
      className="thumb"
      data-thumb={index}
      aria-current={current}
      onClick={() => scrollToPage(index)}
      title={`Page ${page.pageNumber}`}
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
      <span className="thumb__label">{page.pageNumber}</span>
    </button>
  )
}
