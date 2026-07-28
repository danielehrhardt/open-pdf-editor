/**
 * Browser platform — no server, no upload, nothing leaves the machine.
 *
 * Two tiers, picked automatically:
 *
 *  - **File System Access API** (Chrome, Edge, Arc, Brave, Opera): real Open and
 *    Save dialogs, ⌘S overwrites the original in place, and the recents list
 *    reopens documents because handles survive in IndexedDB.
 *  - **Everywhere else** (Safari, Firefox): a hidden file input to open, and a
 *    download to save. Recents are hidden because there is nothing to reopen.
 *
 * The signature library lives in IndexedDB either way.
 */
import { idbDelete, idbGet, idbSet, requestPersistence } from './idb'
import type {
  DroppedFile,
  FileRef,
  OpenedFile,
  Platform,
  RecentEntry,
  SaveResult,
} from './types'
import { isPdfName } from './types'

const LIBRARY_KEY = 'signatures'
const RECENTS_KEY = 'recents'
const MAX_RECENTS = 8

/* --- File System Access API surface (not yet in TypeScript's DOM lib) ------ */

interface FilePickerType {
  description?: string
  accept: Record<string, string[]>
}
interface OpenPickerOptions {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: FilePickerType[]
  id?: string
}
interface SavePickerOptions extends OpenPickerOptions {
  suggestedName?: string
}
type PermissionMode = { mode?: 'read' | 'readwrite' }

interface FsWindow {
  showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>
}

interface HandleWithPermissions extends FileSystemFileHandle {
  queryPermission?: (options?: PermissionMode) => Promise<PermissionState>
  requestPermission?: (options?: PermissionMode) => Promise<PermissionState>
}

interface ItemWithHandle extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}

const fsWindow = window as unknown as FsWindow
const supportsFileSystemAccess =
  typeof fsWindow.showOpenFilePicker === 'function' &&
  typeof fsWindow.showSaveFilePicker === 'function' &&
  // Cross-origin iframes get the API but every call throws a SecurityError.
  window.self === window.top

const PDF_TYPES: FilePickerType[] = [
  { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } },
]
const IMAGE_TYPES: FilePickerType[] = [
  {
    description: 'Image',
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] },
  },
]

const isAbort = (err: unknown) => (err as { name?: string })?.name === 'AbortError'

const readFileObject = async (file: File): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer())

/** Falls back to a hidden <input> when the picker API is unavailable. */
function pickWithInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.append(input)

    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // 'cancel' is well supported now; the focus fallback covers older engines.
    input.addEventListener('cancel', () => finish(null))
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(input.files?.[0] ?? null), 400),
      { once: true },
    )

    input.click()
  })
}

async function ensureAccess(
  ref: FileRef,
  mode: 'read' | 'readwrite',
  interactive: boolean,
): Promise<boolean> {
  if (ref.kind !== 'handle') return false
  const handle = ref.handle as HandleWithPermissions
  if (!handle.queryPermission) return true
  const current = await handle.queryPermission({ mode })
  if (current === 'granted') return true
  if (!interactive || !handle.requestPermission) return false
  return (await handle.requestPermission({ mode })) === 'granted'
}

function download(bytes: Uint8Array, name: string) {
  // Copy into a standalone buffer — Blob keeps a reference to the view's
  // backing store, and pdf-lib's output may be a slice of a pool.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function writeThroughHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable()
  try {
    await writable.write(new Uint8Array(bytes))
  } finally {
    await writable.close()
  }
}

/* --- recents --------------------------------------------------------------- */

interface StoredRecent {
  id: string
  name: string
  location: string
  at: number
  handle: FileSystemFileHandle
}

