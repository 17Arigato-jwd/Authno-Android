/**
 * whenClause.js — the `when` expression language for v2 contributions.
 *
 * Spec: docs/extension-system-v2-spec.md §4.1.
 *
 *   "when": "book.isSaved && ext.hasPermission('network') && app.platform != 'web'"
 *
 * A contribution appears only where it makes sense, and the author says where
 * in a string. That string comes out of an extension package, so the only
 * interesting question about this module is what it *cannot* do.
 *
 * **It is not `eval`, and it is not Turing-complete.** There is no way to
 * express a loop, define a function, reach a global, index a property by a
 * computed name, or call anything except the one predicate below. A visibility
 * rule decides whether a button is drawn; a visibility rule that can loop is a
 * hang in the render path, and one that can reach `window` is not a sandbox.
 *
 * Grammar, in full:
 *
 *   expr    := or
 *   or      := and ( '||' and )*
 *   and     := cmp ( '&&' cmp )*
 *   cmp     := unary ( ( '==' | '!=' ) unary )?
 *   unary   := '!' unary | primary
 *   primary := '(' expr ')' | literal | path | call
 *   call    := 'ext.hasPermission' '(' string ')'
 *   literal := string | number | 'true' | 'false' | 'null'
 *   path    := ident ( '.' ident )*
 *
 * Evaluation is total: an unknown path is `undefined` rather than a throw, so a
 * clause written against a newer app degrades to hidden instead of breaking the
 * screen it appears on.
 */

/** Depth cap. The grammar has no recursion beyond nesting, but parens do. */
const MAX_DEPTH = 32;
const MAX_LENGTH = 512;

export class WhenSyntaxError extends Error {
  constructor(message, at) {
    super(at === undefined ? message : `${message} (at ${at})`);
    this.name = 'WhenSyntaxError';
    this.at = at;
  }
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

const PUNCT = ['&&', '||', '==', '!=', '(', ')', '!', ','];

function tokenize(src) {
  const out = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // Strings. Single or double quoted, backslash escapes for the quote and
    // the backslash only — there is nothing here that needs \n or \u.
    if (c === "'" || c === '"') {
      const quote = c;
      let value = '';
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '\\' && (src[j + 1] === quote || src[j + 1] === '\\')) {
          value += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === quote) { closed = true; j++; break; }
        value += src[j];
        j++;
      }
      if (!closed) throw new WhenSyntaxError('unterminated string', i);
      out.push({ type: 'string', value });
      i = j;
      continue;
    }

    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      const text = src.slice(i, j);
      if ((text.match(/\./g) || []).length > 1) throw new WhenSyntaxError('malformed number', i);
      out.push({ type: 'number', value: Number(text) });
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      out.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (PUNCT.includes(two)) { out.push({ type: 'punct', value: two }); i += 2; continue; }
    if (PUNCT.includes(c)) { out.push({ type: 'punct', value: c }); i += 1; continue; }

    // Everything not named above is rejected rather than ignored. `=` alone,
    // `;`, `[`, `` ` `` and `+` are all things that would mean something in
    // JavaScript, and silently skipping them is how a parser starts accepting
    // programs it was never meant to read.
    throw new WhenSyntaxError(`unexpected character ${JSON.stringify(c)}`, i);
  }

  return out;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/** Parse to an AST. Throws WhenSyntaxError; never evaluates anything. */
