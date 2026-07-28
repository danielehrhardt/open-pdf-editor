/** Tauri platform — native dialogs, real paths, a menu bar, and Finder. */
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm } from '@tauri-apps/plugin-dialog'

import * as native from '../lib/native'
import type {
  DroppedFile,
  FileRef,
  OpenedFile,
  Platform,
  RecentEntry,
  SaveResult,
} from './types'
import { isPdfName } from './types'

const RECENTS_KEY = 'inkwell.recents'
const MAX_RECENTS = 8

interface StoredRecent {
  path: string
  name: string
  location: string
  at: number
}

function readStoredRecents(): StoredRecent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const list = raw ? (JSON.parse(raw) as StoredRecent[]) : []
    return Array.isArray(list) ? list.filter((r) => typeof r?.path === 'string') : []
  } catch {
    return []
  }
}

function writeStoredRecents(list: StoredRecent[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)))
  } catch {
    /* recents are a convenience, not state we owe the user */
  }
}

const pathOf = (ref: FileRef | null): string | null =>
  ref?.kind === 'path' ? ref.path : null

async function openFromPath(path: string): Promise<OpenedFile> {
  const [bytes, meta] = await Promise.all([native.readFile(path), native.fileMeta(path)])
  return {
    name: meta.name,
    bytes,
    ref: { kind: 'path', path },
    writable: meta.writable,
    location: meta.dir,
  }
}

export function createTauriPlatform(): Platform {
  const remember = (path: string, name: string, location: string) => {
    writeStoredRecents([
      { path, name, location, at: Date.now() },
      ...readStoredRecents().filter((r) => r.path !== path),
    ])
  }

  return {
    id: 'tauri',
    canSaveInPlace: true,
    hasNativeMenu: true,
    hasRecents: true,
    storageNote: 'Everything stays on this Mac — no account, no upload.',

    async openPdf() {
      const path = await native.pickPdf()
      if (!path) return null
      const opened = await openFromPath(path)
      remember(path, opened.name, opened.location)
      return opened
    },

    async openImage() {
      const path = await native.pickImage()
      if (!path) return null
      return { name: path.split('/').pop() ?? 'image', bytes: await native.readFile(path) }
    },

    async read(ref) {
      const path = pathOf(ref)
      if (!path) throw new Error('That file is no longer available.')
      return native.readFile(path)
    },

    async save({ bytes, ref, suggestedName, forceNew }) {
      const current = pathOf(ref)
      let target = current

      if (forceNew || !target) {
        const defaultPath = current
          ? current.replace(/[^/]+$/, suggestedName)
          : suggestedName
        target = await native.pickSaveTarget(defaultPath)
        if (!target) return null
      }

      await native.writeFile(target, bytes)
      const name = target.split('/').pop() ?? suggestedName
      const location = target.slice(0, Math.max(0, target.length - name.length - 1))
      remember(target, name, location)
      const result: SaveResult = {
        ref: { kind: 'path', path: target },
        name,
        location,
        persisted: true,
      }
      return result
    },

    loadLibrary: () => native.loadLibraryRaw(),
    saveLibrary: (json) => native.saveLibraryRaw(json),

    async listRecents() {
      const stored = readStoredRecents()
      // Drop entries whose file has since moved or been deleted.
      const alive = await Promise.all(
        stored.map(async (r) => ((await native.pathExists(r.path).catch(() => false)) ? r : null)),
      )
      const kept = alive.filter((r): r is StoredRecent => r !== null)
      if (kept.length !== stored.length) writeStoredRecents(kept)
      return kept.map<RecentEntry>((r) => ({
        id: r.path,
        name: r.name,
        location: r.location,
        at: r.at,
        ref: { kind: 'path', path: r.path },
      }))
    },

    async addRecent(ref, name, location) {
      const path = pathOf(ref)
      if (path) remember(path, name, location)
    },

    async removeRecent(id) {
      writeStoredRecents(readStoredRecents().filter((r) => r.path !== id))
    },

    async openRecent(entry) {
      const path = pathOf(entry.ref)
      if (!path) return null
      return openFromPath(path)
    },

    async reveal(ref) {
      const path = pathOf(ref)
      if (path) await native.revealInFinder(path)
    },
    canReveal: (ref) => ref?.kind === 'path',

    setWindowTitle(title) {
      document.title = title
      void getCurrentWindow().setTitle(title).catch(() => {})
    },

    confirmDiscard(name) {
      return confirm(`“${name}” has unsaved marks. Close it anyway?`, {
        title: 'Unsaved changes',
        kind: 'warning',
        okLabel: 'Discard',
        cancelLabel: 'Keep editing',
      })
    },

    onMenu: (handler) => native.onMenu(handler),

    async onCloseRequest(handler) {
      const appWindow = getCurrentWindow()
      return appWindow.onCloseRequested(async (event) => {
        // Always block first: the decision is async, and the window would be
        // gone before the dialog returned.
        event.preventDefault()
        if (await handler()) await appWindow.destroy()
      })
    },

    async onOpenExternal(handler) {
      const deliver = async (paths: string[]) => {
        const opened: OpenedFile[] = []
        for (const path of paths) {
          try {
            opened.push(await openFromPath(path))
          } catch {
            /* skip anything we cannot read */
          }
        }
        if (opened.length) handler(opened)
      }

      // Files handed over before the webview finished booting.
      const pending = await native.takePendingOpen().catch(() => [] as string[])
      if (pending.length) void deliver(pending)

      return native.onOpenFile((paths) => void deliver(paths))
    },

    async onDrop(handler) {
      return getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          handler({ phase: 'over' })
        } else if (event.payload.type === 'leave') {
          handler({ phase: 'leave' })
        } else if (event.payload.type === 'drop') {
          handler({ phase: 'leave' })
          const files: DroppedFile[] = event.payload.paths.map((path) => ({
            name: path.split('/').pop() ?? path,
            ref: { kind: 'path', path },
            read: () => native.readFile(path),
          }))
          if (files.length) handler({ phase: 'drop', files })
        }
      })
    },
  }
}

export { isPdfName }
