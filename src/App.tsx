/** Application shell: wiring between the host (menus, file drops) and the UI. */
import { useCallback, useEffect, useState } from 'react'

import { crossStamp } from './lib/stamps'
import { bytesToDataUrl, guessMime } from './lib/image'
import { isImageName, isPdfName, platform, type DroppedFile } from './platform'
import { useApp } from './state/store'
import { useLibrary } from './state/library'
import { Rail } from './components/Rail'
import { SignatureStudio } from './components/SignatureStudio'
import { Thumbnails } from './components/Thumbnails'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { Toolbar } from './components/Toolbar'
import { Viewer } from './components/Viewer'
import { Welcome } from './components/Welcome'
import { DocIcon } from './components/Icons'

/**
 * Signing needs the library, so route it through the toolbar button that owns
 * the "use my default signature, otherwise open the studio" decision.
 */
const triggerSign = () =>
  document.querySelector<HTMLButtonElement>('[data-action="sign"]')?.click()

export default function App() {
  const status = useApp((s) => s.status)
  const loadingLabel = useApp((s) => s.loadingLabel)
  const sidebar = useApp((s) => s.sidebar)
  const studioOpen = useApp((s) => s.studioOpen)
  const refreshRecents = useApp((s) => s.refreshRecents)
  const [dragging, setDragging] = useState(false)

  const loadLibrary = useLibrary((s) => s.load)

  useEffect(() => {
    void loadLibrary()
    void refreshRecents()
  }, [loadLibrary, refreshRecents])

  const openViaDialog = useCallback(() => void useApp.getState().openDialog(), [])

  const acceptFiles = useCallback(async (files: DroppedFile[]) => {
    const state = useApp.getState()

    const pdf = files.find((f) => isPdfName(f.name))
    if (pdf) {
      try {
        await state.openFile({
          name: pdf.name,
          bytes: await pdf.read(),
          ref: pdf.ref,
          // A dropped file with no handle cannot be written back to.
          writable: pdf.ref !== null,
          location: '',
        })
      } catch (err) {
        state.toast(err instanceof Error ? err.message : 'Could not open that PDF.', 'error')
      }
      return
    }

    const image = files.find((f) => isImageName(f.name))
    if (image) {
      try {
        const src = bytesToDataUrl(await image.read(), guessMime(image.name))
        if (!state.studioOpen) state.setStudioOpen(true)
        // Give the studio a tick to mount its listener.
        setTimeout(() => window.dispatchEvent(new CustomEvent('inkwell:image', { detail: src })), 60)
      } catch (err) {
        state.toast(err instanceof Error ? err.message : 'Could not read that image.', 'error')
      }
      return
    }

    state.toast('Inkwell opens PDFs — drop a .pdf file.', 'error')
  }, [])

  // Files handed over by the OS (Finder "Open With", the PWA launch queue).
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void (async () => {
      unlisten = await platform().onOpenExternal((opened) => {
        const first = opened[0]
        if (first) void useApp.getState().openFile(first)
      })
    })()
    return () => unlisten?.()
  }, [])

  // Drag and drop onto the window.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void (async () => {
      unlisten = await platform().onDrop((payload) => {
        if (payload.phase === 'over') setDragging(true)
        else if (payload.phase === 'leave') setDragging(false)
        else if (payload.files) {
          setDragging(false)
          void acceptFiles(payload.files)
        }
      })
    })()
    return () => unlisten?.()
  }, [acceptFiles])

  // Native menu commands (desktop only).
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void (async () => {
      unlisten = await platform().onMenu((id) => runCommand(id))
    })()
    return () => unlisten?.()
  }, [])

  // Keyboard handling. The desktop menu owns ⌘-accelerators; on the web this
  // is the only place they exist, so bind them here too.
  useEffect(() => {
    const hasMenu = platform().hasNativeMenu

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable

      const s = useApp.getState()

      if (e.key === 'Escape') {
        if (s.studioOpen) s.setStudioOpen(false)
        else if (s.tool !== 'select') {
          s.armStamp(null)
          s.setTool('select')
        } else if (s.selectedId) s.select(null)
        return
      }

      const mod = e.metaKey || e.ctrlKey

      if (mod && !hasMenu) {
        const command = webAccelerator(e)
        if (command) {
          e.preventDefault()
          runCommand(command)
          return
        }
      }

      if (typing || s.studioOpen) return

      if ((e.key === 'Backspace' || e.key === 'Delete') && s.selectedId) {
        e.preventDefault()
        s.removeElement(s.selectedId)
        return
      }

      if (s.selectedId && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') s.nudge(-step, 0)
        if (e.key === 'ArrowRight') s.nudge(step, 0)
        if (e.key === 'ArrowUp') s.nudge(0, -step)
        if (e.key === 'ArrowDown') s.nudge(0, step)
        return
      }

      if (mod || e.altKey) return

      // Single-key tool switches, mirroring the toolbar order.
      switch (e.key.toLowerCase()) {
        case 'v':
          s.setTool('select')
          break
        case 's':
          triggerSign()
          break
        case 't':
          s.setTool('text')
          break
        case 'd':
          s.setTool('date')
          break
        case 'c':
          s.armStamp(null)
          s.setTool('check')
          break
        case 'x':
          s.armStamp({ ...crossStamp(s.prefs.textColor), kind: 'image', width: 16, label: 'Cross' })
          break
        case 'enter':
          if (s.selectedId) {
            const el = s.elements.find((n) => n.id === s.selectedId)
            if (el?.kind === 'text') s.setEditing(el.id)
          }
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Reflect the open document in the window title.
  useEffect(() => {
    let last = ''
    const apply = (s: ReturnType<typeof useApp.getState>) => {
      const title = s.status === 'ready' ? `${s.dirty ? '• ' : ''}${s.fileName}` : 'Inkwell'
      if (title === last) return
      last = title
      platform().setWindowTitle(title)
    }
    apply(useApp.getState())
    return useApp.subscribe(apply)
  }, [])

  // Never let unsaved marks disappear with the window or the tab.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useApp.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    let unlisten: (() => void) | undefined
    void (async () => {
      unlisten = await platform().onCloseRequest(async () => {
        const s = useApp.getState()
        if (!s.dirty) return true
        const discard = await platform().confirmDiscard(s.fileName)
        // Clear the flag so the follow-up close is not blocked again.
        if (discard) useApp.setState({ dirty: false })
        return discard
      })
    })()

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      unlisten?.()
    }
  }, [])

  return (
    <div className="app">
      <TitleBar onOpen={openViaDialog} />

      {status === 'ready' ? (
        <>
          <Toolbar />
          <div className="body">
            {sidebar && <Thumbnails />}
            <Viewer />
            <Rail />
          </div>
        </>
      ) : (
        <>
          <div />
          <div className="body">
            <Welcome onOpen={openViaDialog} dragging={dragging} />
          </div>
        </>
      )}

      {status === 'loading' && (
        <div className="busy">
          <div className="busy__spinner" />
          <span>{loadingLabel || 'Working…'}</span>
        </div>
      )}

      {dragging && status === 'ready' && !studioOpen && (
        <div className="dragveil">
          <div className="dragveil__box">
            <DocIcon size={26} />
            Drop to open
          </div>
        </div>
      )}

      <SignatureStudio />
      <Toasts />
    </div>
  )
}

