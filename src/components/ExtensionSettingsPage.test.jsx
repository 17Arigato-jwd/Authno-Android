/**
 * ExtensionSettingsPage.test.jsx — the controls an extension declared.
 *
 * `extensionSettingsSchema.js` validated, coerced, reconciled and defaulted
 * these, and its own tests cover all of that. What is covered here is that any
 * of it reaches a screen: before this component, a manifest could declare a
 * folder field and a sync toggle, pass validation, and land nowhere.
 *
 * The mocks are plain functions rather than `jest.fn(impl)` wherever the
 * implementation matters — CRA sets `resetMocks: true`, which strips the
 * implementation off every `jest.fn` before each test. A `jest.fn()` created
 * inside a test body is fine, which is how the call assertions work.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExtensionSettingsPage from './ExtensionSettingsPage';
import { getExtensionConfig, clearExtensionConfig } from '../utils/extensionLoader';

let mockRegistry = null;
jest.mock('../utils/extensionRuntime', () => ({
  commandsV2: () => mockRegistry,
  hostV2: () => null,
}));

const EXT = 'com.example.demo';
const manifest = (schema) => ({ id: EXT, name: 'Demo', settings: { schema } });

beforeEach(() => {
  mockRegistry = null;
  clearExtensionConfig(EXT);
});

describe('drawing what was declared', () => {
  it('renders a control for each entry', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'toggle', key: 'sync', label: 'Back up automatically' },
      { type: 'text', key: 'folder', label: 'Folder' },
    ])} />);
    expect(screen.getByText('Back up automatically')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder')).toBeInTheDocument();
  });

  it('nests a section', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      {
        type: 'section',
        label: 'Advanced',
        children: [{ type: 'toggle', key: 'debug', label: 'Verbose log' }],
      },
    ])} />);
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Verbose log')).toBeInTheDocument();
  });

  it('starts a control at its declared default', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'text', key: 'folder', label: 'Folder', default: '/AuthNo' },
    ])} />);
    expect(screen.getByLabelText('Folder')).toHaveValue('/AuthNo');
  });

  it('shows the stored value over the default', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'select', key: 'when', label: 'Run', options: ['daily', 'weekly'], default: 'daily' },
    ])} />);
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'weekly' } });
    expect(getExtensionConfig(EXT).when).toBe('weekly');
  });
});

describe('writing a value', () => {
  it('stores a toggle', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'toggle', key: 'sync', label: 'Back up automatically' },
    ])} />);
    fireEvent.click(screen.getByLabelText('Back up automatically'));
    expect(getExtensionConfig(EXT).sync).toBe(true);
  });

  it('stores text as it is typed', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'text', key: 'folder', label: 'Folder' },
    ])} />);
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: '/Drafts' } });
    expect(getExtensionConfig(EXT).folder).toBe('/Drafts');
  });

  it('refuses a number outside the declared range', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'number', key: 'every', label: 'Minutes', min: 5, max: 60, default: 15 },
    ])} />);
    const field = screen.getByLabelText('Minutes');
    fireEvent.change(field, { target: { value: '900' } });
    fireEvent.blur(field);
    // Coerced on the way to storage, not merely on the way in. The input's own
    // `max` is a hint the browser may or may not enforce.
    expect(getExtensionConfig(EXT).every).toBeUndefined();
    expect(field).toHaveValue(15);
  });

  it('lets a number field be emptied while it is being typed into', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'number', key: 'every', label: 'Minutes', min: 5, default: 15 },
    ])} />);
    const field = screen.getByLabelText('Minutes');
    // "" and "-" and "1." are all on the way to a number and none of them are
    // one. Coercing per keystroke would put 15 back under the cursor.
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveValue(null);
    fireEvent.change(field, { target: { value: '30' } });
    fireEvent.blur(field);
    expect(getExtensionConfig(EXT).every).toBe(30);
  });

  it('toggles one option of a multiselect without disturbing the others', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'multiselect', key: 'kinds', label: 'Include', options: ['books', 'notes', 'themes'] },
    ])} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'books' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'themes' }));
    expect(getExtensionConfig(EXT).kinds).toEqual(['books', 'themes']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'books' }));
    expect(getExtensionConfig(EXT).kinds).toEqual(['themes']);
  });
});

describe('a schema that does not validate', () => {
  it('says so instead of drawing half a page', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'number', key: 'every', label: 'Minutes', min: 60, max: 5 },
    ])} />);
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Minutes')).toBeNull();
  });
});

describe('an action', () => {
  it('runs the command it names', async () => {
    const invoke = jest.fn(async () => {});
    mockRegistry = { invoke, subscribeReadout: () => () => {} };
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'action', label: 'Back up now', command: 'backup.run' },
    ])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('backup.run', []));
  });

  it('is disabled, not hidden, when the extension is not running', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'action', label: 'Back up now', command: 'backup.run' },
    ])} running={false} />);
    // A button that vanishes when an extension fails to start tells nobody
    // anything.
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
    expect(screen.getByText(/not running/i)).toBeInTheDocument();
  });
});

describe('a readout', () => {
  it('shows what its source reports', async () => {
    mockRegistry = {
      invoke: async () => 'Last backup: 10 minutes ago',
      subscribeReadout: (source, listener) => {
        listener({ value: 'Last backup: 10 minutes ago', error: null, at: 0 });
        return () => {};
      },
    };
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'readout', label: 'Status', source: 'backup.status' },
    ])} />);
    await waitFor(() => expect(screen.getByText('Last backup: 10 minutes ago')).toBeInTheDocument());
  });

  it('stops polling when the page goes away', () => {
    const stop = jest.fn();
    mockRegistry = { invoke: async () => null, subscribeReadout: () => stop };
    const { unmount } = render(<ExtensionSettingsPage manifest={manifest([
      { type: 'readout', label: 'Status', source: 'backup.status' },
    ])} />);
    unmount();
    // The registry polls only while somebody is subscribed, which is only true
    // if this actually unsubscribes.
    expect(stop).toHaveBeenCalled();
  });

  it('does not subscribe at all when the extension is not running', () => {
    const subscribeReadout = jest.fn(() => () => {});
    mockRegistry = { invoke: async () => null, subscribeReadout };
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'readout', label: 'Status', source: 'backup.status' },
    ])} running={false} />);
    expect(subscribeReadout).not.toHaveBeenCalled();
  });
});

describe('keys the schema accepts', () => {
  it('shows a number field\'s unit', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'number', key: 'every', label: 'Check every', suffix: 'minutes', min: 5, max: 1440, default: 30 },
    ])} />);
    // Without this the row read "Check every [30]" — a number with no idea
    // what it counts. The schema took the key and nothing drew it.
    expect(screen.getByText('minutes')).toBeInTheDocument();
    expect(screen.getByLabelText('Check every (minutes)')).toHaveValue(30);
  });

  it('starts a collapsed section closed, and opens it on request', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'section', label: 'Advanced', collapsed: true, children: [
        { type: 'toggle', key: 'debug', label: 'Verbose log' },
      ] },
    ])} />);
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByText('Verbose log')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('Verbose log')).toBeInTheDocument();
  });

  it('leaves an ordinary section open and unclickable', () => {
    render(<ExtensionSettingsPage manifest={manifest([
      { type: 'section', label: 'Basics', children: [
        { type: 'toggle', key: 'a', label: 'A thing' },
      ] },
    ])} />);
    expect(screen.getByText('A thing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Basics/ })).toBeNull();
  });
});
