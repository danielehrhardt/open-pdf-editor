/**
 * Shared text metrics for the on-screen overlay and the exported PDF.
 *
 * The overlay renders real DOM text and the export writes real PDF text, so the
 * two must agree on where the baseline sits. Both go through the helpers here,
 * which read the *browser's* metrics for the same font — the same numbers CSS
 * uses for half-leading — so what you drag is what lands in the file.
 */
import { StandardFonts } from 'pdf-lib'
import type { FontKey } from '../types'

export const LINE_HEIGHT_RATIO = 1.3

export interface FontDef {
  label: string
  /** CSS font-family list; macOS ships the real base-14 faces. */
  family: string
  weight: number
  standard: StandardFonts
}

export const FONTS: Record<FontKey, FontDef> = {
  helvetica: {
    label: 'Helvetica',
    family: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
    weight: 400,
    standard: StandardFonts.Helvetica,
  },
  'helvetica-bold': {
    label: 'Helvetica Bold',
    family: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
    weight: 700,
    standard: StandardFonts.HelveticaBold,
  },
  times: {
    label: 'Times',
    family: 'Times, "Times New Roman", serif',
    weight: 400,
    standard: StandardFonts.TimesRoman,
  },
  'times-bold': {
    label: 'Times Bold',
    family: 'Times, "Times New Roman", serif',
    weight: 700,
    standard: StandardFonts.TimesRomanBold,
  },
  courier: {
    label: 'Courier',
    family: 'Courier, "Courier New", monospace',
    weight: 400,
    standard: StandardFonts.Courier,
  },
}

export const FONT_KEYS = Object.keys(FONTS) as FontKey[]

export const cssFont = (key: FontKey, size: number): string =>
  `${FONTS[key].weight} ${size}px ${FONTS[key].family}`

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    measureCtx = ctx
  }
  return measureCtx
}

export const lineHeightFor = (fontSize: number) => fontSize * LINE_HEIGHT_RATIO

/**
 * Distance from the top of a line box to the text baseline, matching the CSS
 * half-leading rule: `(lineHeight - (ascent + descent)) / 2 + ascent`.
 */
export function baselineOffset(key: FontKey, fontSize: number): number {
  const ctx = getMeasureCtx()
  ctx.font = cssFont(key, fontSize)
  const m = ctx.measureText('HÁgjpq')
  const ascent = m.fontBoundingBoxAscent ?? fontSize * 0.9
  const descent = m.fontBoundingBoxDescent ?? fontSize * 0.25
  return (lineHeightFor(fontSize) - (ascent + descent)) / 2 + ascent
}

export function measureWidth(key: FontKey, fontSize: number, text: string): number {
  const ctx = getMeasureCtx()
  ctx.font = cssFont(key, fontSize)
  return ctx.measureText(text).width
}

export const splitLines = (text: string): string[] => text.split('\n')

/** Natural size of a text element's box in view space. */
export function measureBlock(
  key: FontKey,
  fontSize: number,
  text: string,
  letterSpacing = 0,
): { w: number; h: number } {
  const lines = splitLines(text.length ? text : ' ')
  const widest = Math.max(
    ...lines.map((l) => measureWidth(key, fontSize, l) + Math.max(0, l.length - 1) * letterSpacing),
  )
  return {
    w: Math.max(widest, fontSize * 0.6),
    h: lines.length * lineHeightFor(fontSize),
  }
}

/**
 * Characters outside WinAnsi that have a reasonable stand-in. Anything still
 * unsupported after this pass is replaced with '?' and reported to the user
 * rather than silently corrupting the document.
 */
const SUBSTITUTIONS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"',
  '–': '-', '—': '-', '―': '-', '−': '-', ' ': ' ',
  '…': '...', '•': '-', '→': '->', '←': '<-',
  '≤': '<=', '≥': '>=', '×': 'x', '⁄': '/',
  '​': '', '‌': '', '‍': '', '﻿': '',
  '\t': '    ',
}

export interface SanitizeResult {
  text: string
  dropped: number
}

/** Coerces text into something a base-14 font can actually encode. */
export function sanitizeForFont(text: string, supported: Set<number>): SanitizeResult {
  let dropped = 0
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const sub = SUBSTITUTIONS[ch]
    const candidate = sub !== undefined ? sub : ch
    for (const c of candidate) {
      const cp = c.codePointAt(0)!
      if (supported.has(cp)) {
        out += c
      } else {
        dropped++
        out += '?'
      }
    }
  }
  return { text: out, dropped }
}

/** e.g. "28.07.2026" — matches the user's locale, which is what forms expect. */
export function formatToday(style: 'locale' | 'iso' | 'long' = 'locale'): string {
  const now = new Date()
  if (style === 'iso') return now.toISOString().slice(0, 10)
  if (style === 'long') {
    return now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  }
  return now.toLocaleDateString()
}