/** Maps a browser keystroke onto the same command ids the native menu emits. */
function webAccelerator(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()
  if (key === 'o') return 'open'
  if (key === 's') return e.shiftKey ? 'save-as' : 'save'
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === '=' || key === '+') return 'zoom-in'
  if (key === '-') return 'zoom-out'
  if (key === '0') return 'zoom-fit'
  if (key === '1') return 'tool-signature'
  if (key === '2') return 'tool-text'
  if (key === '3') return 'tool-date'
  if (key === '4') return 'tool-check'
  return null
}

function runCommand(id: string) {
  const s = useApp.getState()
  switch (id) {
    case 'open':
      void s.openDialog()
      break
    case 'save':
      if (s.status === 'ready') void s.save('save')
      break
    case 'save-as':
      if (s.status === 'ready') void s.save('save-as')
      break
    case 'close-doc':
      s.closeDocument()
      break
    case 'undo':
      s.undo()
      break
    case 'redo':
      s.redo()
      break
    case 'delete-selection':
      if (s.selectedId) s.removeElement(s.selectedId)
      break
    case 'tool-signature':
      triggerSign()
      break
    case 'tool-text':
      s.setTool('text')
      break
    case 'tool-date':
      s.setTool('date')
      break
    case 'tool-check':
      s.armStamp(null)
      s.setTool('check')
      break
    case 'manage-signatures':
      s.setStudioOpen(true)
      break
    case 'zoom-in':
      s.zoomBy(2)
      break
    case 'zoom-out':
      s.zoomBy(0.5)
      break
    case 'zoom-fit':
      s.setZoom(s.zoom, 'width')
      break
    case 'toggle-sidebar':
      s.toggleSidebar()
      break
  }
}
