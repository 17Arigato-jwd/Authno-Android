import {
  createPrompts, PromptRefused, MAX_TITLE, MAX_MESSAGE,
  prompts, __resetPrompts,
} from './extensionPrompts.js';

afterEach(() => __resetPrompts());

function harness({ focus = false } = {}) {
  let editorFocused = focus;
  let changes = 0;
  const p = createPrompts({
    editorHasFocus: () => editorFocused,
    onChange: () => { changes += 1; },
  });
  return {
    p,
    focusEditor: (v) => { editorFocused = v; },
    changes: () => changes,
  };
}

describe('asking a question', () => {
  test('a prompt resolves with what was typed', async () => {
    const { p } = harness();
    const asked = p.prompt('demo', { title: 'Pen name?' });
    expect(p.current()).toMatchObject({ kind: 'prompt', extId: 'demo', title: 'Pen name?' });
    p.answer('Ursula');
    await expect(asked).resolves.toBe('Ursula');
  });

  test('a confirm resolves true when accepted', async () => {
    const { p } = harness();
    const asked = p.confirm('demo', { title: 'Sync now?' });
    p.answer();
    await expect(asked).resolves.toBe(true);
  });

  test('the dialog says who is asking', async () => {
    // A person answering deserves to know which extension is asking, and that
    // is the whole reason these are host-drawn.
    const { p } = harness();
    p.prompt('cloud-backup', { title: 'Folder?' });
    expect(p.current().extId).toBe('cloud-backup');
    p.dismiss();
  });

  test('a prompt carries its placeholder and initial value', async () => {
    const { p } = harness();
    p.prompt('demo', { title: 'Name?', placeholder: 'e.g. Ursula', initial: 'A' });
    expect(p.current()).toMatchObject({ placeholder: 'e.g. Ursula', initial: 'A' });
    p.dismiss();
  });

  test('a confirm can be marked dangerous', async () => {
    const { p } = harness();
    p.confirm('demo', { title: 'Delete?', danger: true });
    expect(p.current().danger).toBe(true);
    p.dismiss();
  });

  test('the resolver never leaks into what gets drawn', () => {
    const { p } = harness();
    p.prompt('demo', { title: 'Q' });
    expect(p.current().resolve).toBeUndefined();
    p.dismiss();
  });
});

describe('declining is an answer, not a failure', () => {
  test('a dismissed prompt resolves null and does not throw', async () => {
    const { p } = harness();
    const asked = p.prompt('demo', { title: 'Q' });
    p.dismiss();
    await expect(asked).resolves.toBeNull();
  });

  test('a dismissed confirm resolves false', async () => {
    const { p } = harness();
    const asked = p.confirm('demo', { title: 'Q' });
    p.dismiss();
    await expect(asked).resolves.toBe(false);
  });

  test('an extension that never catches cannot produce an unhandled rejection', async () => {
    // Declining is the ordinary outcome. If it rejected, every extension that
    // forgot a catch would blow up the first time somebody said no.
    const { p } = harness();
    const results = [];
    p.prompt('demo', { title: 'Q' }).then((v) => results.push(v));
    p.dismiss();
    await Promise.resolve();
    expect(results).toEqual([null]);
  });

  test('answering or dismissing with nothing open is harmless', () => {
    const { p } = harness();
    expect(p.answer('x')).toBe(false);
    expect(p.dismiss()).toBe(false);
  });
});

describe('the editor keeps its keystrokes', () => {
  test('a prompt is refused while the editor has focus', async () => {
    // A dialog stealing focus mid-sentence eats what is being typed into it.
    const { p } = harness({ focus: true });
    await expect(p.prompt('demo', { title: 'Q' }))
      .rejects.toMatchObject({ code: 'editor-has-focus' });
    expect(p.current()).toBeNull();
  });

  test('it is refused rather than deferred', async () => {
    // Queueing it would put the dialog up later, out of context, in answer to
    // something the user has since stopped doing.
    const { p, focusEditor } = harness({ focus: true });
    await p.prompt('demo', { title: 'Q' }).catch(() => {});
    focusEditor(false);
    expect(p.pending()).toBe(0);
    expect(p.current()).toBeNull();
  });

  test('once focus leaves the editor, asking works', async () => {
    const { p, focusEditor } = harness({ focus: true });
    await p.prompt('demo', { title: 'Q' }).catch(() => {});
    focusEditor(false);
    const asked = p.prompt('demo', { title: 'Q' });
    p.answer('ok');
    await expect(asked).resolves.toBe('ok');
  });
});

