/**
 * SettingsVersionTap.test.jsx — the seven taps, in the layout a phone gets.
 *
 * devMode.test.js covers the counter. What was broken is upstream of it: the
 * version line was rendered inside the desktop sidebar branch, and portrait
 * has no sidebar. So on every Android install there was nothing to tap, the
 * gesture could not be performed at all, and the tab it unlocks was
 * unreachable. The counter was perfect and never ran.
 *
 * Hence both layouts, asserted separately.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { Settings } from './Settings';
import { ThemeProvider, DARK_DEFAULT } from '../theme';
import { TAPS_REQUIRED } from '../utils/devMode';

const size = (w, h) => { window.innerWidth = w; window.innerHeight = h; };
const PHONE = () => size(400, 900);
const DESKTOP = () => size(1280, 800);

const open = () => render(
  <ThemeProvider initialTheme={DARK_DEFAULT}>
    <Settings isOpen onClose={() => {}} />
  </ThemeProvider>,
);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

const versionButton = () => screen.getByText(/AuthNo v/).closest('button');

describe('the version line', () => {
  it('is there on a phone — the layout every Android install uses', () => {
    PHONE();
    open();
    expect(versionButton()).toBeInTheDocument();
  });

  it('is there on desktop too', () => {
    DESKTOP();
    open();
    expect(versionButton()).toBeInTheDocument();
  });
});

describe('tapping it seven times, on a phone', () => {
  it('unlocks developer options', () => {
    PHONE();
    open();

    expect(screen.queryByText('Developer')).not.toBeInTheDocument();

    const btn = versionButton();
    for (let i = 0; i < TAPS_REQUIRED; i++) fireEvent.click(btn);

    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('counts down out loud only once the taps are clearly deliberate', () => {
    PHONE();
    open();

    const btn = versionButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByText(/more taps?/)).not.toBeInTheDocument();

    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(within(versionButton()).getByText(/3 more taps/)).toBeInTheDocument();
  });

  it('stays unlocked, so it is not a gesture you have to remember', () => {
    PHONE();
    const first = open();
    const btn = versionButton();
    for (let i = 0; i < TAPS_REQUIRED; i++) fireEvent.click(btn);
    first.unmount();

    open();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });
});
