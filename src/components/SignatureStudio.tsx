/** Create a signature by drawing it, typing it, or importing an image. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import getStroke from 'perfect-freehand'

import { beginDrag } from '../lib/drag'
import {
  bytesToDataUrl,
  ctx2d,
  guessMime,
  hasAlpha,
  makeCanvas,
  removeBackground,
  renderTypedSignature,
  toCanvas,
  trimTransparent,
} from '../lib/image'
import * as native from '../lib/native'
import { useApp } from '../state/store'
import { useLibrary } from '../state/library'
import type { SignatureEntry, SignatureSource } from '../types'
import { CloseIcon, EraserIcon, KeyboardIcon, PenIcon, UndoIcon, UploadIcon } from './Icons'

type Tab = 'draw' | 'type' | 'upload'

const INKS = [
  { label: 'Ink black', value: '#16181f' },
  { label: 'Navy', value: '#1b3a8f' },
  { label: 'Royal blue', value: '#2563eb' },
  { label: 'Graphite', value: '#4b5563' },
]

const HAND_FONTS = [
  { label: 'Signature', family: 'Great Vibes' },
  { label: 'Casual', family: 'Caveat' },
  { label: 'Script', family: 'Dancing Script' },
  { label: 'Marker', family: 'Homemade Apple' },
  { label: 'Elegant', family: 'Sacramento' },
]

/** Rendered at 3x the on-screen pad so the embedded PNG stays crisp when
 *  scaled up on a page. */
const EXPORT_SCALE = 3

type Point = [number, number, number]

