/**
 * demoBook.js — "The Good Knight" demo book for the onboarding funnel.
 *
 * Instantiated on funnel entry and filtered out on completion or skip
 * (matched by the _demo flag). Users get a real book to explore before
 * they've signed up or created anything.
 *
 * Chapter content is HTML — the editor is a contentEditable that syncs
 * via innerHTML, so paragraphs must be <p> elements, not \n\n text.
 *
 * Chapter 1 is final content from the author. Further chapters can be
 * appended to CHAPTERS when provided.
 */

const CHAPTER_1_HTML = `
<p>“Ah… finally. We’re HERE!”</p>
<p>“Calm down Joseph, how long did it take, about 2 days?” said Catrina, clearly exhausted from the long carriage ride.</p>
<p>Eclas suddenly shouted, “Hey guards, you need to pay more attention, we’re supposed to reach fort Bayzid quietly. All your shouting would wake up the animals.”</p>
<p>“Oh come on!” the guards whispered amongst themselves, “He never lets us take a break.”</p>
<p>“Don’t be too harsh on them Eclas, they’re only human after all. Besides, we can already see fort Bayzid come into view from here,” A soft female voice came from inside the carriage.</p>
<p>“But Princess!” Eclas exclaimed, but soon quieted down.</p>
<p>“It's as the rumors say Catrina, Fort Bayzid truly looks beautiful at night” Joseph quietly mentioned.</p>
<p>Soon the gates of the castle came into view. The lights illuminated a few figures standing in front of the gates, their faces hidden by shadows.</p>
<p>“State your identity and purpose!” Eclas shouted from afar.</p>
<p>A man walked forward, his face now visible. He was a bald man, preferably in his thirties, looking at his attire it seemed as if he were a mercenary. He was resting a blade on his shoulder.</p>
<p>He then spoke, “Oh look who it is, isn’t it our little princess Penelope? General Raymond brings you his thanks.” He pointed his sword towards the carriage.</p>
<p>Suddenly an arrow flew past Eclas and hit Joseph right in his head, Before Eclas could react another one whizzed past him and killed Catrina. Eclas quickly reached out to his utility belt and pulled out a bunch of pellets and threw them towards the general direction of where the arrows flew from. A huge explosion occured as soon as the pellets landed, some blood splashed upon the dirt road. By that time the bald man had already reached Eclas and struck down his horse. Eclas slit his throat as he fell. The rest of the group chased after them. By this time all the commotion had made the princess open the carriage door to look outside. Eclas pulled himself out of the dead horse and threw some smokebomb pellets as he rolled towards the carriage. The group coughed and was successfully slowed down. Eclas then rushed over, grabbed the princess and carried her into his arms, but as soon as he turned towards the opposite direction to run, he was greeted by a man with a gun. Eclas wasn’t able to react fast enough and the shot hit the lady. Eclas screamed and instantly slit the gunman’s throat. He then ran, imbuing mana in his feet to make him run faster. He ran and ran, he needed to save his princess.</p>
<p style="text-align: center;">⁂</p>
<p>“It's all gonna be alright, P-Princess. D-Don’t worry.” I called out to her as I ran through the forest, carrying her injured body in my arms.</p>
<p>The princess just looked at me, her cold arms stretching and touching my warm sweaty cheek.</p>
<p>I ran, I ran as fast as I could, I had to reach the nearest village and save her. My lungs burned, my sweat dripping down from my forehead onto the dry dirt.</p>
<p>Her breathing had slowed down considerably, her body growing colder.</p>
<p>I couldn’t stop the tears that formed in my eyes. I needed to save her.</p>
<p>But all she did was look at me with a smile in her eyes, as if she had accepted her fate. The moonlight shined upon her beautiful face, as if she were made of the starlight itself.</p>
<p>Soon, we came out of that forest, but her already ashen skin had grown terribly pale, she had lost a lot of blood. Of course she would, she wasn’t trained to survive injuries of the degree she faced.</p>
<p>“If only I were stronger,” I let my thoughts slip out as I took a look at the so-called cold-hearted princess of doom.</p>
<p>“Come on, Eclas, you know this was bound to eventually happen… I already knew what I was getting myself into.”</p>
<p>“But, Princess–” That was all I could mutter.</p>
<p>The night was beautiful, the moonlight glistened upon the fields of dandelions that we passed through.</p>
<p>Eventually she looked at me with a kind of sorrow in her eyes. “Eclas,” she called out to me, “It is time.”</p>
<p>To be honest, I already knew. But I wasn’t willing to accept the truth. I kept on running, but eventually I fell down on my knees. I looked at her with eyes full of tears.</p>
<p>“Why– Why me?”</p>
<p>“Eclas…,” she said, “I am glad.”</p>
<p>She looked at the full moon shining upon the field of flowers,</p>
<p>“If only for a moment, I truly am glad I got to experience all of that.”</p>
<p>“Thank you, Eclas, you helped me free myself from all of those shackles they put on me. If it weren’t for you, I may as well never have become who I am.”</p>
<p>“But it does make me sad when looking at you. You who once hated me so much. The one who sacrificed so much for me. I only wish you don’t stay shackled to the guilt of what my own actions caused.”</p>
<p>“But I’m tired, Eclas, you can put me down now.”</p>
<p>I put her down on the ground, caressing her head so as to provide her whatever comfort I could, with tears flowing down my cheek.</p>
<p>“Princess—” A sharp, ragged sob caught in my throat, cutting off my words. “Why did you do it?” Deep down, I already knew. It was something that needed to be done, but why. Why <i>her</i>. Why did <i>she</i> have to do it.</p>
<p>“I’m sorry, Eclas, I hope you’ll be able to forgive this foolish girl for her countless mistakes,” the princess said. All I could do was look at her as her body went cold. Her eyes went dark. And I knew it was all over.</p>
<p>“Good night…”</p>
<p>I hesitated, the name tasting foreign and heavy on my tongue.</p>
<p>“Penelope… My eternal, incomplete…”</p>
<p>My mind went entirely blank, but my lips moved anyway, betraying a truth I hadn't even known I was carrying.</p>
<p>“…love.”</p>
`.trim();

const PREVIEW = '“Ah… finally. We’re HERE!” “Calm down Joseph, how long did it take, about 2 days?” said Catrina, clearly exhausted from the long carriage ride.';

export function createDemoBook() {
  const now = Date.now();
  return {
    id: '_demo_good_knight_' + now,
    title: 'The Good Knight',
    preview: PREVIEW,
    content: PREVIEW,
    type: 'book',
    created: now,
    updated: now,
    _demo: true, // identifies the demo book so it can be filtered out

    authors: ['AuthNo'],
    genre: 'Fantasy',
    description: 'The tale of the knight Eclas and Princess Penelope — a demo story to explore AuthNo with.',
    language: 'English',
    publisher: '',
    isbn: '',
    devices: [],

    chapters: [
      {
        chap_idx: 0,
        title: 'Chapter 1',
        order: 0,
        content: CHAPTER_1_HTML,
        created: now,
        updated: now,
      },
    ],
  };
}
