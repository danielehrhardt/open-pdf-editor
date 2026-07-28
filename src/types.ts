/** Rotation applied to a page for display, as reported by pdf.js. */
export type Rotation = 0 | 90 | 180 | 270

/** Geometry we need to map between screen space and PDF user space. */
export interface PageGeometry {
  /** 1-based page number. */
  pageNumber: number
  /** pdf.js view box in PDF user units: [x0, y0, x1, y1]. */
  view: [number, number, number, number]
  rotation: Rotation
  /** Unscaled display size in CSS px (equals PDF points at zoom 1). */
  viewWidth: number
  viewHeight: number
}

export type ElementKind = 'signature' | 'text' | 'image'

export type FontKey = 'helvetica' | 'helvetica-bold' | 'times' | 'times-bold' | 'courier'

export interface BaseElement {
  id: string
  kind: ElementKind
  /** 0-based page index. */
  page: number
  /**
   * Position and size in *unscaled view space* (CSS px at zoom 1, origin at the
   * page's top-left as displayed). Zoom-independent by construction.
   */
  x: number
  y: number
  w: number
  h: number
}

export interface ImageElement extends BaseElement {
  kind: 'signature' | 'image'
  /** PNG data URL. */
  src: string
  /** Intrinsic aspect ratio (w/h) used to keep resizing proportional. */
  aspect: number
  /** Library entry this came from, when applicable. */
  sourceId?: string
  opacity: number
}

export interface TextElement extends BaseElement {
  kind: 'text'
  text: string
  /** Font size in PDF points. */
  fontSize: number
  font: FontKey
  /** #rrggbb */
  color: string
  /** Rendered as a monospace-ish glyph run for form boxes. */
  letterSpacing: number
}

export type PdfElement = ImageElement | TextElement

export type SignatureSource = 'draw' | 'type' | 'image'

export interface SignatureEntry {
  id: string
  label: string
  /** Trimmed PNG data URL with transparent background. */
  src: string
  aspect: number
  source: SignatureSource
  createdAt: number
  /** Marks the entry used by the one-click "Sign" action. */
  favorite?: boolean
  kind: 'signature' | 'initials'
}

export interface FormFieldInfo {
  /** Fully-qualified AcroForm field name. */
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist'
  page: number
  /** Rect in unscaled view space. */
  x: number
  y: number
  w: number
  h: number
  readOnly: boolean
  multiline: boolean
  maxLen?: number
  options?: string[]
  /** For radio groups / checkboxes: the "on" state name for this widget. */
  exportValue?: string
  initial: string | string[] | boolean
}

export type ToolId = 'select' | 'signature' | 'text' | 'date' | 'check' | 'image'

export interface ToastItem {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}
