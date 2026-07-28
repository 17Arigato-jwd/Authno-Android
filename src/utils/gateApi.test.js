/**
 * The gate client, and one rule the app depends on.
 *
 * Signing in with a password is the only network call AuthNo makes. Its
 * failures have to be distinguishable from a wrong password, because
 * AccessGate escalates on wrong passwords — two free tries, then a cooldown,
 * then the app closes itself. A writer on a train must never be marched
 * towards that by a tunnel.
 */

import { webcrypto } from 'crypto';
if (!global.crypto?.subtle) global.crypto = webcrypto;

describe('gateApi', () => {
  const OLD_ENV = process.env;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, REACT_APP_GATE_API: 'https://gate.example' };
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => { process.env = OLD_ENV; });

  const load = () => require('./gateApi');
  const json = (body, ok = true, status = 200) =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

  it('is unconfigured when no URL is set', () => {
    process.env.REACT_APP_GATE_API = '';
    expect(load().gateConfigured()).toBe(false);
  });

  it('trims a trailing slash so paths never double up', () => {
    process.env.REACT_APP_GATE_API = 'https://gate.example/';
    expect(load().GATE_API).toBe('https://gate.example');
  });

  it('exchanges a password for a signed key in two calls', async () => {
    fetchMock
      .mockReturnValueOnce(json({ token: 'sess-1', account: { username: 'lunar' } }))
      .mockReturnValueOnce(json({ accessKey: 'AUTHNO-abc.def', username: 'lunar' }));

    const r = await load().fetchKeyWithPassword('lunar', 'a-password');
    expect(r.accessKey).toBe('AUTHNO-abc.def');
    expect(r.username).toBe('lunar');

    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toBe('https://gate.example/v1/auth/password');
    expect(second[0]).toBe('https://gate.example/v1/auth/keyfile/issue');
    // The session from the first call authorises the second, and is then
    // dropped — the app has no use for a bearer token it never checks.
    expect(second[1].headers.authorization).toBe('Bearer sess-1');
  });

  it('never puts the password in the second request', async () => {
    fetchMock
      .mockReturnValueOnce(json({ token: 'sess-1' }))
      .mockReturnValueOnce(json({ accessKey: 'AUTHNO-abc.def' }));
    await load().fetchKeyWithPassword('lunar', 'hunter2-and-friends');
    expect(fetchMock.mock.calls[1][1].body).not.toContain('hunter2');
  });

  it('reports a wrong password as bad-credentials', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'bad-credentials' }, false, 401));
    await expect(load().fetchKeyWithPassword('lunar', 'nope'))
      .rejects.toMatchObject({ code: 'bad-credentials' });
  });

  // The reason this file exists.
  it('reports a dead connection as gate-unreachable, not a bad password', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(load().fetchKeyWithPassword('lunar', 'correct'))
      .rejects.toMatchObject({ code: 'gate-unreachable' });
  });

  it('says gate-unreachable rather than pretending when unconfigured', async () => {
    process.env.REACT_APP_GATE_API = '';
    await expect(load().fetchKeyWithPassword('lunar', 'correct'))
      .rejects.toMatchObject({ code: 'gate-unreachable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mistake a signed-in-but-no-key response for success', async () => {
    fetchMock
      .mockReturnValueOnce(json({ token: 'sess-1' }))
      .mockReturnValueOnce(json({}));
    await expect(load().fetchKeyWithPassword('lunar', 'correct'))
      .rejects.toMatchObject({ code: 'issue-failed' });
  });

  it('explains every failure in plain words, and offers the offline route', () => {
    const { gateErrorText } = load();
    for (const c of ['gate-unreachable', 'bad-credentials', 'revoked', 'rate-limited',
                     'verify-unavailable', 'issue-failed', 'signin-failed']) {
      expect(gateErrorText(c).length).toBeGreaterThan(20);
    }
    expect(gateErrorText('gate-unreachable')).toMatch(/key file/i);
    expect(gateErrorText('nonsense-code').length).toBeGreaterThan(20);
  });
});
