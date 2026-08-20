/**
 * InstallSheet.test.jsx — the sheet that reports an install.
 *
 * The bug this is written against: the installer stops mid-install to ask
 * about permissions, and the sheet that asks is bottom-anchored — as is this
 * one, which is drawn on top of it. So the question arrived underneath a
 * progress bar labelled "Installing…", a bar which had also run backwards
 * because `permissions` had no entry in the stage table and fell to the
 * default. One screenshot, three things wrong.
 */

import { render, screen, act } from '@testing-library/react';
import InstallSheet from './InstallSheet';
import { emitInstall } from '../utils/installEvents';

const emit = (evt) => act(() => { emitInstall({ id: 'i1', kind: 'extension', ...evt }); });

describe('before anything is installing', () => {
  it('draws nothing', () => {
    const { container } = render(<InstallSheet />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('while files are being written', () => {
  it('names the extension and says what it is doing', () => {
    render(<InstallSheet />);
    emit({ stage: 'writing', name: 'Cloud Backup', version: '2.0.0' });
    expect(screen.getByText('Installing Cloud Backup…')).toBeInTheDocument();
    expect(screen.getByText('Installing files…')).toBeInTheDocument();
  });
});

describe('while it is waiting for an answer about permissions', () => {
  it('gets out of the way of the sheet asking the question', () => {
    const { container } = render(<InstallSheet />);
    emit({ stage: 'writing', name: 'Cloud Backup', version: '2.0.0' });
    expect(screen.getByText('Installing Cloud Backup…')).toBeInTheDocument();

    emit({ stage: 'permissions', name: 'Cloud Backup', asking: 4 });
    expect(container).toBeEmptyDOMElement();
  });

  it('comes back once the answer is in, without having lost the install', () => {
    render(<InstallSheet />);
    emit({ stage: 'writing', name: 'Cloud Backup', version: '2.0.0' });
    emit({ stage: 'permissions', name: 'Cloud Backup', asking: 4 });
    emit({ stage: 'activating', name: 'Cloud Backup', version: '2.0.0' });

    expect(screen.getByText('Installing Cloud Backup…')).toBeInTheDocument();
    expect(screen.getByText('Activating…')).toBeInTheDocument();
  });
});

describe('an update', () => {
  it('says updating, and both versions', () => {
    render(<InstallSheet />);
    emit({ stage: 'writing', name: 'Cloud Backup', version: '2.0.0', fromVersion: '1.4.0' });
    expect(screen.getByText('Updating Cloud Backup…')).toBeInTheDocument();
    expect(screen.getByText('v1.4.0 → v2.0.0')).toBeInTheDocument();
  });
});

describe('a failure', () => {
  it('says so, and says why', () => {
    render(<InstallSheet />);
    emit({ stage: 'error', name: 'Cloud Backup', error: 'Invalid magic bytes' });
    expect(screen.getByText("Couldn't install extension")).toBeInTheDocument();
    expect(screen.getByText('Invalid magic bytes')).toBeInTheDocument();
  });
});
