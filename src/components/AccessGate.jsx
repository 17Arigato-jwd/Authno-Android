/**
 * AccessGate.jsx — the first thing an invited writer sees.
 *
 * Asks for the access key and pen name issued on the website, verifies both
 * offline (access.js), and gets out of the way permanently once they match.
 * It renders BEFORE the rest of the app mounts, so nothing behind it can be
 * seen or touched — but it also never destroys anything: a failed gate is a
 * closed door, not a bonfire. Books on disk are untouched no matter what
 * happens here.
 *
 * Escalation matches access.js: two free mistakes, then 30s, then 5 minutes,
 * then the app closes. The counter is persisted, so quitting doesn't reset it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DSIcons } from '../DesignSystem';
import { FloatingBlobs, ONB_THEME_CSS } from './Onboarding';
import {
  verifyAccess, storeAccess, recordFailure, getAttemptState,
  accessErrorText, MAX_ATTEMPTS, trialDaysLeftFrom,
} from '../utils/access';
import { designFromSeed, sigilDataUri, seedFromUserId } from '../utils/sigil';
import { readKeyFile, keyFileErrorText, KEYFILE_EXT } from '../utils/keyfile';
import { playSound, preloadSounds } from '../utils/sounds';
import { hapticSelect } from '../utils/haptics';

const fmtCooldown = (ms) => {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

export default function AccessGate({ accentHex = '#5a00d9', onUnlock }) {
  const [mode, setMode] = useState('file');   // 'file' (default) | 'paste'
  const [key, setKey] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(() => getAttemptState());
  const [now, setNow] = useState(Date.now());
  const [granted, setGranted] = useState(null); // payload, during the unlock beat
  const [sigilSeed, setSigilSeed] = useState(null);
  const keyRef = useRef(null);

  useEffect(() => { preloadSounds(['gateUnlock', 'keyInvalid']); }, []);
  useEffect(() => { keyRef.current?.focus?.(); }, []);

  // Tick only while a cooldown is actually running.
  const locked = attempts.lockedUntil > now;
  useEffect(() => {
    if (!locked) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  const canSubmit = !busy && !locked && username.trim().length > 0 && (
    mode === 'file'
      ? (!!file && email.trim().length > 0)
      : key.trim().length > 0
  );

  const finish = useCallback(async (payload) => {
    // A short beat on the unlocked sigil, then hand over. This is the one
    // moment of ceremony the gate gets — after today it never appears again.
    setGranted(payload);
    playSound('gateUnlock');
    try { setSigilSeed(await seedFromUserId(payload.uid)); } catch { /* cosmetic only */ }
    setTimeout(() => onUnlock?.(payload), 2100);
  }, [onUnlock]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // In file mode the pen name and email are what open the file at all —
      // get either wrong and it yields nothing, so a stray copy of someone's
      // .authkey is not enough to use their membership.
      let accessKey = key;
      if (mode === 'file') {
        const opened = await readKeyFile(file, username, email);
        accessKey = opened.accessKey;
      }
      const payload = await verifyAccess(accessKey, username);
      storeAccess(accessKey, username);
      hapticSelect();
      await finish(payload);
    } catch (e) {
      const reason = e?.message || 'unknown';
      const state = recordFailure();
      setAttempts(getAttemptState());
      setNow(Date.now());
      playSound('keyInvalid');
      if (state.exit) {
        setError('Too many attempts. AuthNo is closing.');
        // Give the message a moment to land, then leave. Android has a real
        // exit; on desktop we ask Electron to quit; on web there is nothing
        // honest to do but say so, so the message stays on screen.
        setTimeout(async () => {
          try {
            const { App } = await import('@capacitor/app');
            await App.exitApp();
          } catch { /* not Android */ }
          try { window.electron?.quitApp?.(); } catch { /* not desktop */ }
        }, 1800);
      } else {
        // Key-file failures have their own vocabulary ('wrong-details' etc.);
        // fall back to the access-key wording for everything else.
        const KEYFILE_REASONS = ['not-a-keyfile', 'corrupt', 'unsupported-version', 'wrong-details'];
        setError(KEYFILE_REASONS.includes(reason) ? keyFileErrorText(reason) : accessErrorText(reason));
      }
      setBusy(false);
    }
  }, [canSubmit, mode, key, file, username, email, finish]);

  const onKeyDown = (e) => { if (e.key === 'Enter' && canSubmit) submit(); };

  const sigilUri = useMemo(() => {
    if (!sigilSeed) return null;
    try { return sigilDataUri(designFromSeed(sigilSeed), 132); } catch { return null; }
  }, [sigilSeed]);

  const remaining = attempts.remaining;
  const showRemaining = attempts.count > 0 && remaining > 0 && remaining <= MAX_ATTEMPTS - 2;

  return (
    <div className="onb" style={S.root}>
      <style>{ONB_THEME_CSS}</style>
      <FloatingBlobs accentHex={accentHex} />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}
        style={S.card}
      >
        {granted ? (
          <div style={S.grantedWrap}>
            <motion.div
              initial={{ scale: 0.82, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.2, 0.9, 0.3, 1] }}
              style={{ marginBottom: 22 }}
            >
              {sigilUri
                ? <img src={sigilUri} alt="" width={132} height={132} style={{ borderRadius: 18, display: 'block' }} />
                : <div style={{ width: 132, height: 132 }} />}
            </motion.div>
            <h1 style={S.title}>Welcome, {granted.u}</h1>
            <p style={S.sub}>
              {trialDaysLeftFrom(granted) > 0
                ? `Everything is unlocked for the next ${trialDaysLeftFrom(granted)} days.`
                : 'Your library is ready.'}
            </p>
          </div>
        ) : (
          <>
            <div style={S.badge}><DSIcons.Key size={19} /></div>
            <h1 style={S.title}>You were invited</h1>
            <p style={S.sub}>
              Enter the access key and pen name from the website. They are
              checked here on your device — AuthNo never asks again, and never
              asks the internet.
            </p>

            {mode === 'file' ? (
              <>
                <label style={S.label} htmlFor="gate-file">Key file</label>
                <input
                  id="gate-file"
                  ref={fileRef}
                  type="file"
                  accept={`.${KEYFILE_EXT}`}
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                  disabled={locked || busy}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={locked || busy}
                  style={{ ...S.input, ...S.filePick, borderStyle: file ? 'solid' : 'dashed' }}
                >
                  {file ? file.name : `Choose your .${KEYFILE_EXT} file`}
                </button>
              </>
            ) : (
              <>
                <label style={S.label} htmlFor="gate-key">Access key</label>
                <textarea
                  id="gate-key"
                  ref={keyRef}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="AUTHNO-eyJ…"
                  rows={3}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={locked || busy}
                  style={{ ...S.input, ...S.mono, resize: 'vertical' }}
                />
              </>
            )}

            <label style={S.label} htmlFor="gate-user">Pen name</label>
            <input
              id="gate-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="inkwell_moth"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={locked || busy}
              style={S.input}
            />

            {mode === 'file' && (
              <>
                <label style={S.label} htmlFor="gate-email">Email</label>
                <input
                  id="gate-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="you@example.com"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={locked || busy}
                  style={S.input}
                />
              </>
            )}

            {error && (
              <div style={S.error} role="alert">
                <DSIcons.Warning size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{error}</span>
              </div>
            )}

            {locked && (
              <div style={S.cooldown} role="status">
                Too many wrong tries. Try again in {fmtCooldown(attempts.lockedUntil - now)}.
              </div>
            )}

            {showRemaining && !locked && (
              <div style={S.remaining}>
                {remaining} {remaining === 1 ? 'try' : 'tries'} left before AuthNo closes.
              </div>
            )}

            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{ ...S.cta, opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'default' }}
            >
              {busy ? 'Checking…' : 'Unlock AuthNo'}
            </button>

            <button
              onClick={() => { setMode(mode === 'file' ? 'paste' : 'file'); setError(null); }}
              disabled={busy}
              style={S.switchMode}
            >
              {mode === 'file' ? 'Paste the key as text instead' : 'Use a key file instead'}
            </button>

            <p style={S.foot}>
              {mode === 'file'
                ? 'Your key file is sealed with the pen name and email it was issued to. All three have to match.'
                : 'The pasted key is checked against your pen name.'}
              {' '}Lost it? It can be re-issued from the website to your email.
              Your books are unaffected either way — this gate has never touched a file of yours.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}

