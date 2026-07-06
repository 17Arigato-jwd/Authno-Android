/**
 * thmbkFormat.js — the .thmbk downloadable-theme container (B5 / U4).
 *
 * Per the design decision, .thmbk reuses the exact VCHS-ECS binary container
 * that .extbk uses (magic, sections, per-section CRC32, Reed-Solomon parity),
 * so both formats share one verified codec, one CLI, and one Android install
 * pipeline. The differences are purely semantic:
 *
 *   MNFT  — manifest.json with { type: 'theme', id, name, version, author? }
 *   ENTR  — theme.json: the full theme object (ThemeBase shape). Partial
 *           themes are allowed; they're merged over DARK_DEFAULT at load time
 *           via createTheme(), so a .thmbk can restyle only what it cares about.
 *   ASST  — optional font files or preview images (reserved; not required)
 *
 * A .thmbk therefore inherits the container's corruption resistance for free.
 */

import { packExtbk, unpackExtbk, validateExtbk, FILE_MAGIC } from './extbkFormat';

export { FILE_MAGIC };

const REQUIRED_META = ['id', 'name', 'version'];

export function validateThemeManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('theme manifest must be a JSON object');
  if (m.type !== 'theme') throw new Error("manifest.type must be 'theme' for a .thmbk file");
  for (const k of REQUIRED_META) {
    if (!m[k] || typeof m[k] !== 'string') throw new Error(`theme manifest.${k} is required`);
  }
  if (!/^[\w.-]+$/.test(m.id) || m.id.includes('..'))
    throw new Error('theme manifest.id must be alphanumeric, dots, or dashes');
  return m;
}

/**
 * Light structural validation of the theme object itself. We deliberately do
 * NOT require every field — createTheme() merges over DARK_DEFAULT — but the
 * object must be a plain object and its meta.id must match the manifest.
 */
export function validateThemeObject(theme, manifest) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme))
    throw new Error('theme.json must be a JSON object');
  if (theme.meta && theme.meta.id && manifest && theme.meta.id !== manifest.id)
    throw new Error(`theme.meta.id (${theme.meta.id}) must match manifest.id (${manifest.id})`);
  return theme;
}

/** Build .thmbk bytes from a manifest + theme object. */
export async function packThmbk({ manifest, theme, rsPct = 20 }) {
  validateThemeManifest(manifest);
  validateThemeObject(theme, manifest);
  return packExtbk({
    manifest,
    entry: JSON.stringify(theme, null, 2),
    assets: [],
    rsPct,
  });
}

/** Decode .thmbk bytes → { manifest, theme }. Applies RS repair via the container. */
export async function unpackThmbk(bytes) {
  const { ok, errors } = validateExtbk(bytes);
  if (!ok) throw new Error(`Invalid .thmbk: ${errors.join('; ')}`);
  const { manifest, entry } = await unpackExtbk(bytes);
  validateThemeManifest(manifest);
  let theme;
  try { theme = JSON.parse(entry); }
  catch { throw new Error('.thmbk theme.json is not valid JSON'); }
  validateThemeObject(theme, manifest);
  return { manifest, theme };
}