async function readRecents(): Promise<StoredRecent[]> {
  if (!supportsFileSystemAccess) return []
  try {
    const list = await idbGet<StoredRecent[]>(RECENTS_KEY)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/* --- platform -------------------------------------------------------------- */

export function createWebPlatform(): Platform {
  void requestPersistence()

  const openFromHandle = async (
    handle: FileSystemFileHandle,
    writable: boolean,
  ): Promise<OpenedFile> => {
    const file = await handle.getFile()
    return {
      name: file.name,
      bytes: await readFileObject(file),
      ref: { kind: 'handle', handle },
      writable,
      location: '',
    }
  }

  return {
    id: 'web',
    canSaveInPlace: supportsFileSystemAccess,
    hasNativeMenu: false,
    hasRecents: supportsFileSystemAccess,
    storageNote: supportsFileSystemAccess
      ? 'Documents stay on your device; signatures are saved in this browser.'
      : 'Nothing is uploaded. Signatures are saved in this browser, and edits download as a new PDF.',

    async openPdf() {
      if (supportsFileSystemAccess) {
        try {
          const [handle] = await fsWindow.showOpenFilePicker!({
            multiple: false,
            types: PDF_TYPES,
            id: 'inkwell-pdf',
          })
          if (!handle) return null
          const opened = await openFromHandle(handle, true)
          await this.addRecent(opened.ref!, opened.name, '')
          return opened
        } catch (err) {
          if (isAbort(err)) return null
          throw err
        }
      }

      const file = await pickWithInput('application/pdf,.pdf')
      if (!file) return null
      return {
        name: file.name,
        bytes: await readFileObject(file),
        ref: null,
        // Nothing to write back to, so Save behaves as Save As.
        writable: false,
        location: '',
      }
    },

    async openImage() {
      if (supportsFileSystemAccess) {
        try {
          const [handle] = await fsWindow.showOpenFilePicker!({
            multiple: false,
            types: IMAGE_TYPES,
            id: 'inkwell-image',
          })
          if (!handle) return null
          const file = await handle.getFile()
          return { name: file.name, bytes: await readFileObject(file) }
        } catch (err) {
          if (isAbort(err)) return null
          throw err
        }
      }
      const file = await pickWithInput('image/*')
      if (!file) return null
      return { name: file.name, bytes: await readFileObject(file) }
    },

    async read(ref) {
      if (ref.kind !== 'handle') throw new Error('That file is no longer available.')
      if (!(await ensureAccess(ref, 'read', true))) {
        throw new Error('Permission to read that file was declined.')
      }
      return readFileObject(await ref.handle.getFile())
    },

    async save({ bytes, ref, suggestedName, forceNew }) {
      if (!forceNew && ref?.kind === 'handle' && supportsFileSystemAccess) {
        if (await ensureAccess(ref, 'readwrite', true)) {
          await writeThroughHandle(ref.handle, bytes)
          return { ref, name: ref.handle.name, location: '', persisted: true }
        }
      }

      if (supportsFileSystemAccess) {
        try {
          const handle = await fsWindow.showSaveFilePicker!({
            suggestedName,
            types: PDF_TYPES,
            id: 'inkwell-pdf',
          })
          await writeThroughHandle(handle, bytes)
          const saved: SaveResult = {
            ref: { kind: 'handle', handle },
            name: handle.name,
            location: '',
            persisted: true,
          }
          await this.addRecent(saved.ref!, saved.name, '')
          return saved
        } catch (err) {
          if (isAbort(err)) return null
          throw err
        }
      }

      download(bytes, suggestedName)
      // A download has no handle to come back to, so the document keeps
      // pointing at the original bytes.
      return { ref: null, name: suggestedName, location: '', persisted: false }
    },

    async loadLibrary() {
      try {
        return (await idbGet<string>(LIBRARY_KEY)) ?? ''
      } catch {
        return ''
      }
    },

    async saveLibrary(json) {
      await idbSet(LIBRARY_KEY, json)
    },

    async listRecents() {
      const stored = await readRecents()
      return stored.map<RecentEntry>((r) => ({
        id: r.id,
        name: r.name,
        location: r.location,
        at: r.at,
        ref: { kind: 'handle', handle: r.handle },
      }))
    },

    async addRecent(ref, name, location) {
      if (!supportsFileSystemAccess || ref.kind !== 'handle') return
      const stored = await readRecents()
      const kept: StoredRecent[] = []
      for (const entry of stored) {
        // isSameEntry is the only reliable way to compare handles.
        const same = await entry.handle.isSameEntry(ref.handle).catch(() => false)
        if (!same) kept.push(entry)
      }
      const next: StoredRecent[] = [
        { id: `r_${Date.now().toString(36)}`, name, location, at: Date.now(), handle: ref.handle },
        ...kept,
      ].slice(0, MAX_RECENTS)
      try {
        await idbSet(RECENTS_KEY, next)
      } catch {
        // Handles are structured-cloneable in Chromium; if a browser refuses,
        // recents simply stay empty.
      }
    },

    async removeRecent(id) {
      const stored = await readRecents()
      await idbSet(
        RECENTS_KEY,
        stored.filter((r) => r.id !== id),
      ).catch(() => undefined)
      if (stored.length === 0) await idbDelete(RECENTS_KEY).catch(() => undefined)
    },

    async openRecent(entry) {
      if (entry.ref.kind !== 'handle') return null
      if (!(await ensureAccess(entry.ref, 'readwrite', true))) {
        throw new Error(`Permission to reopen “${entry.name}” was declined.`)
      }
      const opened = await openFromHandle(entry.ref.handle, true)
      await this.addRecent(entry.ref, opened.name, '')
      return opened
    },

    async reveal() {
      /* Browsers cannot show a file in the OS file manager. */
    },
    canReveal: () => false,

    setWindowTitle(title) {
      document.title = title
    },

    async confirmDiscard(name) {
      return window.confirm(`“${name}” has unsaved marks. Close it anyway?`)
    },

    async onMenu() {
      return () => {}
    },

    async onCloseRequest() {
      // `beforeunload` is the only hook a page gets, and App installs it.
      return () => {}
    },

    async onOpenExternal(handler) {
      // Progressive enhancement: when installed and registered as a PDF
      // handler, the browser delivers files through the Launch Queue.
      const queue = (
        window as unknown as {
          launchQueue?: { setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void }
        }
      ).launchQueue
      if (!queue) return () => {}

      let active = true
      queue.setConsumer(async ({ files }) => {
        if (!active || !files?.length) return
        const opened: OpenedFile[] = []
        for (const handle of files) {
          try {
            opened.push(await openFromHandle(handle, true))
          } catch {
            /* skip anything we cannot read */
          }
        }
        if (opened.length) handler(opened)
      })
      return () => {
        active = false
      }
    },

    async onDrop(handler) {
      let depth = 0

      const collect = async (transfer: DataTransfer): Promise<DroppedFile[]> => {
        const out: DroppedFile[] = []
        const items = [...transfer.items].filter((i) => i.kind === 'file')

        for (const item of items) {
          const withHandle = item as ItemWithHandle
          if (supportsFileSystemAccess && withHandle.getAsFileSystemHandle) {
            try {
              const handle = await withHandle.getAsFileSystemHandle()
              if (handle && handle.kind === 'file') {
                const fileHandle = handle as FileSystemFileHandle
                out.push({
                  name: fileHandle.name,
                  ref: { kind: 'handle', handle: fileHandle },
                  read: async () => readFileObject(await fileHandle.getFile()),
                })
                continue
              }
            } catch {
              /* fall through to the plain File */
            }
          }
          const file = item.getAsFile()
          if (file) {
            out.push({ name: file.name, ref: null, read: () => readFileObject(file) })
          }
        }

        if (out.length === 0) {
          for (const file of transfer.files) {
            out.push({ name: file.name, ref: null, read: () => readFileObject(file) })
          }
        }
        return out
      }

      const onDragEnter = (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        depth++
        handler({ phase: 'over' })
      }
      const onDragOver = (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
      const onDragLeave = () => {
        depth = Math.max(0, depth - 1)
        if (depth === 0) handler({ phase: 'leave' })
      }
      const onDropEvent = async (e: DragEvent) => {
        if (!e.dataTransfer) return
        e.preventDefault()
        depth = 0
        handler({ phase: 'leave' })
        const files = await collect(e.dataTransfer)
        if (files.length) handler({ phase: 'drop', files })
      }

      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('drop', onDropEvent)

      return () => {
        window.removeEventListener('dragenter', onDragEnter)
        window.removeEventListener('dragover', onDragOver)
        window.removeEventListener('dragleave', onDragLeave)
        window.removeEventListener('drop', onDropEvent)
      }
    },
  }
}

export { isPdfName }
