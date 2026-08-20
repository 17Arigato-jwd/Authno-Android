/**
 * PermissionRequestSheet.test.jsx — the dialog, rendered.
 *
 * The queue is tested on its own. This covers what only the component decides:
 * which switches start on, that the author's reason is shown as theirs, that
 * dismissing means no, and that answering one request moves to the next with
 * the switches reset rather than carrying the previous answer across.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import PermissionRequestSheet from './PermissionRequestSheet';
import { permissionRequests, __resetPermissionRequests } from '../utils/permissionRequests';

const plan = (names, carried = []) => ({
  ok: true,
  errors: [],
  prompt: names.map((n) => ({
    permission: n,
    prompt: { 'library:read:all': 'Read all your books', network: 'Connect to the internet', activity: 'See when you are writing' }[n] ?? n,
    reason: `because ${n}`,
    hosts: n === 'network' ? ['https://api.example.com'] : undefined,
  })),
  carried,
  dropped: [],
});

afterEach(() => { __resetPermissionRequests(); });

function ask(extId, names, meta = {}, carried = []) {
  let settled;
  act(() => { settled = permissionRequests().ask(extId, plan(names, carried), meta); });
  return settled;
}

describe('drawing the question', () => {
  it('renders nothing when there is nothing to ask', () => {
    const { container } = render(<PermissionRequestSheet />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the extension, not its id', () => {
    render(<PermissionRequestSheet />);
    ask('cloud-backup', ['network'], { name: 'Cloud Backup', version: '2.0.0' });
    expect(screen.getByText('Cloud Backup')).toBeInTheDocument();
    expect(screen.getByText(/Version 2\.0\.0/)).toBeInTheDocument();
  });

  it("shows the app's line and the author's reason, attributed", () => {
    render(<PermissionRequestSheet />);
    ask('a', ['library:read:all'], { name: 'Word Sprint' });
    expect(screen.getByText('Read all your books')).toBeInTheDocument();
    expect(screen.getByText(/because library:read:all/)).toBeInTheDocument();
    expect(screen.getByText(/— Word Sprint/)).toBeInTheDocument();
  });

  it('lists the hosts a network permission names', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network'], { name: 'A' });
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
  });

  it('says when a reason was not given', () => {
    render(<PermissionRequestSheet />);
    act(() => {
      permissionRequests().ask('a', {
        ok: true, errors: [], carried: [], dropped: [],
        prompt: [{ permission: 'network', prompt: 'Connect to the internet', reason: '' }],
      }, { name: 'A' });
    });
    expect(screen.getByText('No reason given.')).toBeInTheDocument();
  });
});

describe('the switches', () => {
  it('start on, so the button offers everything', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network', 'activity'], { name: 'A' });
    expect(screen.getByText('Allow all 2')).toBeInTheDocument();
  });

  it('report the count when one is turned off', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network', 'activity'], { name: 'A' });
    fireEvent.click(screen.getByLabelText('Allow: Connect to the internet'));
    expect(screen.getByText('Allow 1 of 2')).toBeInTheDocument();
  });

  it('offer nothing when all are off', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network'], { name: 'A' });
    fireEvent.click(screen.getByLabelText('Allow: Connect to the internet'));
    expect(screen.getByText('Allow nothing')).toBeInTheDocument();
  });
});

describe('answering', () => {
  it('resolves with what was left on', async () => {
    render(<PermissionRequestSheet />);
    const settled = ask('a', ['network', 'activity'], { name: 'A' });
    fireEvent.click(screen.getByLabelText('Allow: See when you are writing'));
    await act(async () => { fireEvent.click(screen.getByText('Allow 1 of 2')); });
    expect(await settled).toEqual(['network']);
  });

  it('treats dismissing as no to everything new, keeping what was carried', async () => {
    render(<PermissionRequestSheet />);
    const settled = ask('a', ['network'], { name: 'A' }, ['library:export']);
    await act(async () => { fireEvent.click(screen.getByText('Not now')); });
    expect(await settled).toEqual(['library:export']);
  });

  it('moves to the next request with the switches reset', async () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network'], { name: 'A' });
    ask('b', ['activity'], { name: 'B' });

    // Turn A's only switch off, then allow. B must not inherit that.
    fireEvent.click(screen.getByLabelText('Allow: Connect to the internet'));
    await act(async () => { fireEvent.click(screen.getByText('Allow nothing')); });

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Allow it')).toBeInTheDocument();
  });

  it('says how many are still waiting', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['network'], { name: 'A' });
    ask('b', ['activity'], { name: 'B' });
    expect(screen.getByText('One more extension to review')).toBeInTheDocument();
  });
});

describe('what a person is told to look twice at', () => {
  it('marks the weighty ones', () => {
    render(<PermissionRequestSheet />);
    ask('a', ['library:read:all', 'activity'], { name: 'A' });
    // read:all is marked; activity is not.
    expect(screen.getAllByText('worth a look')).toHaveLength(1);
  });
});
