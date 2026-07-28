// Renders the Inkwell app icon to assets/icon.png at 1024x1024.
// Follows the macOS Big Sur icon grid: an 824x824 squircle centred in a
// 1024x1024 canvas, so `tauri icon` can slice it without further masking.
import { Resvg } from '@resvg/resvg-js'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5B5BF0"/>
      <stop offset="52%" stop-color="#4338CA"/>
      <stop offset="100%" stop-color="#2A1E7A"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#EEF0FB"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1B1F3B"/>
      <stop offset="100%" stop-color="#3B3F73"/>
    </linearGradient>
    <filter id="cardShadow" x="-30%" y="-30%" width="170%" height="170%">
      <feDropShadow dx="0" dy="26" stdDeviation="30" flood-color="#0B0A2B" flood-opacity="0.42"/>
    </filter>
  </defs>

  <!-- squircle body -->
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#body)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sheen)"/>

  <!-- page -->
  <g transform="rotate(-5 512 512)" filter="url(#cardShadow)">
    <path d="M296 258 h330 l112 112 v396 a34 34 0 0 1 -34 34 H296 a34 34 0 0 1 -34 -34 V292 a34 34 0 0 1 34 -34 z" fill="url(#paper)"/>
    <path d="M626 258 l112 112 h-86 a26 26 0 0 1 -26 -26 z" fill="#C3C8E8"/>
    <g fill="#C9CEE8">
      <rect x="330" y="392" width="220" height="19" rx="9.5"/>
      <rect x="330" y="452" width="290" height="19" rx="9.5"/>
      <rect x="330" y="512" width="180" height="19" rx="9.5"/>
    </g>
    <!-- signature baseline -->
    <rect x="330" y="716" width="340" height="10" rx="5" fill="#D5D9EE"/>
    <!-- handwritten stroke -->
    <path d="M330 690 C 366 612, 398 726, 434 652 C 466 588, 486 716, 522 646 C 556 582, 586 712, 628 636 C 654 590, 676 646, 706 616"
          fill="none" stroke="url(#ink)" stroke-width="27" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M604 700 C 646 676, 690 668, 726 676" fill="none" stroke="url(#ink)" stroke-width="15" stroke-linecap="round" opacity="0.85"/>
  </g>
</svg>`

const render = (markup, size) =>
  new Resvg(markup, { fitTo: { mode: 'width', value: size } }).render().asPng()

await mkdir(path.join(root, 'assets'), { recursive: true })
await writeFile(path.join(root, 'assets', 'icon.png'), render(svg, 1024))
console.log('wrote assets/icon.png (1024x1024)')

// The webview build also needs the app copy React imports.
await mkdir(path.join(root, 'src', 'assets'), { recursive: true })
await writeFile(path.join(root, 'src', 'assets', 'icon.png'), render(svg, 512))

// PWA icons. The maskable variant bleeds the background to the edges so
// Android/Chrome can crop it to any shape without clipping the artwork.
const maskable = svg
  .replace(/<rect x="100" y="100" width="824" height="824" rx="185"/g, '<rect x="0" y="0" width="1024" height="1024" rx="0"')
  .replace('transform="rotate(-5 512 512)"', 'transform="rotate(-5 512 512) scale(0.82) translate(112 112)"')

const icons = path.join(root, 'public', 'icons')
await mkdir(icons, { recursive: true })
await writeFile(path.join(icons, 'icon-192.png'), render(svg, 192))
await writeFile(path.join(icons, 'icon-512.png'), render(svg, 512))
await writeFile(path.join(icons, 'icon-maskable-512.png'), render(maskable, 512))
await writeFile(path.join(icons, 'apple-touch-icon.png'), render(svg, 180))
console.log('wrote public/icons/* and src/assets/icon.png')
