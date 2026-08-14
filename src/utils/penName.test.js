import { validatePenName, normalizePenName, cleanPenName, isReserved } from './penName';

const bad = (u) => validatePenName(u).reason;
const good = (u) => validatePenName(u).ok;

describe('the pen name is optional', () => {
  /** The field says "(optional)". A form that then complains is worse than one that never asked. */
  test('blank is valid', () => {
    expect(good('')).toBe(true);
    expect(good('   ')).toBe(true);
    expect(good(undefined)).toBe(true);
    expect(good(null)).toBe(true);
  });

  test('a blank name stores as empty rather than as whitespace', () => {
    expect(cleanPenName('   ')).toBe('');
    expect(cleanPenName('@')).toBe('');
  });
});

describe('normalising what people actually type', () => {
  test('the leading @ is habit, not part of the name', () => {
    expect(normalizePenName('@janewrites')).toBe('janewrites');
    expect(normalizePenName('@@jane')).toBe('jane');
  });

  test('case and surrounding space do not make a different name', () => {
    expect(normalizePenName('  JaneWrites ')).toBe('janewrites');
  });

  test('what gets stored is the normalised form', () => {
    expect(cleanPenName('  @JaneWrites ')).toBe('janewrites');
  });
});

describe('impersonation', () => {
  /** The whole point: this field used to accept every one of these. */
  test('the obvious ones are refused', () => {
    ['admin', 'root', 'owner', 'staff', 'support', 'official', 'moderator', 'authno']
      .forEach((u) => expect(bad(u)).toBe('reserved'));
  });

  /**
   * Some of these are now caught by the SHAPE rules before the reserved lookup
   * runs — a name cannot start or end with a separator, so `_admin` never
   * reaches the list. Refused either way, which is the thing that matters;
   * asserting the reason would be asserting which rule got there first.
   */
  test('and the spellings that read the same', () => {
    ['_admin', 'admin_', 'adm1n', '4dm1n', 'r00t', '0wner', 'admin2', 'supp0rt']
      .forEach((u) => expect(good(u)).toBe(false));
    // These reach the list and are refused by it.
    ['adm1n', 'r00t', 'admin2', 'supp0rt'].forEach((u) => expect(bad(u)).toBe('reserved'));
  });

  test('and the brand with something attached', () => {
    ['authno_support', 'authnoteam', '@AuthNo_Help'].forEach((u) => expect(bad(u)).toBe('reserved'));
  });

  /**
   * A rule that refuses ordinary words gets deleted by whoever is answering
   * the support mail, so these must keep working.
   */
  test('ordinary words that merely contain a reserved one are fine', () => {
    ['badminton', 'rooted', 'teams', 'helper', 'inkwell_moth', 'developer_x']
      .forEach((u) => expect(good(u)).toBe(true));
  });

  test('isReserved works on the whole name, never a substring', () => {
    expect(isReserved('admin')).toBe(true);
    expect(isReserved('badminton')).toBe(false);
  });
});

describe('shape', () => {
  test('length is bounded at both ends', () => {
    expect(bad('ab')).toBe('too-short');
    expect(bad('a'.repeat(21))).toBe('too-long');
    expect(good('abc')).toBe(true);
    expect(good('a'.repeat(20))).toBe(true);
  });

  test('letters, numbers, underscores and hyphens', () => {
    ['bad name', 'naïve', 'jane!', 'jane😀'].forEach((u) =>
      expect(bad(u)).toBe('bad-characters'));
    expect(good('jane-writes')).toBe(true);
  });

  /**
   * Three scripts, one per name.
   *
   * Mixing is the whole homoglyph attack: Cyrillic а is pixel-identical to
   * Latin a, so `jаne` and `jane` read the same and are different permanent
   * names. Refusing to mix removes that without enumerating every lookalike.
   */
  describe('scripts', () => {
    test('Japanese and Russian are names too', () => {
      ['ゆうき', '山田太郎', 'ユウキ_01', 'ゆうきー', 'иван', 'иван_петров']
        .forEach((u) => expect(good(u)).toBe(true));
    });

    test('but only one alphabet at a time', () => {
      ['jаne', 'иванjane', 'ゆうきjane'].forEach((u) =>
        expect(bad(u)).toBe('mixed-scripts'));
    });

    test('half-width katakana folds to full-width rather than being refused', () => {
      expect(normalizePenName('ﾕｳｷ')).toBe('ユウキ');
      expect(good('ﾕｳｷ')).toBe(true);
    });

    test('a length mark cannot start a name, the way a hyphen cannot', () => {
      expect(bad('ーゆうき')).toBe('bad-start');
    });

    /**
     * Russian has no lowercase lookalike for r, d, i, u or g, so most of the
     * reserved list is unspellable in it. These two are not, and the Cyrillic
     * fold in reservedSkeleton is what catches them.
     */
    test('a Cyrillic name that reads as a reserved one is still refused', () => {
      expect(bad('теам')).toBe('reserved');
      expect(bad('ехтвк')).toBe('reserved');
    });
  });

  describe('separators', () => {
    test('not at either end', () => {
      expect(bad('-jane')).toBe('bad-start');
      expect(bad('_jane')).toBe('bad-start');
      expect(bad('jane-')).toBe('bad-end');
      expect(bad('jane_')).toBe('bad-end');
    });

    test('never two in a row', () => {
      ['jane__doe', 'jane--doe', 'jane_-doe'].forEach((u) =>
        expect(bad(u)).toBe('double-separator'));
    });

    test('alternating is fine, as on reddit', () => {
      expect(good('j_a_n_e')).toBe(true);
    });

    test('a name starts with a letter, not a digit', () => {
      expect(bad('1jane')).toBe('bad-start');
    });
  });

  test('a name needs at least one letter', () => {
    expect(bad('___')).toBe('bad-characters');
    expect(bad('12345')).toBe('bad-characters');
    expect(good('a1b')).toBe(true);
  });

  test('every refusal comes with something a person can act on', () => {
    ['ab', 'a'.repeat(21), 'bad name', '___', 'admin'].forEach((u) => {
      const r = validatePenName(u);
      expect(r.ok).toBe(false);
      expect(typeof r.message).toBe('string');
      expect(r.message.length).toBeGreaterThan(0);
    });
  });

  /** An invalid name must never reach storage. */
  test('cleanPenName drops anything that would not validate', () => {
    expect(cleanPenName('admin')).toBe('');
    expect(cleanPenName('bad name')).toBe('');
    expect(cleanPenName('janewrites')).toBe('janewrites');
  });
});
