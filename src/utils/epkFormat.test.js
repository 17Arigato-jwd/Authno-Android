/**
 * epkFormat.test.js — the JS reader against the conformance corpus.
 *
 * Every assertion here is one row of the table in epkCorpus.js EXPECTED. The
 * native Android unpacker and the Electron reader run the same table and must
 * produce the identical verdict — that is the entire point of writing the
 * corpus before the readers (spec §8a).
 */

import {
  packEpk, readEpk, inspectEpk, isEpk, pathIsSafe,
  EpkError, EpkIncomplete,
  CODEC_STORE, CODEC_DEFLATE,
  HEADER_SIZE, TAIL_SIZE, CORE_CEILING,
} from './epkFormat.js';

import {
  wellFormed, damage, hostile, locate, damageEntry, reparity, zeroRange,
  SAMPLE_MANIFEST, SAMPLE_MODULES, EXPECTED, corrupt, seeded,
} from './epkCorpus.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

async function keypair() {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}

// ─── Well-formed ─────────────────────────────────────────────────────────────

describe('well-formed packages', () => {
  test('empty package round-trips with no repairs', async () => {
    const pkg = await wellFormed.empty();
    const r = await readEpk(pkg);
    expect(r.manifest.id).toBe('corpus-fixture');
    expect(r.modules['index.js']).toContain('activate');
    expect(r.entryCount).toBe(0);
    expect(r.repairs).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test('single entry reads back byte-identical', async () => {
    const pkg = await wellFormed.single();
    const r = await readEpk(pkg);
    const data = await r.read('icon.png');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(600);
    expect(r.repairs).toHaveLength(0);
  });

  test('mixed codecs all decode', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const r = await readEpk(pkg);
    expect([...r.entries.keys()].sort()).toEqual(['a/data.json', 'b/photo.jpg', 'c/font.woff2']);
    for (const path of r.entries.keys()) {
      expect(await r.read(path)).not.toBeNull();
    }
    expect(r.entries.get('a/data.json').codec).toBe(CODEC_DEFLATE);
    expect(r.entries.get('b/photo.jpg').codec).toBe(CODEC_STORE);
  });

  test('unicode and deeply nested paths survive', async () => {
    const pkg = await wellFormed.unicodeAndNesting();
    const r = await readEpk(pkg);
    expect(r.entries.has('assets/日本語/画像.png')).toBe(true);
    expect(r.entries.has('émoji-🎨.svg')).toBe(true);
    expect(DEC.decode(await r.read('a/b/c/d/e/f/g/deep.txt'))).toBe('deep');
  });

  test('lazy flag survives the round trip', async () => {
    const pkg = await wellFormed.lazyEntry();
    const r = await readEpk(pkg);
    expect(r.entries.get('big.bin').flags & 0b100).toBeTruthy();
  });

  test('400 entries read back in full', async () => {
    const pkg = await wellFormed.manyEntries(400);
    const r = await readEpk(pkg);
    expect(r.entryCount).toBe(400);
    expect(DEC.decode(await r.read('tiles/tile-0399.txt'))).toBe('tile 399');
  });

  test('the build is reproducible — same inputs, same bytes', async () => {
    const uuid = new Uint8Array(16).fill(7);
    const args = {
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [
        { path: 'z.txt', data: ENC.encode('z'), codec: CODEC_DEFLATE },
        { path: 'a.txt', data: ENC.encode('a'), codec: CODEC_DEFLATE },
      ],
      uuid,
    };
    const one = await packEpk(args);
    const two = await packEpk(args);
    expect(Buffer.from(one)).toEqual(Buffer.from(two));
  });

  test('entries are sorted by path regardless of input order', async () => {
    const pkg = await packEpk({
      manifest: SAMPLE_MANIFEST,
      assets: [
        { path: 'zebra.txt', data: ENC.encode('z'), codec: CODEC_DEFLATE },
        { path: 'alpha.txt', data: ENC.encode('a'), codec: CODEC_DEFLATE },
        { path: 'middle.txt', data: ENC.encode('m'), codec: CODEC_DEFLATE },
      ],
    });
    const r = await readEpk(pkg);
    expect([...r.entries.keys()]).toEqual(['alpha.txt', 'middle.txt', 'zebra.txt']);
  });

  test('stored entries are 4096-aligned so they can be mapped', async () => {
    const pkg = await wellFormed.single();
    const r = await readEpk(pkg);
    expect(r.entries.get('icon.png').entryOffset % 4096).toBe(0);
  });

  test('inspect works without decoding', () => {
    return wellFormed.single().then((pkg) => {
      const info = inspectEpk(pkg);
      expect(info.isEpk).toBe(true);
      expect(info.frontHeaderValid).toBe(true);
      expect(info.tailValid).toBe(true);
      expect(info.entryCount).toBe(1);
      expect(info.packageHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('isEpk distinguishes EPK from an ECS file', async () => {
    const pkg = await wellFormed.empty();
    expect(isEpk(pkg)).toBe(true);
    // \x89EXTBK\r\n — the ECS magic
    expect(isEpk(new Uint8Array([0x89, 0x45, 0x58, 0x54, 0x42, 0x4b, 0x0d, 0x0a, ...new Array(80).fill(0)]))).toBe(false);
  });
});

// ─── The repair ladder (§6a) ─────────────────────────────────────────────────

describe('repair ladder', () => {
  test('rung 1 — front header zeroed, recovered from the tail copy', async () => {
    const pkg = await wellFormed.single();
    const { bytes } = damage.frontHeaderZeroed(pkg);
    const r = await readEpk(bytes);
    expect(r.headerSource).toBe('tail-copy');
    expect(r.repairs.some((x) => x.rung === 1)).toBe(true);
    expect(await r.read('icon.png')).not.toBeNull();
  });

  test('rung 3 — a truncated file is incomplete, not corrupt', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const { bytes } = damage.truncated(pkg, 0.6);
    await expect(readEpk(bytes)).rejects.toThrow(EpkIncomplete);
    const err = await readEpk(bytes).then(() => null, (e) => e);
    expect(err.reason).toBe('incomplete');
    expect(err.resumeFrom).toBe(bytes.length);
    expect(err.need).toBeGreaterThan(bytes.length);
  });

  test('rung 4 — core bit rot is repaired by Reed-Solomon', async () => {
    const pkg = await wellFormed.single();
    const { bytes } = damage.coreBitRot(pkg, 6);
    const r = await readEpk(bytes);
    expect(r.repairs.some((x) => x.rung === 4)).toBe(true);
    expect(r.manifest.id).toBe('corpus-fixture');
  });

  test('core damage beyond RS tolerance is refused, not guessed at', async () => {
    const pkg = await wellFormed.single();
    const { bytes } = damage.coreDestroyed(pkg);
    await expect(readEpk(bytes)).rejects.toMatchObject({ name: 'EpkError' });
  });

  test('rung 5 — directory bit rot is repaired by its parity', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const { bytes } = damage.directoryBitRot(pkg, 4);
    const r = await readEpk(bytes);
    expect(r.repairs.some((x) => x.rung === 5)).toBe(true);
    expect(r.entries.size).toBe(3);
  });

  test('rung 6 — directory AND parity destroyed, rebuilt from preambles', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const { bytes } = damage.directoryAndParityZeroed(pkg);
    const r = await readEpk(bytes);
    expect(r.repairs.some((x) => x.rung === 6)).toBe(true);
    expect(r.entries.size).toBe(3);
    for (const path of r.entries.keys()) {
      expect(await r.read(path)).not.toBeNull();
    }
  });

  test('rung 7 — a damaged kind=code entry is repaired by its own parity', async () => {
    const pkg = await wellFormed.withWasm();
    const before = await readEpk(pkg);
    const rec = before.entries.get('engine.wasm');
    const bytes = damageEntry(pkg, rec.entryOffset, rec.storedSize, 3, 17);
    const r = await readEpk(bytes);
    const wasm = await r.read('engine.wasm');
    expect(wasm).not.toBeNull();
    expect(wasm.length).toBe(3000);
    expect(r.repairs.some((x) => x.rung === 7)).toBe(true);
  });

  test('rung 8 — a damaged asset is dropped, not fatal', async () => {
    const pkg = await wellFormed.withWasm();
    const before = await readEpk(pkg);
    const rec = before.entries.get('logo.png');
    const bytes = damageEntry(pkg, rec.entryOffset, rec.storedSize, 4, 23);
    const r = await readEpk(bytes);
    expect(await r.read('logo.png')).toBeNull();
    expect(r.warnings.some((w) => w.path === 'logo.png' && w.rung === 8)).toBe(true);
    // The rest of the package still works — graceful degradation, not refusal.
    expect(await r.read('engine.wasm')).not.toBeNull();
    expect(r.manifest.id).toBe('corpus-fixture');
  });

  test('an undamaged package reports no repairs at all', async () => {
    for (const name of EXPECTED.wellFormed) {
      const pkg = await wellFormed[name]();
      const r = await readEpk(pkg);
      expect({ name, repairs: r.repairs }).toEqual({ name, repairs: [] });
    }
  });
});

// ─── Hostile packages (§8) ───────────────────────────────────────────────────

describe('hostile packages are refused without repair', () => {
  const cases = [
    ['pathTraversal', 'unsafe-path'],
    ['absolutePath', 'unsafe-path'],
    ['nulInPath', 'unsafe-path'],
    ['offsetPastEof', 'range-outside-blob'],
    ['rangeOutsideBlob', 'range-outside-blob'],
    ['entryCountOverflow', 'entry-cap'],
  ];

  test.each(cases)('%s is refused with reason %s', async (name, reason) => {
    const pkg = await wellFormed.mixedCodecs();
    const bytes = hostile[name](pkg);
    let err = null;
    try { await readEpk(bytes); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EpkError);
    expect(err.reason).toBe(reason);
  });

  test('overlapping entry ranges are refused', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const r = await readEpk(pkg);
    const recs = [...r.entries.values()].sort((a, b) => a.entryOffset - b.entryOffset);
    // Stretch the first entry so it swallows the second.
    const out = pkg.slice();
    const L = locate(out);
    const target = recs[0];
    // find its record in the directory and widen storedSize
    let o = L.dirOffset;
    for (let i = 0; i < L.entryCount; i++) {
      const pathLength = out[o + 48] | (out[o + 49] << 8);
      const n = 52 + pathLength;
      const size = n + ((4 - (n % 4)) % 4);
      const off = (out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>> 0;
      if (off === target.entryOffset) {
        const wider = recs[1].entryOffset + 8 - target.entryOffset;
        out[o + 4] = wider & 0xff; out[o + 5] = (wider >>> 8) & 0xff;
        out[o + 6] = (wider >>> 16) & 0xff; out[o + 7] = (wider >>> 24) & 0xff;
        break;
      }
      o += size;
    }
    // Recompute the parity, or rung 5 heals the edit before it is ever seen.
    let err = null;
    try { await readEpk(reparity(out)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EpkError);
    expect(['overlapping-ranges', 'range-outside-blob']).toContain(err.reason);
  });

  test('duplicate paths are refused at pack time', async () => {
    await expect(packEpk({
      manifest: SAMPLE_MANIFEST,
      assets: [
        { path: 'same.txt', data: ENC.encode('a') },
        { path: 'same.txt', data: ENC.encode('b') },
      ],
    })).rejects.toMatchObject({ reason: 'duplicate-path' });
  });

  test('a traversal path is refused at pack time too', async () => {
    await expect(packEpk({
      manifest: SAMPLE_MANIFEST,
      assets: [{ path: '../escape.txt', data: ENC.encode('x') }],
    })).rejects.toMatchObject({ reason: 'unsafe-path' });
  });

  test('an oversized core is refused at pack time', async () => {
    const huge = 'x'.repeat(CORE_CEILING);   // incompressible enough after JSON escaping? no —
    // deflate would crush a run of x. Use pseudorandom text so the core really is over the cap.
    const rnd = seeded(99);
    let s = '';
    for (let i = 0; i < 400000; i++) s += String.fromCharCode(32 + Math.floor(rnd() * 94));
    await expect(packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: { 'big.js': s + s + s + s + s + s + s + s + s + s + s + s },
    })).rejects.toMatchObject({ reason: 'core-too-large' });
    expect(huge.length).toBe(CORE_CEILING);
  }, 30000);

  test('pathIsSafe rejects the whole traversal family', () => {
    for (const bad of [
      '../x', 'a/../../x', '/abs', 'C:\\win', 'a\\b', 'a//b', 'a/./b', '', 'a/', 'x\0y', '.', '..',
    ]) {
      expect({ path: bad, safe: pathIsSafe(bad) }).toEqual({ path: bad, safe: false });
    }
    for (const good of ['a.txt', 'a/b/c.png', '日本語/x.js', 'a-b_c.1.woff2']) {
      expect({ path: good, safe: pathIsSafe(good) }).toEqual({ path: good, safe: true });
    }
  });
});

// ─── Signing (§7) ────────────────────────────────────────────────────────────

describe('Ed25519 signing', () => {
  test('a signed package verifies against its public key', async () => {
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    const r = await readEpk(pkg, { publicKey: kp.publicKey });
    expect(r.signed).toBe(true);
    expect(r.signatureOk).toBe(true);
  });

  test('editing the signed map is refused — repair cannot rescue it', async () => {
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    const bytes = hostile.signedTampered(pkg);
    let err = null;
    try { await readEpk(bytes, { publicKey: kp.publicKey }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EpkError);
    expect(['bad-signature', 'package-hash-mismatch']).toContain(err.reason);
  });

  test('editing an asset destroys it but cannot substitute it', async () => {
    // The signature covers the directory, and the directory holds a digest per
    // entry. So flipping bytes in the blob does not break the signature — it
    // breaks that one entry, which is dropped at rung 8. An attacker gets
    // denial, never deception, and the rest of the package still works.
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    const bytes = hostile.blobTampered(pkg);
    const r = await readEpk(bytes, { publicKey: kp.publicKey });
    expect(r.signatureOk).toBe(true);
    expect(await r.read('icon.png')).toBeNull();
    expect(r.warnings.some((w) => w.rung === 8)).toBe(true);
  });

  test('an unsigned package still has its map covered by the package hash', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const bytes = hostile.signedTampered(pkg);
    await expect(readEpk(bytes)).rejects.toMatchObject({ reason: 'package-hash-mismatch' });
  });

  test('repaired bytes are exposed so the caller can persist them (§6a.2)', async () => {
    const pkg = await wellFormed.single();
    const clean = await readEpk(pkg);
    expect(clean.repairedBytes).toBeNull();

    const { bytes } = damage.coreBitRot(pkg, 6);
    const r = await readEpk(bytes);
    expect(r.repairedBytes).not.toBeNull();
    // Writing them back yields a package that now reads with no repairs at all.
    const again = await readEpk(r.repairedBytes);
    expect(again.repairs).toEqual([]);
  });

  test('the wrong public key does not verify', async () => {
    const a = await keypair();
    const b = await keypair();
    const pkg = await wellFormed.signed(a.privateKey);
    await expect(readEpk(pkg, { publicKey: b.publicKey }))
      .rejects.toMatchObject({ reason: 'bad-signature' });
  });

  test('an unsigned package from the update channel is refused (§7.2)', async () => {
    const pkg = await wellFormed.single();
    await expect(readEpk(pkg, { fromChannel: true }))
      .rejects.toMatchObject({ reason: 'unsigned-channel-package' });
  });

  test('an unsigned package chosen manually is allowed, and marked unsigned', async () => {
    const pkg = await wellFormed.single();
    const r = await readEpk(pkg, { fromChannel: false });
    expect(r.signed).toBe(false);
    expect(r.signatureOk).toBeNull();
  });

  test('repair still verifies: damaged-then-repaired signed package passes', async () => {
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    // Damage the core only — RS restores the author's exact bytes, so the
    // signature over the package hash must verify again (§6a.4).
    const L = locate(pkg);
    const bytes = corrupt(pkg, { from: L.coreOffset, to: L.coreOffset + 150, count: 4, seed: 77 });
    const r = await readEpk(bytes, { publicKey: kp.publicKey });
    expect(r.repairs.some((x) => x.rung === 4)).toBe(true);
    expect(r.signatureOk).toBe(true);
  });
});

// ─── Regressions ─────────────────────────────────────────────────────────────
//
// Each of these is a bug that was in the shipped-to-branch reader. They run
// first-class rather than as a footnote because the repair path is exactly
// where hostile input arrives.

describe('regressions', () => {
  test('a preamble claiming an earlier offset terminates the scan', async () => {
    // The scan skipped forward to entryOffset + storedSize. A record may claim
    // an offset BEHIND the preamble carrying it, which rewound the cursor to a
    // point before that preamble — found again, rewound again, forever.
    //
    // Verified by reverting the clamp: this fixture hangs the jest worker
    // outright. That is also why the assertion is plain termination rather than
    // a timeout race — scanPreambles is synchronous, so on the broken version
    // nothing else on the thread gets to run, and no in-process timer can fire.
    // The iteration budget in scanPreambles exists so any FUTURE
    // non-termination degrades to a named refusal instead of a hang.
    //
    // It has to be a preamble after the first: at the first, the cursor is
    // already at the blob's start and cannot be sent backwards.
    const pkg = await wellFormed.mixedCodecs();
    const L = locate(pkg);
    let out = pkg.slice();

    const MAGIC = [0x89, 0x45, 0x50, 0x4b, 0x45, 0x4e, 0x54, 0x0a];
    const matchesAt = (buf, o) => MAGIC.every((m, i) => buf[o + i] === m);
    const at = [];
    for (let o = L.blobOffset; o < L.dirOffset - 8 && at.length < 3; o++) {
      if (matchesAt(out, o)) { at.push(o); o += 7; }
    }
    expect(at.length).toBeGreaterThanOrEqual(2);

    const wr32 = (buf, o, v) => {
      buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff;
      buf[o + 2] = (v >>> 16) & 0xff; buf[o + 3] = (v >>> 24) & 0xff;
    };
    wr32(out, at[1] + 8, L.blobOffset);   // entryOffset — behind this preamble
    wr32(out, at[1] + 12, 1);             // storedSize
    out = zeroRange(out, L.dirOffset, L.dirOffset + L.dirLength + L.dirParityLength);

    const verdict = await readEpk(out).then(() => 'read', (e) => `refused:${e.reason}`);
    expect(typeof verdict).toBe('string');
    expect(verdict).not.toContain('scan-budget-exceeded');
  }, 15000);

  test('a package written at a different rsPct still reads', async () => {
    // The reader used to derive parity geometry from its own default rsPct, so
    // any package built at another percentage produced a parity-length mismatch
    // and was reported as an unrecoverable core. The geometry lives in the
    // header now, so the reader is never told and never wrong.
    for (const rsPct of [0, 5, 10, 20, 40]) {
      const pkg = await packEpk({
        manifest: SAMPLE_MANIFEST,
        modules: SAMPLE_MODULES,
        assets: [{ path: 'x.bin', data: ENC.encode('hello'), codec: CODEC_DEFLATE }],
        rsPct,
      });
      const r = await readEpk(pkg);
      expect({ rsPct, id: r.manifest.id, repairs: r.repairs.length })
        .toEqual({ rsPct, id: 'corpus-fixture', repairs: 0 });
      expect(DEC.decode(await r.read('x.bin'))).toBe('hello');
    }
  });

  test('an rsPct=0 package still repairs its header from the tail', async () => {
    const pkg = await packEpk({
      manifest: SAMPLE_MANIFEST, modules: SAMPLE_MODULES, assets: [], rsPct: 0,
    });
    const { bytes } = damage.frontHeaderZeroed(pkg);
    const r = await readEpk(bytes);
    expect(r.headerSource).toBe('tail-copy');
  });

  test('a channel package with a destroyed tail is refused, not trusted', async () => {
    // "signed" is a flag in the header. Without the tail there is nothing to
    // check it against, so a package could claim to be signed and be installed
    // with no verification at all.
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    const bytes = pkg.slice(0, pkg.length - TAIL_SIZE);
    await expect(readEpk(bytes, { fromChannel: true, publicKey: kp.publicKey }))
      .rejects.toMatchObject({ reason: expect.stringMatching(/incomplete|unverifiable-channel-package/) });
  });

  test('a channel package with no key to check against is refused', async () => {
    const kp = await keypair();
    const pkg = await wellFormed.signed(kp.privateKey);
    await expect(readEpk(pkg, { fromChannel: true }))
      .rejects.toMatchObject({ reason: 'no-public-key' });
  });

  test('bytes from another realm are packed, not stringified', async () => {
    // Buffer is a Uint8Array subclass from Node's realm: `instanceof
    // Uint8Array` is false across realms, and the old fallback stringified it.
    // This is the Electron main process and the Capacitor bridge, both of which
    // hand over exactly this shape.
    const buf = Buffer.from('real bytes, not a toString', 'utf8');
    const pkg = await packEpk({
      manifest: SAMPLE_MANIFEST,
      assets: [{ path: 'b.bin', data: buf, codec: CODEC_STORE }],
    });
    const r = await readEpk(pkg);
    expect(DEC.decode(await r.read('b.bin'))).toBe('real bytes, not a toString');
  });

  test('readEpk accepts a Buffer as the package itself', async () => {
    const pkg = await wellFormed.single();
    const r = await readEpk(Buffer.from(pkg));
    expect(r.entryCount).toBe(1);
    expect(await r.read('icon.png')).not.toBeNull();
  });
});

// ─── Structural guards ───────────────────────────────────────────────────────

describe('structural guards', () => {
  test('a non-EPK buffer is refused', async () => {
    await expect(readEpk(new Uint8Array(200))).rejects.toMatchObject({ reason: 'no-header' });
  });

  test('an unknown formatVersion is refused', async () => {
    const pkg = await wellFormed.single();
    const out = pkg.slice();
    out[8] = 99;
    out[out.length - TAIL_SIZE + 64 + 8] = 99;   // and the tail's copy
    await expect(readEpk(out)).rejects.toMatchObject({ reason: 'bad-version' });
  });

  test('a package over the policy cap is refused', async () => {
    const pkg = await wellFormed.single();
    await expect(readEpk(pkg, { policyCap: 100 })).rejects.toMatchObject({ reason: 'policy-cap' });
  });

  test('the entry cap is enforced at pack time', async () => {
    await expect(packEpk({
      manifest: SAMPLE_MANIFEST,
      assets: [{ path: 'a.txt', data: ENC.encode('a') }, { path: 'b.txt', data: ENC.encode('b') }],
      entryCap: 1,
    })).rejects.toMatchObject({ reason: 'entry-cap' });
  });

  test('reading a path that is not there names the reason', async () => {
    const pkg = await wellFormed.single();
    const r = await readEpk(pkg);
    await expect(r.read('nope.png')).rejects.toMatchObject({ reason: 'no-such-entry' });
  });

  test('header and tail agree on every offset', async () => {
    const pkg = await wellFormed.mixedCodecs();
    const L = locate(pkg);
    const copyAt = pkg.length - TAIL_SIZE + 64;
    expect(Buffer.from(pkg.slice(copyAt, copyAt + HEADER_SIZE)))
      .toEqual(Buffer.from(pkg.slice(0, HEADER_SIZE)));
    expect(L.dirOffset).toBe(L.blobOffset + L.blobLength);
  });
});
