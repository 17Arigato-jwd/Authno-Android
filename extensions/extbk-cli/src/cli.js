#!/usr/bin/env node
/**
 * extbk-cli v1.0.0 — AuthNo extension bundle tool (VCHS-ECS binary format)
 *
 * Commands:
 *   extbk build   <src-dir>  [out.extbk]   -- pack directory into .extbk
 *   extbk check   <file.extbk>              -- validate structure + CRCs
 *   extbk info    <file.extbk>              -- print manifest + section table
 *   extbk unpack  <file.extbk> [dest-dir]   -- extract all sections
 */

import { program } from 'commander';
import { cmdBuild }  from './commands/build.js';
import { cmdCheck }  from './commands/check.js';
import { cmdInfo }   from './commands/info.js';
import { cmdUnpack } from './commands/unpack.js';

program
  .name('extbk')
  .description('AuthNo extension bundle tool — VCHS-ECS binary format, v1.0.1')
  .version('1.0.1');

program
  .command('build <srcDir> [outFile]')
  .description('Pack an extension directory into a VCHS-ECS .extbk binary archive')
  .option('--rs-pct <n>',  'Reed-Solomon protection level 0-100 (default: 20)', '20')
  .option('--overwrite',   'Overwrite output file if it already exists', false)
  .action(cmdBuild);

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

program.parse();
