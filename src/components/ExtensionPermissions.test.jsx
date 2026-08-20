/**
 * ExtensionPermissions.test.jsx — the permissions half of the Extensions tab.
 *
 * The model decides what the rows say; extensionSettingsModel.test.js covers
 * that. This covers what only the component decides: that a grant change goes
 * through the path that restarts the extension, that a runtime host can be
 * taken back, and that "nobody asked" reaches the same dialog an install
 * would have used rather than a second, subtly different one.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import ExtensionPermissions from './ExtensionPermissions';
import { writeGrants, clearGrants } from '../utils/extensionGrants';
import { permissionRequests, __resetPermissionRequests } from '../utils/permissionRequests';

// `mock`-prefixed, because jest hoists jest.mock() above every other
// statement in the file and refuses to close over anything that is not
// obviously a mock — a reference to a plain const would be read before its
// initialiser ran.
const mockSetGrants = jest.fn(async () => ({ restarted: true }));
let mockHostFor = () => null;
let mockInstalled = [];

jest.mock('../utils/extensionRuntime', () => ({
  setGrants: (...a) => mockSetGrants(...a),
  hostV2: (id) => mockHostFor(id),
}));

jest.mock('../utils/ExtensionContext', () => ({
  useExtensions: () => ({ extensions: mockInstalled }),
}));

const MANIFEST = {
  apiVersion: 2,
  id: 'cloud-backup',
  name: 'Cloud Backup',
  version: '2.0.0',
  permissions: {
    'library:read:all': { reason: 'To copy every book.' },
    network: {
      reason: 'To reach Dropbox.',
      hosts: ['https://api.dropboxapi.com'],
      userHosts: { reason: 'To reach the server you type in.', max: 2 },
    },
  },
};

beforeEach(() => {
  mockSetGrants.mockClear();
  mockHostFor = () => null;
  mockInstalled = [MANIFEST];
  clearGrants('cloud-backup');
  __resetPermissionRequests();
});
afterEach(() => { clearGrants('cloud-backup'); __resetPermissionRequests(); });

describe('the list', () => {
  it('shows nothing when no extension is installed', () => {
    mockInstalled = [];
    const { container } = render(<ExtensionPermissions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every declared permission, granted or not', () => {
    writeGrants('cloud-backup', ['network'], []);
    render(<ExtensionPermissions />);
    // Both, so the screen is the whole list rather than only the yeses.
    expect(screen.getByText('Read all your books')).toBeInTheDocument();
    expect(screen.getByText('Connect to the internet')).toBeInTheDocument();
  });

  it("quotes the author's reason next to the switch that acts on it", () => {
    render(<ExtensionPermissions />);
    expect(screen.getByText(/To copy every book\./)).toBeInTheDocument();
  });

  it('shows the hosts a network permission declares', () => {
    render(<ExtensionPermissions />);
    expect(screen.getByText('https://api.dropboxapi.com')).toBeInTheDocument();
  });
});

describe('changing a grant', () => {
  it('sends the whole new set, not a delta', async () => {
    writeGrants('cloud-backup', ['network'], []);
    render(<ExtensionPermissions />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Do not allow: Read all your books'));
    });
    expect(mockSetGrants).toHaveBeenCalledTimes(1);
    const [extId, granted] = mockSetGrants.mock.calls[0];
    expect(extId).toBe('cloud-backup');
    expect([...granted].sort()).toEqual(['library:read:all', 'network']);
  });

  it('takes one away', async () => {
    writeGrants('cloud-backup', ['library:read:all', 'network'], []);
    render(<ExtensionPermissions />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Allow: Connect to the internet'));
    });
    expect(mockSetGrants.mock.calls[0][1]).toEqual(['library:read:all']);
  });
});

describe('a host the person allowed at runtime', () => {
  it('is listed apart from the declared ones and can be taken back', async () => {
    writeGrants('cloud-backup', ['network'], ['https://dav.example.org']);
    render(<ExtensionPermissions />);

    expect(screen.getByText('Added by you')).toBeInTheDocument();
    expect(screen.getByText('Declared by the extension')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop allowing https://dav.example.org'));
    });

    const [, granted, hosts] = mockSetGrants.mock.calls[0];
    expect(granted).toEqual(['network']);
    expect(hosts).toEqual([]);   // the grant it named is gone
  });
});

describe('an extension nobody was ever asked about', () => {
  it('offers Review, and Review raises the install dialog', async () => {
    mockInstalled = [{ ...MANIFEST, _permissionsPending: true }];
    render(<ExtensionPermissions />);

    expect(screen.getByText('This extension has not been asked what it may do yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Review'));

    // The same queue the install would have used — one dialog, one set of
    // words, rather than a second screen that exists only because the first
    // one was missed.
    await waitFor(() => expect(permissionRequests().current()).not.toBeNull());
    expect(permissionRequests().current().name).toBe('Cloud Backup');
  });

  it('writes what the dialog answered', async () => {
    mockInstalled = [{ ...MANIFEST, _permissionsPending: true }];
    render(<ExtensionPermissions />);
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(permissionRequests().current()).not.toBeNull());

    await act(async () => { permissionRequests().answer(['network']); });
    await waitFor(() => expect(mockSetGrants).toHaveBeenCalled());
    expect(mockSetGrants.mock.calls[0][1]).toEqual(['network']);
  });
});

describe('a permission the extension keeps being refused', () => {
  it('says so, and how often', () => {
    writeGrants('cloud-backup', [], []);
    mockHostFor = () => ({
      missingPermissions: () => [
        { permission: 'library:read:all', prompt: 'Read all your books', count: 12, wasRequested: true },
      ],
    });
    render(<ExtensionPermissions />);
    expect(screen.getByText('This extension has been asking for a permission it does not have.')).toBeInTheDocument();
    expect(screen.getByText(/12 times/)).toBeInTheDocument();
  });

  it('distinguishes one it never declared', () => {
    mockHostFor = () => ({
      missingPermissions: () => [
        { permission: 'library:write', prompt: 'Add and change books', count: 3, wasRequested: false },
      ],
    });
    render(<ExtensionPermissions />);
    expect(screen.getByText('This extension is asking for something it never requested.')).toBeInTheDocument();
  });
});
