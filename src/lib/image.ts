/** Canvas helpers for turning strokes, typed text and photos into clean,
 *  transparent-background signature PNGs. */

export interface Trimmed {
  dataUrl: string
  width: number
  height: number
  aspect: number
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('Canvas 2D is unavailable')
  return g
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode that image'))
    img.src = src
  })
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

/**
 * Crops fully-transparent margins away and rescales so the longest edge is at
 * most `maxEdge`. Tight bounds make placement predictable — the visible ink
 * fills the element box instead of floating inside invisible padding.
 */
export function trimTransparent(canvas: HTMLCanvasElement, maxEdge = 1600, padding = 6): Trimmed {
  const g = ctx2d(canvas)
  const { width, height } = canvas
  const { data } = g.getImageData(0, 0, width, height)

  let top = height
  let left = width
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }

  if (right < 0) {
    // Nothing was drawn — hand back a 1x1 transparent pixel rather than throwing.
    const empty = makeCanvas(1, 1)
    return { dataUrl: empty.toDataURL('image/png'), width: 1, height: 1, aspect: 1 }
  }

  left = Math.max(0, left - padding)
  top = Math.max(0, top - padding)
  right = Math.min(width - 1, right + padding)
  bottom = Math.min(height - 1, bottom + padding)

  const cw = right - left + 1
  const ch = bottom - top + 1
  const scale = Math.min(1, maxEdge / Math.max(cw, ch))
  const out = makeCanvas(cw * scale, ch * scale)
  const og = ctx2d(out)
  og.imageSmoothingEnabled = true
  og.imageSmoothingQuality = 'high'
  og.drawImage(canvas, left, top, cw, ch, 0, 0, out.width, out.height)

  return {
    dataUrl: out.toDataURL('image/png'),
    width: out.width,
    height: out.height,
    aspect: out.width / out.height,
  }
}

/**
 * Turns a photo or scan of a signature into transparent ink.
 *
 * Pixels are scored by how bright they are; anything above `threshold` fades
 * out completely, and the band just below it fades progressively so edges stay
 * anti-aliased instead of turning into a jagged cut-out. Remaining ink is
 * pushed toward `inkColor` so faint pencil still reads as a real signature.
 */
export async function removeBackground(
  src: string,
  threshold = 0.72,
  inkColor?: string,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(src)
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale)
  const g = ctx2d(canvas)
  g.drawImage(img, 0, 0, canvas.width, canvas.height)

  const image = g.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  const ink = inkColor ? hexToRgb(inkColor) : null
  // Everything above `hi` is background; below `lo` is solid ink.
  const hi = threshold
  const lo = Math.max(0, threshold - 0.28)

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    let alpha: number
    if (lum >= hi) alpha = 0
    else if (lum <= lo) alpha = 1
    else alpha = (hi - lum) / (hi - lo)

    d[i + 3] = Math.round(d[i + 3] * alpha)
    if (ink && alpha > 0) {
      d[i] = ink.r
      d[i + 1] = ink.g
      d[i + 2] = ink.b
    }
  }

  g.putImageData(image, 0, 0)
  return canvas
}

/** Loads an image into a canvas untouched (used when the source already has alpha). */
export async function toCanvas(src: string, maxEdge = 1600): Promise<HTMLCanvasElement> {
  const img = await loadImage(src)
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale)
  ctx2d(canvas).drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** True when more than a sliver of the image is already transparent. */
export async function hasAlpha(src: string): Promise<boolean> {
  const canvas = await toCanvas(src, 320)
  const { data } = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
  let transparent = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++
  return transparent / (data.length / 4) > 0.02
}

/** Renders typed text in a handwriting face to a transparent canvas. */
export function renderTypedSignature(
  text: string,
  fontFamily: string,
  color: string,
  fontSize = 220,
): HTMLCanvasElement {
  const measureCanvas = makeCanvas(10, 10)
  const mg = ctx2d(measureCanvas)
  mg.font = `${fontSize}px "${fontFamily}", cursive`
  const metrics = mg.measureText(text || ' ')

  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.35
  const pad = fontSize * 0.3
  const width = Math.ceil(metrics.width + pad * 2)
  const height = Math.ceil(ascent + descent + pad * 2)

  const canvas = makeCanvas(width, height)
  const g = ctx2d(canvas)
  g.font = `${fontSize}px "${fontFamily}", cursive`
  g.fillStyle = color
  g.textBaseline = 'alphabetic'
  g.fillText(text, pad, pad + ascent)
  return canvas
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  }
}

export { makeCanvas, ctx2d }
