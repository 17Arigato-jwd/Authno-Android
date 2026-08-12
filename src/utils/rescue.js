/**
 * rescue.js — getting books out when the gate says no.
 *
 * The access gate is a closed door, not a bonfire: a locked-out writer still
 * owns every word they wrote. This module is the escape hatch the website
 * promises on /support — "open the app and choose Export my books on the
 * sign-in screen" — and it is deliberately the least clever code in the
 * project.
 *
 * Rules it holds itself to:
 *   - No account, no session, no key, no network. Nothing here calls access.js
 *     or touches a signature.
 *   - Read-only. It never writes to localStorage and never deletes a file, so
 *     using the hatch can't cost you anything.
 *   - Honest about gaps. The localStorage mirror is a *mirror*: App.js strips
 *     covers and history from it, and under quota pressure it degrades to bare
 *     {id,title,filePath} stubs. A stub exported as EPUB is an empty book, so
 *     we detect that and say so rather than handing over a blank file.
 */

const MIRROR_KEY = 'offlineWriterSessions';

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Words across every chapter, or the legacy top-level body — never both.
 *
 * `session.content` is a MIRROR of the first chapter, not an extra chapter, so
 * adding it to the chapter totals counted the opening chapter twice. On a
 * one-chapter book that doubled the number outright, and this screen is shown
 * to somebody locked out and anxious about whether their work is still there:
 * a count that does not match their book is the last thing it should offer.
 *
 * Same rule Streak's countBookWords follows — chapters when there are any,
 * the flat body only when there are none.
 */
export function bookWordCount(session) {
  const chapters = session?.chapters || [];
  const parts = chapters.length ? chapters.map((c) => c?.content) : [session?.content];
  return parts.reduce((n, part) => {
    const text = plain(part);
    return n + (text ? text.split(' ').length : 0);
  }, 0);
}

/**
 * True when this entry is a name without a manuscript — the quota-degraded
 * mirror App.js falls back to. The book itself is fine; it's on disk. It just
 * isn't in here, so exporting from this copy would produce nothing.
 */
export function isStub(session) {
  if (!session) return true;
  const hasChapterText = (session.chapters || []).some((c) => plain(c?.content));
  return !hasChapterText && !plain(session.content);
}

/**
 * Everything the local mirror can offer, newest first. Returns a plain array —
 * a corrupt or absent store is an empty library, never a thrown error, because
 * the one thing this screen must never do is fail to appear.
 */
export function readLocalLibrary() {
  let raw = null;
  try { raw = localStorage.getItem(MIRROR_KEY); } catch { return []; }
  if (!raw) return [];

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((s) => s && typeof s === 'object' && !s._demo)
    .map((s) => ({
      ...s,
      title: s.title || 'Untitled',
      chapters: Array.isArray(s.chapters) ? s.chapters : [],
    }))
    .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}

/**
 * The formats the app can actually write. Kept in one list so the rescue
 * screen and the website's support copy can't drift apart: if a format isn't
 * here, we don't claim it anywhere.
 */
export const RESCUE_FORMATS = [
  { id: 'txt',  label: 'TXT',  hint: 'Plain text. Opens anywhere, forever.' },
  { id: 'html', label: 'HTML', hint: 'Styled, single file, opens in any browser.' },
  { id: 'epub', label: 'EPUB', hint: 'For e-readers and Apple Books.' },
  { id: 'pdf',  label: 'PDF',  hint: 'Fixed layout, for printing or sending.' },
];

const EXPORTERS = {
  txt:  (m) => m.exportAsTxt,
  html: (m) => m.exportAsHtml,
  epub: (m) => m.exportAsEpub,
  pdf:  (m) => m.exportAsPdf,
};

/**
 * Write one book out in one format. Imported lazily so the gate stays light —
 * most people never open this screen, and the PDF/EPUB writers are not small.
 */
export async function exportBookAs(session, format) {
  const pick = EXPORTERS[format];
  if (!pick) throw new Error('unknown-format');
  const mod = await import('./storage');
  const fn = pick(mod);
  if (typeof fn !== 'function') throw new Error('unknown-format');
  await fn(session);
}
