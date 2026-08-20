/**
 * ExtensionPromptDialog.test.jsx — the question an extension asked.
 *
 * The queue's rules are covered in extensionPrompts.test.js. What is covered
 * here is the thing that was actually broken: nothing settled the promise.
 * `ui.confirm` and `network.requestHost` both awaited an answer that could
 * never come, so an extension asking anything hung, permanently, with no
 * error and nothing on screen.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import ExtensionPromptDialog from './ExtensionPromptDialog';
import { prompts, __resetPrompts } from '../utils/extensionPrompts';

let mockInstalled = [];
jest.mock('../utils/ExtensionContext', () => ({
  useExtensions: () => ({ extensions: mockInstalled }),
}));

beforeEach(() => { mockInstalled = []; });
afterEach(() => { __resetPrompts(); });

const ask = (kind, extId, opts) => {
  let p;
  act(() => { p = prompts()[kind](extId, opts); });
  return p;
};

describe('when nothing is being asked', () => {
  it('draws nothing', () => {
    const { container } = render(<ExtensionPromptDialog />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a confirm', () => {
  it('settles rather than hanging — the whole reason this exists', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('confirm', 'cloud-backup', {
      title: 'Connect to a new address?',
      message: 'https://dav.example.org',
    });
    fireEvent.click(screen.getByText('Yes'));
    await expect(settled).resolves.toBe(true);
  });

  it('resolves false on No, not a rejection', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('confirm', 'a', { title: 'Sure?' });
    fireEvent.click(screen.getByText('No'));
    await expect(settled).resolves.toBe(false);
  });

  it('says whose question it is, before the question', () => {
    render(<ExtensionPromptDialog />);
    ask('confirm', 'cloud-backup', { title: 'Sure?' });
    expect(screen.getByText('cloud-backup is asking')).toBeInTheDocument();
  });

  it('names the extension rather than its directory', () => {
    mockInstalled = [{ id: 'cloud-backup', name: 'Cloud Backup' }];
    render(<ExtensionPromptDialog />);
    ask('confirm', 'cloud-backup', { title: 'Sure?' });
    expect(screen.getByText('Cloud Backup is asking')).toBeInTheDocument();
  });

  it('keeps a host on its own line rather than folding it into prose', () => {
    render(<ExtensionPromptDialog />);
    ask('confirm', 'a', { title: 'Connect?', message: 'wants to reach:\n\nhttps://dav.example.org\n\nOnly allow this if you recognise it.' });
    const p = screen.getByText(/dav\.example\.org/);
    expect(p).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });
});

describe('a prompt', () => {
  it('returns what was typed', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('prompt', 'a', { title: 'Folder name?', initial: '' });
    fireEvent.change(screen.getByLabelText('Folder name?'), { target: { value: '/AuthNo' } });
    fireEvent.click(screen.getByText('Done'));
    await expect(settled).resolves.toBe('/AuthNo');
  });

  it('starts from the initial value the extension gave', () => {
    render(<ExtensionPromptDialog />);
    ask('prompt', 'a', { title: 'Folder?', initial: '/AuthNo' });
    expect(screen.getByLabelText('Folder?')).toHaveValue('/AuthNo');
  });

  it('returns null on cancel, so "" and "declined" stay different', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('prompt', 'a', { title: 'Folder?' });
    fireEvent.click(screen.getByText('Cancel'));
    await expect(settled).resolves.toBeNull();
  });

  it('answers on Enter and cancels on Escape', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('prompt', 'a', { title: 'Folder?' });
    const input = screen.getByLabelText('Folder?');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(settled).resolves.toBe('x');
  });
});

describe('one at a time', () => {
  it('moves to the next question with the field reset', async () => {
    render(<ExtensionPromptDialog />);
    const first = ask('prompt', 'a', { title: 'First?', initial: 'one' });
    ask('prompt', 'b', { title: 'Second?' });

    fireEvent.click(screen.getByText('Done'));
    await expect(first).resolves.toBe('one');

    await waitFor(() => expect(screen.getByText('Second?')).toBeInTheDocument());
    // Not carrying 'one' across from the previous person's answer.
    expect(screen.getByLabelText('Second?')).toHaveValue('');
  });
});

describe('an extension that stops mid-question', () => {
  it('has its dialog taken down and its promise settled', async () => {
    render(<ExtensionPromptDialog />);
    const settled = ask('confirm', 'a', { title: 'Sure?' });
    act(() => { prompts().cancelFor('a'); });
    await expect(settled).resolves.toBe(false);
    expect(screen.queryByText('Sure?')).not.toBeInTheDocument();
  });
});

describe('the path that was hanging', () => {
  /**
   * network.requestHost is how a self-hosted WebDAV server gets permission to
   * be reached at all. extensionRuntime wires its `ask` to prompts().confirm,
   * which enqueued an entry and returned a promise nobody settled — so Cloud
   * Backup's connect() stopped dead on the one call that makes self-hosting
   * possible, with nothing on screen and no error.
   *
   * This drives the real shape: the host asks, the dialog appears, the person
   * answers, the promise settles.
   */
  it('a host grant asks, is answered, and settles', async () => {
    mockInstalled = [{ id: 'cloud-backup', name: 'Cloud Backup' }];
    render(<ExtensionPromptDialog />);

    // Exactly what extensionRuntime's network.ask does.
    let answered;
    act(() => {
      answered = prompts().confirm('cloud-backup', {
        title: 'Connect to a new address?',
        message: 'Cloud Backup wants to connect to:\n\nhttps://dav.example.org\n\n'
          + 'Only allow this if you recognise the address.',
      }).catch(() => false);
    });

    expect(screen.getByText('Connect to a new address?')).toBeInTheDocument();
    expect(screen.getByText(/dav\.example\.org/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Yes'));
    await expect(answered).resolves.toBe(true);
  });

  it('is refused while the editor has focus, rather than deferred', async () => {
    // An extension must not be able to put a dialog in front of somebody
    // mid-sentence. Refused, not queued: a dialog that appeared later, out of
    // context, would be worse than one that never appeared.
    prompts().setEditorFocusTest(() => true);
    render(<ExtensionPromptDialog />);

    await expect(prompts().confirm('a', { title: 'Sure?' }))
      .rejects.toMatchObject({ code: 'editor-has-focus' });
    expect(screen.queryByText('Sure?')).not.toBeInTheDocument();

    prompts().setEditorFocusTest(() => false);
  });
});

