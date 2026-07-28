/**
 * A very small IndexedDB key/value store.
 *
 * The web build keeps the signature library here rather than in localStorage:
 * signatures are PNG data URLs, and a handful of them would blow past the 5 MB
 * localStorage ceiling. IndexedDB also stores `FileSystemFileHandle` objects
 * directly, which is what makes the recents list able to reopen a document.
 */

const DB_NAME = 'inkwell'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

export const idbGet = <T>(key: string): Promise<T | undefined> =>
  run<T | undefined>('readonly', (store) => store.get(key) as IDBRequest<T | undefined>)

export const idbSet = (key: string, value: unknown): Promise<void> =>
  run<IDBValidKey>('readwrite', (store) => store.put(value, key)).then(() => undefined)

export const idbDelete = (key: string): Promise<void> =>
  run<undefined>('readwrite', (store) => store.delete(key) as IDBRequest<undefined>).then(
    () => undefined,
  )

/** True when the browser gives us persistent (non-evictable) storage. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
