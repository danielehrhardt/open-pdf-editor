<!-- Thanks for contributing to Inkwell. Keep this short — a couple of lines is fine. -->

## What this changes

<!-- And why. If it fixes an issue, write "Fixes #123" so GitHub closes it on merge. -->

## How you checked it

<!-- Tick what applies. -->

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (geometry, export, forms)
- [ ] Tried it in the browser (`npm run dev`)
- [ ] Tried it in the macOS app (`npm run app:dev`)

<!--
If you touched src/lib/geometry.ts, src/lib/export.ts or anything that decides
where an element lands on the page, please say which of the verifiers cover the
change — and add an assertion if none of them do. That file is load-bearing:
what you see on screen has to equal what gets written into the PDF.

If the change affects placement or rendering visibly, a before/after screenshot
saves everyone a round trip.
-->
