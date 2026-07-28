/** Generates samples/Sample Agreement.pdf — a small fillable form with a
 *  signature line, handy for trying Inkwell end to end. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const INK = rgb(0.09, 0.1, 0.13)
const MUTED = rgb(0.45, 0.47, 0.53)
const RULE = rgb(0.82, 0.83, 0.87)

const doc = await PDFDocument.create()
doc.setTitle('Sample Agreement')
doc.setSubject('A fillable form for trying out Inkwell')

const helv = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const form = doc.getForm()

const page = doc.addPage([595.28, 841.89])
const { width, height } = page.getSize()
const left = 64
const right = width - 64

let y = height - 92

page.drawText('Service Agreement', { x: left, y, size: 24, font: bold, color: INK })
y -= 22
page.drawText('Please complete every field, then sign and date at the bottom.', {
  x: left,
  y,
  size: 10.5,
  font: helv,
  color: MUTED,
})

y -= 26
page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: RULE })

/** Draws a caption and returns the rect a widget should occupy under it. */
function labelled(caption, boxWidth, boxHeight = 24) {
  y -= 34
  page.drawText(caption, { x: left, y, size: 9.5, font: bold, color: MUTED })
  y -= boxHeight + 4
  return { x: left, y, width: boxWidth, height: boxHeight }
}

for (const [caption, field, boxWidth] of [
  ['FULL NAME', 'client.name', 300],
  ['EMAIL ADDRESS', 'client.email', 300],
  ['COMPANY', 'client.company', 300],
  ['PROJECT REFERENCE', 'client.reference', 180],
]) {
  const rect = labelled(caption, boxWidth)
  const input = form.createTextField(field)
  input.addToPage(page, { ...rect, borderWidth: 0, backgroundColor: rgb(0.965, 0.968, 0.98) })
}

const countryRect = labelled('COUNTRY', 200)
const country = form.createDropdown('client.country')
country.setOptions(['Germany', 'Austria', 'Switzerland', 'Netherlands', 'Other'])
country.addToPage(page, {
  ...countryRect,
  borderWidth: 0,
  backgroundColor: rgb(0.965, 0.968, 0.98),
})

y -= 40
page.drawText('TERMS', { x: left, y, size: 9.5, font: bold, color: MUTED })
y -= 18

const terms = [
  'The scope of work is as described in the attached statement of work.',
  'Invoices are payable within 14 days of receipt.',
  'Either party may terminate with 30 days written notice.',
]
for (const line of terms) {
  page.drawText(`•  ${line}`, { x: left, y, size: 10.5, font: helv, color: INK })
  y -= 17
}

y -= 16
const agree = form.createCheckBox('client.agreesToTerms')
agree.addToPage(page, {
  x: left,
  y: y - 2,
  width: 14,
  height: 14,
  borderWidth: 1,
  borderColor: rgb(0.6, 0.62, 0.7),
})
page.drawText('I have read and accept the terms above.', {
  x: left + 22,
  y,
  size: 10.5,
  font: helv,
  color: INK,
})

y -= 26
const newsletter = form.createCheckBox('client.newsletter')
newsletter.addToPage(page, {
  x: left,
  y: y - 2,
  width: 14,
  height: 14,
  borderWidth: 1,
  borderColor: rgb(0.6, 0.62, 0.7),
})
page.drawText('Send me occasional product updates.', {
  x: left + 22,
  y,
  size: 10.5,
  font: helv,
  color: INK,
})

// Signature block: deliberately *not* a form field, so it exercises placing a
// signature image and stamping a date.
const blockY = 132
page.drawLine({
  start: { x: left, y: blockY + 66 },
  end: { x: right, y: blockY + 66 },
  thickness: 1,
  color: RULE,
})

page.drawLine({
  start: { x: left, y: blockY },
  end: { x: left + 240, y: blockY },
  thickness: 1,
  color: rgb(0.35, 0.37, 0.45),
})
page.drawText('Signature', { x: left, y: blockY - 14, size: 9, font: helv, color: MUTED })

page.drawLine({
  start: { x: right - 160, y: blockY },
  end: { x: right, y: blockY },
  thickness: 1,
  color: rgb(0.35, 0.37, 0.45),
})
page.drawText('Date', { x: right - 160, y: blockY - 14, size: 9, font: helv, color: MUTED })

page.drawText('Page 1 of 1  ·  Sample document generated for Inkwell', {
  x: left,
  y: 52,
  size: 8.5,
  font: helv,
  color: MUTED,
})

const bytes = await doc.save()
const out = path.join(process.cwd(), 'samples')
await mkdir(out, { recursive: true })
const file = path.join(out, 'Sample Agreement.pdf')
await writeFile(file, bytes)
console.log(`wrote ${path.relative(process.cwd(), file)} (${(bytes.length / 1024).toFixed(1)} kB)`)
