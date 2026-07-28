/** Application shell: wiring between the OS (menus, file drops) and the UI. */
import { useCallback, useEffect, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'

import { crossStamp } from './lib/stamps'
import * as native from './lib/native'
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

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/i

export default function App() {
  const status = useApp((s) => s.status)
  const loadingLabel = useApp((s) => s.loadingLabel)
  const sidebar = useApp((s) => s.sidebar)
  const studioOpen = useApp((s) => s.studioOpen)
  const [dragging, setDragging] = useState(false)

  const loadLibrary = useLibrary((s) => s.load)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  const openViaDialog = useCallback(async () => {
    try {
      const path = await native.pickPdf()
      if (path) await useApp.getState().openPath(path)
    } catch (err) {
      useApp.getState().toast(err instanceof Error ? err.message : 'Could not open that file.', 'error')
    }
  }, [])

  const acceptPaths = useCallback((paths: string[]) => {
    const state = useApp.getState()
    const pdf = paths.find((p) => p.toLowerCase().endsWith('.pdf'))
    if (pdf) {
      void state.openPath(pdf)
      return
    }
    const image = paths.find((p) => IMAGE_EXTENSIONS.test(p))
    if (image) {
      // The signature studio listens for this while it is open.
      if (!state.studioOpen) state.setStudioOpen(true)
      // Give the studio a tick to mount its listener.
      setTimeout(
        () => window.dispatchEvent(new CustomEvent('inkwell:image', { detail: image })),
        60,
      )
      return
    }
    state.toast('Inkwell opens PDFs — drop a .pdf file.', 'error')
  }, [])

  // Files handed over by Finder ("Open With", dock drop).
  useEffect(() => {
    if (!native.isTauri()) return
    let unlisten: (() => void) | undefined

    void (async () => {
      const pending = await native.takePendingOpen().catch(() => [] as string[])
      if (pending.length > 0) acceptPaths(pending)
      unlisten = await native.onOpenFile(acceptPaths)
    })()

    return () => unlisten?.()
  }, [acceptPaths])

  // Native drag and drop onto the window.
  useEffect(() => {
    if (!native.isTauri()) return
    let unlisten: (() => void) | undefined

    void (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'over') setDragging(true)
        else if (event.payload.type === 'leave') setDragging(false)
        else if (event.payload.type === 'drop') {
          setDragging(false)
          acceptPaths(event.payload.paths)
        }
      })
    })()

    return () => unlisten?.()
  }, [acceptPaths])

  // Menu commands.
  useEffect(() => {
    if (!native.isTauri()) return
    let unlisten: (() => void) | undefined

    void (async () => {
      unlisten = await native.onMenu((id) => {
        const s = useApp.getState()
        switch (id) {
          case 'open':
            void openViaDialog()
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
            document.querySelector<HTMLButtonElement>('[title^="Place a signature"]')?.click()
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
      })
    })()

    return () => unlisten?.()
  }, [openViaDialog])

  // In-window keyboard handling for things the menu does not own.
  useEffect(() => {
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

      if (e.metaKey || e.ctrlKey || e.altKey) return

      // Single-key tool switches, mirroring the toolbar order.
      switch (e.key.toLowerCase()) {
        case 'v':
          s.setTool('select')
          break
        case 's':
          document.querySelector<HTMLButtonElement>('[title^="Place a signature"]')?.click()
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
    const unsubscribe = useApp.subscribe((s) => {
      document.title = s.status === 'ready' ? `${s.dirty ? '• ' : ''}${s.fileName}` : 'Inkwell'
    })
    return unsubscribe
  }, [])

  // Guard against losing work when the window is closed.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useApp.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="app">
      <TitleBar onOpen={() => void openViaDialog()} />

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
            <Welcome onOpen={() => void openViaDialog()} dragging={dragging} />
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
