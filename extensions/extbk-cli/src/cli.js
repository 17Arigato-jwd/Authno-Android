#!/usr/bin/env node
/**
 * extbk-cli v1.0.0 — AuthNo extension bundle tool (VCHS-ECS binary format)
 *
 * Commands:
 *   extbk init    <name>     [dir]          -- scaffold a new extension
 *   extbk build   <src-dir>  [out.extbk]   -- pack directory into .extbk
 *   extbk watch   <src-dir>  [out.extbk]   -- rebuild on every change
 *   extbk check   <file.extbk>              -- validate structure + CRCs
 *   extbk info    <file.extbk>              -- print manifest + section table
 *   extbk unpack  <file.extbk> [dest-dir]   -- extract all sections
 */

import { createRequire } from 'module';
import { program } from 'commander';

// One source of truth for the version — it used to be hard-coded here as 1.0.2
// while package.json said 1.0.0, so `extbk --version` disagreed with npm.
const VERSION = createRequire(import.meta.url)('../package.json').version;
import { cmdInit }   from './commands/init.js';
import { cmdBuild }  from './commands/build.js';
import { cmdWatch }  from './commands/watch.js';
import { cmdCheck }  from './commands/check.js';
import { cmdInfo }   from './commands/info.js';
import { cmdUnpack } from './commands/unpack.js';
import { cmdThmbkBuild } from './commands/thmbk-build.js';

program
  .name('extbk')
  .description('AuthNo extension bundle tool — VCHS-ECS binary format')
  .version(VERSION);

program
  .command('init <name> [dir]')
  .description('Scaffold a new extension directory that builds as generated')
  .option('-t, --template <name>', 'minimal | panel', 'minimal')
  .option('--force', 'Write into a non-empty directory', false)
  .action(cmdInit);

program
  .command('build <srcDir> [outFile]')
  .description('Pack an extension directory into a VCHS-ECS .extbk binary archive')
  .option('--rs-pct <n>',  'Reed-Solomon protection level 0-100 (default: 20)', '20')
  .option('--overwrite',   'Overwrite output file if it already exists', false)
  .option('--out-dir <dir>', 'Directory to write the archive into', '.')
  .option('--force',       'Build even if the manifest audit finds problems', false)
  .action(cmdBuild);

program
  .command('watch <srcDir> [outFile]')
  .description('Rebuild the archive whenever a source file changes')
  .option('--rs-pct <n>',  'Reed-Solomon protection level 0-100 (default: 20)', '20')
  .option('--out-dir <dir>', 'Directory to write the archive into', '.')
  .option('--force',       'Build even if the manifest audit finds problems', false)
  .action(cmdWatch);

program
  .command('check <extbkFile>')
  .description('Validate a .extbk archive (magic, CRC32, required sections, manifest)')
  .action(cmdCheck);

program
  .command('info <extbkFile>')
  .description('Print manifest summary and VCHS-ECS section table')
  .action(cmdInfo);

program
  .command('unpack <extbkFile> [destDir]')
  .description('Extract a .extbk archive to a directory')
  .option('--overwrite', 'Overwrite destination if it already exists', false)
  .action(cmdUnpack);

program
  .command('thmbk-build <src> [outFile]')
  .description('Pack a theme (dir with manifest.json + theme.json, or a bundled theme.json) into a .thmbk')
  .option('--rs-pct <n>', 'Reed-Solomon protection level 0-100 (default: 20)', '20')
  .option('--overwrite',  'Overwrite output file if it already exists', false)
  .action(cmdThmbkBuild);

program.parse();
