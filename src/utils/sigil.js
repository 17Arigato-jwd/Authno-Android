/**
 * sigil.js — the deterministic visual identity of an invite code.
 *
 * PORT OF the website's src/invite/sigil.ts. designFromSeed() must behave
 * identically in both: the whole point is that the sigil on the inviter's
 * card, on the redeem page and on this app's gate screen are the same mark,
 * derived from nothing but sha256(normalized code). sigil.test.js pins the
 * same three seeds the site's scripts/sigil-golden.mjs pins — if one changes,
 * both must change together.
 *
 * The SVG renderer is cosmetic and may differ; only the design is contractual.
 */

/** [background, dim, bright, accent] — 16 curated dark plates. */
export const SIGIL_PALETTES = [
  ['#17121f', '#3f3357', '#a78bfa', '#f0abfc'], // ink violet
  ['#1c1210', '#54332a', '#fb923c', '#fde68a'], // ember
  ['#0f1a16', '#2d4f43', '#34d399', '#a7f3d0'], // verdigris
  ['#0e1620', '#2c455e', '#60a5fa', '#bae6fd'], // night tide
  ['#1e1114', '#59303c', '#fb7185', '#fecdd3'], // rosewood
  ['#1a1508', '#57481d', '#facc15', '#fef08a'], // goldleaf
  ['#141417', '#3d3d46', '#9ca3af', '#e5e7eb'], // iron
  ['#131807', '#3d4a1e', '#a3e635', '#d9f99d'], // moss
  ['#190f1d', '#4b2b55', '#c084fc', '#e9d5ff'], // plum wine
  ['#1b1410', '#523c28', '#f59e0b', '#fcd34d'], // copper
  ['#0c1719', '#28494e', '#2dd4bf', '#99f6e4'], // teal glass
  ['#200e0e', '#5c2626', '#ef4444', '#fca5a5'], // crimson wax
  ['#12131f', '#333a5e', '#818cf8', '#c7d2fe'], // periwinkle
  ['#121711', '#38452f', '#86efac', '#dcfce7'], // sage
  ['#1a1612', '#4e4433', '#d6b37a', '#f5e8cd'], // dusk sand
  ['#141019', '#3a2f4a', '#e879f9', '#fbcfe8'], // orchid ice
];

export const SIGIL_MOTIFS = 24; // reserved slots for the hand-drawn centre plates
export const SIGIL_FRAMES = 12; // reserved slots for the hand-drawn borders

function hexToBytes(hex) {
  const clean = String(hex).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('sigil seed must be a sha256 hex string');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Pure function: 64-char sha256 hex → design. THE golden-tested contract. */
export function designFromSeed(seedHex) {
  const b = hexToBytes(seedHex);

  const paletteIdx = b[0] % SIGIL_PALETTES.length;
  const motifIdx = b[1] % SIGIL_MOTIFS;
  const frameIdx = b[2] % SIGIL_FRAMES;
  const density = 0.38 + (b[28] % 48) / 200;

  const cells = [];
  for (let r = 0; r < 10; r++) {
    const row = new Array(10).fill(0);
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const byte = b[3 + (i >> 1)];
      const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
      if (nibble / 16 < density) {
        const ring = Math.max(Math.abs(r - 4.5), Math.abs(c - 4.5));
        const v = ring <= 1.5 ? 3 : ring <= 3.5 ? 2 : 1;
        row[c] = v;
        row[9 - c] = v;
      }
    }
    cells.push(row);
  }

  return { paletteIdx, palette: SIGIL_PALETTES[paletteIdx], motifIdx, frameIdx, density, cells };
}

/** sha256 of a normalized invite code — the seed the server also stores. */
export async function seedFromNormalizedCode(norm) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Render a design as a self-contained SVG string. */
export function sigilSvg(design, size = 96) {
  const [bg, dim, bright, accent] = design.palette;
  const u = size / 16;
  const tone = ['', dim, bright, accent];
  const parts = [];

  parts.push(`<rect width="${size}" height="${size}" rx="${(2.2 * u).toFixed(2)}" fill="${bg}"/>`);

  const style = design.frameIdx % 3;
  if (style === 0) {
    const t = 1.4 * u, L = 2.2 * u, w = Math.max(1, size * 0.02);
    for (const [x, y, dx, dy] of [
      [t, t, 1, 1], [size - t, t, -1, 1], [t, size - t, 1, -1], [size - t, size - t, -1, -1],
    ]) {
      parts.push(`<path d="M ${x + dx * L} ${y} H ${x} V ${y + dy * L}" fill="none" stroke="${accent}" stroke-width="${w}" stroke-linecap="square" opacity="0.85"/>`);
    }
  } else if (style === 1) {
    parts.push(`<rect x="${u}" y="${u}" width="${size - 2 * u}" height="${size - 2 * u}" rx="${1.6 * u}" fill="none" stroke="${dim}" stroke-width="${Math.max(1, size * 0.014)}"/>`);
    parts.push(`<rect x="${1.7 * u}" y="${1.7 * u}" width="${size - 3.4 * u}" height="${size - 3.4 * u}" rx="${1.2 * u}" fill="none" stroke="${dim}" stroke-width="${Math.max(0.7, size * 0.008)}" opacity="0.7"/>`);
  } else {
    const w = Math.max(1, size * 0.02), n = 1.8 * u;
    parts.push(`<path d="M ${size / 2 - n} ${u} h ${2 * n} M ${size / 2 - n} ${size - u} h ${2 * n} M ${u} ${size / 2 - n} v ${2 * n} M ${size - u} ${size / 2 - n} v ${2 * n}" stroke="${accent}" stroke-width="${w}" opacity="0.8"/>`);
  }

  const o = 3 * u, cell = u, inset = 0.08 * u, r = 0.16 * u;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const v = design.cells[row][col];
      if (!v) continue;
      parts.push(`<rect x="${(o + col * cell + inset).toFixed(2)}" y="${(o + row * cell + inset).toFixed(2)}" width="${(cell - 2 * inset).toFixed(2)}" height="${(cell - 2 * inset).toFixed(2)}" rx="${r.toFixed(2)}" fill="${tone[v]}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}

export function sigilDataUri(design, size = 96) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(sigilSvg(design, size))}`;
}

/**
 * The member's own mark, derived from their user id rather than a code —
 * used on the gate and in Settings so an account has a face too.
 */
export async function seedFromUserId(uid) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(uid || '')));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
