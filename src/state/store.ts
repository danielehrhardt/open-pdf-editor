/** The application store: one open document, its overlay elements, form values
 *  and the editing history that ties them together. */
import { create } from 'zustand'

import { buildPdf, EncryptedPdfError } from '../lib/export'
import { constrainToPage } from '../lib/geometry'
import { movePageOrder } from '../lib/pages'
import { measureBlock } from '../lib/text'
import { loadPdf, PasswordRequiredError, type PDFDocumentProxy } from '../lib/pdf'
import {
  platform,
  suggestSignedName,
  type FileRef,
  type OpenedFile,
  type RecentEntry,
} from '../platform'
import type {
  FontKey,
  FormFieldInfo,
  ImageElement,
  PageGeometry,
  PdfElement,
  TextElement,
  ToastItem,
  ToolId,
} from '../types'

const HISTORY_LIMIT = 80
const PREFS_KEY = 'inkwell.prefs'

export type FormValue = string | boolean | string[]

/** An image waiting to be dropped onto the page by the next click. */
export interface PendingStamp {
  src: string
  aspect: number
  kind: 'signature' | 'image'
  /** Signature library entry it came from, for highlighting. */
  sourceId?: string
  /** Placement width in PDF points. */
  width: number
  label: string
}

interface Snapshot {
  elements: PdfElement[]
  formValues: Record<string, FormValue>
  /** Page order, so undoing a reorder puts the pages back. */
  pages: PageGeometry[]
  /** Field page indices move with the pages, so they travel together. */
  fields: FormFieldInfo[]
}

interface Prefs {
  flattenForm: boolean
  sidebar: boolean
  textFont: FontKey
  textSize: number
  textColor: string
}

const DEFAULT_PREFS: Prefs = {
  flattenForm: true,
  sidebar: true,
  textFont: 'helvetica',
  textSize: 12,
  textColor: '#111827',
}

export interface AppState {
  status: 'empty' | 'loading' | 'ready'
  loadingLabel: string

  /** Where the document came from, and where Save writes back to. */
  ref: FileRef | null
  fileName: string
  location: string
  writable: boolean
  source: Uint8Array | null
  doc: PDFDocumentProxy | null
  pages: PageGeometry[]
  fields: FormFieldInfo[]
  formValues: Record<string, FormValue>
  elements: PdfElement[]

  selectedId: string | null
  editingId: string | null
  dirty: boolean
  saving: boolean

  past: Snapshot[]
  future: Snapshot[]

  tool: ToolId
  /** Stamp armed for the next click on a page. */
  pending: PendingStamp | null
  zoom: number
  fitMode: 'width' | 'page' | null
  currentPage: number
  sidebar: boolean
  studioOpen: boolean
  prefs: Prefs

  recents: RecentEntry[]
  toasts: ToastItem[]

  // ---- document lifecycle
  openDialog: () => Promise<void>
  openFile: (
    file: OpenedFile,
    options?: { quiet?: boolean; preserveView?: boolean },
  ) => Promise<void>
  openRecent: (entry: RecentEntry) => Promise<void>
  refreshRecents: () => Promise<void>
  dropRecent: (id: string) => Promise<void>
  closeDocument: () => void
  save: (mode: 'save' | 'save-as') => Promise<void>

  // ---- editing
  addElement: (el: PdfElement) => void
  updateElement: (id: string, patch: Partial<PdfElement>, options?: { history?: boolean }) => void
  removeElement: (id: string) => void
  duplicateElement: (id: string) => void
  select: (id: string | null) => void
  setEditing: (id: string | null) => void
  nudge: (dx: number, dy: number) => void
  setFormValue: (name: string, value: FormValue) => void
  beginChange: () => void
  undo: () => void
  redo: () => void

  // ---- ui
  setTool: (tool: ToolId) => void
  armStamp: (stamp: PendingStamp | null) => void
  setZoom: (zoom: number, fitMode?: 'width' | 'page' | null) => void
  zoomBy: (factor: number) => void
  setCurrentPage: (page: number) => void
  /** Moves the page at display index `from` to display index `to`. */
  movePage: (from: number, to: number) => void
  toggleSidebar: () => void
  setStudioOpen: (open: boolean) => void
  setPrefs: (patch: Partial<Prefs>) => void
  toast: (message: string, tone?: ToastItem['tone'], action?: ToastItem['action']) => void
  dismissToast: (id: string) => void
}

let counter = 0
export const newElementId = () => `el_${Date.now().toString(36)}_${(counter++).toString(36)}`

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

const ZOOM_STOPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

