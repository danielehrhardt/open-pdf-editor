/** A placed signature, stamp or text block: draggable, resizable, editable. */
import { useEffect, useLayoutEffect, useRef } from 'react'

import { beginDrag } from '../lib/drag'
import { cssFont, lineHeightFor, measureBlock } from '../lib/text'
import { useApp } from '../state/store'
import type { ImageElement, PageGeometry, PdfElement, TextElement } from '../types'

const MIN_SIZE = 8

interface Props {
  element: PdfElement
  page: PageGeometry
  zoom: number
  selected: boolean
  editing: boolean
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

export function ElementBox({ element, page, zoom, selected, editing }: Props) {
  const select = useApp((s) => s.select)
  const setEditing = useApp((s) => s.setEditing)
  const updateElement = useApp((s) => s.updateElement)
  const beginChange = useApp((s) => s.beginChange)
  const removeElement = useApp((s) => s.removeElement)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  const startMove = (e: React.PointerEvent) => {
    if (editing) return
    select(element.id)
    const origin = { x: element.x, y: element.y }
    beginDrag(e, {
      onStart: beginChange,
      onMove: ({ dx, dy, shift }) => {
        let nx = origin.x + dx / zoom
        let ny = origin.y + dy / zoom
        if (shift) {
          // Constrain to the dominant axis for tidy alignment.
          if (Math.abs(dx) > Math.abs(dy)) ny = origin.y
          else nx = origin.x
        }
        updateElement(element.id, { x: nx, y: ny }, { history: false })
      },
    })
  }

  const startResize = (e: React.PointerEvent, corner: Corner) => {
    select(element.id)
    const start = { x: element.x, y: element.y, w: element.w, h: element.h }
    const isText = element.kind === 'text'
    const aspect = isText ? start.w / start.h : (element as ImageElement).aspect || start.w / start.h
    const baseFontSize = isText ? (element as TextElement).fontSize : 0

    beginDrag(e, {
      onStart: beginChange,
      onMove: ({ dx, dy, alt }) => {
        const vdx = dx / zoom
        const vdy = dy / zoom
        const west = corner === 'nw' || corner === 'sw'
        const north = corner === 'nw' || corner === 'ne'

        let w = west ? start.w - vdx : start.w + vdx
        let h = north ? start.h - vdy : start.h + vdy

        // Images keep their aspect unless Option is held; text always scales
        // proportionally because its height is derived from the font size.
        if (!alt || isText) {
          const byWidth = Math.abs(w / start.w - 1) > Math.abs(h / start.h - 1)
          if (byWidth) h = w / aspect
          else w = h * aspect
        }

        w = Math.max(MIN_SIZE, w)
        h = Math.max(MIN_SIZE, h)

        if (isText) {
          const scale = w / start.w
          const fontSize = Math.min(288, Math.max(4, baseFontSize * scale))
          updateElement(
            element.id,
            {
              fontSize: Math.round(fontSize * 10) / 10,
              x: west ? start.x + (start.w - w) : start.x,
              y: north ? start.y + (start.h - h) : start.y,
            } as Partial<TextElement>,
            { history: false },
          )
          return
        }

        updateElement(
          element.id,
          {
            w,
            h,
            x: west ? start.x + (start.w - w) : start.x,
            y: north ? start.y + (start.h - h) : start.y,
          },
          { history: false },
        )
      },
    })
  }

  const style: React.CSSProperties = {
    left: element.x * zoom,
    top: element.y * zoom,
    width: element.w * zoom,
    height: element.h * zoom,
  }

  return (
    <div
      className="el el--interactive"
      data-selected={selected}
      style={style}
      onPointerDown={startMove}
      onDoubleClick={() => element.kind === 'text' && setEditing(element.id)}
    >
      {element.kind === 'text' ? (
        <TextBody
          element={element as TextElement}
          zoom={zoom}
          editing={editing}
          textareaRef={textareaRef}
          onCommit={(text) => {
            const trimmed = text.replace(/\s+$/, '')
            if (!trimmed.trim()) {
              removeElement(element.id)
              return
            }
            setEditing(null)
            updateElement(element.id, { text: trimmed } as Partial<TextElement>)
          }}
          onInput={(text) =>
            updateElement(element.id, { text } as Partial<TextElement>, { history: false })
          }
        />
      ) : (
        <img
          src={(element as ImageElement).src}
          alt=""
          style={{ opacity: (element as ImageElement).opacity ?? 1 }}
          draggable={false}
        />
      )}

      {selected && !editing && (
        <>
          <Handle corner="nw" onDown={startResize} />
          <Handle corner="ne" onDown={startResize} />
          <Handle corner="sw" onDown={startResize} />
          <Handle corner="se" onDown={startResize} />
        </>
      )}

      {/* Keeps elements from being dragged off-page unnoticed. */}
      <span hidden aria-hidden="true">
        {page.pageNumber}
      </span>
    </div>
  )
}

function Handle({
  corner,
  onDown,
}: {
  corner: Corner
  onDown: (e: React.PointerEvent, corner: Corner) => void
}) {
  return (
    <div
      className={`handle handle--${corner}`}
      onPointerDown={(e) => onDown(e, corner)}
      role="presentation"
    />
  )
}

function TextBody({
  element,
  zoom,
  editing,
  textareaRef,
  onCommit,
  onInput,
}: {
  element: TextElement
  zoom: number
  editing: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onCommit: (text: string) => void
  onInput: (text: string) => void
}) {
  const font = cssFont(element.font, element.fontSize * zoom)
  const lineHeight = `${lineHeightFor(element.fontSize) * zoom}px`

  // Keep the editor's box in step with the text as it is typed.
  useLayoutEffect(() => {
    if (!editing || !textareaRef.current) return
    const { w } = measureBlock(element.font, element.fontSize, element.text, element.letterSpacing)
    textareaRef.current.style.width = `${Math.max(w, 12) * zoom}px`
  }, [editing, element.text, element.font, element.fontSize, element.letterSpacing, zoom, textareaRef])

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="el__textarea"
        value={element.text}
        spellCheck={false}
        style={{
          font,
          lineHeight,
          color: element.color,
          letterSpacing: element.letterSpacing ? `${element.letterSpacing * zoom}px` : undefined,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onInput(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            onCommit(element.text)
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onCommit(element.text)
          }
        }}
      />
    )
  }

  return (
    <div
      className="el__text"
      style={{
        font,
        lineHeight,
        color: element.color,
        letterSpacing: element.letterSpacing ? `${element.letterSpacing * zoom}px` : undefined,
      }}
    >
      {element.text}
    </div>
  )
}
