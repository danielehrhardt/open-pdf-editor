/** Pointer-drag plumbing shared by element moving, resizing and the signature pad. */
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface DragDelta {
  dx: number
  dy: number
  x: number
  y: number
  shift: boolean
  alt: boolean
}

export interface DragHandlers {
  onStart?: () => void
  onMove: (delta: DragDelta) => void
  onEnd?: (delta: DragDelta) => void
}

/**
 * Tracks a drag on `window` so the gesture survives the pointer leaving the
 * element — the usual failure mode of naive drag code when you move fast.
 */
export function beginDrag(event: ReactPointerEvent, handlers: DragHandlers): void {
  event.preventDefault()
  event.stopPropagation()

  const startX = event.clientX
  const startY = event.clientY
  let last: DragDelta = { dx: 0, dy: 0, x: startX, y: startY, shift: false, alt: false }
  let started = false

  const toDelta = (e: PointerEvent): DragDelta => ({
    dx: e.clientX - startX,
    dy: e.clientY - startY,
    x: e.clientX,
    y: e.clientY,
    shift: e.shiftKey,
    alt: e.altKey,
  })

  const move = (e: PointerEvent) => {
    if (!started) {
      started = true
      handlers.onStart?.()
    }
    last = toDelta(e)
    handlers.onMove(last)
  }

  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    if (started) last = toDelta(e)
    handlers.onEnd?.(last)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
