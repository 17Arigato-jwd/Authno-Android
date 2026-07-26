/**
 * extbk init <name> [dir] [options]
 *
 * Scaffolds a working extension directory. The output builds and installs as
 * generated — the point is that "hello world" is one command, not a page of
 * copy-paste from the docs that goes stale the moment the manifest changes.
 *
 * Templates:
 *   minimal  — manifest + activate() with an onSave hook. No UI.
 *   panel    — minimal, plus a settings page rendered from a ui-file.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';

const TEMPLATES = ['minimal', 'panel'];

export async function cmdInit(name, dir, opts) {
  const template = String(opts.template ?? 'minimal').toLowerCase();
  if (!TEMPLATES.includes(template)) {
    die(`Unknown template "${template}". Available: ${TEMPLATES.join(', ')}`);
  }

  const id = slugify(name);
  if (!id) die('Name must contain at least one letter or number.');

  const target = path.resolve(dir ?? id);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !opts.force) {
    die(`Directory is not empty: ${target}\nUse --force to write into it anyway.`);
  }
  fs.mkdirSync(target, { recursive: true });

  const files = template === 'panel' ? panelTemplate(id, name) : minimalTemplate(id, name);
  for (const [rel, contents] of Object.entries(files)) {
    const p = path.join(target, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents, 'utf8');
    ok(`created ${chalk.dim(path.relative(process.cwd(), p))}`);
  }

  process.stdout.write(
    `\n${chalk.green('✔')} ${chalk.bold(id)} scaffolded from the ${chalk.cyan(template)} template.\n\n` +
    `  ${chalk.dim('cd')} ${path.relative(process.cwd(), target) || '.'}\n` +
    `  ${chalk.dim('extbk build .')}\n\n` +
    `Open the resulting .extbk on a device with AuthNo installed to try it.\n`,
  );
}

// ─── Templates ────────────────────────────────────────────────────────────────

function minimalTemplate(id, name) {
  return {
    'manifest.json': JSON.stringify({
      id,
      name,
      version: '0.1.0',
      description: `${name} — a brand new AuthNo extension.`,
      author: 'you',
      icon: 'Package',
      minAppVersion: '1.1.18-beta.12',
      tier: 'free',
    }, null, 2) + '\n',

    'index.js': `/**
 * ${name} — entry point.
 *
 * activate() runs once when the extension is enabled, and again after every
 * reinstall. Anything you return is called on deactivate; hooks you register
 * here are torn down for you either way.
 */
export function activate({ registerHook, storage, toast, app }) {
  console.log('[${id}] activating on', app.platform, app.version);

  registerHook('onSave', async ({ session, trigger }) => {
    if (trigger !== 'autosave') return;
    const count = (await storage.getJSON('saveCount', 0)) + 1;
    await storage.setJSON('saveCount', count);
    if (count % 10 === 0) {
      toast(\`\${session.title}: \${count} saves and counting\`, { variant: 'success' });
    }
  });

  return function deactivate() {
    console.log('[${id}] deactivating');
  };
}
`,

    'README.md': `# ${name}\n\nAn AuthNo extension.\n\n\`\`\`sh\nextbk build .      # produces ${id}-0.1.0.extbk\nextbk check *.extbk\n\`\`\`\n`,
  };
}

function panelTemplate(id, name) {
  const base = minimalTemplate(id, name);
  const manifest = JSON.parse(base['manifest.json']);
  manifest.contributes = {
    settings: [{ id: `${id}-settings`, label: name, icon: 'Package', page: 'settings' }],
    pages: { settings: { title: name, type: 'ui-file', file: 'Settings.js' } },
  };
  return {
    ...base,
    'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'Settings.js': `/**
 * Settings page. Runs inside a sandboxed iframe; the host is reachable only
 * through window.AuthnoHostAPI, which is injected before this file executes.
 */
const API = window.AuthnoHostAPI;

const root = document.createElement('div');
root.style.cssText = 'font:14px system-ui;padding:16px;color:#e7e7ea';
document.body.appendChild(root);

(async () => {
  const info  = await API.getAppInfo();
  const books = await API.getSessions();
  const saves = await API.storage.getJSON('saveCount', 0);

  root.innerHTML = \`
    <h2 style="margin:0 0 12px;font-size:17px">${name}</h2>
    <p style="opacity:.7;margin:0 0 16px">Running on \${info.name} \${info.version} (\${info.platform}).</p>
    <p style="margin:0 0 16px">\${books.length} book(s) in the library · \${saves} autosaves seen.</p>
    <button id="hi" style="padding:9px 14px;border-radius:8px;border:0;background:#5a00d9;color:#fff;cursor:pointer">Say hello</button>
  \`;

  root.querySelector('#hi').onclick = () => API.toast('Hello from ${name}', { variant: 'success' });
})();
`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ok(msg)  { process.stdout.write(`${chalk.green('✔')} ${msg}\n`); }
function die(msg) { process.stderr.write(`${chalk.red('✘')} ${msg}\n`); process.exit(1); }