const S = {
  root: {
    position: 'fixed', inset: 0, zIndex: 100000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom))',
    background: 'var(--onb-bg, #0b0710)', overflowY: 'auto',
  },
  card: {
    position: 'relative', zIndex: 1, width: '100%', maxWidth: 460,
    background: 'var(--onb-card, rgba(20,14,28,0.86))',
    border: '1px solid var(--onb-border, rgba(255,255,255,0.09))',
    borderRadius: 22, padding: 'clamp(24px, 6vw, 34px)',
    backdropFilter: 'blur(22px)', boxShadow: '0 28px 70px rgba(0,0,0,0.5)',
  },
  grantedWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10px 0 6px' },
  badge: {
    width: 42, height: 42, borderRadius: 13, marginBottom: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--onb-accent-soft, rgba(168,85,247,0.16))',
    color: 'var(--onb-accent, #c084fc)',
  },
  title: { fontFamily: 'Sora, sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 10px', color: 'var(--onb-text1, #fff)' },
  sub: { fontSize: 14, lineHeight: 1.66, color: 'var(--onb-text3, rgba(255,255,255,0.62))', margin: '0 0 22px' },
  label: { display: 'block', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.01em', color: 'var(--onb-text2, rgba(255,255,255,0.8))', marginBottom: 7 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 16,
    background: 'var(--onb-input, rgba(255,255,255,0.05))',
    border: '1px solid var(--onb-border, rgba(255,255,255,0.11))',
    borderRadius: 11, color: 'var(--onb-text1, #fff)', fontSize: 15,
    fontFamily: 'inherit', outline: 'none',
  },
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.55 },
  filePick: {
    textAlign: 'left', cursor: 'pointer',
    color: 'var(--onb-text2, rgba(255,255,255,0.8))',
    borderWidth: 1.5,
  },
  switchMode: {
    display: 'block', width: '100%', marginTop: 12, padding: '8px 0',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--onb-text4, rgba(255,255,255,0.5))',
    fontSize: 12.5, textDecoration: 'underline', fontFamily: 'inherit',
  },
  error: {
    display: 'flex', gap: 9, alignItems: 'flex-start',
    background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 11, padding: '11px 13px', marginBottom: 14,
    fontSize: 13, lineHeight: 1.6, color: '#fca5a5',
  },
  cooldown: {
    background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 11, padding: '11px 13px', marginBottom: 14,
    fontSize: 13, lineHeight: 1.6, color: '#fcd34d',
  },
  remaining: { fontSize: 12.5, color: 'var(--onb-text4, rgba(255,255,255,0.45))', marginBottom: 14 },
  cta: {
    width: '100%', padding: '14px 20px', borderRadius: 13, border: 'none',
    background: 'var(--onb-accent, linear-gradient(135deg,#c084fc,#a855f7))',
    color: '#fff', fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 15.5,
    transition: 'opacity .2s',
  },
  foot: { fontSize: 12, lineHeight: 1.6, color: 'var(--onb-text4, rgba(255,255,255,0.42))', margin: '18px 0 0' },
};
