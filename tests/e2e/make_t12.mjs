/* The invented T-12 layouts (tests/t12-layouts.js) written as files for the browser flows. */
import fs from 'fs';
import { createRequire } from 'module';
import { LAYOUTS, layoutFile } from '../t12-layouts.js';
const ExcelJS = createRequire(import.meta.url)('exceljs');
const dir = process.argv[2] || new URL('./files/', import.meta.url).pathname;
for (const L of LAYOUTS) {
  const f = await layoutFile(L, ExcelJS);
  fs.writeFileSync(`${dir}/${L.file}`, f);
}
console.log(LAYOUTS.map((L) => L.file).join(' '));