export function parseWhen(src) {
  if (typeof src !== 'string') throw new WhenSyntaxError('when must be a string');
  if (src.length > MAX_LENGTH) throw new WhenSyntaxError(`when is longer than ${MAX_LENGTH} characters`);

  const tokens = tokenize(src);
  if (!tokens.length) throw new WhenSyntaxError('when is empty');

  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (value) => {
    const t = tokens[pos];
    if (t && t.type === 'punct' && t.value === value) { pos++; return true; }
    return false;
  };

  function parseExpr(depth) {
    if (depth > MAX_DEPTH) throw new WhenSyntaxError('when is nested too deeply');
    return parseOr(depth);
  }

  function parseOr(depth) {
    let left = parseAnd(depth);
    while (eat('||')) left = { op: 'or', left, right: parseAnd(depth) };
    return left;
  }

  function parseAnd(depth) {
    let left = parseCmp(depth);
    while (eat('&&')) left = { op: 'and', left, right: parseCmp(depth) };
    return left;
  }

  function parseCmp(depth) {
    const left = parseUnary(depth);
    if (eat('==')) return { op: 'eq', left, right: parseUnary(depth) };
    if (eat('!=')) return { op: 'ne', left, right: parseUnary(depth) };
    return left;
  }

  function parseUnary(depth) {
    if (eat('!')) return { op: 'not', value: parseUnary(depth + 1) };
    return parsePrimary(depth);
  }

  function parsePrimary(depth) {
    const t = peek();
    if (!t) throw new WhenSyntaxError('unexpected end of expression');

    if (t.type === 'punct' && t.value === '(') {
      pos++;
      const inner = parseExpr(depth + 1);
      if (!eat(')')) throw new WhenSyntaxError('missing )');
      return inner;
    }

    if (t.type === 'string') { pos++; return { op: 'lit', value: t.value }; }
    if (t.type === 'number') { pos++; return { op: 'lit', value: t.value }; }

    if (t.type === 'ident') {
      pos++;
      if (t.value === 'true') return { op: 'lit', value: true };
      if (t.value === 'false') return { op: 'lit', value: false };
      if (t.value === 'null') return { op: 'lit', value: null };

      // The one call form in the language. Anything else that looks like a
      // call is a syntax error rather than a lookup, so `foo.bar('x')` cannot
      // quietly become a property read of `foo.bar`.
      if (eat('(')) {
        if (t.value !== 'ext.hasPermission') {
          throw new WhenSyntaxError(`${t.value} is not callable`);
        }
        const arg = peek();
        if (!arg || arg.type !== 'string') {
          throw new WhenSyntaxError('ext.hasPermission takes a string');
        }
        pos++;
        if (!eat(')')) throw new WhenSyntaxError('missing ) after ext.hasPermission');
        return { op: 'hasPermission', name: arg.value };
      }

      if (t.value.endsWith('.') || t.value.startsWith('.') || t.value.includes('..')) {
        throw new WhenSyntaxError(`malformed path ${t.value}`);
      }
      return { op: 'path', path: t.value.split('.') };
    }

    throw new WhenSyntaxError(`unexpected ${t.type}`);
  }

  const ast = parseExpr(0);
  if (pos !== tokens.length) throw new WhenSyntaxError('trailing input after expression');
  return ast;
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Walk a path through the context WITHOUT prototype access.
 *
 * `hasOwnProperty` at every step is the whole point: without it,
 * `app.constructor.constructor` reaches Function, and a visibility rule becomes
 * arbitrary code. Own properties only, no inherited anything.
 */
function lookup(ctx, path) {
  let node = ctx;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = node[key];
    if (typeof node === 'function') return undefined;
  }
  return node;
}

function evaluate(node, ctx) {
  switch (node.op) {
    case 'lit': return node.value;
    case 'path': return lookup(ctx, node.path);
    case 'not': return !evaluate(node.value, ctx);
    case 'and': return evaluate(node.left, ctx) ? evaluate(node.right, ctx) : false;
    case 'or': return evaluate(node.left, ctx) || evaluate(node.right, ctx);
    // Strict, so '1' never equals 1 — a clause that reads as a type confusion
    // should behave like one rather than quietly matching.
    case 'eq': return evaluate(node.left, ctx) === evaluate(node.right, ctx);
    case 'ne': return evaluate(node.left, ctx) !== evaluate(node.right, ctx);
    case 'hasPermission': {
      const granted = ctx && ctx.__grants;
      return Array.isArray(granted) ? granted.includes(node.name) : false;
    }
    default: return undefined;
  }
}

/**
 * Evaluate a parsed clause to a boolean.
 *
 * `grants` is passed separately rather than living in the context object so an
 * extension cannot shadow it with a settings key called `__grants`.
 */
export function evaluateWhen(ast, context = {}, grants = []) {
  const ctx = { ...context, __grants: Array.isArray(grants) ? grants : [] };
  return !!evaluate(ast, ctx);
}

/**
 * Parse and evaluate in one call, for a contribution being rendered.
 *
 * A clause that does not parse hides its contribution and reports why, rather
 * than throwing into a render. `onError` exists so the Extensions tab can show
 * the author's mistake instead of the button silently never appearing.
 */
export function whenAllows(src, context = {}, grants = [], onError = null) {
  if (src === undefined || src === null || src === '') return true;
  let ast;
  try {
    ast = parseWhen(src);
  } catch (e) {
    if (onError) onError(e);
    return false;
  }
  return evaluateWhen(ast, context, grants);
}

/** Build the standard evaluation context. Own properties only, by construction. */
export function whenContext({ app = {}, book = {}, settings = {} } = {}) {
  return {
    app: {
      platform: app.platform ?? 'web',
      version: app.version ?? '0.0.0',
    },
    book: {
      isOpen: !!book.isOpen,
      isSaved: !!book.isSaved,
      chapterCount: Number(book.chapterCount ?? 0),
    },
    ext: {
      settings: { ...settings },
    },
  };
}
