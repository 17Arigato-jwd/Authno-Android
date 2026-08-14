import {
  relativeImports, resolvePath, planModuleGraph, rewriteSpecifiers,
} from './moduleGraph';

const urls = (order) => {
  const m = {};
  order.forEach((p, i) => { m[p] = `blob:fake/${i}`; });
  return (p) => m[p];
};

describe('finding what a module imports', () => {
  test('the three shapes an import takes', () => {
    expect(relativeImports(`
      import { a } from './a.js';
      import './side-effect.js';
      const c = await import('./c.js');
    `)).toEqual(['./a.js', './side-effect.js', './c.js']);
  });

  test('either quote, and a parent directory', () => {
    expect(relativeImports(`import x from "../lib/x.js";`)).toEqual(['../lib/x.js']);
  });

  /**
   * Bare specifiers are somebody else's problem on purpose. Rewriting `react`
   * to a blob URL would turn a clear "this extension expects a bundler" into a
   * blob that 404s.
   */
  test('bare specifiers and full URLs are left alone', () => {
    expect(relativeImports(`
      import React from 'react';
      import { z } from 'https://esm.sh/z';
      import { a } from '/absolute.js';
    `)).toEqual([]);
  });

  test('the same file imported twice is listed once', () => {
    expect(relativeImports(`import {a} from './x.js'; import {b} from './x.js';`))
      .toEqual(['./x.js']);
  });

  test('nothing to import is not a crash', () => {
    expect(relativeImports('')).toEqual([]);
    expect(relativeImports(null)).toEqual([]);
    expect(relativeImports(undefined)).toEqual([]);
  });
});

describe('resolving a specifier against its importer', () => {
  test('a sibling', () => {
    expect(resolvePath('index.js', './queue.js')).toBe('queue.js');
    expect(resolvePath('lib/a.js', './b.js')).toBe('lib/b.js');
  });

  test('a subdirectory and a parent', () => {
    expect(resolvePath('index.js', './lib/x.js')).toBe('lib/x.js');
    expect(resolvePath('lib/deep/a.js', '../b.js')).toBe('lib/b.js');
    expect(resolvePath('lib/deep/a.js', '../../c.js')).toBe('c.js');
  });

  /**
   * These paths are handed to a file read afterwards. `..` past the root has to
   * land inside the extension, not above it.
   */
  test('climbing past the root stays at the root', () => {
    expect(resolvePath('index.js', '../../../../etc/passwd')).toBe('etc/passwd');
    expect(resolvePath('a/b.js', '../../../x.js')).toBe('x.js');
  });
});

