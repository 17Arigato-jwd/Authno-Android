#!/usr/bin/env node
/**
 * check-opened-file.mjs — the decision that made a tapped .extbk do nothing.
 *
 * Three intent handlers each asked "does this URI end in my extension?", and
 * a content URI does not end in anything: Downloads hands over
 * `content://…/document/msf%3A42` with type application/octet-stream. Every
 * test failed, every handler returned early, and the app opened on the home
 * screen as if nothing had been tapped. No error, nowhere to look.
 *
 * That decision now lives in OpenedFile.java, deliberately free of Android
 * imports so it can be compiled and run here — the rest of the app needs the
 * SDK and dl.google.com, which this environment does not have. Nothing else
 * in the Android source can be exercised; this can, and it is the piece that
 * was wrong.
 *
 * Usage: node scripts/check-opened-file.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JAVA_DIR = path.join(ROOT, 'android/app/src/main/java/com/aurorastudios/authno');
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m';

let javac;
try {
  javac = execFileSync('which', ['javac'], { encoding: 'utf8' }).trim();
} catch {
  console.log(`${DIM}· javac not installed — skipping.${OFF}`);
  process.exit(0);
}

// The magic numbers, as the JS side defines them. Written out rather than
// imported so a change on either side shows up as a disagreement here.
const ECS = '0x89,0x45,0x58,0x54,0x42,0x4B,0x0D,0x0A'; // \x89EXTBK\r\n
const EPK = '0x89,0x45,0x50,0x4B,0x0D,0x0A,0x1A,0x0A'; // \x89EPK\r\n\x1a\n
const ZIP = '0x50,0x4B,0x03,0x04,0x00,0x00,0x00,0x00'; // not ours

/** [what it is, name, mime, magic, expected] */
const CASES = [
  // The reported bug, in the three shapes a provider hands it over in.
  ['a downloaded .extbk from Downloads',
    '"cloud-backup-2.0.0.extbk"', '"application/octet-stream"', ECS, 'EXTBK'],
  ['a .extbk with no name the provider will admit to',
    'null', '"application/octet-stream"', EPK, 'EXTBK'],
  ['a .extbk shared with no type at all',
    '"pack.extbk"', 'null', ECS, 'EXTBK'],

  // What used to be the only thing that worked.
  ['a file:// path ending in .extbk', '"/sdcard/Download/x.extbk"', 'null', ECS, 'EXTBK'],
  ['our own registered type', 'null', '"application/x-extbk"', 'null', 'EXTBK'],

  // The other two types still route where they did.
  ['a theme', '"midnight.thmbk"', '"application/octet-stream"', ECS, 'THMBK'],
  ['a book', '"draft.authbook"', '"application/octet-stream"', 'null', 'AUTHBOOK'],
  ['a book by type', 'null', '"application/x-authbook"', 'null', 'AUTHBOOK'],

  // The name beats a type that disagrees with it: a person who named a file
  // .thmbk meant it, and providers guess types all the time.
  ['a theme a provider called an extension',
    '"midnight.thmbk"', '"application/x-extbk"', ECS, 'THMBK'],

  // And the reason accepting octet-stream from the chooser is safe.
  ['somebody else\'s zip', '"holiday.zip"', '"application/octet-stream"', ZIP, 'UNKNOWN'],
  ['an unnamed blob that is not ours', 'null', '"application/octet-stream"', ZIP, 'UNKNOWN'],
  ['nothing to go on at all', 'null', 'null', 'null', 'UNKNOWN'],
  ['a truncated file, shorter than the magic', '"x"', 'null', '0x89,0x45', 'UNKNOWN'],

  // Case is the provider's choice, not ours.
  ['a shouted extension', '"PACK.EXTBK"', 'null', 'null', 'EXTBK'],
];

const body = CASES.map(([what, name, mime, magic, expect], i) => {
  const bytes = magic === 'null' ? 'null' : `new byte[]{ ${magic.split(',').map((b) => `(byte) ${b}`).join(', ')} }`;
  return `        check(${JSON.stringify(what)}, OpenedFile.kindOf(${name}, ${mime}, ${bytes}), OpenedFile.${expect});`;
}).join('\n');

const harness = `package com.aurorastudios.authno;

public class OpenedFileCheck {
    static int failed = 0;
    static void check(String what, String got, String want) {
        if (!want.equals(got)) {
            System.out.println("  FAIL " + what + ": wanted " + want + ", got " + got);
            failed++;
        }
    }
    public static void main(String[] args) {
${body}
        if (failed > 0) System.exit(1);
        System.out.println("${CASES.length} cases");
    }
}
`;

const out = mkdtempSync(path.join(tmpdir(), 'authno-openedfile-'));
try {
  const src = path.join(out, 'OpenedFileCheck.java');
  writeFileSync(src, harness);
  execFileSync(javac, ['-nowarn', '-d', out, path.join(JAVA_DIR, 'OpenedFile.java'), src], { stdio: 'pipe' });
  const res = execFileSync('java', ['-cp', out, 'com.aurorastudios.authno.OpenedFileCheck'], { encoding: 'utf8' });
  console.log(`${GREEN}✔${OFF} OpenedFile routes every shape a file arrives in (${res.trim()})`);
} catch (e) {
  console.error(`${RED}✖ OpenedFile${OFF}`);
  if (e.stdout) process.stdout.write(e.stdout.toString());
  if (e.stderr) process.stderr.write(e.stderr.toString());
  process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
