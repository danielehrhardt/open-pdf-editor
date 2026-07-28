// Copies pdf.js runtime assets (cmaps + standard fonts) into public/ so that
// PDFs using CJK encodings or relying on the base-14 fonts render correctly
// inside the offline Tauri webview.
import { cp, mkdir, rm, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'node_modules', 'pdfjs-dist')
const to = path.join(root, 'public', 'pdfjs')

const exists = async (p) => access(p).then(() => true, () => false)

if (!(await exists(from))) {
  console.error('pdfjs-dist is not installed yet — skipping asset sync')
  process.exit(0)
}

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })

// cmaps: CJK encodings. standard_fonts: the base-14 substitutes.
// wasm: JPX/JBIG2 image decoders. iccs: colour profiles.
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = path.join(from, dir)
  if (await exists(src)) {
    await cp(src, path.join(to, dir), { recursive: true })
  }
}

console.log('pdf.js assets synced to public/pdfjs')
