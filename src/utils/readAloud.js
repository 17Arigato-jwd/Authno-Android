/**
 * readAloud.js — text-to-speech for books using the Web Speech API (U2).
 *
 * No dependency: built on window.speechSynthesis, which works in the Android
 * WebView and on desktop. Speaks chapter by chapter, supports play/pause/stop,
 * rate and voice selection, and reports progress so the UI can highlight the
 * active chapter.
 *
 * Long chapters are split into sentence-sized utterances because many TTS
 * engines silently truncate or choke on very long strings.
 */

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  // Split on sentence terminators but keep chunks reasonable (~240 chars).
  const rough = text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [text];
  const out = [];
  let buf = '';
  for (const piece of rough) {
    if ((buf + piece).length > 240 && buf) { out.push(buf.trim()); buf = piece; }
    else buf += piece;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function getVoices() {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

/** Voices can load asynchronously; resolve once they're available. */
export function loadVoices() {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) return resolve([]);
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) return resolve(existing);
    const handler = () => { resolve(window.speechSynthesis.getVoices()); window.speechSynthesis.onvoiceschanged = null; };
    window.speechSynthesis.onvoiceschanged = handler;
    // Fallback timeout in case the event never fires.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

export class BookReader {
  constructor() {
    this.queue = [];         // [{ text, chapterIndex }]
    this.index = 0;
    this.playing = false;
    this.paused = false;
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(evt) { for (const fn of this.listeners) { try { fn({ ...this.state(), ...evt }); } catch (e) { console.error(e); } } }

  state() {
    return {
      playing: this.playing,
      paused: this.paused,
      index: this.index,
      total: this.queue.length,
      chapterIndex: this.queue[this.index]?.chapterIndex ?? null,
      rate: this.rate,
    };
  }

  /** Build the utterance queue from a book session. */
  load(session) {
    this.stop();
    const chapters = [...(session?.chapters || [])].sort((a, b) => a.order - b.order);
    this.queue = [];
    chapters.forEach((ch, ci) => {
      const title = (ch.title || `Chapter ${ci + 1}`).trim();
      this.queue.push({ text: title + '.', chapterIndex: ci, isHeading: true });
      for (const s of splitSentences(stripHtml(ch.content))) {
        this.queue.push({ text: s, chapterIndex: ci });
      }
    });
    // If the book has no chapters, fall back to top-level content.
    if (!chapters.length && session?.content) {
      for (const s of splitSentences(stripHtml(session.content))) this.queue.push({ text: s, chapterIndex: 0 });
    }
    this.index = 0;
    this._emit({ type: 'loaded' });
    return this.queue.length;
  }

  setRate(r) { this.rate = Math.max(0.5, Math.min(2, r)); this._emit({ type: 'rate' }); }
  setVoice(v) { this.voice = v ?? null; }

  play() {
    if (!isSpeechSupported() || !this.queue.length) return;
    if (this.paused) { this.paused = false; this.playing = true; window.speechSynthesis.resume(); this._emit({ type: 'resume' }); return; }
    if (this.playing) return;
    this.playing = true;
    this._speakCurrent();
    this._emit({ type: 'play' });
  }

  _speakCurrent() {
    if (!this.playing) return;
    if (this.index >= this.queue.length) { this._finish(); return; }
    const item = this.queue[this.index];
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = this.rate; u.pitch = this.pitch;
    if (this.voice) u.voice = this.voice;
    u.onend = () => {
      if (!this.playing) return;
      this.index += 1;
      this._emit({ type: 'progress' });
      this._speakCurrent();
    };
    u.onerror = (e) => {
      // 'interrupted'/'canceled' happen on stop — not real errors.
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.index += 1;
      this._speakCurrent();
    };
    window.speechSynthesis.speak(u);
  }

  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true; this.playing = false;
    window.speechSynthesis.pause();
    this._emit({ type: 'pause' });
  }

  stop() {
    this.playing = false; this.paused = false; this.index = 0;
    if (isSpeechSupported()) window.speechSynthesis.cancel();
    this._emit({ type: 'stop' });
  }

  next() {
    if (!this.queue.length) return;
    const curChap = this.queue[this.index]?.chapterIndex ?? 0;
    let i = this.index + 1;
    while (i < this.queue.length && this.queue[i].chapterIndex === curChap) i += 1;
    this._jump(Math.min(i, this.queue.length - 1));
  }

  prev() {
    if (!this.queue.length) return;
    const curChap = this.queue[this.index]?.chapterIndex ?? 0;
    // Jump to start of current chapter, or previous chapter if already there.
    let start = this.index;
    while (start > 0 && this.queue[start - 1].chapterIndex === curChap) start -= 1;
    let target = start;
    if (start === this.index && start > 0) {
      const prevChap = this.queue[start - 1].chapterIndex;
      target = start - 1;
      while (target > 0 && this.queue[target - 1].chapterIndex === prevChap) target -= 1;
    }
    this._jump(target);
  }

  _jump(i) {
    const wasPlaying = this.playing || this.paused;
    window.speechSynthesis.cancel();
    this.index = Math.max(0, Math.min(i, this.queue.length - 1));
    this.paused = false;
    this._emit({ type: 'seek' });
    if (wasPlaying) { this.playing = true; this._speakCurrent(); }
  }

  _finish() {
    this.playing = false; this.paused = false; this.index = 0;
    this._emit({ type: 'finished' });
  }
}
