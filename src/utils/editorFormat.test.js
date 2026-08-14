/**
 * Defanging a book file.
 *
 * A `.authbook` is a file writers send each other, and its chapters go
 * straight into a contentEditable. Anything executable in one would run with
 * the app's own reach: the books on disk, and everything in localStorage.
 *
 * The second half of these tests matters as much as the first. This runs on
 * every book the app opens, including ones that have been on the device for a
 * year, because the door they come through cannot tell them apart — so it has
 * to leave a writer's own formatting exactly as it found it. A sanitiser that
 * quietly deletes somebody's highlights is not a safer app, it is a different
 * bug.
 */

import { defangHtml, defangChapters } from './editorFormat';

describe('what cannot survive', () => {
  test('a script tag', () => {
    expect(defangHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });

  test('an image with an onerror — the one that actually fires', () => {
    const out = defangHtml('<p>chapter one</p><img src="x" onerror="fetch(\'//evil\')">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('chapter one');
  });

  test('event handlers on tags that are otherwise fine', () => {
    const out = defangHtml('<p onclick="steal()" onmouseover="x()">text</p>');
    expect(out).not.toMatch(/onclick|onmouseover/i);
    expect(out).toContain('text');
  });

  test('a javascript: link, without taking the words with it', () => {
    const out = defangHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('click');
  });

  test('iframes, objects, embeds and forms', () => {
    const out = defangHtml(
      '<iframe src="//x"></iframe><object data="x"></object><embed src="x">' +
      '<form action="//x"><input name="p"></form><p>kept</p>'
    );
    expect(out).toBe('<p>kept</p>');
  });

  test('svg, which carries its own script', () => {
    const out = defangHtml('<svg><script>alert(1)</script></svg><p>kept</p>');
    expect(out).not.toMatch(/svg|script/i);
    expect(out).toContain('kept');
  });

  test('a data: URL', () => {
    const out = defangHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toMatch(/data:/i);
  });

  test('case and spacing do not smuggle anything through', () => {
    const out = defangHtml('<P OnClick="x()">a</P><SCRIPT>b</SCRIPT>');
    expect(out.toLowerCase()).not.toMatch(/onclick|<script/);
  });
});

describe('what must survive untouched', () => {
  /**
   * These are the tags and styles the editor itself writes. The paste
   * whitelist would strip most of them, which is exactly why this is not the
   * paste whitelist.
   */
  test('colours and highlights, which execCommand writes as inline styles', () => {
    const html = '<p><span style="color: rgb(255, 0, 0);">red</span> and '
      + '<span style="background-color: yellow;">highlighted</span></p>';
    expect(defangHtml(html)).toBe(html);
  });

  test('fonts, sizes and line spacing', () => {
    const html = '<p style="line-height: 1.8;"><span style="font-family: Georgia; font-size: 19px;">x</span></p>';
    expect(defangHtml(html)).toBe(html);
  });

  test('bold, italics, headings, lists, quotes and rules', () => {
    const html = '<h1>One</h1><p><b>b</b><i>i</i><u>u</u><s>s</s></p>'
      + '<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><hr>';
    // A round trip through the parser normalises `<hr>` and nothing else, so
    // compare on the parts rather than the whole string.
    const out = defangHtml(html);
    for (const frag of ['<h1>One</h1>', '<b>b</b>', '<i>i</i>', '<u>u</u>', '<s>s</s>',
      '<ul><li>a</li></ul>', '<ol><li>b</li></ol>', '<blockquote>q</blockquote>']) {
      expect(out).toContain(frag);
    }
  });

  test('an ordinary link keeps its href and its rel', () => {
    const html = '<a href="https://example.com" rel="noopener">source</a>';
    expect(defangHtml(html)).toBe(html);
  });

  test('anchors and ids, which the thread layer writes', () => {
    const html = '<span id="thread-4" class="authno-anchor" data-thread="4">x</span>';
    expect(defangHtml(html)).toBe(html);
  });

  /**
   * The parse-and-reserialise round trip has to be a fixed point, or a book
   * opened and saved a hundred times drifts a hundred steps from what was
   * written. contenteditable emits &nbsp; constantly, so that is the entity
   * that would do it.
   */
  test('a round trip is stable — opening a book does not rewrite it', () => {
    const html = '<p>a&nbsp;b</p><p><span style="color: red;">c&amp;d</span></p>';
    const once = defangHtml(html);
    expect(once).toBe(html);
    expect(defangHtml(once)).toBe(once);
  });

  test('empty, missing and non-string input', () => {
    expect(defangHtml('')).toBe('');
    expect(defangHtml(null)).toBe('');
    expect(defangHtml(undefined)).toBe('');
    expect(defangHtml(42)).toBe(42);
  });
});

describe('a whole book', () => {
  test('every chapter is cleaned and the rest of the chapter is left alone', () => {
    const chapters = [
      { chap_idx: 1, title: 'One', word_count: 3, content: '<p>a</p><script>x</script>' },
      { chap_idx: 2, title: 'Two', word_count: 9, content: '<p style="color: red;">b</p>' },
    ];
    const out = defangChapters(chapters);
    expect(out[0].content).toBe('<p>a</p>');
    expect(out[0].title).toBe('One');
    expect(out[0].word_count).toBe(3);
    expect(out[1].content).toBe('<p style="color: red;">b</p>');
  });

  /**
   * An unhydrated chapter is `content: null` — distinct from empty, and the
   * flag every save guard reads. Turning it into '' would tell those guards
   * the book is complete when a chapter is still missing.
   */
  test('an unloaded chapter stays unloaded', () => {
    const out = defangChapters([{ chap_idx: 1, content: null, word_count: 88000 }]);
    expect(out[0].content).toBeNull();
  });

  test('it does not mutate what it was given', () => {
    const chapters = [{ chap_idx: 1, content: '<p>a</p><script>x</script>' }];
    defangChapters(chapters);
    expect(chapters[0].content).toContain('<script>');
  });

  test('a book with no chapters is not a crash', () => {
    expect(defangChapters(undefined)).toBeUndefined();
    expect(defangChapters([])).toEqual([]);
    expect(() => defangChapters([null, undefined])).not.toThrow();
  });
});
