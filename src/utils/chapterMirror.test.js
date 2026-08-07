import { sessionToBook } from './authbook';

// Does the chapter-1 mirror get written back into the SAME chapter it was
// taken from? App.js computes it from the lowest `order`; sessionToBook writes
// it into array index 0. Reordering changes `order` without moving the array
// element, so the two can point at different chapters.
describe('the chapter-1 mirror round-trips into the right chapter', () => {
  test('array order matching sort order is fine', () => {
    const book = sessionToBook({
      id: 'b', title: 'N',
      content: '<p>ONE</p>',
      chapters: [
        { chap_idx: 1, order: 1, title: 'One', content: '<p>ONE</p>' },
        { chap_idx: 2, order: 2, title: 'Two', content: '<p>TWO</p>' },
      ],
    });
    expect(book.chapters[0].content).toBe('<p>ONE</p>');
    expect(book.chapters[1].content).toBe('<p>TWO</p>');
  });

  test('after a reorder, the mirror must not land in the wrong chapter', () => {
    // This is the state handleMoveChapter produces: `order` swapped, array
    // positions untouched. The mirror was taken from the lowest order (ch2).
    const book = sessionToBook({
      id: 'b', title: 'N',
      content: '<p>TWO</p>',          // mirror of the first-by-order chapter
      chapters: [
        { chap_idx: 1, order: 2, title: 'One', content: '<p>ONE</p>' },
        { chap_idx: 2, order: 1, title: 'Two', content: '<p>TWO</p>' },
      ],
    });
    const byIdx = (i) => book.chapters.find((c) => c.chap_idx === i);
    expect(byIdx(1).content).toBe('<p>ONE</p>');   // must NOT become TWO
    expect(byIdx(2).content).toBe('<p>TWO</p>');
  });
});
