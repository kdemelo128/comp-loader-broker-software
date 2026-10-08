# Bundled third-party files

Everything the app needs ships with it, so the page makes no outbound request
and works with no connection. Each library carries its version in its file
name: the service worker serves these files cache-first, and a new version
under a new name is the only way an installed copy can be sure to pick it up.

| Path | Package | Version | Licence |
|---|---|---|---|
| `vendor/pdf-4.7.76-legacy.min.js`, `vendor/pdf-4.7.76-legacy.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`, `legacy/build`) | 4.7.76 | Apache-2.0 |
| `vendor/exceljs-4.4.0.min.js` | [ExcelJS](https://github.com/exceljs/exceljs) (`dist/exceljs.min.js`) | 4.4.0 | MIT |
| `vendor/fflate-0.8.3.min.js` | [fflate](https://github.com/101arrowz/fflate) (`umd/index.js`) | 0.8.3 | MIT |
| `fonts/public-sans-*.woff2` | [Public Sans](https://public-sans.digital.gov/) via `@fontsource/public-sans` | 5.1.0 | OFL-1.1 |

## Why the legacy build of pdf.js

The standard build of pdf.js 4.7 calls `Promise.withResolvers`, which Safari
added in 17.4; on an older iPhone every PDF fails to open. The legacy build
polyfills it. Its oldest remaining requirement is one class static block in
`pdf.min.js`, which Safari has supported since 16.4 (iOS 16.4, March 2023). Both
were measured by parsing the files rather than taken from documentation.

## Edits to the published files

- The two pdf.js files are renamed from `.mjs` to `.js` so every static host
  serves them with a JavaScript content type. They are still ES modules.
- `pdf-4.7.76-legacy.worker.min.js` had 30 raw control bytes (ESC and similar)
  inside string literals in its font code. They are written as `\xHH` escapes,
  which mean the same thing; some hosts refuse files containing raw control
  characters. A tokenizer comparison of the original and edited files finds all
  426,344 tokens identical in value.
- The trailing `//# sourceMappingURL=` comment is removed from
  `exceljs-4.4.0.min.js`, because the map file it names is not shipped.

## Updating a library

1. `npm pack <package>@<version>` and take the file named in the table.
2. Save it under `vendor/` with the new version in its name, and delete the old one.
3. Update the name in `app/kit.js`, in the `ASSETS` list in `sw.js`, and here.
4. Bump `CACHE` in `sw.js`. `npm test` fails if the list and the files disagree.

## Used only by the tests

`npm ci` installs these for `npm test`; none of them ships with the site.

| Package | Version | Why |
|---|---|---|
| `exceljs` | 4.4.0 | builds workbooks in the workbook tests, and the templates the template tests fill |
| `fflate` | 0.8.3 | reads and writes the .xlsx packages in the tests |
| `@xmldom/xmldom` | 0.9.12 | stands in for the browser's DOMParser when the template tests run in Node |