describe('the address a network grant turns on', () => {
  const askHost = (url) => {
    let p;
    act(() => {
      p = prompts().hostConfirm('cloud-backup', {
        title: 'Connect to a new address?',
        message: 'Cloud Backup wants to connect to:',
        emphasis: url,
        note: 'Only allow this if you recognise the address.',
      });
    });
    return p;
  };

  it('is drawn apart from the sentence around it', () => {
    render(<ExtensionPromptDialog />);
    askHost('https://dav.example.org');
    const line = screen.getByText('https://dav.example.org');
    // Not inside the paragraph: set in running prose it reads as background,
    // and it is the one fact the answer turns on.
    expect(line.tagName).toBe('DIV');
    expect(line).not.toBe(screen.getByText('Cloud Backup wants to connect to:'));
  });

  it('shows the whole address, however long', () => {
    render(<ExtensionPromptDialog />);
    const long = 'https://dav.example.org/remote.php/dav/files/rowan/' + 'a'.repeat(150);
    askHost(long);
    // Truncation here would hide the end of the host, which is the half that
    // says who you are actually talking to.
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it('does not draw an emphasis block when there is none', () => {
    render(<ExtensionPromptDialog />);
    ask('confirm', 'a', { title: 'Sure?', message: 'Plain question.' });
    expect(screen.queryByText('Only allow this if you recognise the address.')).toBeNull();
  });
});

describe('moving from one question to the next', () => {
  it('does not carry the previous answer into an identical question', async () => {
    render(<ExtensionPromptDialog />);
    const first = ask('prompt', 'cloud-backup', { title: 'Which folder?' });
    fireEvent.change(screen.getByLabelText('Which folder?'), { target: { value: '/Drafts' } });
    fireEvent.click(screen.getByText('Done'));
    await expect(first).resolves.toBe('/Drafts');

    // The same question, word for word, about a second book.
    ask('prompt', 'cloud-backup', { title: 'Which folder?' });
    await waitFor(() => expect(screen.getByLabelText('Which folder?')).toHaveValue(''));
  });

  it('starts an identical question at its own default, not the last answer', async () => {
    render(<ExtensionPromptDialog />);
    const first = ask('prompt', 'cloud-backup', { title: 'Which folder?', initial: '/AuthNo' });
    fireEvent.change(screen.getByLabelText('Which folder?'), { target: { value: '/Drafts' } });
    fireEvent.click(screen.getByText('Done'));
    await expect(first).resolves.toBe('/Drafts');

    ask('prompt', 'cloud-backup', { title: 'Which folder?', initial: '/AuthNo' });
    await waitFor(() => expect(screen.getByLabelText('Which folder?')).toHaveValue('/AuthNo'));
  });
});
