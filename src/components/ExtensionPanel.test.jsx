/**
 * ExtensionPanel.test.jsx — the panel beside the editor.
 *
 * panelPlacement's arithmetic is tested in extensionSurfaces.test.js. This
 * covers the promises only the component can break: that the editor's measure
 * is what wins when there is not room for both, that opening does not move the
 * caret, and that a panel whose extension went away closes rather than drawing
 * an empty box.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ExtensionPanel, { CHAR_SAMPLE } from './ExtensionPanel';
import { surfaces, __resetSurfaces, SURFACE_LIMITS } from '../utils/extensionSurfaces';

let mockInstalled = [];
jest.mock('../utils/ExtensionContext', () => ({
  useExtensions: () => ({ extensions: mockInstalled }),
}));

// The page body loads modules off disk through Capacitor; the panel's own
// behaviour is what is under test, so the body is stood in for.
jest.mock('./ExtensionPage', () => ({
  __esModule: true,
  default: ({ pageId }) => <div data-testid="panel-body">{pageId}</div>,
}));

const MANIFEST = {
  apiVersion: 2,
  id: 'word-sprint',
  name: 'Word Sprint',
  pages: { main: { title: 'Sprint', type: 'ui-file', file: 'Panel.js' } },
};

const setWidth = (px) => {
  window.innerWidth = px;
  act(() => { window.dispatchEvent(new Event('resize')); });
};

beforeEach(() => {
  mockInstalled = [MANIFEST];
  __resetSurfaces();
  window.innerWidth = 1280;
});
afterEach(() => {
  __resetSurfaces();
  // A spy left installed by a failing test reaches every test after it, and
  // getComputedStyle is called by more than the thing under test.
  jest.restoreAllMocks();
});

const openPanel = () => act(() => { surfaces().openPanel('word-sprint', 'main'); });

describe('when nothing is open', () => {
  it('draws nothing', () => {
    const { container } = render(<ExtensionPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('docked, on a wide screen', () => {
  it('opens beside the editor with the page inside it', () => {
    render(<ExtensionPanel />);
    openPanel();
    expect(screen.getByLabelText('Sprint')).toBeInTheDocument();
    expect(screen.getByTestId('panel-body')).toHaveTextContent('main');
  });

  it('is never wider than the model allows', () => {
    render(<ExtensionPanel />);
    openPanel();
    const aside = screen.getByLabelText('Sprint');
    const px = parseInt(aside.style.width, 10);
    expect(px).toBeLessThanOrEqual(SURFACE_LIMITS.PANEL_MAX_PX);
    expect(px).toBeGreaterThanOrEqual(SURFACE_LIMITS.PANEL_MIN_PX);
  });

  it('closes on its own button', () => {
    render(<ExtensionPanel />);
    openPanel();
    fireEvent.click(screen.getByLabelText('Close Sprint'));
    expect(screen.queryByLabelText('Sprint')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<ExtensionPanel />);
    openPanel();
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByLabelText('Sprint')).not.toBeInTheDocument();
  });
});

describe('the editor is what wins', () => {
  it('collapses rather than squeezing the measure below the floor', () => {
    // Measured character width is what makes this reachable. At the default
    // 8.5px, the narrowest non-phone viewport (720) still leaves (720-280)/8.5
    // = 51 characters, so `collapsed` never happens — the rule reads as
    // enforced and never fires. It fires for the person it exists for: a
    // reader at large text, whose characters are wide enough that a panel and
    // 45 characters of prose do not both fit.
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      font: '', fontSize: '24px', fontFamily: 'serif', letterSpacing: 'normal',
    }));
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: CHAR_SAMPLE.length * 14, height: 30 });

    render(<ExtensionPanel />);
    setWidth(900);
    openPanel();

    // 14px per character: (900 - 280) / 14 = 44.3, under the floor of 45. The
    // panel yields — it does not shrink further and it does not overlay.
    expect(screen.queryByLabelText('Sprint')).not.toBeInTheDocument();

    // Still open in the model: the dot in the corner is what remains, and the
    // panel returns when there is room again.
    expect(surfaces().open()).not.toBeNull();
    setWidth(1400);
    expect(screen.getByLabelText('Sprint')).toBeInTheDocument();

  });

  it('becomes a sheet on a phone rather than a sliver beside the text', () => {
    render(<ExtensionPanel />);
    setWidth(390);
    openPanel();
    const el = screen.getByLabelText('Sprint');
    expect(el).toHaveAttribute('role', 'complementary');
    expect(el.style.position).toBe('fixed');
  });
});

describe('promises the model made', () => {
  it('does not move the caret when it opens', () => {
    render(
      <>
        <input data-testid="caret" autoFocus />
        <ExtensionPanel />
      </>,
    );
    const input = screen.getByTestId('caret');
    input.focus();
    openPanel();
    // Nothing in the panel calls focus(); an extension must not be able to
    // take the keyboard away mid-sentence.
    expect(document.activeElement).toBe(input);
  });

  it('refuses to be opened by the extension itself', () => {
    render(<ExtensionPanel />);
    act(() => { surfaces().openPanel('word-sprint', 'main', { bySystem: true }); });
    expect(screen.queryByLabelText('Sprint')).not.toBeInTheDocument();
  });
});

describe('when the extension goes away', () => {
  it('closes instead of drawing an empty box', () => {
    const { rerender } = render(<ExtensionPanel />);
    openPanel();
    expect(screen.getByLabelText('Sprint')).toBeInTheDocument();

    mockInstalled = [];
    rerender(<ExtensionPanel />);
    expect(screen.queryByLabelText('Sprint')).not.toBeInTheDocument();
    expect(surfaces().open()).toBeNull();
  });
});
