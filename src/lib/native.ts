/**
 * Thin wrapper over the Tauri IPC surface.
 *
 * Every call degrades gracefully when the app is loaded in a plain browser
 * (`npm run dev` without the shell), which keeps UI iteration fast.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog, message } from '@tauri-apps/plugin-dialog'

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface FileMeta {
  path: string
  name: string
  dir: string
  size: number
  writable: boolean
}

/** base64url-encodes a string so arbitrary paths survive an HTTP header. */
function encodePath(path: string): string {
  const bytes = new TextEncoder().encode(path)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function readFile(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>('read_file', { path })
  return new Uint8Array(buf)
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  // Copy into a fresh buffer: `data` may be a view into a larger ArrayBuffer
  // (pdf-lib reuses pools), and Tauri serialises the whole underlying buffer.
  const exact = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data
    : new Uint8Array(data)
  await invoke('write_file', exact, { headers: { 'x-target-path': encodePath(path) } })
}

export const fileMeta = (path: string) => invoke<FileMeta>('file_meta', { path })
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path })
export const loadLibraryRaw = () => invoke<string>('load_library')
export const saveLibraryRaw = (json: string) => invoke<void>('save_library', { json })
export const revealInFinder = (path: string) => invoke<void>('reveal', { path })
export const openExternal = (path: string) => invoke<void>('open_external', { path })
export const takePendingOpen = () => invoke<string[]>('take_pending_open')

export async function pickPdf(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    directory: false,
    title: 'Open PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  return typeof picked === 'string' ? picked : null
}

export async function pickImage(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    directory: false,
    title: 'Choose an image',
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  })
  return typeof picked === 'string' ? picked : null
}

export async function pickSaveTarget(defaultPath: string): Promise<string | null> {
  const picked = await saveDialog({
    title: 'Save PDF',
    defaultPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  return picked ?? null
}

export const alert = (title: string, text: string) =>
  message(text, { title, kind: 'error' })

export function onMenu(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>('menu', (e) => handler(e.payload))
}

export function onOpenFile(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>('open-file', (e) => handler(e.payload))
}
