/** Persistent signature library, stored as JSON in the app's data directory. */
import { create } from 'zustand'

import { platform } from '../platform'
import type { SignatureEntry } from '../types'

interface LibraryState {
  entries: SignatureEntry[]
  loaded: boolean
  load: () => Promise<void>
  add: (entry: Omit<SignatureEntry, 'id' | 'createdAt'>) => Promise<SignatureEntry>
  remove: (id: string) => Promise<void>
  rename: (id: string, label: string) => Promise<void>
  setFavorite: (id: string) => Promise<void>
}

function newId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function parse(raw: string): SignatureEntry[] {
  if (!raw.trim()) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data?.entries)) return []
    return (data.entries as SignatureEntry[]).filter(
      (e) => typeof e?.id === 'string' && typeof e?.src === 'string',
    )
  } catch {
    return []
  }
}

export const useLibrary = create<LibraryState>((set, get) => {
  const persist = async (entries: SignatureEntry[]) => {
    set({ entries })
    try {
      await platform().saveLibrary(JSON.stringify({ version: 1, entries }, null, 2))
    } catch (err) {
      console.error('Could not persist the signature library', err)
    }
  }

  return {
    entries: [],
    loaded: false,

    load: async () => {
      if (get().loaded) return
      try {
        set({ entries: parse(await platform().loadLibrary()), loaded: true })
      } catch {
        set({ entries: [], loaded: true })
      }
    },

    add: async (input) => {
      const existing = get().entries
      // The first signature of its kind becomes the default for one-click signing.
      const isFirstOfKind = !existing.some((e) => e.favorite && e.kind === input.kind)
      const entry: SignatureEntry = {
        ...input,
        id: newId(),
        createdAt: Date.now(),
        favorite: isFirstOfKind,
      }
      await persist([entry, ...existing])
      return entry
    },

    remove: async (id) => {
      const entries = get().entries.filter((e) => e.id !== id)
      await persist(entries)
    },

    rename: async (id, label) => {
      await persist(get().entries.map((e) => (e.id === id ? { ...e, label } : e)))
    },

    setFavorite: async (id) => {
      const target = get().entries.find((e) => e.id === id)
      if (!target) return
      await persist(
        get().entries.map((e) =>
          e.kind === target.kind ? { ...e, favorite: e.id === id } : e,
        ),
      )
    },
  }
})
