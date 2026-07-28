/**
 * Coordinate math between three spaces:
 *
 *  - **PDF user space** — origin bottom-left, y grows upward, units are points.
 *  - **View space**     — what the user sees at zoom 1: origin top-left of the
 *                         displayed (i.e. already rotated) page, y grows down.
 *  - **Screen space**   — view space multiplied by the current zoom.
 *
 * The transforms below are the algebraic inverse of pdf.js's `PageViewport`
 * for scale 1, so a rect placed on screen lands on exactly the same spot when
 * pdf-lib writes it into the file — including on pages with a /Rotate entry or
 * a CropBox whose origin is not (0, 0).
 */
import type { PageGeometry, Rotation } from '../types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** Unscaled on-screen size of a page, accounting for its rotation. */
export function viewSize(view: PageGeometry['view'], rotation: Rotation) {
  const w = Math.abs(view[2] - view[0])
  const h = Math.abs(view[3] - view[1])
  return rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

/** View-space point → PDF user-space point. */
export function viewToPdf(p: Point, geo: PageGeometry): Point {
  const [x0, y0, x1, y1] = geo.view
  switch (geo.rotation) {
    case 90:
      return { x: p.y + x0, y: p.x + y0 }
    case 180:
      return { x: x1 - p.x, y: p.y + y0 }
    case 270:
      return { x: x1 - p.y, y: y1 - p.x }
    default:
      return { x: p.x + x0, y: y1 - p.y }
  }
}

/** PDF user-space point → view-space point. */
export function pdfToView(p: Point, geo: PageGeometry): Point {
  const [x0, y0, x1, y1] = geo.view
  switch (geo.rotation) {
    case 90:
      return { x: p.y - y0, y: p.x - x0 }
    case 180:
      return { x: x1 - p.x, y: p.y - y0 }
    case 270:
      return { x: y1 - p.y, y: x1 - p.x }
    default:
      return { x: p.x - x0, y: y1 - p.y }
  }
}

/** PDF user-space rect [x0,y0,x1,y1] → axis-aligned view-space rect. */
export function pdfRectToView(rect: number[], geo: PageGeometry): Rect {
  const a = pdfToView({ x: rect[0], y: rect[1] }, geo)
  const b = pdfToView({ x: rect[2], y: rect[3] }, geo)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

export interface DrawAnchor {
  /** pdf-lib anchor — the *unrotated* bottom-left corner of the drawn box. */
  x: number
  y: number
  /** Counter-clockwise rotation in degrees to apply about the anchor. */
  rotate: Rotation
}

/**
 * Maps a view-space rect to the anchor + rotation pdf-lib needs so the drawn
 * content covers exactly that rect once the page's own rotation is applied.
 */
export function drawAnchorForRect(rect: Rect, geo: PageGeometry): DrawAnchor {
  // The anchor is the bottom-left corner of the box as the *user sees it*,
  // which in view space is (x, y + h).
  const p = viewToPdf({ x: rect.x, y: rect.y + rect.h }, geo)
  return { x: p.x, y: p.y, rotate: geo.rotation }
}

/**
 * Maps a view-space point that sits on a text baseline to its PDF position.
 * Shares the rotation convention with {@link drawAnchorForRect}.
 */
export function drawAnchorForPoint(p: Point, geo: PageGeometry): DrawAnchor {
  const q = viewToPdf(p, geo)
  return { x: q.x, y: q.y, rotate: geo.rotation }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Keeps an element at least partially on the page so it can never be lost. */
export function constrainToPage(rect: Rect, pageW: number, pageH: number): Rect {
  const minVisible = 12
  return {
    ...rect,
    x: clamp(rect.x, -rect.w + minVisible, pageW - minVisible),
    y: clamp(rect.y, -rect.h + minVisible, pageH - minVisible),
  }
}
