import { compareVersions, satisfiesMinAppVersion } from './extensionLoader';

describe('compareVersions', () => {
  const lt = (a, b) => expect(compareVersions(a, b)).toBeLessThan(0);
  const gt = (a, b) => expect(compareVersions(a, b)).toBeGreaterThan(0);
  const eq = (a, b) => expect(compareVersions(a, b)).toBe(0);

  it('orders release cores', () => {
    lt('1.1.17', '1.1.18');
    lt('1.2.0', '1.10.0');
    gt('2.0.0', '1.99.99');
    eq('1.1.18', '1.1.18');
  });

  it('treats missing components as zero', () => {
    eq('1.1', '1.1.0');
    lt('1.1', '1.1.1');
  });

  it('sorts a pre-release before its own release', () => {
    lt('1.1.18-beta.1', '1.1.18');
    gt('1.1.18', '1.1.18-beta.99');
  });

  it('compares numeric pre-release identifiers numerically, not as strings', () => {
    // The bug this guards: "11" < "2" lexically, so beta.11 sorted below beta.2.
    lt('1.1.18-beta.2', '1.1.18-beta.11');
    gt('1.1.18-beta.11', '1.1.18-beta.9');
  });

  it('a longer pre-release chain sorts after its prefix', () => {
    lt('1.1.18-beta', '1.1.18-beta.1');
  });
});

describe('satisfiesMinAppVersion', () => {
  it('passes when the manifest declares nothing', () => {
    expect(satisfiesMinAppVersion({}, '1.0.0')).toBe(true);
    expect(satisfiesMinAppVersion({ minAppVersion: '' }, '1.0.0')).toBe(true);
  });

  it('passes on an exact match and on anything newer', () => {
    expect(satisfiesMinAppVersion({ minAppVersion: '1.1.18' }, '1.1.18')).toBe(true);
    expect(satisfiesMinAppVersion({ minAppVersion: '1.1.14-beta.21' }, '1.1.18-beta.11')).toBe(true);
  });

  it('fails when the host is older than the extension requires', () => {
    expect(satisfiesMinAppVersion({ minAppVersion: '1.1.19' }, '1.1.18-beta.11')).toBe(false);
    expect(satisfiesMinAppVersion({ minAppVersion: '1.1.18' }, '1.1.18-beta.11')).toBe(false);
  });
});
