/**
 * stubs/storage.js — exports, without the app's file layer.
 *
 * `src/utils/storage.js` is 1300 lines of the app's own file handling: the SAF
 * pickers, the save-as flow, the .authbook read/write path, the book index, the
 * PDF writer and an ePub zip builder written by hand. The sandbox host reaches
 * exactly four of its functions, and only ever with `returnBytes: true` — the
 * `library.export` capability calls them and takes the bytes across the bridge.
 *
 * So the build swaps the module for this one. Two reasons, and the smaller one
 * is size (the real module and its dependencies are about half the bundle).
 * The larger one is that everything else in there is the app's business with
 * the device — how a manuscript reaches disk, where it goes, what it is
 * wrapped in. An extension author never touches any of it, and shipping it
 * inside a tool that anybody may download puts it in their hands for no reason
 * anybody can name.
 *
 * `authbook` is NOT stubbed and does not come through here: it is the default
 * export format, the one an extension actually moves around, and it is handled
 * in extensionRuntime.js by authbook.js directly. So the format that matters
 * works in the sandbox exactly as it does on a phone.
 *
 * What this does NOT do is pretend. `epub` and `pdf` are refused by name
 * rather than answered with something that is not an ePub — an author whose
 * extension exports one should find that out here, in a sentence, rather than
 * on a device.
 */

const enc = (text, mimeType, filename) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return { filename, base64: btoa(bin), mimeType };
};

const nameFor = (session, ext) =>
  `${String(session?.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-')}.${ext}`;

const ordered = (session) =>
  [...(session?.chapters || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const strip = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .trim();

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function exportAsTxt(session, options = {}) {
  const text = [
    session?.title || 'Untitled',
    '',
    ...ordered(session).flatMap((c) => [c.title || '', strip(c.content), '']),
  ].join('\n');
  if (!options.returnBytes) throw new Error('the sandbox host only exports to bytes');
  return enc(text, 'text/plain', nameFor(session, 'txt'));
}

export async function exportAsHtml(session, options = {}) {
  const body = ordered(session)
    .map((c) => `<h2>${esc(c.title)}</h2>\n${c.content || ''}`)
    .join('\n');
  const html = `<!DOCTYPE html><html lang="${esc(session?.language || 'en')}"><head>`
    + `<meta charset="utf-8"><title>${esc(session?.title || 'Untitled')}</title></head>`
    + `<body><h1>${esc(session?.title || 'Untitled')}</h1>\n${body}</body></html>`;
  if (!options.returnBytes) throw new Error('the sandbox host only exports to bytes');
  return enc(html, 'text/html', nameFor(session, 'html'));
}

const notHere = (format) => {
  throw new Error(
    `the sandbox host does not build ${format} files — try 'authbook', 'txt' or 'html'. `
    + 'On a device this format works normally.',
  );
};

export async function exportAsEpub() { return notHere('ePub'); }
export async function exportAsPdf() { return notHere('PDF'); }