export const useApp = create<AppState>((set, get) => {
  const initialPrefs = readPrefs()

  // `pages` and `fields` are only ever replaced wholesale, so keeping the array
  // itself is enough — no element of it is mutated in place.
  const snapshot = (): Snapshot => ({
    elements: get().elements.map((e) => ({ ...e })),
    formValues: { ...get().formValues },
    pages: get().pages,
    fields: get().fields,
  })

  const pushHistory = () => {
    set({ past: [...get().past, snapshot()].slice(-HISTORY_LIMIT), future: [] })
  }

  return {
    status: 'empty',
    loadingLabel: '',

    ref: null,
    fileName: '',
    location: '',
    writable: true,
    source: null,
    doc: null,
    pages: [],
    fields: [],
    formValues: {},
    elements: [],

    selectedId: null,
    editingId: null,
    dirty: false,
    saving: false,

    past: [],
    future: [],

    tool: 'select',
    pending: null,
    zoom: 1,
    fitMode: 'width',
    currentPage: 0,
    sidebar: initialPrefs.sidebar,
    studioOpen: false,
    prefs: initialPrefs,

    recents: [],
    toasts: [],

    openDialog: async () => {
      try {
        const file = await platform().openPdf()
        if (file) await get().openFile(file)
      } catch (err) {
        get().toast(describeError(err), 'error')
      }
    },

    openFile: async (file, options) => {
      const keepView = options?.preserveView === true
      set({ status: 'loading', loadingLabel: 'Reading pages…' })
      try {
        const loaded = await loadPdf(file.bytes)
        get().doc?.destroy()
        set({
          status: 'ready',
          loadingLabel: '',
          ref: file.ref,
          fileName: file.name,
          location: file.location,
          writable: file.writable,
          source: file.bytes,
          doc: loaded.doc,
          pages: loaded.pages,
          fields: loaded.fields,
          formValues: loaded.initialValues,
          elements: [],
          selectedId: null,
          editingId: null,
          dirty: false,
          past: [],
          future: [],
          tool: 'select',
          pending: null,
          ...(keepView ? {} : { currentPage: 0 }),
        })
        void get().refreshRecents()

        if (options?.quiet) return
        if (loaded.fields.length > 0) {
          get().toast(
            `${loaded.fields.length} form field${loaded.fields.length === 1 ? '' : 's'} detected — click one to fill it in.`,
            'info',
          )
        }
        if (!file.writable && platform().canSaveInPlace) {
          get().toast('This file is read-only — use Save As to keep your changes.', 'info')
        }
      } catch (err) {
        set({ status: get().doc ? 'ready' : 'empty', loadingLabel: '' })
        get().toast(describeError(err), 'error')
      }
    },

    openRecent: async (entry) => {
      try {
        const file = await platform().openRecent(entry)
        if (file) await get().openFile(file)
      } catch (err) {
        get().toast(describeError(err), 'error')
        void get().refreshRecents()
      }
    },

    refreshRecents: async () => {
      try {
        set({ recents: await platform().listRecents() })
      } catch {
        set({ recents: [] })
      }
    },

    dropRecent: async (id) => {
      await platform()
        .removeRecent(id)
        .catch(() => undefined)
      void get().refreshRecents()
    },

    closeDocument: () => {
      get().doc?.destroy()
      set({
        status: 'empty',
        ref: null,
        fileName: '',
        location: '',
        source: null,
        doc: null,
        pages: [],
        fields: [],
        formValues: {},
        elements: [],
        selectedId: null,
        editingId: null,
        dirty: false,
        past: [],
        future: [],
        tool: 'select',
        pending: null,
      })
    },

    save: async (mode) => {
      const s = get()
      if (!s.source || s.saving) return

      set({ saving: true })
      try {
        const { bytes, warnings } = await buildPdf({
          source: s.source,
          pages: s.pages,
          elements: s.elements,
          fields: s.fields,
          formValues: s.formValues,
          flattenForm: s.prefs.flattenForm,
        })

        const result = await platform().save({
          bytes,
          ref: s.ref,
          suggestedName:
            mode === 'save-as' || !s.ref
              ? suggestSignedName(s.fileName || 'Document.pdf')
              : s.fileName,
          forceNew: mode === 'save-as' || !s.writable,
        })

        if (!result) {
          set({ saving: false })
          return
        }

        for (const w of warnings) get().toast(w, 'info')

        if (result.persisted) {
          // Re-open what we just wrote. Without this the stamps stay in
          // `elements` while `source` already contains them, so a second save
          // would draw every signature twice.
          await get().openFile(
            {
              name: result.name,
              bytes,
              ref: result.ref,
              writable: true,
              location: result.location,
            },
            { quiet: true, preserveView: true },
          )
          set({ saving: false })

          const target = result.ref
          get().toast(
            `Saved ${result.name}`,
            'success',
            platform().canReveal(target)
              ? { label: 'Show in Finder', run: () => void platform().reveal(target!) }
              : undefined,
          )
        } else {
          // A download: the file left the app but there is no handle to write
          // back to, so the working copy stays exactly as it is.
          set({ saving: false, dirty: false })
          get().toast(`Downloaded ${result.name}`, 'success')
        }
      } catch (err) {
        set({ saving: false })
        get().toast(describeError(err), 'error')
      }
    },

    addElement: (el) => {
      pushHistory()
      set((s) => ({
        elements: [...s.elements, el],
        selectedId: el.id,
        dirty: true,
        pending: null,
        tool: 'select',
      }))
    },

    updateElement: (id, patch, options) => {
      if (options?.history !== false) pushHistory()
      set((s) => ({
        elements: s.elements.map((el) => {
          if (el.id !== id) return el
          const next = { ...el, ...patch } as PdfElement
          if (next.kind === 'text') {
            const t = next as TextElement
            const size = measureBlock(t.font, t.fontSize, t.text, t.letterSpacing)
            t.w = size.w
            t.h = size.h
          }
          const page = s.pages[next.page]
          if (page) {
            const fixed = constrainToPage(next, page.viewWidth, page.viewHeight)
            next.x = fixed.x
            next.y = fixed.y
          }
          return next
        }),
        dirty: true,
      }))
    },

    removeElement: (id) => {
      pushHistory()
      set((s) => ({
        elements: s.elements.filter((el) => el.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        editingId: s.editingId === id ? null : s.editingId,
        dirty: true,
      }))
    },

    duplicateElement: (id) => {
      const source = get().elements.find((el) => el.id === id)
      if (!source) return
      pushHistory()
      const copy = { ...source, id: newElementId(), x: source.x + 16, y: source.y + 16 }
      set((s) => ({ elements: [...s.elements, copy], selectedId: copy.id, dirty: true }))
    },

    select: (id) => set((s) => ({ selectedId: id, editingId: id === null ? null : s.editingId })),
    setEditing: (id) => set({ editingId: id, selectedId: id ?? get().selectedId }),

    nudge: (dx, dy) => {
      const { selectedId, elements } = get()
      const el = elements.find((e) => e.id === selectedId)
      if (!el) return
      get().updateElement(el.id, { x: el.x + dx, y: el.y + dy })
    },

    setFormValue: (name, value) => {
      pushHistory()
      set((s) => ({ formValues: { ...s.formValues, [name]: value }, dirty: true }))
    },

    beginChange: pushHistory,

    undo: () => {
      const { past, future } = get()
      if (past.length === 0) return
      const previous = past[past.length - 1]
      set({
        past: past.slice(0, -1),
        future: [...future, snapshot()].slice(-HISTORY_LIMIT),
        elements: previous.elements,
        formValues: previous.formValues,
        pages: previous.pages,
        fields: previous.fields,
        dirty: true,
        editingId: null,
      })
    },

    redo: () => {
      const { past, future } = get()
      if (future.length === 0) return
      const next = future[future.length - 1]
      set({
        future: future.slice(0, -1),
        past: [...past, snapshot()].slice(-HISTORY_LIMIT),
        elements: next.elements,
        formValues: next.formValues,
        pages: next.pages,
        fields: next.fields,
        dirty: true,
        editingId: null,
      })
    },

    setTool: (tool) =>
      set((s) => ({
        tool,
        pending: tool === 'signature' || tool === 'image' ? s.pending : null,
        selectedId: tool === 'select' ? s.selectedId : null,
        editingId: null,
      })),

    armStamp: (stamp) =>
      set({
        pending: stamp,
        tool: stamp ? (stamp.kind === 'image' ? 'image' : 'signature') : 'select',
      }),

    setZoom: (zoom, fitMode = null) => set({ zoom: Math.min(6, Math.max(0.15, zoom)), fitMode }),

    zoomBy: (factor) => {
      const current = get().zoom
      if (factor > 1) {
        const next = ZOOM_STOPS.find((z) => z > current + 0.001) ?? Math.min(6, current * 1.25)
        set({ zoom: next, fitMode: null })
      } else {
        const next =
          [...ZOOM_STOPS].reverse().find((z) => z < current - 0.001) ??
          Math.max(0.15, current / 1.25)
        set({ zoom: next, fitMode: null })
      }
    },

    setCurrentPage: (page) => set({ currentPage: page }),

    movePage: (from, to) => {
      const move = movePageOrder(get().pages, from, to)
      if (!move) return

      pushHistory()
      set((s) => ({
        pages: move.pages,
        elements: s.elements.map((el) => ({ ...el, page: move.remap(el.page) })),
        fields: s.fields.map((f) => ({ ...f, page: move.remap(f.page) })),
        currentPage: move.remap(s.currentPage),
        dirty: true,
      }))
    },

    toggleSidebar: () => {
      const sidebar = !get().sidebar
      set({ sidebar })
      get().setPrefs({ sidebar })
    },

    setStudioOpen: (studioOpen) => set({ studioOpen }),

    setPrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch }
      set({ prefs })
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      } catch {
        /* non-critical */
      }
    },

    toast: (message, tone = 'info', action) => {
      const id = `t_${Date.now()}_${counter++}`
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }))
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 4200)
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

function describeError(err: unknown): string {
  if (err instanceof PasswordRequiredError) {
    return 'That PDF is password protected. Remove the password and try again.'
  }
  if (err instanceof EncryptedPdfError) {
    return 'This PDF is encrypted, so Inkwell cannot write changes back into it.'
  }
  if (err instanceof Error && err.message) return err.message
  return typeof err === 'string' ? err : 'Something went wrong.'
}

/** Convenience selector for the element the user currently has selected. */
export function useSelectedElement(): PdfElement | null {
  return useApp((s) => s.elements.find((e) => e.id === s.selectedId) ?? null)
}

export type { ImageElement, TextElement }
