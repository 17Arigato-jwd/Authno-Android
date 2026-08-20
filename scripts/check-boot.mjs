#!/usr/bin/env node
/**
 * Boot the real built app in a real browser and watch for anything uncaught.
 *
 * The existing browser checks drive synthetic harnesses — the sandbox, the
 * protocol, the load stress. None of them loads `build/` itself, which is
 * where an integration break lands: a bad import, a component that throws on
 * first paint, a promise nobody catches.
 *
 * CLAUDE.md names the specific one to watch for: `"WidgetData" plugin is not
 * implemented on web` is expected off-device, but only as a CAUGHT error. If
 * it shows up as an uncaught page error or an unhandled rejection, that is the
 * thenable bug back — Capacitor's plugin object is a Proxy that answers `then`
 * with a callable, so handing it to promise resolution makes `await` hang
 * forever instead of throwing.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const PORT = 4417;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

function serve() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(BUILD, url === '/' ? 'index.html' : url);
    // SPA fallback, same as any static host would do.
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(BUILD, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
    console.error('No build/ — run `npm run build` first.');
    process.exit(2);
  }

  const server = serve();
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();

  const pageErrors = [];
  const rejections = [];
  const consoleErrors = [];

  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // `pageerror` does not fire for unhandled rejections in every Chromium
  // build, so listen for them directly too.
  await page.addInitScript(() => {
    window.__rejections = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__rejections.push(String(e.reason?.message ?? e.reason));
    });
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  // Long enough for the deferred work — plugin probes, seeding, discovery.
  await wait(4000);

  rejections.push(...(await page.evaluate(() => window.__rejections ?? [])));

  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 400);
  const painted = await page.evaluate(() => document.body.children.length > 0);

  await browser.close();
  server.close();

  console.log(`title: ${JSON.stringify(title)}`);
  console.log(`painted: ${painted}`);
  console.log(`first text: ${JSON.stringify(bodyText.slice(0, 200))}`);
  console.log();

  const show = (name, list) => {
    console.log(`${name}: ${list.length}`);
    for (const l of [...new Set(list)]) console.log(`   · ${l}`);
  };
  show('uncaught page errors', pageErrors);
  show('unhandled rejections', rejections);
  show('console.error', consoleErrors);

  const fatal = [...pageErrors, ...rejections];
  if (!painted) { console.error('\nFAIL: nothing painted'); process.exit(1); }
  if (fatal.length) { console.error('\nFAIL: something went uncaught'); process.exit(1); }
  console.log('\nOK: booted clean');
}

main().catch((e) => { console.error(e); process.exit(1); });
