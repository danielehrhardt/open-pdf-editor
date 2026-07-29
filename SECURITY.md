# Security Policy

## Reporting a vulnerability

Please report security issues privately, not as a public issue.

- **Preferred:** [open a private advisory][advisory] on this repository
  (Security → Report a vulnerability).
- **Or email:** daniel.ehrhardt@codext.de

Please include what you did, what happened, and what you expected, plus the
affected version — the tag or commit, and whether you hit it in the browser at
[pdfeditor.codext.de](https://pdfeditor.codext.de/) or in the macOS app. If a
particular PDF triggers it, attaching that file is the single most useful thing
you can do; say so if it must not be redistributed.

You can expect an acknowledgement within a few days. I'll tell you whether it's
confirmed, what the fix looks like, and when it ships. Please give me a
reasonable window to release a fix before disclosing publicly. Credit is yours
unless you'd rather stay anonymous.

## Supported versions

Fixes land on `main` and go out in the next release. Only the latest release is
supported — there are no maintenance branches for older versions.

## What is in scope

Inkwell parses untrusted PDFs, which is the interesting attack surface. Reports
that would be treated as vulnerabilities:

- A crafted PDF that achieves code execution, escapes the renderer, or reads
  files outside what the user opened.
- Anything that causes document content, signature images, or file paths to
  leave the device. The app is designed to make no network requests after load;
  a way to make one is a bug in itself.
- A bypass of the Content-Security-Policy in [`public/_headers`](public/_headers)
  or in `src-tauri/tauri.conf.json`.
- Signature data or IndexedDB contents readable across origins.
- In the macOS app: a path traversal or arbitrary write via the file dialogs,
  the `.pdf` file association, or the Rust commands in `src-tauri/`.

## What is not

These are documented behaviours rather than vulnerabilities:

- **Inkwell's signatures are not cryptographic.** The app places a picture of
  your signature. It does not produce a digital certificate signature, and it
  does not verify or preserve existing ones. Anyone can edit a stamped PDF.
  This is a product boundary, not a defect.
- **Data at rest is not encrypted.** Signatures live in IndexedDB in the clear,
  which means anyone with access to your browser profile or user account can read
  them. Clearing site data deletes them. Use the OS (FileVault, an account
  password) if you need protection at that level.
- **Flattening is not redaction.** Locked fields become page content, but
  anything already in the file stays in the file.
- Findings that need an attacker to already have local access to an unlocked
  machine or the browser profile.
- Vulnerabilities in pdf.js or pdf-lib themselves — please report those upstream
  to [pdf.js][pdfjs] or [pdf-lib][pdflib]. Do tell me if Inkwell pins a version
  that is known-vulnerable, so the dependency can be bumped.

[advisory]: https://github.com/danielehrhardt/open-pdf-editor/security/advisories/new
[pdfjs]: https://github.com/mozilla/pdf.js/security
[pdflib]: https://github.com/Hopding/pdf-lib/issues
