/**
 * SettingsExtensionsTab.test.jsx — the tab that manages extensions, in the
 * place people look for it.
 *
 * Extensions shipped in 1.1.20 with exactly one door: the bottom tab bar in
 * the library drawer, which Sidebar.jsx renders only when `android` is true.
 * On desktop there was no way to see what was installed at all. On a phone the
 * door existed but was not where anybody expects a list of installed things to
 * be — somebody installed Cloud Backup, opened Settings, and found nothing.
 *
 * The same class of bug as the version pill: a headline feature reachable only
 * from a surface that half the installs do not draw. So it is asserted the
 * same way — by opening Settings and pressing the word.
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

// The tab itself is tested elsewhere and drags in Capacitor, the extension
// runtime and a filesystem. What is under test here is whether Settings can
// reach it, so a marker stands in for it — and it reports the props it was
// handed, because handing it no `onClose` is how a contribution chip opens a
// page behind a dialog that never closes.
jest.mock('./ExtensionTab', () => ({
  __esModule: true,
  default: (props) => {
    const React = require('react');
    return React.createElement('div', {
      'data-testid': 'extension-tab',
      'data-has-close': String(typeof props.onClose === 'function'),
    }, 'installed extensions');
  },
}));

import { Settings } from './Settings';
import { ThemeProvider, DARK_DEFAULT } from '../theme';

const PHONE = () => { window.innerWidth = 400; window.innerHeight = 900; };
const DESKTOP = () => { window.innerWidth = 1280; window.innerHeight = 800; };

const open = (onClose = () => {}) => render(
  <ThemeProvider initialTheme={DARK_DEFAULT}>
    <Settings isOpen onClose={onClose} />
  </ThemeProvider>,
);

/** Found the way somebody finds it: by its name in the tab strip. */
const goToExtensions = () => fireEvent.click(screen.getAllByText('Extensions')[0]);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('Settings › Extensions', () => {
  it('is a tab on a phone', () => {
    PHONE();
    open();
    expect(screen.getAllByText('Extensions').length).toBeGreaterThan(0);
  });

  it('is a tab on desktop, where there was no other way in', () => {
    DESKTOP();
    open();
    expect(screen.getAllByText('Extensions').length).toBeGreaterThan(0);
  });

  it('opens the tab that manages them', () => {
    PHONE();
    open();
    goToExtensions();
    expect(screen.getByTestId('extension-tab')).toBeInTheDocument();
  });

  it('opens on desktop too', () => {
    DESKTOP();
    open();
    goToExtensions();
    expect(screen.getByTestId('extension-tab')).toBeInTheDocument();
  });

  it('gives it a way to close Settings, so a page it opens is visible', () => {
    PHONE();
    open();
    goToExtensions();
    expect(screen.getByTestId('extension-tab')).toHaveAttribute('data-has-close', 'true');
  });

  it('is findable by search, by what it holds rather than its own name', () => {
    DESKTOP();
    open();
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'install from file' } });
    fireEvent.click(screen.getByText('Install from file'));
    expect(screen.getByTestId('extension-tab')).toBeInTheDocument();
  });

  it('does not take over General on the way in', () => {
    PHONE();
    open();
    expect(screen.queryByTestId('extension-tab')).not.toBeInTheDocument();
  });
});
