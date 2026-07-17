/**
 * demoBook.js — "Good Knight" demo book for onboarding funnel.
 *
 * Populated during onboarding Step 1 (About You) and filtered out on
 * funnel completion or skip. Users see a real app experience before signup.
 *
 * TODO: Replace placeholder chapters with actual Good Knight content.
 * Each chapter should have: chap_idx, title, order, content, created, updated.
 */

const now = Date.now();

export const DEMO_BOOK = {
  id: '_demo_good_knight_' + now,
  title: 'Good Knight',
  preview: 'A tale of courage and honor in a world of fantasy.',
  content: 'A tale of courage and honor in a world of fantasy.',
  type: 'book',
  created: now,
  updated: now,
  _demo: true, // Flag to identify and filter demo books

  authors: ['AuthNo Demo'],
  genre: 'Fantasy',
  description: 'An epic adventure featuring a noble knight on a quest to save the realm.',
  language: 'English',
  publisher: 'AuthNo Demo',
  isbn: '',
  devices: [],

  chapters: [
    {
      chap_idx: 0,
      title: 'Chapter 1: The Call to Adventure',
      order: 0,
      content: `The morning sun cast long shadows across the stone courtyard as Sir Aldric received the summons. The scroll bore the royal seal—urgent and unmistakable. He had spent years training for this moment, though he never imagined it would come like this.

"The kingdom needs you," the messenger had said, his voice trembling with urgency. Somewhere in the dark forests beyond the eastern mountains, a darkness was stirring. An ancient evil that legends spoke of only in whispered tones.

Aldric gripped his sword, feeling its familiar weight at his side. His heart quickened with purpose. This was what it meant to be a knight—not the parades or the feasts, but the willingness to stand against the darkness when others could not.

He turned toward the stables, his mind already racing through the preparations he would need to make. Time was not their ally, and every moment of delay could cost lives.`,
      created: now,
      updated: now,
    },
    {
      chap_idx: 1,
      title: 'Chapter 2: Into the Wilderness',
      order: 1,
      content: `The forest path grew darker with each league they traveled. Aldric rode hard, pushing his horse forward through tangled undergrowth and twisted roots that seemed to reach up from the earth itself. The air grew cold—unnaturally so, even for autumn.

Behind him, the sounds of civilization faded away. Ahead, only uncertainty awaited. But he had not come this far to turn back. Knights did not yield when the stakes were highest.

A branch snapped somewhere to his left. Aldric's hand moved instantly to his sword hilt, every sense alert. In the dim light filtering through the canopy above, he caught movement—something massive and shadow-like.

"Come then," he whispered, drawing his blade. "Let us see what guards this cursed place."

The forest seemed to hold its breath, waiting.`,
      created: now,
      updated: now,
    },
    {
      chap_idx: 2,
      title: 'Chapter 3: The First Trial',
      order: 2,
      content: `The creature materialized from the shadows—a beast of nightmares with eyes like burning coals. Aldric had never seen anything like it, yet something deep within him remained calm. All his training, all those endless hours of practice, had prepared him for this moment.

He raised his sword, let it catch what little light remained. The creature roared, a sound that shook the very earth beneath his feet.

Aldric advanced, each step measured and sure. This was where heroes were made—not in quiet halls or peaceful times, but here, in the darkness, facing down fears that would break lesser men.

His blade sang as he struck, beginning a dance that would determine not just his fate, but the fate of everyone depending on him back in the kingdom.

The real battle had only just begun.`,
      created: now,
      updated: now,
    },
  ],
};

export function createDemoBook() {
  return { ...DEMO_BOOK, id: '_demo_good_knight_' + Date.now() };
}
