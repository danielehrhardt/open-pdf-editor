/** Generates the small mark stamps (check, cross, dot) as transparent PNGs so
 *  they travel through the same embed path as signatures — no font coverage
 *  worries, no vector edge cases. */
import { ctx2d, makeCanvas } from './image'

export interface Stamp {
  src: string
  aspect: number
}

const SIZE = 256

function stroke(g: CanvasRenderingContext2D, color: string, width: number) {
  g.strokeStyle = color
  g.lineWidth = width
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.stroke()
}

export function checkStamp(color = '#16181f'): Stamp {
  const canvas = makeCanvas(SIZE, SIZE * 0.82)
  const g = ctx2d(canvas)
  const w = canvas.width
  const h = canvas.height
  g.beginPath()
  g.moveTo(w * 0.1, h * 0.52)
  g.lineTo(w * 0.38, h * 0.82)
  g.lineTo(w * 0.92, h * 0.14)
  stroke(g, color, w * 0.13)
  return { src: canvas.toDataURL('image/png'), aspect: w / h }
}

export function crossStamp(color = '#16181f'): Stamp {
  const canvas = makeCanvas(SIZE, SIZE)
  const g = ctx2d(canvas)
  const w = canvas.width
  const pad = w * 0.14
  g.beginPath()
  g.moveTo(pad, pad)
  g.lineTo(w - pad, w - pad)
  g.moveTo(w - pad, pad)
  g.lineTo(pad, w - pad)
  stroke(g, color, w * 0.13)
  return { src: canvas.toDataURL('image/png'), aspect: 1 }
}

export function dotStamp(color = '#16181f'): Stamp {
  const canvas = makeCanvas(SIZE, SIZE)
  const g = ctx2d(canvas)
  g.beginPath()
  g.arc(SIZE / 2, SIZE / 2, SIZE * 0.3, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  return { src: canvas.toDataURL('image/png'), aspect: 1 }
}