describe('the order to create modules in', () => {
  test('leaves before the module that imports them', () => {
    const files = {
      'index.js': `import { q } from './queue.js'; import { l } from './log.js';`,
      'queue.js': `import { l } from './log.js'; export const q = 1;`,
      'log.js': `export const l = 2;`,
    };
    const { order, missing, cycle } = planModuleGraph(files);
    expect(cycle).toBeNull();
    expect(missing).toEqual([]);
    expect(order.indexOf('log.js')).toBeLessThan(order.indexOf('queue.js'));
    expect(order.indexOf('queue.js')).toBeLessThan(order.indexOf('index.js'));
    expect(order[order.length - 1]).toBe('index.js');
  });

  test('a single file with no imports', () => {
    expect(planModuleGraph({ 'index.js': 'export function activate(){}' }).order)
      .toEqual(['index.js']);
  });

  /**
   * A folder can hold anything — a README, a test, an old copy. Creating blobs
   * for files nothing imports would cost memory for nothing.
   */
  test('only what the entry can reach', () => {
    const files = {
      'index.js': `import './used.js';`,
      'used.js': 'export const a = 1;',
      'orphan.js': 'export const b = 2;',
    };
    expect(planModuleGraph(files).order).toEqual(['used.js', 'index.js']);
  });

  test('a diamond visits the shared leaf once', () => {
    const files = {
      'index.js': `import './a.js'; import './b.js';`,
      'a.js': `import './shared.js';`,
      'b.js': `import './shared.js';`,
      'shared.js': 'export const s = 1;',
    };
    const { order } = planModuleGraph(files);
    expect(order.filter((p) => p === 'shared.js')).toHaveLength(1);
    expect(order[0]).toBe('shared.js');
  });

  test('an extensionless import finds the file anyway', () => {
    const files = { 'index.js': `import './queue';`, 'queue.js': 'export const q = 1;' };
    expect(planModuleGraph(files).order).toEqual(['queue.js', 'index.js']);
  });

  test('a directory import finds its index', () => {
    const files = { 'index.js': `import './lib';`, 'lib/index.js': 'export const l = 1;' };
    expect(planModuleGraph(files).order).toEqual(['lib/index.js', 'index.js']);
  });

  /**
   * Reported, not thrown. An extension that ships without a file it imports is
   * broken either way, and the useful version of that news names the importer
   * and the specifier rather than a blob URL this code invented.
   */
  test('a missing file is named rather than guessed at', () => {
    const files = { 'index.js': `import './gone.js'; import './here.js';`, 'here.js': 'export const h = 1;' };
    const { order, missing } = planModuleGraph(files);
    expect(missing).toEqual([{ from: 'index.js', spec: './gone.js' }]);
    expect(order).toContain('here.js');
  });

  test('no entry file at all is reported the same way', () => {
    const { order, missing } = planModuleGraph({ 'other.js': '' });
    expect(order).toEqual([]);
    expect(missing).toEqual([{ from: '', spec: 'index.js' }]);
  });

  /**
   * The real limitation, named. A blob URL cannot express a cycle: the first
   * module would need the second's URL before the second exists. Refusing with
   * the loop spelled out beats hanging or half-loading.
   */
  test('a cycle is refused with the loop spelled out', () => {
    const files = {
      'index.js': `import './a.js';`,
      'a.js': `import './b.js';`,
      'b.js': `import './a.js';`,
    };
    const { cycle } = planModuleGraph(files);
    expect(cycle).toEqual(['a.js', 'b.js', 'a.js']);
  });

  test('a module importing itself is a cycle too', () => {
    expect(planModuleGraph({ 'index.js': `import './index.js';` }).cycle)
      .toEqual(['index.js', 'index.js']);
  });

  test('a named entry other than index.js', () => {
    const files = { 'main.js': `import './x.js';`, 'x.js': '' };
    expect(planModuleGraph(files, 'main.js').order).toEqual(['x.js', 'main.js']);
  });
});

describe('pointing the specifiers at real URLs', () => {
  const files = {
    'index.js': `import { q } from './queue.js';\nimport './lib/log';\nexport function activate(){ return q; }`,
    'queue.js': 'export const q = 1;',
    'lib/log.js': 'export const l = 2;',
  };

  test('every relative specifier becomes a URL', () => {
    const urlFor = urls(['queue.js', 'lib/log.js', 'index.js']);
    const out = rewriteSpecifiers('index.js', files['index.js'], files, urlFor);
    expect(out).toContain(`from 'blob:fake/0'`);
    expect(out).toContain(`import 'blob:fake/1'`);
    expect(out).not.toMatch(/\.\/queue|\.\/lib\/log/);
  });

  test('the code around the specifier is untouched', () => {
    const urlFor = urls(['queue.js', 'lib/log.js', 'index.js']);
    const out = rewriteSpecifiers('index.js', files['index.js'], files, urlFor);
    expect(out).toContain('export function activate(){ return q; }');
  });

  test('bare specifiers survive verbatim', () => {
    const src = `import React from 'react';\nimport { x } from './x.js';`;
    const f = { 'index.js': src, 'x.js': '' };
    const out = rewriteSpecifiers('index.js', src, f, urls(['x.js']));
    expect(out).toContain(`from 'react'`);
  });

  /**
   * The browser's own error names the specifier the author wrote. One naming a
   * URL invented here would send them looking in the wrong place.
   */
  test('a specifier that resolves to nothing is left as written', () => {
    const src = `import './gone.js';`;
    const out = rewriteSpecifiers('index.js', src, { 'index.js': src }, () => 'blob:x');
    expect(out).toBe(src);
  });

  test('a dynamic import is rewritten too', () => {
    const f = { 'index.js': `const m = await import('./late.js');`, 'late.js': '' };
    const out = rewriteSpecifiers('index.js', f['index.js'], f, urls(['late.js']));
    expect(out).toContain(`import('blob:fake/0')`);
  });

  test('nothing to rewrite is not a crash', () => {
    expect(rewriteSpecifiers('index.js', '', {}, () => null)).toBe('');
    expect(rewriteSpecifiers('index.js', null, {}, () => null)).toBe('');
  });
});
