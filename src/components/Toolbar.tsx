/** Primary tool strip: what to place, history, zoom and page navigation. */
import { useEffect, useState } from 'react'

import * as native from '../lib/native'
import { bytesToDataUrl, guessMime, loadImage } from '../lib/image'
import { useApp } from '../state/store'
import { useLibrary } from '../state/library'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CursorIcon,
  DateIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  SidebarIcon,
  SignatureIcon,
  TextIcon,
  UndoIcon,
} from './Icons'
import { scrollToPage } from './Viewer'

export function Toolbar() {
  const tool = useApp((s) => s.tool)
  const setTool = useApp((s) => s.setTool)
  const armStamp = useApp((s) => s.armStamp)
  const setStudioOpen = useApp((s) => s.setStudioOpen)
  const toast = useApp((s) => s.toast)

  const past = useApp((s) => s.past.length)
  const future = useApp((s) => s.future.length)
  const undo = useApp((s) => s.undo)
  const redo = useApp((s) => s.redo)

  const zoom = useApp((s) => s.zoom)
  const zoomBy = useApp((s) => s.zoomBy)
  const setZoom = useApp((s) => s.setZoom)
  const fitMode = useApp((s) => s.fitMode)

  const pages = useApp((s) => s.pages)
  const currentPage = useApp((s) => s.currentPage)
  const sidebar = useApp((s) => s.sidebar)
  const toggleSidebar = useApp((s) => s.toggleSidebar)

  const entries = useLibrary((s) => s.entries)

  const pickSignature = () => {
    const preferred =
      entries.find((e) => e.favorite && e.kind === 'signature') ??
      entries.find((e) => e.kind === 'signature') ??
      entries[0]

    if (!preferred) {
      setStudioOpen(true)
      return
    }
    armStamp({
      src: preferred.src,
      aspect: preferred.aspect,
      kind: 'signature',
      sourceId: preferred.id,
      width: preferred.kind === 'initials' ? 72 : 190,
      label: preferred.label,
    })
    toast('Click on the page to place your signature.', 'info')
  }

  const pickImage = async () => {
    const path = await native.pickImage()
    if (!path) return
    try {
      const bytes = await native.readFile(path)
      const src = bytesToDataUrl(bytes, guessMime(path))
      const img = await loadImage(src)
      armStamp({
        src,
        aspect: img.naturalWidth / img.naturalHeight || 1,
        kind: 'image',
        width: 200,
        label: path.split('/').pop() ?? 'Image',
      })
      toast('Click on the page to place the image.', 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load that image.', 'error')
    }
  }

  return (
    <div className="toolbar">
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title="Toggle page thumbnails"
        aria-pressed={sidebar}
        onClick={toggleSidebar}
      >
        <SidebarIcon />
      </button>

      <span className="divider" />

      <div className="toolgroup" role="group" aria-label="Tools">
        <button
          className="tool"
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
          title="Select and move (V)"
        >
          <CursorIcon />
          Select
        </button>
        <button
          className="tool"
          data-action="sign"
          aria-pressed={tool === 'signature'}
          onClick={pickSignature}
          title="Place a signature (⌘1)"
        >
          <SignatureIcon />
          Sign
        </button>
        <button
          className="tool"
          aria-pressed={tool === 'text'}
          onClick={() => setTool('text')}
          title="Add text (⌘2)"
        >
          <TextIcon />
          Text
        </button>
        <button
          className="tool"
          aria-pressed={tool === 'date'}
          onClick={() => setTool('date')}
          title="Stamp today's date (⌘3)"
        >
          <DateIcon />
          Date
        </button>
        <button
          className="tool"
          aria-pressed={tool === 'check'}
          onClick={() => {
            armStamp(null)
            setTool('check')
          }}
          title="Add a checkmark (⌘4)"
        >
          <CheckIcon />
          Check
        </button>
        <button
          className="tool"
          aria-pressed={tool === 'image'}
          onClick={() => void pickImage()}
          title="Place an image"
        >
          <ImageIcon />
          Image
        </button>
      </div>

      <span className="divider" />

      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title="Undo (⌘Z)"
        disabled={past === 0}
        onClick={undo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title="Redo (⇧⌘Z)"
        disabled={future === 0}
        onClick={redo}
      >
        <RedoIcon />
      </button>

      <span className="spacer" />

      <PagePill total={pages.length} current={currentPage} />

      <div className="zoomctl">
        <button className="icon" title="Zoom out (⌘−)" onClick={() => zoomBy(0.5)}>
          <MinusIcon size={14} />
        </button>
        <button
          className="zoomctl__value"
          title={fitMode === 'width' ? 'Fit width — click for 100%' : 'Click to fit width (⌘0)'}
          onClick={() => (fitMode === 'width' ? setZoom(1, null) : setZoom(zoom, 'width'))}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon" title="Zoom in (⌘+)" onClick={() => zoomBy(2)}>
          <PlusIcon size={14} />
        </button>
      </div>

      {/* Placement hint keeps the current mode legible at a glance. */}
      <PlacementHint />
    </div>
  )
}

function PagePill({ total, current }: { total: number; current: number }) {
  const [draft, setDraft] = useState(String(current + 1))

  useEffect(() => setDraft(String(current + 1)), [current])

  const go = (value: string) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return
    const index = Math.min(total - 1, Math.max(0, Math.round(n) - 1))
    scrollToPage(index)
  }

  return (
    <div className="pagepill">
      <button
        className="btn btn--ghost btn--icon"
        title="Previous page"
        disabled={current === 0}
        onClick={() => scrollToPage(current - 1)}
        style={{ width: 22, height: 22 }}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <input
        value={draft}
        inputMode="numeric"
        aria-label="Page number"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => go(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span>of {total}</span>
      <button
        className="btn btn--ghost btn--icon"
        title="Next page"
        disabled={current >= total - 1}
        onClick={() => scrollToPage(current + 1)}
        style={{ width: 22, height: 22 }}
      >
        <ChevronRightIcon size={14} />
      </button>
    </div>
  )
}

function PlacementHint() {
  const tool = useApp((s) => s.tool)
  const pending = useApp((s) => s.pending)
  const setTool = useApp((s) => s.setTool)
  const armStamp = useApp((s) => s.armStamp)

  if (tool === 'select') return null

  const label =
    tool === 'signature'
      ? `Click to place “${pending?.label ?? 'signature'}”`
      : tool === 'text'
        ? 'Click where the text goes'
        : tool === 'date'
          ? "Click to stamp today's date"
          : tool === 'check'
            ? 'Click to add a checkmark'
            : `Click to place “${pending?.label ?? 'image'}”`

  return (
    <button
      type="button"
      className="btn"
      title="Cancel (Esc)"
      onClick={() => {
        armStamp(null)
        setTool('select')
      }}
      style={{ maxWidth: 240, overflow: 'hidden' }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span className="kbd">esc</span>
    </button>
  )
}
