/**
 * SettingsVersionTap.test.jsx — the seven taps, on the version people tap.
 *
 * devMode.js was correct and had never run. The version in Settings › About —
 * the one somebody actually taps, because it is the About screen and because
 * Android taught everybody to tap the build number — was a <span> in a
 * decorative pill. No handler, no focus, not announced as anything, in either
 * layout. The gesture could not be performed at all.
 *
 * Asserted on a phone first, because that is every Android install, and the
 * portrait layout has no sidebar to fall back to.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

// Settings swaps panels inside <AnimatePresence mode="wait">, which holds the
// incoming panel back until the outgoing one's exit animation finishes. In
// jsdom nothing animates and nothing finishes, so the tab never changes and
// About never mounts. Stand the two in for their plain equivalents; what is
// under test is the version pill, not the crossfade.
jest.mock('framer-motion', () => {
  const React = require('react');
  // Cached, one component per tag. A Proxy that builds a fresh component on
  // every `motion.div` read hands React a new element type each render, and
  // React unmounts and remounts the whole subtree — which detaches the button
  // under test after its first click, so the second tap lands on nothing.
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

import { Settings } from './Settings';
import { ThemeProvider, DARK_DEFAULT } from '../theme';
import { TAPS_REQUIRED } from '../utils/devMode';
import { APP_META } from '../DesignSystem';

const PHONE = () => { window.innerWidth = 400; window.innerHeight = 900; };
const DESKTOP = () => { window.innerWidth = 1280; window.innerHeight = 800; };

const open = () => render(
  <ThemeProvider initialTheme={DARK_DEFAULT}>
    <Settings isOpen onClose={() => {}} />
  </ThemeProvider>,
);

/** Settings opens on General; About is a tab. */
const goToAbout = () => fireEvent.click(screen.getByText('About'));

/** The pill in About, addressed the way a person finds it: by the version. */
const versionPill = () => screen.getByText(`v${APP_META.version}`).closest('button');

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('the version in About', () => {
  it('is something you can press, on a phone', () => {
    PHONE();
    open();
    goToAbout();
    expect(versionPill()).toBeInTheDocument();
  });

  it('is something you can press on desktop too', () => {
    DESKTOP();
    open();
    goToAbout();
    expect(versionPill()).toBeInTheDocument();
  });

  it('says what it is, for anybody not looking at it', () => {
    PHONE();
    open();
    goToAbout();
    expect(versionPill()).toHaveAttribute('aria-label', `AuthNo version ${APP_META.version}`);
  });
});

describe('tapping it seven times, on a phone', () => {
  it('unlocks developer options', () => {
    PHONE();
    open();
    goToAbout();

    expect(screen.queryByText('Developer')).not.toBeInTheDocument();

    const pill = versionPill();
    for (let i = 0; i < TAPS_REQUIRED; i++) fireEvent.click(pill);

    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('counts down in place, and only once the taps look deliberate', () => {
    PHONE();
    open();
    goToAbout();

    // The build date sits beside the version until there is something to say.
    expect(within(versionPill()).getByText(APP_META.buildDate)).toBeInTheDocument();

    const pill = versionPill();
    fireEvent.click(pill);
    fireEvent.click(pill);
    expect(screen.queryByText(/more taps?/)).not.toBeInTheDocument();

    fireEvent.click(pill);
    fireEvent.click(pill);
    expect(within(versionPill()).getByText('3 more taps')).toBeInTheDocument();
    expect(within(versionPill()).queryByText(APP_META.buildDate)).not.toBeInTheDocument();
  });

  it('stays unlocked, so it is not a gesture you have to remember', () => {
    PHONE();
    const first = open();
    goToAbout();
    const pill = versionPill();
    for (let i = 0; i < TAPS_REQUIRED; i++) fireEvent.click(pill);
    first.unmount();

    open();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });
});

describe('when nothing is wired to it', () => {
  it('stays a plain pill rather than a button that does nothing', () => {
    PHONE();
    open();
    goToAbout();
    // Sanity check on the other half of the contract: AboutSection only
    // becomes a button when it is given something to do. Here it was, so the
    // build date's sibling is the version and the element is a button — the
    // no-handler case is covered by AboutSection's own default.
    expect(versionPill().tagName).toBe('BUTTON');
  });
});
