/**
 * The extension sandbox, checked in a real browser.
 *
 *   node scripts/check-extension-sandbox.mjs
 *
 * Two claims hold the whole boundary up, and neither is checkable from jsdom —
 * it has no origin model and no module loader, so a unit test asserting either
 * would be asserting the mock:
 *
 *   1. A `sandbox="allow-scripts"` frame cannot reach its parent. If this is
 *      wrong, an extension reads the access key out of localStorage and the
 *      postMessage bridge is decoration. It was wrong until this commit — the
 *      frame carried `allow-same-origin` too, and that pair is not a weaker
 *      sandbox but none at all.
 *
 *   2. That same frame can still build and dynamically import its own blob:
 *      module graph. If this is wrong, no extension loads anywhere, because
 *      blob URLs are how extension files reach a frame that has no server
 *      behind it — which is also what makes extensions work off Android.
 *
 * The probe builds the graphs the way the app builds them and checks each entry
 * actually imported its dependencies rather than merely running. Both
 * assemblies are covered: the background half receives its modules over
 * postMessage, the ui-file half reads them out of a JSON block baked into its
 * own document, and those are two separate pieces of code to get wrong.
 *
 * CHROMIUM_PATH overrides the browser; this repo's image keeps one at
 * /opt/pw-browsers/chromium.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The sandbox attribute the app ships, read out of the source.
 *
 * This script used to write `allow-scripts` into its own frames and check
 * that. It passed for a year while `ExtensionPage.jsx` — the component that
 * renders every extension UI page anybody actually opens — carried
 * `allow-scripts allow-same-origin allow-forms allow-modals`, which on a
 * srcdoc document is no boundary at all. A check that supplies the answer it
 * expects is checking its own fixture.
 *
 * Parsed rather than imported because src/ is JSX behind a bundler and this is
 * a bare node script. Both frames now read one exported constant, so there is
 * exactly one string to find.
 */
function shippedSandboxAttribute() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'sandboxProtocol.js'), 'utf8');
  const m = src.match(/export const FRAME_SANDBOX = '([^']*)'/);
  if (!m) throw new Error('sandboxProtocol.js no longer exports FRAME_SANDBOX — this check cannot verify what ships.');
  return m[1];
}

const SANDBOX = shippedSandboxAttribute();