export function SignatureStudio() {
  const open = useApp((s) => s.studioOpen)
  const setOpen = useApp((s) => s.setStudioOpen)
  const toast = useApp((s) => s.toast)
  const armStamp = useApp((s) => s.armStamp)
  const add = useLibrary((s) => s.add)

  const [tab, setTab] = useState<Tab>('draw')
  const [ink, setInk] = useState(INKS[0].value)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<SignatureEntry['kind']>('signature')
  const [busy, setBusy] = useState(false)

  // draw
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [penSize, setPenSize] = useState(9)

  // type
  const [typed, setTyped] = useState('')
  const [family, setFamily] = useState(HAND_FONTS[0].family)
  const [fontsReady, setFontsReady] = useState(false)

  // upload
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(72)
  const [keepColor, setKeepColor] = useState(false)
  const [cleanBackground, setCleanBackground] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTab('draw')
    setStrokes([])
    setTyped('')
    setLabel('')
    setKind('signature')
    setImageSrc(null)
    setPreview(null)
  }, [open])

  // The handwriting faces must be resident before we rasterise typed text.
  useEffect(() => {
    if (!open || fontsReady) return
    void Promise.all(
      HAND_FONTS.map((f) => document.fonts.load(`220px "${f.family}"`).catch(() => undefined)),
    ).then(() => setFontsReady(true))
  }, [open, fontsReady])

  const loadImageFromPath = useCallback(
    async (path: string) => {
      try {
        const bytes = await native.readFile(path)
        const src = bytesToDataUrl(bytes, guessMime(path))
        setImageSrc(src)
        // A photo or scan needs its white paper knocked out; a PNG that already
        // has transparency does not.
        setCleanBackground(!(await hasAlpha(src)))
        setTab('upload')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not read that image.', 'error')
      }
    },
    [toast],
  )

  // Images dropped onto the window while the studio is open land here.
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (path) void loadImageFromPath(path)
    }
    window.addEventListener('inkwell:image', handler)
    return () => window.removeEventListener('inkwell:image', handler)
  }, [open, loadImageFromPath])

  // Paste an image straight from the clipboard.
  useEffect(() => {
    if (!open) return
    const onPaste = async (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (!file) return
      e.preventDefault()
      const src = bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), file.type)
      setImageSrc(src)
      setCleanBackground(!(await hasAlpha(src)))
      setTab('upload')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  // Recompute the cleaned-up import preview.
  useEffect(() => {
    if (tab !== 'upload' || !imageSrc) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const canvas = cleanBackground
          ? await removeBackground(imageSrc, threshold / 100, keepColor ? undefined : ink)
          : await toCanvas(imageSrc)
        if (!cancelled) setPreview(trimTransparent(canvas).dataUrl)
      } catch {
        if (!cancelled) setPreview(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, imageSrc, threshold, keepColor, cleanBackground, ink])

  const typedPreviewReady = fontsReady && typed.trim().length > 0

  const canSave =
    (tab === 'draw' && strokes.length > 0) ||
    (tab === 'type' && typedPreviewReady) ||
    (tab === 'upload' && Boolean(preview))

  const buildCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (tab === 'draw') {
      if (strokes.length === 0) return null
      return renderStrokes(strokes, penSize, ink, EXPORT_SCALE)
    }
    if (tab === 'type') {
      if (!typed.trim()) return null
      return renderTypedSignature(typed.trim(), family, ink, 260)
    }
    if (!imageSrc) return null
    return cleanBackground
      ? removeBackground(imageSrc, threshold / 100, keepColor ? undefined : ink)
      : toCanvas(imageSrc)
  }, [tab, strokes, penSize, ink, typed, family, imageSrc, cleanBackground, threshold, keepColor])

  const commit = async (place: boolean) => {
    setBusy(true)
    try {
      const canvas = await buildCanvas()
      if (!canvas) return
      const trimmed = trimTransparent(canvas)
      const source: SignatureSource = tab === 'draw' ? 'draw' : tab === 'type' ? 'type' : 'image'
      const fallbackLabel =
        typed.trim() || (kind === 'initials' ? 'Initials' : source === 'image' ? 'Imported' : 'Signature')

      const entry = await add({
        label: label.trim() || fallbackLabel,
        src: trimmed.dataUrl,
        aspect: trimmed.aspect,
        source,
        kind,
      })

      setOpen(false)
      if (place) {
        armStamp({
          src: entry.src,
          aspect: entry.aspect,
          kind: 'signature',
          sourceId: entry.id,
          width: kind === 'initials' ? 72 : 190,
          label: entry.label,
        })
        toast('Click on the page to place your signature.', 'info')
      } else {
        toast('Saved to your signature library.', 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create that signature.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Create a signature">
        <header className="modal__head">
          <span className="modal__title">Create a signature</span>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setOpen(false)}>
            <CloseIcon />
          </button>
        </header>

        <div className="modal__body">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'draw'} onClick={() => setTab('draw')}>
              <PenIcon size={14} /> Draw
            </button>
            <button role="tab" aria-selected={tab === 'type'} onClick={() => setTab('type')}>
              <KeyboardIcon size={14} /> Type
            </button>
            <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>
              <UploadIcon size={14} /> Import
            </button>
          </div>

          {tab === 'draw' && (
            <DrawPad
              strokes={strokes}
              setStrokes={setStrokes}
              penSize={penSize}
              ink={ink}
            />
          )}

          {tab === 'type' && (
            <>
              <input
                className="text-input"
                placeholder="Type your name"
                value={typed}
                autoFocus
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
              <div className="typepreview">
                {typedPreviewReady ? (
                  <span style={{ fontFamily: `"${family}", cursive`, color: ink }}>{typed}</span>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>
                    {fontsReady ? 'Your signature appears here' : 'Loading fonts…'}
                  </span>
                )}
              </div>
              <div className="fontgrid">
                {HAND_FONTS.map((f) => (
                  <button
                    key={f.family}
                    className="fontchip"
                    aria-selected={family === f.family}
                    title={f.label}
                    onClick={() => setFamily(f.family)}
                    style={{ fontFamily: `"${f.family}", cursive`, color: ink }}
                  >
                    {typed.trim() ? typed.slice(0, 12) : f.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'upload' && (
            <UploadPane
              imageSrc={imageSrc}
              preview={preview}
              threshold={threshold}
              setThreshold={setThreshold}
              keepColor={keepColor}
              setKeepColor={setKeepColor}
              cleanBackground={cleanBackground}
              setCleanBackground={setCleanBackground}
              onPick={async () => {
                const path = await native.pickImage()
                if (path) await loadImageFromPath(path)
              }}
              onClear={() => {
                setImageSrc(null)
                setPreview(null)
              }}
            />
          )}

          {(tab !== 'upload' || !keepColor) && (
            <div className="row">
              <span className="label">Ink</span>
              <div className="inkdots">
                {INKS.map((c) => (
                  <button
                    key={c.value}
                    className="inkdot"
                    aria-selected={ink === c.value}
                    title={c.label}
                    style={{ background: c.value }}
                    onClick={() => setInk(c.value)}
                  />
                ))}
              </div>

              {tab === 'draw' && (
                <>
                  <span className="divider" />
                  <span className="label">Pen</span>
                  <input
                    type="range"
                    min={4}
                    max={18}
                    value={penSize}
                    onChange={(e) => setPenSize(Number(e.target.value))}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </>
              )}
            </div>
          )}

          <div className="row">
            <input
              className="text-input grow"
              placeholder="Name it (optional) — e.g. Work signature"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <div className="segmented" style={{ width: 190 }}>
              <button
                aria-selected={kind === 'signature'}
                onClick={() => setKind('signature')}
              >
                Signature
              </button>
              <button aria-selected={kind === 'initials'} onClick={() => setKind('initials')}>
                Initials
              </button>
            </div>
          </div>
        </div>

        <footer className="modal__foot">
          <span className="rail__hint" style={{ flex: 1 }}>
            Saved signatures stay on this Mac and are ready next time.
          </span>
          <button type="button" className="btn" disabled={!canSave || busy} onClick={() => void commit(false)}>
            Save
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSave || busy}
            onClick={() => void commit(true)}
          >
            Save &amp; place
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ draw --- */

function DrawPad({
  strokes,
  setStrokes,
  penSize,
  ink,
}: {
  strokes: Point[][]
  setStrokes: React.Dispatch<React.SetStateAction<Point[][]>>
  penSize: number
  ink: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentRef = useRef<Point[]>([])
  const [drawing, setDrawing] = useState(false)

  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    const g = ctx2d(canvas)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, rect.width, rect.height)
    g.fillStyle = ink
    for (const stroke of [...strokes, currentRef.current]) {
      if (stroke.length === 0) continue
      g.fill(strokePath(stroke, penSize))
    }
  }, [strokes, penSize, ink])

  useEffect(() => {
    repaint()
  }, [repaint])

  useEffect(() => {
    const onResize = () => repaint()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [repaint])

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const at = (cx: number, cy: number, pressure: number): Point => [
      cx - rect.left,
      cy - rect.top,
      pressure > 0 && pressure !== 0.5 ? pressure : 0.5,
    ]

    currentRef.current = [at(e.clientX, e.clientY, e.pressure)]
    setDrawing(true)
    repaint()

    beginDrag(e, {
      onMove: ({ x, y }) => {
        currentRef.current = [...currentRef.current, at(x, y, 0.5)]
        repaint()
      },
      onEnd: () => {
        const finished = currentRef.current
        currentRef.current = []
        setDrawing(false)
        if (finished.length > 1) setStrokes((prev) => [...prev, finished])
        else repaint()
      },
    })
  }

  return (
    <>
      <div className="pad">
        <canvas ref={canvasRef} onPointerDown={start} />
        <div className="pad__baseline" />
        <span className="pad__x">×</span>
        {strokes.length === 0 && !drawing && (
          <div className="pad__hint">Draw your signature above the line</div>
        )}
      </div>
      <div className="row row--tight">
        <button
          type="button"
          className="btn"
          disabled={strokes.length === 0}
          onClick={() => setStrokes((prev) => prev.slice(0, -1))}
        >
          <UndoIcon size={14} /> Undo stroke
        </button>
        <button
          type="button"
          className="btn"
          disabled={strokes.length === 0}
          onClick={() => setStrokes([])}
        >
          <EraserIcon size={14} /> Clear
        </button>
        <span className="rail__hint" style={{ marginLeft: 'auto' }}>
          A trackpad works — draw slowly for the smoothest line.
        </span>
      </div>
    </>
  )
}

const STROKE_OPTIONS = {
  thinning: 0.62,
  smoothing: 0.58,
  streamline: 0.45,
  simulatePressure: true,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  start: { taper: 6, cap: true },
  end: { taper: 22, cap: true },
}

function strokePath(points: Point[], size: number): Path2D {
  const outline = getStroke(points, { size, ...STROKE_OPTIONS }) as number[][]
  const path = new Path2D()
  if (outline.length === 0) return path

  // Quadratic mid-point smoothing — the standard perfect-freehand rendering.
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]
    const [x1, y1] = outline[i]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

/** Re-renders the captured strokes at export resolution. */
function renderStrokes(
  strokes: Point[][],
  size: number,
  ink: string,
  scale: number,
): HTMLCanvasElement {
  let maxX = 0
  let maxY = 0
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  const pad = size * 2
  const canvas = makeCanvas((maxX + pad) * scale, (maxY + pad) * scale)
  const g = ctx2d(canvas)
  g.scale(scale, scale)
  g.fillStyle = ink
  for (const stroke of strokes) g.fill(strokePath(stroke, size))
  return canvas
}

/* ---------------------------------------------------------------- upload --- */

function UploadPane({
  imageSrc,
  preview,
  threshold,
  setThreshold,
  keepColor,
  setKeepColor,
  cleanBackground,
  setCleanBackground,
  onPick,
  onClear,
}: {
  imageSrc: string | null
  preview: string | null
  threshold: number
  setThreshold: (v: number) => void
  keepColor: boolean
  setKeepColor: (v: boolean) => void
  cleanBackground: boolean
  setCleanBackground: (v: boolean) => void
  onPick: () => void | Promise<void>
  onClear: () => void
}) {
  const shown = useMemo(() => preview ?? imageSrc, [preview, imageSrc])

  return (
    <>
      <div className="imagedrop">
        {shown ? (
          <img src={shown} alt="Signature preview" />
        ) : (
          <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
            <UploadIcon size={26} />
            <div>Photograph your signature on white paper, then import it here.</div>
            <button type="button" className="btn btn--primary" onClick={() => void onPick()}>
              Choose image…
            </button>
            <div style={{ fontSize: 11.5 }}>…or press ⌘V to paste, or drop a file on the window</div>
          </div>
        )}
      </div>

      {imageSrc && (
        <>
          <div className="row">
            <label className="row row--tight" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={cleanBackground}
                onChange={(e) => setCleanBackground(e.target.checked)}
              />
              <span className="label">Remove background</span>
            </label>
            {cleanBackground && (
              <>
                <input
                  type="range"
                  min={35}
                  max={95}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ accentColor: 'var(--accent)', flex: 1 }}
                />
                <label className="row row--tight" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={keepColor}
                    onChange={(e) => setKeepColor(e.target.checked)}
                  />
                  <span className="label">Keep original colour</span>
                </label>
              </>
            )}
          </div>
          <div className="row row--tight">
            <button type="button" className="btn" onClick={() => void onPick()}>
              Choose another…
            </button>
            <button type="button" className="btn btn--ghost btn--danger" onClick={onClear}>
              Remove
            </button>
          </div>
        </>
      )}
    </>
  )
}
