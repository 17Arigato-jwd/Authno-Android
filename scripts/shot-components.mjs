#!/usr/bin/env node
/**
 * shot-components.mjs — draw a component, in a real browser, on its own.
 *
 * jsdom asserts structure and says nothing about appearance. A 48dp target
 * that is 48dp in the style object and collapsed to nothing by a flex parent
 * looks identical to jsdom and wrong to a person, and every component here is
 * chrome that sits over somebody's manuscript — the one place "wrong and
 * invisible in tests" costs the most.
 *
 * So the REAL component is server-rendered with react-dom/server, dropped into
 * a page, and photographed. These components style themselves with inline
 * styles and nothing else, so what the browser paints from that markup is what
 * it paints in the app.
 *
 * Not a pass/fail check — there is no correct pixel to compare against. It
 * writes PNGs for a person to look at, and fails only if a component throws
 * while rendering, which is worth catching on its own.
 *
 * Usage: node scripts/shot-components.mjs [outDir]
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? path.join(ROOT, 'component-shots');
const PORT = 4411;

/**
 * A require hook for JSX, in the twelve lines @babel/register would be.
 *
 * CRA owns the transform — babel-preset-react-app is already installed — so
 * this borrows the preset rather than describing one, and adding
 * @babel/register as a dependency for a screenshot script is not worth it.
 *
 * BABEL_ENV matters: the preset reads it, and without it the development
 * branch injects JSX source locations that reference files react-dom/server
 * has no reason to be able to find.
 */
process.env.BABEL_ENV = process.env.BABEL_ENV ?? 'production';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'production';

const babel = require('@babel/core');
const Module = require('node:module');
const compileJsx = (module_, filename) => {
  const { code } = babel.transformFileSync(filename, {
    presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]],
    babelrc: false,
    configFile: false,
    sourceMaps: 'inline',
  });
  module_._compile(code, filename);
};
Module._extensions['.jsx'] = compileJsx;
const compileJs = Module._extensions['.js'];
Module._extensions['.js'] = (module_, filename) => {
  // Only ours. node_modules ships CommonJS already and running it through
  // babel would be slow and, for anything using `import.meta`, wrong.
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return compileJs(module_, filename);
  return compileJsx(module_, filename);
};

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/**
 * Stand in for a module, before anything requires it.
 *
 * The Extensions tab reads the installed list, the grant store and the running
 * host — three things that only exist inside a live app. There is no jest here
 * to mock them, and a babel-compiled ES module's exports object is frozen, so
 * assigning over it throws "only has a getter".
 *
 * Seeding require.cache is the version that works: the component's own
 * `require` finds the entry and never loads the real file. It has to happen
 * before the component is required, which is why it is up here rather than
 * inside the scene that needs it.
 */