/**
 * And that both frames use it — stated precisely, because the blunt version is
 * wrong.
 *
 * `allow-same-origin` is not always a bug. ExtensionPage's *remote* page type
 * loads a real https origin, and there the flag means the extension author's
 * own origin — cross-origin to the app, and what any ordinary page needs in
 * order to have storage. What must never carry it is a **srcdoc** frame:
 * srcdoc content has no origin of its own, so the flag hands it the
 * embedder's, and the embedder is AuthNo.
 *
 * So the rule is not "no literal attributes anywhere". It is: nothing that
 * sets srcdoc gets allow-same-origin, and the two frames that do set srcdoc
 * read one shared constant.
 *
 * Comments are stripped first. Both files explain what the attribute used to
 * be and why it changed, and that prose is why anybody will understand this in
 * a year — it must not read as a violation of the rule it documents.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

for (const rel of [
  ['src', 'utils', 'extensionSandbox.js'],
  ['src', 'components', 'ExtensionPage.jsx'],
]) {
  const lines = codeOnly(fs.readFileSync(path.join(ROOT, ...rel), 'utf8')).split('\n');

  lines.forEach((line, i) => {
    if (!/allow-same-origin/.test(line)) return;
    // Generously bounded: the same JSX element or DOM-building block.
    const near = lines.slice(Math.max(0, i - 12), i + 12).join('\n');
    if (/srcdoc/i.test(near)) {
      console.error(`  \u2716 ${rel.join('/')}:${i + 1} gives a srcdoc frame allow-same-origin:`);
      console.error(`      ${line.trim()}`);
      console.error("    srcdoc inherits the embedder's origin, which is the app's own.");
      process.exit(1);
    }
  });

  if (!/FRAME_SANDBOX/.test(lines.join('\n'))) {
    console.error(`  \u2716 ${rel.join('/')} does not reference FRAME_SANDBOX — its srcdoc frame is spelling its own attribute again.`);
    process.exit(1);
  }
}
console.log(`Checking the attribute the app ships: sandbox="${SANDBOX}"`);

const PORT = 4399;
const KEY = 'SECRET-KEY-DO-NOT-LEAK';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();

const seen = [];
page.on('console', (m) => seen.push(m.text()));

// A real http origin. about:blank has no localStorage of its own, so the host
// script would throw before it could listen and every check would pass for the
// wrong reason.
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.evaluate((key) => {
  localStorage.setItem('authno_access_key', key);
  window.__hostSecret = 'ALSO-SECRET';
  window.addEventListener('message', (e) => console.log(`MSG ${JSON.stringify(e.data)}`));
}, KEY);

await page.evaluate((SANDBOX) => {
  const boot = `
    (function () {
      var report = function (k, v) { parent.postMessage({ k: k, v: v }, '*'); };
      var probe = function (k, fn) {
        try { report(k, String(fn())); } catch (e) { report(k, 'THREW: ' + e.name); }
      };

      probe('parent.localStorage', function () { return parent.localStorage.getItem('authno_access_key'); });
      probe('parent.globals',      function () { return parent.__hostSecret; });
      probe('parent.document',     function () { return !!parent.document; });
      probe('own.localStorage',    function () { return !!localStorage; });
      report('origin', String(location.origin));

      try {
        var leaf  = URL.createObjectURL(new Blob(['export const two = 2;'], { type: 'text/javascript' }));
        // Blob's first argument is a sequence, not a string — joining the
        // lines and passing the result straight in throws TypeError.
        var entrySrc = [
          "import { two } from '" + leaf + "';",
          "export function activate(host) { return 'activated:' + (two + host.n); }"
        ].join('\\n');
        var entry = URL.createObjectURL(new Blob([entrySrc], { type: 'text/javascript' }));
        import(entry)
          .then(function (mod) { report('blob-import', mod.activate({ n: 40 })); })
          .catch(function (err) { report('blob-import', 'FAILED: ' + err.message); });
      } catch (e) { report('blob-import', 'THREW: ' + e.name + ' - ' + e.message); }
    })();
  `;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX);
  f.srcdoc = `<!doctype html><html><head><script>${boot}${`</${'script'}>`}</head><body></body></html>`;
  document.body.appendChild(f);
}, SANDBOX);

// ── The UI page's loader, which assembles the same graph differently ─────────
//
// The background half is handed its modules over postMessage. A ui-file page
// gets them baked into its srcdoc as a JSON block, because the host builds that
// document anyway — so the escaping and the loader are separate code, and a
// separate thing to get wrong. Three modules here, not two, so a graph deeper
// than one hop is actually exercised.
await page.evaluate((SANDBOX) => {
  const modules = [
    { path: 'lib/log.js', source: 'export const tag = () => "logged";' },
    { path: 'lib/queue.js', source: 'import { tag } from "__authno_mod_0__";\nexport const run = () => tag() + ":queued";' },
    { path: 'ui/main.js', source: 'import { run } from "__authno_mod_1__";\nparent.postMessage({ k: "ui-page", v: run() }, "*");' },
  ];
  const json = JSON.stringify(modules).replace(/</g, '\u003c');

  const loader = `
    (function () {
      var mods = JSON.parse(document.getElementById('authno-modules').textContent);
      var urls = [];
      try {
        for (var i = 0; i < mods.length; i++) {
          var src = mods[i].source;
          for (var j = 0; j < urls.length; j++) {
            src = src.split('__authno_mod_' + j + '__').join(urls[j]);
          }
          urls.push(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        }
        import(urls[urls.length - 1]).catch(function (err) {
          parent.postMessage({ k: 'ui-page', v: 'FAILED: ' + err.message }, '*');
        });
      } catch (err) {
        parent.postMessage({ k: 'ui-page', v: 'THREW: ' + err.message }, '*');
      }
    })();
  `;

  const close = `</${'script'}>`;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX);
  f.srcdoc = `<!doctype html><html><body>`
    + `<script type="application/json" id="authno-modules">${json}${close}`
    + `<script>${loader}${close}`
    + `</body></html>`;
  document.body.appendChild(f);
}, SANDBOX);

await page.waitForTimeout(2500);
await browser.close();
server.close();

const text = seen.join('\n');
const checks = [
  ['the frame cannot read the parent\'s localStorage', /"k":"parent.localStorage","v":"THREW/],
  ['the frame cannot read the parent\'s globals',      /"k":"parent.globals","v":"THREW/],
  ['the frame cannot reach the parent\'s DOM',         /"k":"parent.document","v":"THREW/],
  ['the frame has no storage of its own',              /"k":"own.localStorage","v":"THREW/],
  ['the frame\'s origin is opaque',                    /"k":"origin","v":"null"/],
  ['a blob module graph still imports and runs',       /"k":"blob-import","v":"activated:42"/],
  ['a ui page links a three-module graph',             /"k":"ui-page","v":"logged:queued"/],
  ['the access key never crossed the boundary',        new RegExp(`^(?!.*${KEY})`, 's')],
];

let ok = true;
for (const [label, re] of checks) {
  const pass = re.test(text);
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${label}`);
}

if (!ok) {
  console.error('\nSandbox check FAILED. Raw messages:\n' + (text || '(nothing was reported — the frame never ran)'));
  process.exit(1);
}
console.log('\n✔ extension sandbox holds.');
