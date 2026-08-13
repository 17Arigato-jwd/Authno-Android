import { countWords, countWordsIn, plainText } from './wordCount';

describe('scripts that separate words with spaces', () => {
  test('English is unchanged', () => {
    expect(countWords('<p>the lighthouse keeper has never seen the sea</p>')).toBe(8);
    expect(countWordsIn('one two three')).toBe(3);
  });

  test('Russian, Arabic and Korean use spaces and always counted correctly', () => {
    expect(countWords('<p>Смотритель маяка никогда не видел моря.</p>')).toBe(6);
    expect(countWords('<p>حارس المنارة لم ير البحر قط.</p>')).toBe(6);
    expect(countWords('<p>등대지기는 바다를 본 적이 없다.</p>')).toBe(5);
  });
});

describe('scripts that do not', () => {
  /**
   * The bug. Every one of these counted as ONE word, so a writer working in
   * them could not reach a daily goal, the streak never lit, and the nightly
   * reminder asked for words they had already written.
   */
  test('Japanese is counted as words, not as one', () => {
    expect(countWords('<p>灯台守は海を見たことがない。</p>')).toBeGreaterThan(4);
  });

  test('Chinese is counted as words, not as one', () => {
    expect(countWords('<p>守塔人从未见过大海。</p>')).toBeGreaterThan(3);
  });

  test('Thai is counted as words, not as one', () => {
    expect(countWords('<p>ผู้ดูแลประภาคารไม่เคยเห็นทะเล</p>')).toBeGreaterThan(3);
  });

  /**
   * The consequence that actually mattered: a real session has to be able to
   * clear a real goal. A chapter of Japanese prose used to score about 20.
   */
  test('a chapter of Japanese clears a 300-word goal', () => {
    const chapter = `<p>${'灯台守は海を見たことがない。'.repeat(40)}</p>`;
    expect(countWords(chapter)).toBeGreaterThanOrEqual(300);
  });

  test('mixed scripts in one paragraph are all counted', () => {
    const n = countWords('<p>The keeper 灯台守 never saw the sea</p>');
    expect(n).toBeGreaterThan(6);
  });
});

describe('the html stripping every old counter did', () => {
  test('tags go, text stays', () => {
    expect(plainText('<p>one</p><p>two</p>')).toBe('one two');
    expect(countWords('<p>one</p><p>two</p>')).toBe(2);
  });

  test('&nbsp; is a space, not a word', () => {
    expect(countWords('<p>one&nbsp;two</p>')).toBe(2);
    expect(countWords('<p>one&NBSP;two</p>')).toBe(2);
  });

  test('nothing is zero, not one', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('<p></p>')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWordsIn('')).toBe(0);
  });

  /**
   * Latin text keeps its historical count exactly, punctuation included.
   *
   * The segmenter would call "..." zero words; the old whitespace split called
   * it one, and the fast path deliberately still does. word_count is stored in
   * every .authbook and seeds the streak baseline, so changing how English
   * counts would silently renumber every manuscript already written and shift
   * everyone's totals on next open. Being consistent with the files on disk is
   * worth more than being right about a paragraph of ellipses.
   */
  test('Latin counting is unchanged, down to the punctuation', () => {
    expect(countWords('<p>...</p>')).toBe(1);
    expect(countWords('<p>hello, world!</p>')).toBe(2);
    expect(countWords('<p>one - two</p>')).toBe(3);
  });
});

describe('the counters that must agree', () => {
  /**
   * The manifest count seeds the in-app cache, the streak measures against
   * that cache, and history compares the two. When they disagreed the streak
   * baseline drifted after the first edit — which is why all of them now come
   * from this one function. Imported by their old names, asserted identical.
   */
  test('every consumer resolves to the same implementation', async () => {
    const [{ wordCountOf }, { countWords: streakCount }, { wordCount: dashCount }] =
      await Promise.all([import('./history'), import('../components/Streak'), import('../components/BookDashboard')]);
    const samples = ['<p>hello there world</p>', '<p>灯台守は海を見たことがない。</p>', '', '<p>a&nbsp;b</p>'];
    samples.forEach((s) => {
      const base = countWords(s);
      expect(wordCountOf(s)).toBe(base);
      expect(streakCount(s)).toBe(base);
      expect(dashCount(s)).toBe(base);
    });
  });
});
