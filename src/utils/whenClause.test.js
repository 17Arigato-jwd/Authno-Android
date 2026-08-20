import {
  parseWhen, evaluateWhen, whenAllows, whenContext, WhenSyntaxError,
} from './whenClause.js';

const ctx = whenContext({
  app: { platform: 'android', version: '1.1.20' },
  book: { isOpen: true, isSaved: true, chapterCount: 12 },
  settings: { mode: 'auto', retries: 3 },
});

const run = (src, grants = []) => whenAllows(src, ctx, grants);

describe('the when language', () => {
  test('an absent clause always allows', () => {
    expect(whenAllows(undefined, ctx)).toBe(true);
    expect(whenAllows(null, ctx)).toBe(true);
    expect(whenAllows('', ctx)).toBe(true);
  });

  test('paths read from the context', () => {
    expect(run('book.isSaved')).toBe(true);
    expect(run('book.isOpen')).toBe(true);
    expect(run('app.platform == "android"')).toBe(true);
    expect(run('app.platform == "web"')).toBe(false);
  });

  test('logical operators', () => {
    expect(run('book.isSaved && app.platform != "web"')).toBe(true);
    expect(run('book.isSaved && app.platform == "web"')).toBe(false);
    expect(run('app.platform == "web" || book.isSaved')).toBe(true);
    expect(run('!book.isSaved')).toBe(false);
    expect(run('!!book.isSaved')).toBe(true);
  });

  test('parentheses group as written', () => {
    expect(run('(app.platform == "web" || book.isSaved) && book.isOpen')).toBe(true);
    expect(run('app.platform == "web" || (book.isSaved && false)')).toBe(false);
  });

  test('numbers and equality are strict', () => {
    expect(run('book.chapterCount == 12')).toBe(true);
    expect(run('book.chapterCount == "12"')).toBe(false);
    expect(run('book.chapterCount != 0')).toBe(true);
  });

  test('ext.hasPermission reads the grants, not the context', () => {
    expect(run("ext.hasPermission('network')", ['network'])).toBe(true);
    expect(run("ext.hasPermission('network')", [])).toBe(false);
    expect(run("ext.hasPermission('network') && book.isSaved", ['network'])).toBe(true);
  });

  test('extension settings are readable', () => {
    expect(run('ext.settings.mode == "auto"')).toBe(true);
    expect(run('ext.settings.retries == 3')).toBe(true);
    expect(run('ext.settings.nothing')).toBe(false);
  });

  test('the spec example evaluates', () => {
    const src = "book.isSaved && ext.hasPermission('network') && app.platform != 'web'";
    expect(run(src, ['network'])).toBe(true);
    expect(run(src, [])).toBe(false);
  });

  test('an unknown path is falsey, not an error', () => {
    // A clause written against a newer app hides its contribution rather than
    // throwing into a render.
    expect(run('app.somethingFromV3')).toBe(false);
    expect(run('a.b.c.d.e')).toBe(false);
    expect(run('!app.somethingFromV3')).toBe(true);
  });

  test('&& short-circuits so a missing left side cannot throw on the right', () => {
    expect(run('missing.thing && missing.thing.deeper')).toBe(false);
  });
});

describe('the when language cannot become code', () => {
  const rejected = [
    // assignment and statements
    'book.isSaved = true',
    'book.isSaved; alert(1)',
    // any call except the one predicate
    'alert(1)',
    'app.constructor("return 1")',
    'ext.settings.toString()',
    // computed access
    'app["platform"]',
    'app[0]',
    // template and arithmetic
    'app.platform + ""',
    String.fromCharCode(96) + '${app.platform}' + String.fromCharCode(96),
    // comments, which would let a clause hide its own tail
    'book.isSaved // rest',
    'book.isSaved /* x */',
    // arrow functions
    '() => 1',
    'x => x',
  ];

  test.each(rejected)('%s does not parse', (src) => {
    expect(() => parseWhen(src)).toThrow(WhenSyntaxError);
  });

  test('prototype access returns undefined rather than a function', () => {
    // The parser rejects a call, and the evaluator refuses to walk onto the
    // prototype chain — so neither half alone is the whole defence.
    expect(run('app.constructor')).toBe(false);
    expect(run('app.__proto__')).toBe(false);
    expect(run('app.constructor.constructor')).toBe(false);
    expect(run('book.hasOwnProperty')).toBe(false);
    expect(run('app.toString')).toBe(false);
  });

  test('a function reachable in the context is never returned', () => {
    const withFn = { app: { platform: 'web', evil: () => true } };
    expect(whenAllows('app.evil', withFn)).toBe(false);
  });

  test('__grants cannot be shadowed by a settings key', () => {
    // hasPermission must read the real grants, not anything the extension can
    // put into its own settings.
    const spoofed = whenContext({ settings: {} });
    spoofed.__grants = ['network'];          // as if the extension had set it
    expect(evaluateWhen(parseWhen("ext.hasPermission('network')"), spoofed, [])).toBe(false);
    expect(evaluateWhen(parseWhen("ext.hasPermission('network')"), spoofed, ['network'])).toBe(true);
  });

  test('only ext.hasPermission is callable', () => {
    expect(() => parseWhen("ext.hasPermissions('network')")).toThrow(/not callable/);
    expect(() => parseWhen("book.hasPermission('x')")).toThrow(/not callable/);
    expect(() => parseWhen('ext.hasPermission(book.isSaved)')).toThrow(/takes a string/);
  });

  test('deeply nested parentheses are refused rather than blowing the stack', () => {
    const deep = '('.repeat(200) + 'true' + ')'.repeat(200);
    expect(() => parseWhen(deep)).toThrow(WhenSyntaxError);
  });

  test('a very long clause is refused', () => {
    expect(() => parseWhen('true && '.repeat(200) + 'true')).toThrow(/longer than/);
  });

  test('an unterminated string is a syntax error, not a silent truncation', () => {
    expect(() => parseWhen("app.platform == 'android")).toThrow(/unterminated/);
  });

  test('trailing input is refused', () => {
    expect(() => parseWhen('true false')).toThrow(/trailing input/);
    expect(() => parseWhen('true)')).toThrow(/trailing input/);
  });

  test('a malformed clause hides its contribution and reports why', () => {
    const seen = [];
    expect(whenAllows('app[0]', ctx, [], (e) => seen.push(e))).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(WhenSyntaxError);
  });
});
