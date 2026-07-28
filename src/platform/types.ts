/**
 * The platform seam.
 *
 * Everything above this line — rendering, placing signatures, writing the PDF —
 * is plain browser code and runs identically in the Tauri shell and on a static
 * host. Only opening files, saving them, and remembering the signature library
 * differ, so those live behind this interface.
 */

/** An opaque reference to a file we can read again or save back over. */
export type FileRef =
  | { kind: 'path'; path: string }
  /** A File System Access handle (Chromium). Lets the web build save in place. */
  | { kind: 'handle'; handle: FileSystemFileHandle }

export interface OpenedFile {
  name: string
  bytes: Uint8Array
  ref: FileRef | null
  /** False for read-only originals; the UI then steers the user to Save As. */
  writable: boolean
  /** Human-readable location, shown in the recents list. Empty on the web. */
  location: string
}

export interface SaveRequest {
  bytes: Uint8Array
  /** Where it came from; null means we have nowhere to save back to. */
  ref: FileRef | null
  suggestedName: string
  /** Save As: always ask, never overwrite silently. */
  forceNew: boolean
}

export interface SaveResult {
  ref: FileRef | null
  name: string
  location: string
  /** True when the bytes went to a real destination the user chose or owns. */
  persisted: boolean
}

export interface RecentEntry {
  id: string
  name: string
  location: string
  at: number
  ref: FileRef
}

export interface DropPayload {
  phase: 'over' | 'leave' | 'drop'
  /** Present on 'drop'. */
  files?: DroppedFile[]
}

export interface DroppedFile {
  name: string
  read: () => Promise<Uint8Array>
  ref: FileRef | null
}

export interface Platform {
  readonly id: 'tauri' | 'web'
  /** Whether ⌘S can overwrite the original without a dialog. */
  readonly canSaveInPlace: boolean
  /** Tauri owns a real menu bar; the web build binds its own shortcuts. */
  readonly hasNativeMenu: boolean
  /** Whether reopening from the recents list is supported. */
  readonly hasRecents: boolean
  /** A short note for the UI about where data lives. */
  readonly storageNote: string

  openPdf(): Promise<OpenedFile | null>
  openImage(): Promise<{ name: string; bytes: Uint8Array } | null>
  read(ref: FileRef): Promise<Uint8Array>
  save(request: SaveRequest): Promise<SaveResult | null>

  loadLibrary(): Promise<string>
  saveLibrary(json: string): Promise<void>

  listRecents(): Promise<RecentEntry[]>
  addRecent(ref: FileRef, name: string, location: string): Promise<void>
  removeRecent(id: string): Promise<void>
  /** Re-open a recent; may need the user to re-grant access on the web. */
  openRecent(entry: RecentEntry): Promise<OpenedFile | null>

  reveal(ref: FileRef): Promise<void>
  canReveal(ref: FileRef | null): boolean

  setWindowTitle(title: string): void
  confirmDiscard(name: string): Promise<boolean>

  /** Native menu commands. Returns an unsubscribe function. */
  onMenu(handler: (id: string) => void): Promise<() => void>
  /** Files handed over by the OS. */
  onOpenExternal(handler: (files: OpenedFile[]) => void): Promise<() => void>
  /** Drag and drop over the window. */
  onDrop(handler: (payload: DropPayload) => void): Promise<() => void>
  /**
   * Intercepts a window close. The handler resolves true to allow it. The web
   * build relies on `beforeunload` instead and returns a no-op.
   */
  onCloseRequest(handler: () => Promise<boolean>): Promise<() => void>
}

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|heic|heif|tiff?|avif)$/i
export const isPdfName = (name: string) => /\.pdf$/i.test(name)
export const isImageName = (name: string) => IMAGE_EXTENSIONS.test(name)

/** Suggests "Contract.pdf" → "Contract (signed).pdf". */
export function suggestSignedName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : '.pdf'
  if (/\(signed\)$/i.test(stem)) return fileName
  return `${stem} (signed)${ext}`
}
