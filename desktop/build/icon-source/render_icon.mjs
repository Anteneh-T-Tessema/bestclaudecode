// Regenerates icon_1024.png from icon.svg — the source for desktop/build/icon.icns
// and icon.iconset/* (built via `iconutil`/electron-builder, not by this script).
// Run with: node desktop/build/icon-source/render_icon.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(__dirname, 'icon.svg'), 'utf-8');
const outPath = path.join(__dirname, 'icon_1024.png');

const html = `<!DOCTYPE html>
<html><head><style>
* { margin:0; padding:0; }
body { width:1024px; height:1024px; background:#0D1117; overflow:hidden; }
</style></head>
<body>${svg}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1024, height: 1024 });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);
const buf = await page.screenshot({ type: 'png', clip: { x:0, y:0, width:1024, height:1024 } });
writeFileSync(outPath, buf);
await browser.close();
console.log(`Wrote ${outPath}`);