describe('one at a time', () => {
  test('a second question from the same extension is refused', async () => {
    const { p } = harness();
    p.prompt('demo', { title: 'First' });
    await expect(p.prompt('demo', { title: 'Second' }))
      .rejects.toMatchObject({ code: 'already-asking' });
    p.dismiss();
  });

  test('a different extension queues rather than drawing over it', async () => {
    // Two dialogs at once is not a decision, it is a pile.
    const { p } = harness();
    const first = p.prompt('a', { title: 'A?' });
    const second = p.prompt('b', { title: 'B?' });

    expect(p.current().extId).toBe('a');
    expect(p.pending()).toBe(2);

    p.answer('one');
    expect(p.current().extId).toBe('b');
    p.answer('two');

    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
  });

  test('the queue drains in order', async () => {
    const { p } = harness();
    const asked = ['a', 'b', 'c'].map((id) => p.prompt(id, { title: id }));
    const seen = [];
    for (let i = 0; i < 3; i++) { seen.push(p.current().extId); p.answer(p.current().extId); }
    expect(seen).toEqual(['a', 'b', 'c']);
    await expect(Promise.all(asked)).resolves.toEqual(['a', 'b', 'c']);
  });
});

describe('a question is refused rather than quietly reshaped', () => {
  test('an over-long title is refused', async () => {
    const { p } = harness();
    await expect(p.prompt('demo', { title: 'x'.repeat(MAX_TITLE + 1) }))
      .rejects.toMatchObject({ code: 'title-too-long' });
  });

  test('an over-long message is refused', async () => {
    const { p } = harness();
    await expect(p.confirm('demo', { title: 'Q', message: 'y'.repeat(MAX_MESSAGE + 1) }))
      .rejects.toMatchObject({ code: 'message-too-long' });
  });

  test('truncating a confirm would change the question, which is why it is refused', async () => {
    // "Delete every book permanently?" cut to fit is a different question, and
    // it is the dangerous half that gets cut.
    const { p } = harness();
    const dangerous = `Delete every book permanently? ${'.'.repeat(MAX_TITLE)}`;
    await expect(p.confirm('demo', { title: dangerous })).rejects.toBeInstanceOf(PromptRefused);
    expect(p.current()).toBeNull();
  });

  test('exactly at the limit is allowed', async () => {
    const { p } = harness();
    const asked = p.prompt('demo', {
      title: 'x'.repeat(MAX_TITLE), message: 'y'.repeat(MAX_MESSAGE),
    });
    expect(p.current()).not.toBeNull();
    p.dismiss();
    await expect(asked).resolves.toBeNull();
  });

  test('a dialog with nothing in it is refused', async () => {
    const { p } = harness();
    await expect(p.prompt('demo', {})).rejects.toMatchObject({ code: 'empty' });
    await expect(p.prompt('demo', { title: '', message: '' }))
      .rejects.toMatchObject({ code: 'empty' });
  });

  test('a refused question does not occupy the queue', async () => {
    const { p } = harness();
    await p.prompt('demo', { title: 'x'.repeat(200) }).catch(() => {});
    expect(p.pending()).toBe(0);
    const asked = p.prompt('demo', { title: 'fine' });
    p.answer('ok');
    await expect(asked).resolves.toBe('ok');
  });
});

describe('an extension that goes away mid-question', () => {
  test('its visible dialog is settled, not left hanging', async () => {
    // The frame is going. A promise nobody will ever resolve is a leak inside
    // a sandbox that is about to be destroyed.
    const { p } = harness();
    const asked = p.prompt('demo', { title: 'Q' });
    expect(p.cancelFor('demo')).toBe(1);
    await expect(asked).resolves.toBeNull();
    expect(p.current()).toBeNull();
  });

  test('its queued questions are settled too', async () => {
    const { p } = harness();
    const other = p.prompt('other', { title: 'first in line' });
    const mine = p.confirm('demo', { title: 'queued' });

    expect(p.cancelFor('demo')).toBe(1);
    await expect(mine).resolves.toBe(false);

    expect(p.current().extId).toBe('other');
    p.answer('x');
    await expect(other).resolves.toBe('x');
  });

  test('cancelling promotes whatever was behind it', async () => {
    const { p } = harness();
    const a = p.prompt('a', { title: 'A' });
    const b = p.prompt('b', { title: 'B' });
    p.cancelFor('a');
    expect(p.current().extId).toBe('b');
    p.answer('bee');
    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toBe('bee');
  });

  test('cancelling an extension with nothing open is harmless', () => {
    const { p } = harness();
    expect(p.cancelFor('nobody')).toBe(0);
  });
});

describe('notification', () => {
  test('the UI is told when the visible dialog changes', () => {
    const { p, changes } = harness();
    const before = changes();
    p.prompt('demo', { title: 'Q' });
    p.dismiss();
    expect(changes()).toBeGreaterThan(before);
  });

  test('a listener that throws does not break the caller', () => {
    const p = createPrompts({ onChange: () => { throw new Error('render bug'); } });
    expect(() => p.prompt('demo', { title: 'Q' })).not.toThrow();
  });

  test('the shared instance is one object', () => {
    expect(prompts()).toBe(prompts());
  });
});
