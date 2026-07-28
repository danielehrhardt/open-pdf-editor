/** Scrolling page stack: fit-to-width sizing, lazy rendering, page tracking. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { checkStamp } from '../lib/stamps'
import { formatToday } from '../lib/text'
import { useApp } from '../state/store'
import { createElementForTool, PageView } from './PageView'

const PAGE_GAP = 22
const STACK_PADDING = 26
/**
 * Filling a very wide window would render a page at 300%+, which is unreadable
 * rather than helpful. Cap the automatic fit; manual zoom still goes to 600%.
 */
const MAX_FIT_ZOOM = 2

export function Viewer() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pages = useApp((s) => s.pages)
  const zoom = useApp((s) => s.zoom)
  const fitMode = useApp((s) => s.fitMode)
  const setZoom = useApp((s) => s.setZoom)
  const elements = useApp((s) => s.elements)
  const fields = useApp((s) => s.fields)
  const tool = useApp((s) => s.tool)
  const pending = useApp((s) => s.pending)
  const prefs = useApp((s) => s.prefs)
  const addElement = useApp((s) => s.addElement)
  const setEditing = useApp((s) => s.setEditing)
  const setTool = useApp((s) => s.setTool)
  const setCurrentPage = useApp((s) => s.setCurrentPage)

  const [visible, setVisible] = useState<Set<number>>(() => new Set([0, 1]))

  const widest = useMemo(
    () => pages.reduce((max, p) => Math.max(max, p.viewWidth), 1),
    [pages],
  )
  const tallest = useMemo(
    () => pages.reduce((max, p) => Math.max(max, p.viewHeight), 1),
    [pages],
  )

  // Recompute the fit zoom whenever the container or the fit mode changes.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !fitMode || pages.length === 0) return

    const apply = () => {
      const availableW = el.clientWidth - STACK_PADDING * 2
      const availableH = el.clientHeight - STACK_PADDING * 2
      if (availableW <= 0) return
      const next =
        fitMode === 'width'
          ? availableW / widest
          : Math.min(availableW / widest, availableH / tallest)
      setZoom(Math.min(MAX_FIT_ZOOM, Math.max(0.15, next)), fitMode)
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitMode, widest, tallest, pages.length, setZoom])

  // Track which pages are near the viewport so only those get rasterised.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const nodes = root.querySelectorAll<HTMLElement>('[data-page]')
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(index)
            else next.delete(index)
          }
          // Always keep the neighbours warm to avoid blank flashes on scroll.
          for (const i of [...next]) {
            if (i > 0) next.add(i - 1)
            if (i < nodes.length - 1) next.add(i + 1)
          }
          return next
        })
      },
      { root, rootMargin: '600px 0px', threshold: 0 },
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [pages.length])

  // Report the page occupying the middle of the viewport.
  const onScroll = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const mid = root.scrollTop + root.clientHeight / 2
    const nodes = root.querySelectorAll<HTMLElement>('[data-page]')
    let best = 0
    let bestDistance = Infinity
    nodes.forEach((node, i) => {
      const center = node.offsetTop + node.offsetHeight / 2
      const distance = Math.abs(center - mid)
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    })
    setCurrentPage(best)
  }, [setCurrentPage])

  // Trackpad pinch and ⌘-scroll zoom, anchored on the pointer.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const state = useApp.getState()
      const factor = Math.exp(-e.deltaY / 180)
      const next = Math.min(6, Math.max(0.15, state.zoom * factor))

      const rect = root.getBoundingClientRect()
      const px = e.clientX - rect.left + root.scrollLeft
      const py = e.clientY - rect.top + root.scrollTop
      const ratio = next / state.zoom

      state.setZoom(next, null)
      requestAnimationFrame(() => {
        root.scrollLeft = px * ratio - (e.clientX - rect.left)
        root.scrollTop = py * ratio - (e.clientY - rect.top)
      })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  const place = useCallback(
    (pageIndex: number, x: number, y: number) => {
      const page = pages[pageIndex]
      if (!page) return

      let stamp = pending
      if (tool === 'check' && !stamp) {
        const mark = checkStamp(prefs.textColor)
        stamp = { ...mark, kind: 'image', width: 18, label: 'Checkmark' }
      }

      const element = createElementForTool(tool, pageIndex, page, x, y, {
        pending: stamp,
        text: {
          value: tool === 'date' ? formatToday() : '',
          font: prefs.textFont,
          fontSize: prefs.textSize,
          color: prefs.textColor,
        },
      })
      if (!element) return

      addElement(element)
      if (tool === 'text') setEditing(element.id)
      // Ticking boxes usually means ticking several, so that one tool stays
      // armed; everything else drops back to Select after a single placement.
      if (tool === 'check') setTool('check')
    },
    [pages, pending, tool, prefs, addElement, setEditing, setTool],
  )

  const placing = tool !== 'select' && (tool !== 'signature' || Boolean(pending))

  return (
    <div
      ref={scrollRef}
      className={`viewer${placing ? ' viewer--placing' : ''}`}
      onScroll={onScroll}
    >
      <div className="viewer__stack" style={{ gap: PAGE_GAP }}>
        {pages.map((page, i) => (
          <PageView
            key={page.pageNumber}
            index={i}
            page={page}
            zoom={zoom}
            active={visible.has(i)}
            fields={fields.filter((f) => f.page === i)}
            elements={elements.filter((e) => e.page === i)}
            onPlace={place}
          />
        ))}
      </div>
    </div>
  )
}

/** Scrolls a page into view; used by the thumbnail rail and the page pill. */
export function scrollToPage(index: number) {
  const node = document.querySelector<HTMLElement>(`[data-page="${index}"]`)
  node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
