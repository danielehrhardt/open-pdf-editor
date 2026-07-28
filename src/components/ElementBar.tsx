/** Floating property bar for the selected element. */
import { FONTS, FONT_KEYS } from '../lib/text'
import { useApp } from '../state/store'
import type { ImageElement, PdfElement, TextElement } from '../types'
import { CopyIcon, TextIcon, TrashIcon } from './Icons'

const BAR_HEIGHT = 34
const GAP = 10

export function ElementBar({ element, zoom }: { element: PdfElement; zoom: number }) {
  const updateElement = useApp((s) => s.updateElement)
  const removeElement = useApp((s) => s.removeElement)
  const duplicateElement = useApp((s) => s.duplicateElement)
  const setEditing = useApp((s) => s.setEditing)
  const setPrefs = useApp((s) => s.setPrefs)

  const top = element.y * zoom - BAR_HEIGHT - GAP
  const style: React.CSSProperties = {
    left: element.x * zoom,
    top: top > 4 ? top : (element.y + element.h) * zoom + GAP,
  }

  const isText = element.kind === 'text'
  const text = element as TextElement
  const image = element as ImageElement

  return (
    <div className="elbar" style={style} onPointerDown={(e) => e.stopPropagation()}>
      {isText ? (
        <>
          <select
            value={text.font}
            title="Font"
            onChange={(e) => {
              const font = e.target.value as TextElement['font']
              updateElement(element.id, { font } as Partial<TextElement>)
              setPrefs({ textFont: font })
            }}
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                {FONTS[key].label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={4}
            max={288}
            step={0.5}
            value={Math.round(text.fontSize * 10) / 10}
            title="Size in points"
            onChange={(e) => {
              const fontSize = Number(e.target.value)
              if (!Number.isFinite(fontSize)) return
              updateElement(element.id, { fontSize } as Partial<TextElement>)
              setPrefs({ textSize: fontSize })
            }}
          />

          <label className="swatch" title="Colour">
            <input
              type="color"
              value={text.color}
              onChange={(e) => {
                updateElement(element.id, { color: e.target.value } as Partial<TextElement>)
                setPrefs({ textColor: e.target.value })
              }}
            />
          </label>

          <button
            type="button"
            className="icon"
            title="Edit text"
            onClick={() => setEditing(element.id)}
          >
            <TextIcon size={15} />
          </button>
        </>
      ) : (
        <>
          <span className="label" style={{ paddingLeft: 4 }}>
            Opacity
          </span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round((image.opacity ?? 1) * 100)}
            title="Opacity"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              updateElement(
                element.id,
                { opacity: Number(e.target.value) / 100 } as Partial<ImageElement>,
                { history: false },
              )
            }
          />
          <span
            className="label"
            style={{ minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round((image.opacity ?? 1) * 100)}%
          </span>
        </>
      )}

      <span className="divider" style={{ height: 18 }} />

      <button
        type="button"
        className="icon"
        title="Duplicate"
        onClick={() => duplicateElement(element.id)}
      >
        <CopyIcon size={15} />
      </button>
      <button
        type="button"
        className="icon danger"
        title="Delete"
        onClick={() => removeElement(element.id)}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  )
}