function stubModule(relPath, exports) {
  const abs = require.resolve(path.join(ROOT, relPath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

const FIXTURE_MANIFESTS = [
  {
    apiVersion: 2, id: 'cloud-backup', name: 'Cloud Backup', version: '2.0.0',
    _permissionsPending: true,
    permissions: {
      'library:read:all': { reason: 'To copy every book, not only the one you have open.' },
      network: {
        reason: 'To reach Google Drive, Dropbox, or a server you name.',
        hosts: ['https://www.googleapis.com', 'https://api.dropboxapi.com'],
        userHosts: { reason: 'To reach the WebDAV server you type in.', max: 2 },
      },
    },
  },
  {
    apiVersion: 2, id: 'word-sprint', name: 'Word Sprint', version: '1.0.0',
    permissions: {
      'library:read:current': { reason: 'To count the words in the book you have open.' },
      activity: { reason: 'To know when you have stopped typing.' },
    },
  },
];

stubModule('src/utils/ExtensionContext.js', {
  useExtensions: () => ({ extensions: FIXTURE_MANIFESTS }),
});
stubModule('src/utils/extensionGrants.js', {
  readGrants: (id) => (id === 'cloud-backup'
    ? { granted: ['network'], userHosts: ['https://dav.example.org'] }
    : { granted: ['activity'], userHosts: [] }),
  writeGrants: () => true,
  clearGrants: () => true,
});
stubModule('src/utils/extensionRuntime.js', {
  setGrants: async () => ({ restarted: true }),
  hostV2: (id) => (id === 'word-sprint'
    ? {
      missingPermissions: () => [
        { permission: 'library:read:current', prompt: 'Read the book you have open', count: 47, wasRequested: true },
      ],
    }
    : null),
});

const ExtensionDots = require(path.join(ROOT, 'src/components/ExtensionDots.jsx')).default;
const ExtensionPermissions = require(path.join(ROOT, 'src/components/ExtensionPermissions.jsx')).default;
const ExtensionPromptDialog = require(path.join(ROOT, 'src/components/ExtensionPromptDialog.jsx')).default;
const { prompts, __resetPrompts } = require(path.join(ROOT, 'src/utils/extensionPrompts.js'));
const PermissionRequestSheet = require(path.join(ROOT, 'src/components/PermissionRequestSheet.jsx')).default;
const ExtensionSettingsPage = require(path.join(ROOT, 'src/components/ExtensionSettingsPage.jsx')).default;
const { surfaces, __resetSurfaces } = require(path.join(ROOT, 'src/utils/extensionSurfaces.js'));
const { permissionRequests, __resetPermissionRequests } = require(path.join(ROOT, 'src/utils/permissionRequests.js'));

const plan = (items, carried = []) => ({
  ok: true, errors: [], carried, dropped: [],
  prompt: items.map(([permission, prompt, reason, hosts]) => ({ permission, prompt, reason, hosts })),
});

/** name → () => react element, with whatever state it needs already set up. */
const SCENES = {
  'dots-one'() {
    __resetSurfaces();
    surfaces().setOverlay('word-sprint', 'Sprint: 4:12 left');
    return React.createElement(ExtensionDots, {});
  },
  'dots-overflow'() {
    __resetSurfaces();
    for (const [id, line] of [
      ['cloud-backup', 'Backing up "The Salt Road"'],
      ['word-sprint', 'Sprint: 4:12 left'],
      ['spellcheck', 'Checking chapter 9'],
      ['thesaurus', 'Ready'],
      ['stats', 'Counting'],
    ]) surfaces().setOverlay(id, line);
    return React.createElement(ExtensionDots, {});
  },
  /** The host-grant question — the one that used to hang forever. */
  'prompt-host'() {
    __resetPrompts();
    prompts().hostConfirm('cloud-backup', {
      title: 'Connect to a new address?',
      message: 'Cloud Backup wants to connect to:',
      // Long on purpose. A self-hosted WebDAV address is routinely this shape,
      // and it is the string that decides whether the panel holds together.
      emphasis: 'https://dav.example.org/remote.php/dav/files/rowan/Manuscripts/AuthNo',
      note: 'Only allow this if you recognise the address.',
    }).catch(() => {});
    return React.createElement(ExtensionPromptDialog, { accentHex: '#5a00d9' });
  },

  /** A text question, with a field. */
  'prompt-text'() {
    __resetPrompts();
    prompts().prompt('cloud-backup', {
      title: 'Which folder?',
      message: 'Where copies of your books should go on the server.',
      placeholder: '/AuthNo',
      initial: '/AuthNo',
    }).catch(() => {});
    return React.createElement(ExtensionPromptDialog, { accentHex: '#5a00d9' });
  },

  /**
   * A settings page with one of everything, on a card the width of the tab it
   * lives in. Every control type at once is the layout worth photographing:
   * one at a time they all look fine, and the question is whether a label
   * column, a toggle, a select and a row of chips agree on their alignment.
   */
  'ext-settings'() {
    return React.createElement('div', {
      style: { padding: '16px 12px', maxWidth: 420 },
    }, React.createElement(ExtensionSettingsPage, {
      accentHex: '#5a00d9',
      running: true,
      manifest: {
        id: 'cloud-backup',
        name: 'Cloud Backup',
        settings: {
          schema: [
            { type: 'toggle', key: 'auto', label: 'Back up automatically', default: true,
              hint: 'After every chapter you finish.' },
            { type: 'text', key: 'folder', label: 'Folder on the server', default: '/AuthNo' },
            { type: 'number', key: 'every', label: 'Check every', suffix: 'minutes', min: 5, max: 240, default: 30 },
            { type: 'select', key: 'keep', label: 'Versions to keep', options: ['3', '10', 'all'], default: '10' },
            { type: 'multiselect', key: 'kinds', label: 'Include', options: ['Books', 'Notes', 'Themes'], default: ['Books'] },
            { type: 'readout', label: 'Status', source: 'backup.status' },
            { type: 'action', label: 'Back up now', command: 'backup.run' },
            {
              type: 'section',
              label: 'Advanced',
              collapsed: true,
              children: [
                { type: 'toggle', key: 'debug', label: 'Verbose log', default: false },
                { type: 'text', key: 'agent', label: 'User agent', default: '' },
              ],
            },
          ],
        },
      },
    }));
  },

  'permission-one'() {
    __resetPermissionRequests();
    permissionRequests().ask('word-sprint', plan([
      ['library:read:current', 'Read the book you have open', 'To count the words in the book you have open.'],
    ]), { name: 'Word Sprint', version: '1.0.0' });
    return React.createElement(PermissionRequestSheet, { accentHex: '#5a00d9' });
  },
  /**
   * The Extensions tab's permission section, with everything wrong at once:
   * one extension nobody was asked about, one being refused something it
   * keeps reaching for, and a runtime host to take back.
   */
  'permissions-tab'() {
    return React.createElement('div', { style: { padding: '16px 12px' } },
      React.createElement(ExtensionPermissions, { accentHex: '#5a00d9' }));
  },
  'permission-many'() {
    __resetPermissionRequests();
    permissionRequests().ask('cloud-backup', plan([
      ['library:read:all', 'Read all your books', 'To copy every book, not only the one you have open.'],
      ['library:write', 'Add and change books', 'To put a book back when you restore one.'],
      ['network', 'Connect to the internet', 'To reach Google Drive, Dropbox, or a server you name.',
        ['https://www.googleapis.com', 'https://api.dropboxapi.com', 'https://content.dropboxapi.com']],
      ['browser', 'Open pages in your browser', 'To sign you in to your provider.'],
    ], ['library:export']), { name: 'Cloud Backup', version: '2.0.0' });
    permissionRequests().ask('word-sprint', plan([
      ['activity', 'See when you are writing', 'To know when you have stopped typing.'],
    ]), { name: 'Word Sprint', version: '1.0.0' });
    return React.createElement(PermissionRequestSheet, { accentHex: '#5a00d9' });
  },
};

const rendered = {};
const failures = [];
for (const [name, build] of Object.entries(SCENES)) {
  try {
    rendered[name] = renderToStaticMarkup(build());
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

if (failures.length) {
  console.error('✖ a component threw while rendering:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

/**
 * The CSS variables a light theme actually sets.
 *
 * Taken from the shipped Sepia theme through the same themeVars() the app
 * calls, not transcribed — a hand-copied palette is exactly the kind of thing
 * that stays right while the real one moves.
 *
 * A component that themes its TEXT and hardcodes its PANEL looks correct in
 * the dark default and unreadable here: dark text on a dark panel, which no
 * dark-only screenshot can show.
 */
const { SEPIA } = require(path.join(ROOT, 'src/theme/ThemeSepia.js'));
const { themeVars } = require(path.join(ROOT, 'src/theme/ThemeBase.js'));
const LIGHT_THEME = `<style>:root{${themeVars(SEPIA)}}
  html,body{background:${SEPIA.backgrounds.app};} .page{color:${SEPIA.text.t3};}</style>`;

const page = (body, light = false) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;height:100%;background:#0b0b0c;
    font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;}
  /* Stand-in for the manuscript underneath, so chrome can be judged over it. */
  .page{padding:28px 22px;color:#8b8b96;font-size:15px;line-height:1.75;max-width:60ch;}
</style>
${light ? LIGHT_THEME : ''}
</head><body>
<div class="page">The gate had been shut for a hundred years, and the hinge
remembered none of it. She set her palm flat against the wood and felt the cold
come up through it, the way water finds a crack.</div>
${body}</body></html>`;

const server = http.createServer((req, res) => {
  const [pathname] = (req.url ?? '/').split('?');
  const name = decodeURIComponent(pathname.replace(/^\//, '')) || 'dots-one';
  res.writeHead(200, { 'content-type': 'text/html' });
  // `?light` renders the scene with the --ds-* variables a light theme sets,
  // which is the only way to see a component that hardcodes a dark panel and
  // themes its text: the two stop agreeing, and the text disappears.
  const light = /[?&]light\b/.test(req.url ?? '');
  res.end(page(rendered[name] ?? '<p style="color:red">no such scene</p>', light));
});
await new Promise((r) => server.listen(PORT, r));

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(launchOptions());
const errors = [];

// Every scene in the dark default, plus the ones whose panels sit under
// themed text in a light theme — that pairing is where a hardcoded panel
// shows up as unreadable text.
const LIGHT_TOO = ['permission-many', 'prompt-host', 'ext-settings'];
for (const name of [...Object.keys(SCENES), ...LIGHT_TOO.map((n) => `${n}@light`)]) {
  const p = await browser.newPage({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await p.goto(`http://127.0.0.1:${PORT}/${name.replace(/@light$/, '')}${name.endsWith('@light') ? '?light' : ''}`, { waitUntil: 'domcontentloaded' });
  // Let entrance animations finish. FrostedModal fades and scales in over
  // 200ms, and shooting through that produced two photographs of the same
  // dialog at different opacities — which reads as a contrast bug in the
  // component rather than as the shutter being early.
  await p.evaluate(() => Promise.all(
    document.getAnimations().map((a) => a.finished.catch(() => {})),
  ));
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  await p.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.error('✖ the page threw:', errors.join(' | '));
  process.exit(1);
}
console.log(`✔ ${Object.keys(SCENES).length} component shots in ${OUT}`);
for (const n of Object.keys(SCENES)) console.log(`  ${n}.png`);
