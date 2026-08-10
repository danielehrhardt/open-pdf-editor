/** Page-order arithmetic for the thumbnail rail. */

export interface PageMove<T> {
  /** The pages in their new display order. */
  pages: T[]
  /**
   * Old display index -> new display index. Everything pinned to a page — its
   * stamps, its form widgets, the page you were reading — moves through this.
   */
  remap: (index: number) => number
}

/**
 * Moves the page at display index `from` to display index `to`.
 *
 * Returns `null` when there is nothing to do, so callers do not push an empty
 * step onto the undo stack for a drag that landed back where it started.
 */
export function movePageOrder<T>(pages: T[], from: number, to: number): PageMove<T> | null {
  if (from < 0 || from >= pages.length) return null
  const target = Math.min(pages.length - 1, Math.max(0, to))
  if (target === from) return null

  const next = [...pages]
  next.splice(target, 0, ...next.splice(from, 1))

  // Pages between the two positions shift by exactly one, in the direction
  // opposite to the travel; everything outside that span stays put.
  const remap = (index: number) => {
    if (index === from) return target
    if (from < target) return index > from && index <= target ? index - 1 : index
    return index >= target && index < from ? index + 1 : index
  }

  return { pages: next, remap }
}
