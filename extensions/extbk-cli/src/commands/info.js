/**
 * extbk info <file.extbk>
 *
 * Prints a detailed summary of the VCHS-ECS binary .extbk archive:
 * format header, RS level, section table, and manifest fields.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { inspectExtbk, unpackExtbk } from '../format.js';

export async function cmdInfo(extbkFile) {
  const file = path.resolve(extbkFile);
  if (!fs.existsSync(file)) die(`File not found: ${file}`);

  const buf = fs.readFileSync(file);
  let info, unpacked;

  try {
    info     = inspectExtbk(buf);
    unpacked = await unpackExtbk(buf);
  } catch (e) {
    die(`Failed to parse: ${e.message}`);
  }

  const { header, sections } = info;
  const { manifest } = unpacked;

  log('');
  log(chalk.bold('Extension info'));
  log(chalk.dim('-'.repeat(44)));
  field('ID',          manifest.id      ?? dim('(none)'));
  field('Name',        manifest.name    ?? dim('(none)'));
  field('Version',     manifest.version ?? dim('(none)'));
  field('Description', manifest.description ?? dim('(none)'));
  field('Author',      manifest.author  ?? dim('(none)'));
  field('License',     manifest.license ?? dim('(none)'));

  log('');
  log(chalk.bold('Format'));
  log(chalk.dim('-'.repeat(44)));
  field('Format',      `VCHS-ECS v${header.version}`);
  field('RS level',    `${header.rsPct}% (${rsDesc(header.rsPct)})`);
  field('Sections',    sections.length);
  field('File size',   fmtBytes(buf.length));

  log('');
  log(chalk.bold('Contributions'));
  log(chalk.dim('-'.repeat(44)));
  const c = manifest.contributes ?? {};
  field('Homescreen tiles',   (c.homescreen    ?? []).length || dim('none'));
  field('Settings items',     (c.settings      ?? []).length || dim('none'));
  field('Editor toolbar',     (c.editorToolbar ?? []).length || dim('none'));
  field('BookDashboard tabs', (c.bookDashboard?.tabs ?? []).length || dim('none'));
  field('Pages',              c.pages ? Object.keys(c.pages).join(', ') : dim('none'));

  log('');
  log(chalk.bold('Sections'));
  log(chalk.dim('-'.repeat(44)));
  log(`  ${'TAG '.padEnd(6)}${'ASSET'.padEnd(7)}${'ORIG'.padStart(10)}${'COMP'.padStart(10)}  ${'CRC32'.padEnd(10)}`);
  log(chalk.dim(`  ${'-'.repeat(42)}`));
  for (const s of sections) {
    const ratio = s.compSize < s.origSize
      ? chalk.dim(` (${Math.round(100 - (s.compSize / s.origSize) * 100)}% smaller)`)
      : '';
    log(
      `  ${chalk.cyan(s.tag.padEnd(6))}` +
      `${String(s.assetIdx).padEnd(7)}` +
      `${fmtBytes(s.origSize).padStart(10)}` +
      `${fmtBytes(s.compSize).padStart(10)}  ` +
      `${chalk.dim(s.crc32)}${ratio}`
    );
  }
  log('');
}

function rsDesc(pct) {
  if (pct === 0) return 'disabled, CRC-only detection';
  if (pct < 10)  return 'minimal protection';
  if (pct < 25)  return 'standard';
  if (pct < 50)  return 'high';
  return 'maximum';
}

function fmtBytes(n) {
  if (!n || n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

function dim(s)  { return chalk.dim(s); }
function log(msg) { process.stdout.write(msg + '\n'); }
function field(label, val) { log(`  ${chalk.dim(label.padEnd(20))} ${val}`); }
function die(msg) { process.stderr.write(`${chalk.red('x')} ${msg}\n`); process.exit(1); }
