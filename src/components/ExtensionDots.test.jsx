/**
 * ExtensionDots.test.jsx — the corner indicator.
 *
 * The model decides which dots exist and what colour each is; those rules are
 * tested in extensionSurfaces.test.js. This covers what only the component
 * decides: that it is absent when nothing is running, that it is a real
 * target with a real name, and that it does not leave a sheet up describing
 * extensions that have stopped.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ExtensionDots from './ExtensionDots';
import { surfaces, __resetSurfaces } from '../utils/extensionSurfaces';

afterEach(() => { __resetSurfaces(); });

const set = (extId, text) => act(() => { surfaces().setOverlay(extId, text); });
const clear = (extId) => act(() => { surfaces().clearOverlay(extId); });

describe('when nothing is running', () => {
  it('draws nothing at all', () => {
    const { container } = render(<ExtensionDots />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disappears when the last extension stops', () => {
    render(<ExtensionDots />);
    set('word-sprint', 'Sprint: 4:12 left');
    expect(screen.getByRole('button')).toBeInTheDocument();
    clear('word-sprint');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('the indicator', () => {
  it('appears when an extension sets a line, and says how many in words', () => {
    render(<ExtensionDots />);
    set('word-sprint', 'Sprint: 4:12 left');
    expect(screen.getByLabelText('1 extension is doing something')).toBeInTheDocument();
  });

  it('counts more than one', () => {
    render(<ExtensionDots />);
    set('a', 'one');
    set('b', 'two');
    expect(screen.getByLabelText('2 extensions are doing something')).toBeInTheDocument();
  });

  it('is a target worth hitting, not the size of the dot', () => {
    render(<ExtensionDots />);
    set('a', 'one');
    const btn = screen.getByRole('button');
    // The dot draws at 8dp; the model carries 48 for the target so a component
    // cannot quietly use the visual size for both.
    expect(btn).toHaveStyle({ minWidth: '48px', minHeight: '48px' });
  });

  it('collapses past three into a +n', () => {
    render(<ExtensionDots />);
    for (const id of ['a', 'b', 'c', 'd', 'e']) set(id, `line ${id}`);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('stays out of the way of a tap meant for the text', () => {
    const { container } = render(<ExtensionDots />);
    set('a', 'one');
    const wrapper = container.querySelector('div');
    expect(wrapper).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.getByRole('button')).toHaveStyle({ pointerEvents: 'auto' });
  });

  it('can be hidden outright', () => {
    const { container } = render(<ExtensionDots hidden />);
    set('a', 'one');
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the sheet', () => {
  it('names each extension and shows its own line', () => {
    render(<ExtensionDots />);
    set('word-sprint', 'Sprint: 4:12 left');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('word-sprint')).toBeInTheDocument();
    expect(screen.getByText('Sprint: 4:12 left')).toBeInTheDocument();
  });

  it('attributes the line to the extension rather than the app', () => {
    render(<ExtensionDots />);
    set('a', 'something');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Each line is written by the extension itself.')).toBeInTheDocument();
  });

  it('accounts for the ones the row could not fit', () => {
    render(<ExtensionDots />);
    for (const id of ['a', 'b', 'c', 'd']) set(id, `line ${id}`);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('One more extension is running.')).toBeInTheDocument();
  });

  it('closes itself when the last extension stops', () => {
    render(<ExtensionDots />);
    set('a', 'something');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Running now')).toBeInTheDocument();
    // A sheet listing nothing, left up because the thing it described ended,
    // is a dead end.
    clear('a');
    expect(screen.queryByText('Running now')).not.toBeInTheDocument();
  });
});

describe('an open panel suppresses its own dot', () => {
  it('does not say the same thing twice', () => {
    render(<ExtensionDots />);
    set('a', 'one');
    set('b', 'two');
    expect(screen.getByLabelText('2 extensions are doing something')).toBeInTheDocument();
    act(() => { surfaces().openPanel('a', 'main', { bySystem: false }); });
    expect(screen.getByLabelText('1 extension is doing something')).toBeInTheDocument();
  });
});
