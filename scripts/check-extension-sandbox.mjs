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
import { chromium } from 'playwright-core';

const PORT = 4399;
const KEY = 'SECRET-KEY-DO-NOT-LEAK';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
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

await page.evaluate(() => {
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
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = `<!doctype html><html><head><script>${boot}${`</${'script'}>`}</head><body></body></html>`;
  document.body.appendChild(f);
});

// ── The UI page's loader, which assembles the same graph differently ─────────
//
// The background half is handed its modules over postMessage. A ui-file page
// gets them baked into its srcdoc as a JSON block, because the host builds that
// document anyway — so the escaping and the loader are separate code, and a
// separate thing to get wrong. Three modules here, not two, so a graph deeper
// than one hop is actually exercised.
await page.evaluate(() => {
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
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = `<!doctype html><html><body>`
    + `<script type="application/json" id="authno-modules">${json}${close}`
    + `<script>${loader}${close}`
    + `</body></html>`;
  document.body.appendChild(f);
});

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
