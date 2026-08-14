/**
 * moduleGraph.js — turning a folder of ES modules into something that can be
 * imported from an origin that has no folder.
 *
 * Extension code used to be fetched from `https://localhost/extensions/<id>/`,
 * which only Android's WebView serves. That gave relative imports somewhere to
 * resolve against, and it is why extensions never ran on desktop: nothing
 * serves that URL anywhere else.
 *
 * A sandboxed iframe has no server either — worse, it has an opaque origin and
 * a base URL of `about:srcdoc`, so `./queue.js` resolves to nothing at all. The
 * way through is to hand the sandbox every file at once and let it build blob
 * URLs, rewriting each `./queue.js` to the blob URL that file became. Blob URLs
 * work in an opaque origin, need no server, and are identical on a phone and on
 * a laptop.
 *
 * A blob URL cannot exist before its content does, and its content mentions the
 * URLs of everything it imports — so the files have to be created leaves-first.
 * That ordering is this module's whole job, and it is pure, so the cases that
 * break it are reachable from a test rather than from an extension that fails
 * to load on somebody's phone.
 */

/**
 * Relative import specifiers in an ES module.
 *
 * Deliberately narrow. It matches `from './x.js'`, `import './x.js'` and
 * `import('./x.js')` with either quote, and nothing else — bare specifiers
 * (`react`), absolute paths and full URLs are left exactly as they are, because
 * an extension importing one of those is either wrong or means it.
 *
 * A regex over source is not a parser and cannot be. It will rewrite a relative
 * specifier inside a string literal or a comment that happens to look like an
 * import. The failure is loud (a blob URL where a string was expected) rather
 * than silent, and the alternative is shipping a JS parser to move some quotes.
 */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.[^'"]*)\2/g;

/** Every relative path a module imports, in source order, deduplicated. */
export function relativeImports(source) {
  const out = [];
  const seen = new Set();
  for (const m of String(source ?? '').matchAll(SPECIFIER)) {
    const spec = m[3];
    if (!seen.has(spec)) { seen.add(spec); out.push(spec); }
  }
  return out;
}

/**
 * Resolve `./queue.js` against the module that imported it.
 *
 * Paths are extension-relative and POSIX throughout — they come from a
 * manifest and from Capacitor's Filesystem, neither of which uses backslashes.
 * `..` above the extension root resolves to nothing rather than escaping,
 * which matters: the same paths are handed to a file read.
 */
export function resolvePath(fromPath, spec) {
  const baseParts = String(fromPath).split('/').slice(0, -1);
  const parts = String(spec).split('/');
  const out = [...baseParts];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

/**
 * Add `.js` when a specifier omitted it and the bare form is not a file.
 *
 * Node resolves extensionless imports; browsers never have. Extensions written
 * against a bundler carry them, and refusing to load over a missing two
 * characters would be a worse answer than trying the obvious thing.
 */
function locate(path, files) {
  if (Object.prototype.hasOwnProperty.call(files, path)) return path;
  for (const candidate of [`${path}.js`, `${path}/index.js`]) {
    if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
  }
  return null;
}

/**
 * The order to create modules in, leaves first.
 *
 * @param {Object<string,string>} files  path → source, extension-relative
 * @param {string} entry                 usually "index.js"
 * @returns {{ order: string[], missing: Array<{from: string, spec: string}>, cycle: string[]|null }}
 *
 * `order` holds only what is reachable from the entry: a folder full of
 * unrelated files is not this function's business, and creating blobs for them
 * would cost memory nobody asked for.
 *
 * `missing` is reported rather than thrown. An extension that imports a file it
 * did not ship is broken, and saying which line broke it beats a browser error
 * naming a blob URL.
 *
 * `cycle` is a real limitation and is named as one. Blob URLs cannot express a
 * cycle — the first module would need the second's URL before the second
 * exists — so a circular import is refused with the loop spelled out instead of
 * hanging or half-loading.
 */
export function planModuleGraph(files, entry = 'index.js') {
  const order = [];
  const missing = [];
  const done = new Set();
  const onStack = [];
  let cycle = null;

  if (!Object.prototype.hasOwnProperty.call(files ?? {}, entry)) {
    return { order: [], missing: [{ from: '', spec: entry }], cycle: null };
  }

  const visit = (path) => {
    if (done.has(path) || cycle) return;
    const at = onStack.indexOf(path);
    if (at !== -1) { cycle = [...onStack.slice(at), path]; return; }

    onStack.push(path);
    for (const spec of relativeImports(files[path])) {
      const target = locate(resolvePath(path, spec), files);
      if (!target) { missing.push({ from: path, spec }); continue; }
      visit(target);
      if (cycle) { onStack.pop(); return; }
    }
    onStack.pop();
    done.add(path);
    order.push(path);
  };

  visit(entry);
  return { order, missing, cycle };
}

/**
 * One module's source with its relative specifiers pointed at real URLs.
 *
 * `urlFor` is a lookup rather than a map so the caller can create each blob as
 * it goes, which is the only order the blobs can be created in anyway.
 * Specifiers that resolve to nothing are left untouched — the browser's own
 * error names the specifier the author wrote, which is more use than one naming
 * a URL this file invented.
 */
export function rewriteSpecifiers(path, source, files, urlFor) {
  return String(source ?? '').replace(SPECIFIER, (whole, head, quote, spec) => {
    const target = locate(resolvePath(path, spec), files);
    const url = target ? urlFor(target) : null;
    return url ? `${head}${quote}${url}${quote}` : whole;
  });
}
