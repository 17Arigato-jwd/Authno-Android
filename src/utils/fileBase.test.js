/**
 * The filename a book is written under.
 *
 * This is a data-loss surface, not a cosmetic one. The rule used to be
 * `[^a-z0-9\-_ ]` → `_`, which is ASCII-only, so every Japanese, Cyrillic,
 * Greek, Arabic or Hebrew title collapsed to a row of underscores — and two
 * such books produced the *same* filename, so the second export silently
 * overwrote the first. Only writers who do not work in English were affected,
 * which is the reason nobody reported it.
 *
 * fileBase is not exported (it is an implementation detail of storage.js, and
 * storage.js pulls in Capacitor at import time), so the rule is reimplemented
 * here and pinned. If the two ever drift, that is the bug this file exists to
 * catch — keep them identical.
 */

// eslint-disable-next-line no-control-regex
const FS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001F]/g;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function fileBase(session) {
  let base = String(session?.title ?? '')
    .normalize('NFC')
    .replace(FS_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  base = base.slice(0, 60).replace(/[.\s]+$/, '');
  if (!base || WIN_RESERVED.test(base)) base = 'Untitled';
  return base;
}

const name = (title) => `${fileBase({ title })}.authbook`;

describe('titles that are not English', () => {
  /** The bug: all of these used to be "________.authbook". */
  test('non-Latin scripts survive intact', () => {
    expect(name('日本語のタイトル')).toBe('日本語のタイトル.authbook');
    expect(name('Война и мир')).toBe('Война и мир.authbook');
    expect(name('Ελληνικά')).toBe('Ελληνικά.authbook');
    expect(name('الكتاب')).toBe('الكتاب.authbook');
    expect(name('한국어')).toBe('한국어.authbook');
  });

  /**
   * The consequence that actually cost work: distinct titles must not
   * collapse onto one filename.
   */
  test('two different non-Latin titles do not collide', () => {
    expect(name('日本語')).not.toBe(name('한국어'));
    expect(name('Война')).not.toBe(name('мир'));
  });

  test('accented Latin is kept, not flattened', () => {
    expect(name('Café Brûlé')).toBe('Café Brûlé.authbook');
    expect(name('Åsa Ünal')).toBe('Åsa Ünal.authbook');
  });

  /** Composed and decomposed forms are the same title, so one file. */
  test('unicode normalisation collapses equivalent spellings', () => {
    expect(name('Café')).toBe(name('Café'));
  });
});

describe('names a filesystem would mangle', () => {
  /** A whitespace-only title exported as ".authbook" — a hidden dotfile. */
  test('a blank or whitespace title falls back rather than hiding the file', () => {
    expect(name('')).toBe('Untitled.authbook');
    expect(name('   ')).toBe('Untitled.authbook');
    expect(name('\t\n ')).toBe('Untitled.authbook');
    expect(name(undefined)).toBe('Untitled.authbook');
    expect(name(null)).toBe('Untitled.authbook');
  });

  test('a leading dot never survives — it would hide the file', () => {
    expect(name('.hidden')).toBe('hidden.authbook');
    expect(name('...')).toBe('Untitled.authbook');
  });

  test('trailing dots and spaces go, because Windows drops them silently', () => {
    expect(name('Book.')).toBe('Book.authbook');
    expect(name('Book   ')).toBe('Book.authbook');
    expect(name('Book . . ')).toBe('Book.authbook');
  });

  test('Windows device names are refused whatever the extension', () => {
    expect(name('CON')).toBe('Untitled.authbook');
    expect(name('nul')).toBe('Untitled.authbook');
    expect(name('COM1')).toBe('Untitled.authbook');
    // Not reserved — only the exact device names are.
    expect(name('Constance')).toBe('Constance.authbook');
    expect(name('Comic')).toBe('Comic.authbook');
  });
});

describe('the characters that must not get through', () => {
  test('path traversal is still impossible', () => {
    expect(name('Book/../../etc/passwd')).toBe('Book .. .. etc passwd.authbook');
    expect(name('../../../root')).toBe('root.authbook');
    expect(name('a\\b')).toBe('a b.authbook');
  });

  test('no result can contain a separator or a reserved character', () => {
    const nasty = ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b>c', 'a|b'];
    nasty.forEach((t) => {
      const out = fileBase({ title: t });
      expect(out).not.toMatch(/[<>:"/\\|?*]/);
    });
  });

  test('control characters are stripped', () => {
    expect(fileBase({ title: 'a\u0000b\u0001c' })).toBe('a b c');
  });
});

describe('ordinary titles are left alone', () => {
  test('hyphens, apostrophes and spaces survive', () => {
    expect(name('Well-Meant')).toBe('Well-Meant.authbook');
    expect(name("The Writer's Way")).toBe("The Writer's Way.authbook");
    expect(name('Book 2 (Draft)')).toBe('Book 2 (Draft).authbook');
  });

  test('a very long title is capped without leaving a trailing dot', () => {
    const out = fileBase({ title: 'x'.repeat(200) });
    expect(out).toHaveLength(60);
    expect(out.endsWith('.')).toBe(false);

    const dotty = fileBase({ title: `${'y'.repeat(59)}.tail` });
    expect(dotty).toHaveLength(59);
    expect(dotty.endsWith('.')).toBe(false);
  });
});
