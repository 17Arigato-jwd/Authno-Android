/**
 * SettingsExtensionsTab.test.jsx — the tab that manages extensions, and the
 * two states it has.
 *
 * Extensions shipped in 1.1.20 with exactly one door: the bottom tab bar in
 * the library drawer, which Sidebar.jsx renders only when `android` is true.
 * On desktop there was no way to see what was installed at all; on a phone the
 * door was two screens from where anybody looks. It is a Settings tab now.
 *
 * The second state is the one worth a test of its own: the tab **does not
 * exist until something is installed**, and it goes away again when the last
 * extension does. A settings tab for a feature you are not using is worse than
 * no tab — it is a permanent empty room — and the failure mode of getting this
 * wrong is standing on a section that has stopped existing.
 */

import { render, screen, fireEvent } from '@testing-library/react';

// Same reason as SettingsVersionTap: <AnimatePresence mode="wait"> never lets
// the incoming panel mount in jsdom, because nothing animates and so the
// outgoing exit never finishes. Cached per tag — a fresh component per read
// makes React remount the subtree on every render.
jest.mock('framer-motion', () => {
  const React = require('react');
  const cache = new Map();
  const passthrough = (tag) => {
    if (!cache.has(tag)) {
      cache.set(tag, React.forwardRef(function Motion(props, ref) {
        const {
          initial, animate, exit, transition, variants, whileHover, whileTap,
          whileInView, layout, layoutId, ...rest
        } = props;
        return React.createElement(tag, { ...rest, ref });
      }));
    }
    return cache.get(tag);
  };
  return {
    __esModule: true,
    AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
    motion: new Proxy({}, { get: (_, tag) => passthrough(tag) }),
  };
});

// What is installed, as this test decides it. `useExtensions` is the one thing
// Settings reads to know whether the tab should exist at all.
// Prefixed `mock` because jest.mock's factory is hoisted above every other
// binding in the file and refuses to close over anything else.
let mockInstalled = [];
jest.mock('../utils/ExtensionContext', () => ({
  __esModule: true,
  useExtensions: () => ({ extensions: mockInstalled }),
  useExtensionContributions: () => [],
}));

// The panel itself is tested elsewhere and drags in Capacitor, the runtime and
// a filesystem. What is under test here is whether Settings can reach it — and
// what it is handed, because a panel with no `onClose` opens an extension page
// behind a dialog that never closes.
jest.mock('./ExtensionsPanel', () => ({
  __esModule: true,
  default: (props) => {
    const React = require('react');
    return React.createElement('div', {
      'data-testid': 'extensions-panel',
      'data-has-close': String(typeof props.onClose === 'function'),
    }, 'installed extensions');
  },
}));

import { Settings } from './Settings';
import { ThemeProvider, DARK_DEFAULT } from '../theme';

const PHONE = () => { window.innerWidth = 400; window.innerHeight = 900; };
const DESKTOP = () => { window.innerWidth = 1280; window.innerHeight = 800; };

const ONE = [{ id: 'cloud-backup', name: 'Cloud Backup', version: '2.0.1' }];
const TWO = [...ONE, { id: 'focus-stats', name: 'Focus Stats', version: '1.0.0' }];

const open = (onClose = () => {}) => render(
  <ThemeProvider initialTheme={DARK_DEFAULT}>
    <Settings isOpen onClose={onClose} />
  </ThemeProvider>,
);

/** Found the way somebody finds it: by its name in the tab strip. */
const goToExtensions = () => fireEvent.click(screen.getAllByText('Extensions')[0]);

beforeEach(() => { mockInstalled = []; localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('with nothing installed', () => {
  it('there is no Extensions tab on a phone', () => {
    PHONE();
    open();
    expect(screen.queryByText('Extensions')).not.toBeInTheDocument();
  });

  it('there is none on desktop either', () => {
    DESKTOP();
    open();
    expect(screen.queryByText('Extensions')).not.toBeInTheDocument();
  });

  it('search does not offer to jump to a tab that is not there', () => {
    DESKTOP();
    open();
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'install from file' } });
    expect(screen.queryByText('Install from file')).not.toBeInTheDocument();
  });
});

describe('with extensions installed', () => {
  it('the tab is there on a phone', () => {
    PHONE();
    mockInstalled = ONE;
    open();
    expect(screen.getAllByText('Extensions').length).toBeGreaterThan(0);
  });

  it('the tab is there on desktop, where there was no other way in', () => {
    DESKTOP();
    mockInstalled = ONE;
    open();
    expect(screen.getAllByText('Extensions').length).toBeGreaterThan(0);
  });

  it('it says how many, rather than only that there are some', () => {
    DESKTOP();
    mockInstalled = TWO;
    open();
    const tab = screen.getAllByText('Extensions')[0].closest('button');
    expect(tab).toHaveTextContent('2');
  });

  it('opening it renders the panel that manages them', () => {
    PHONE();
    mockInstalled = ONE;
    open();
    goToExtensions();
    expect(screen.getByTestId('extensions-panel')).toBeInTheDocument();
  });

  it('opens on desktop too', () => {
    DESKTOP();
    mockInstalled = ONE;
    open();
    goToExtensions();
    expect(screen.getByTestId('extensions-panel')).toBeInTheDocument();
  });

  it('gives the panel a way to close Settings, so a page it opens is visible', () => {
    PHONE();
    mockInstalled = ONE;
    open();
    goToExtensions();
    expect(screen.getByTestId('extensions-panel')).toHaveAttribute('data-has-close', 'true');
  });

  it('is findable by search, by what it holds rather than its own name', () => {
    DESKTOP();
    mockInstalled = ONE;
    open();
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'install from file' } });
    fireEvent.click(screen.getByText('Install from file'));
    expect(screen.getByTestId('extensions-panel')).toBeInTheDocument();
  });

  it('does not take over General on the way in', () => {
    PHONE();
    mockInstalled = ONE;
    open();
    expect(screen.queryByTestId('extensions-panel')).not.toBeInTheDocument();
  });
});

describe('when the last extension goes', () => {
  it('the section falls back rather than leaving a blank panel', () => {
    PHONE();
    mockInstalled = ONE;
    const { rerender } = open();
    goToExtensions();
    expect(screen.getByTestId('extensions-panel')).toBeInTheDocument();

    mockInstalled = [];
    rerender(
      <ThemeProvider initialTheme={DARK_DEFAULT}>
        <Settings isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId('extensions-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Extensions')).not.toBeInTheDocument();
    // General is a real panel, so the dialog is not showing nothing.
    expect(screen.getAllByText('General').length).toBeGreaterThan(0);
  });
});
