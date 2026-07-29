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
 *
 * One door is always open: "Export my books" reaches ExportRescue with no key,
 * no account and no cooldown. Being locked out of the app must never mean
 * being locked out of your own manuscripts — the website promises exactly
 * this on /support, and this is where that promise is kept.
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DSIcons } from '../DesignSystem';
import { FloatingBlobs, ONB_THEME_CSS } from './Onboarding';
import {
  verifyAccess, storeAccess, recordFailure, getAttemptState,
  accessErrorText, MAX_ATTEMPTS, trialDaysLeftFrom,
} from '../utils/access';
import { designFromSeed, sigilDataUri, seedFromUserId } from '../utils/sigil';
import { unpackKeyFile, keyFileSecretKind, keyFileErrorText, KEYFILE_EXT } from '../utils/keyfile';
import { fetchKeyWithPassword, redeemCode, gateConfigured, gateErrorText } from '../utils/gateApi';
import { playSound, preloadSounds } from '../utils/sounds';
import { hapticSelect } from '../utils/haptics';

const ExportRescue = lazy(() => import('./ExportRescue'));

const fmtCooldown = (ms) => {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

export default function AccessGate({ accentHex = '#5a00d9', onUnlock }) {
  // 'redeem' is the front door, because the only way to have an account is to
  // have been given a code — so for everybody arriving here for the first time
  // this is the screen they need, and signing in is the exception rather than
  // the default. 'file' is not a fallback for people with old key files: it is
  // how you get in with no network, which for an offline-first editor is an
  // ordinary situation, so it stays reachable whether or not the gate answers.
  const [mode, setMode] = useState(() => (gateConfigured() ? 'redeem' : 'file'));
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  // The second half of the seal. Which one it is depends on the file: v2 is
  // sealed with the password, v1 (issued before passwords existed) with the
  // email. The file's own header says which, so the field relabels itself
  // rather than asking for a password and then failing on a good old file.
  const [secret, setSecret] = useState('');
  const [secretKind, setSecretKind] = useState(null);   // 'password' | 'email' | null
  const [file, setFile] = useState(null);
  const [fileBytes, setFileBytes] = useState(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(() => getAttemptState());
  const [now, setNow] = useState(Date.now());
  const [granted, setGranted] = useState(null); // payload, during the unlock beat
  const [sigilSeed, setSigilSeed] = useState(null);
  const [rescuing, setRescuing] = useState(false); // "Export my books" is open
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
    mode === 'redeem'   ? (code.trim().length > 0 && email.trim().length > 0 && password.length > 0)
    : mode === 'password' ? password.length > 0
    : (!!fileBytes && !!secretKind && secret.length > 0)
  );

  /** Read the file once, up front, so its version can label the next field. */
  const chooseFile = useCallback(async (f) => {
    setError(null);
    setFile(f);
    setSecret('');
    if (!f) { setFileBytes(null); setSecretKind(null); return; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = keyFileSecretKind(bytes);
      setFileBytes(bytes);
      setSecretKind(kind);
      if (!kind) setError(keyFileErrorText('not-a-keyfile'));
    } catch {
      setFileBytes(null);
      setSecretKind(null);
      setError(keyFileErrorText('not-a-keyfile'));
    }
  }, []);

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
      // In file mode the pen name and the secret are what open the file at
      // all — get either wrong and it yields nothing, so a stray copy of
      // someone's .authkey is not enough to use their membership.
      let accessKey = null;
      if (mode === 'redeem') {
        // The code becomes an account and a key in one request. Everything
        // after this is identical to a key that arrived in a file — verified
        // offline, stored locally, and never asked about again.
        const made = await redeemCode({
          code: code.trim(), username: username.trim(),
          email: email.trim(), password,
        });
        accessKey = made.accessKey;
      } else if (mode === 'password') {
        // Fetch a key, then verify it offline like any other. The network is
        // used once, here; everything after this point is identical to a key
        // that arrived in a file.
        const issued = await fetchKeyWithPassword(username.trim(), password);
        accessKey = issued.accessKey;
      } else {
        const opened = await unpackKeyFile(
          fileBytes, username, secretKind === 'email' ? secret.trim() : secret
        );
        accessKey = opened.accessKey;
      }
      const payload = await verifyAccess(accessKey, username);
      storeAccess(accessKey, username);
      hapticSelect();
      await finish(payload);
    } catch (e) {
      const reason = e?.message || 'unknown';

      // Not every failure is a wrong answer. A dead connection, a gate that is
      // down, a server-side rate limit — none of those are the writer getting
      // their password wrong, and counting them would march somebody with bad
      // wifi towards the app closing itself. Escalation is for credentials.
      const NOT_A_CREDENTIAL_FAILURE = [
        'gate-unreachable', 'gate-not-configured', 'verify-unavailable',
        'rate-limited', 'signin-failed', 'issue-failed', 'no-session',
        // Redeeming: telling somebody their pen name is taken or their
        // password is too short is a form asking to be corrected, not a wrong
        // answer. Counting these would be perverse — the escalation exists to
        // make guessing expensive, and a person filling in a form they were
        // invited to fill in is not guessing. They have no account to lock
        // themselves out of yet either.
        'username-taken', 'username-too-short', 'username-too-long',
        'username-invalid', 'username-reserved',
        'password-too-short', 'password-too-long',
        'email-required', 'turnstile-failed', 'redeem-failed',
        // A real code that is spent or withdrawn is not a guess either. The
        // person holding it needs a new one, not a five-minute cooldown.
        'code-already-used', 'code-revoked',
        // 'invalid-code' is deliberately NOT here: a wrong code IS a guess,
        // and guessing invite codes is the thing escalation is for.
      ];
      if (NOT_A_CREDENTIAL_FAILURE.includes(reason)) {
        setError(gateErrorText(reason));
        setBusy(false);
        return;
      }

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
        // 'invalid-code' belongs here even though it escalates. Escalating and
        // being explicable are different questions, and a mistyped code is the
        // likeliest mistake on the redeem screen — answering it with "something
        // went wrong checking that key" sends somebody to look at a key they
        // do not have yet.
        const GATE_REASONS = ['bad-credentials', 'missing-credentials', 'revoked', 'invalid-code'];
        const named = reason === 'wrong-details' && secretKind === 'email' ? 'wrong-details-v1' : reason;
        setError(
          KEYFILE_REASONS.includes(reason) ? keyFileErrorText(named)
          : GATE_REASONS.includes(reason) ? gateErrorText(reason)
          : accessErrorText(reason)
        );
      }
      setBusy(false);
    }
  }, [canSubmit, mode, password, code, email, fileBytes, username, secret, secretKind, finish]);

  const onKeyDown = (e) => { if (e.key === 'Enter' && canSubmit) submit(); };

  const sigilUri = useMemo(() => {
    if (!sigilSeed) return null;
    try { return sigilDataUri(designFromSeed(sigilSeed), 132); } catch { return null; }
  }, [sigilSeed]);

  const remaining = attempts.remaining;
  const showRemaining = attempts.count > 0 && remaining > 0 && remaining <= MAX_ATTEMPTS - 2;

  // Deliberately checked before everything else, including the cooldown: a
  // locked-out writer reaching for their manuscripts is not a login attempt,
  // so it is not rate-limited and not counted.
  if (rescuing) {
    return (
      <Suspense fallback={null}>
        <ExportRescue accentHex={accentHex} onBack={() => setRescuing(false)} />
      </Suspense>
    );
  }

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
              {mode === 'redeem'
                ? 'Redeem your invite code to set up your account.'
                : mode === 'password'
                ? 'Sign in once with your pen name and password. After that AuthNo checks your key here on your device and never asks the internet again.'
                : 'Your key is checked here on your device — no network needed, now or ever.'}
            </p>

            {mode === 'redeem' && (
              <>
                <label style={S.label} htmlFor="gate-code">Invite code</label>
                <input
                  id="gate-code"
                  ref={keyRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={onKeyDown}
                  spellCheck={false}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  disabled={locked || busy}
                  style={{ ...S.input, ...S.mono }}
                />
              </>
            )}

            {mode === 'file' && (
              <>
                <label style={S.label} htmlFor="gate-file">Key file</label>
                <input
                  id="gate-file"
                  ref={fileRef}
                  type="file"
                  accept={`.${KEYFILE_EXT}`}
                  onChange={(e) => { void chooseFile(e.target.files?.[0] ?? null); }}
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

            {mode === 'redeem' && (
              <>
                {/* Labels are the website's, word for word, because /redeem is
                    the same act on the same account and two names for one
                    field is how people come to believe they are two things. */}
                <label style={S.label} htmlFor="gate-email">Email</label>
                <input
                  id="gate-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="you@example.com"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="email"
                  disabled={locked || busy}
                  style={S.input}
                />
                <label style={S.label} htmlFor="gate-newpassword">Password</label>
                <input
                  id="gate-newpassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onKeyDown}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="new-password"
                  disabled={locked || busy}
                  style={S.input}
                />
              </>
            )}

            {mode === 'password' && (
              <>
                <label style={S.label} htmlFor="gate-password">Password</label>
                <input
                  id="gate-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onKeyDown}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="current-password"
                  disabled={locked || busy}
                  style={S.input}
                />
              </>
            )}

            {mode === 'file' && (
              <>
                <label style={S.label} htmlFor="gate-secret">
                  {secretKind === 'email' ? 'Email' : 'Password'}
                </label>
                <input
                  id="gate-secret"
                  type={secretKind === 'email' ? 'email' : 'password'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={secretKind === 'email' ? 'you@example.com' : ''}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={locked || busy || !secretKind}
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
              {busy ? 'Checking…' : mode === 'redeem' ? 'Redeem and open AuthNo' : 'Unlock AuthNo'}
            </button>

            {/* Small on purpose. Redeeming is the main path because a code is
                the only way to have an account at all; the rest are for people
                who already have one, or who have no signal, and they should be
                findable without competing with it. */}
            <div style={S.altModes}>
              {mode !== 'redeem' && gateConfigured() && (
                <button onClick={() => { setMode('redeem'); setError(null); }} disabled={busy} style={S.switchMode}>
                  Redeem an invite code
                </button>
              )}
              {mode !== 'password' && gateConfigured() && (
                <button onClick={() => { setMode('password'); setError(null); }} disabled={busy} style={S.switchMode}>
                  {mode === 'redeem' ? 'Already have an account? Sign in' : 'Sign in with a password'}
                </button>
              )}
              {mode !== 'file' && (
                <button onClick={() => { setMode('file'); setError(null); }} disabled={busy} style={S.switchMode}>
                  {mode === 'password' || mode === 'redeem' ? 'Sign in offline with a key file' : 'Use a key file instead'}
                </button>
              )}
            </div>

            <div style={S.rescueWrap}>
              <button onClick={() => setRescuing(true)} style={S.rescue}>
                <DSIcons.Download size={14} style={{ flexShrink: 0 }} />
                <span>Export my books</span>
              </button>
              <p style={S.rescueNote}>
                Locked out and need your manuscripts? This works with no key
                and no account.
              </p>
            </div>

            <p style={S.foot}>
              {mode === 'redeem'
                ? 'This is the only time AuthNo needs the network. It fetches your key, then checks it here from now on.'
                : mode === 'password'
                ? 'This is the only time AuthNo needs the network. It fetches your key, then checks it here from now on.'
                : (secretKind === 'email'
                    ? 'This key file predates passwords, so it is sealed with the pen name and email it was issued to. All three have to match.'
                    : 'Your key file is sealed with your pen name and password. All three have to match.')}
              {' '}Lost it? Take another from your account on the website — it
              costs nothing. Your books are unaffected either way; this gate has
              never touched a file of yours.
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
    // flex-start, NOT center. Centring a child taller than its scroll container
    // overflows it in BOTH directions, and there is no scrolling upwards — so
    // the badge and the top of the heading were cut off and unreachable on any
    // screen short enough. `margin: auto` on the card below still centres it
    // whenever there IS room, which is the behaviour centring was here for.
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: 'max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom))',
    background: 'var(--onb-bg, #0b0710)', overflowY: 'auto',
  },
  // The vertical rhythm below is deliberately tight. Redeem asks for four
  // fields — more than any other mode — and under them sit the three routes in,
  // the rescue button and its note. At the old spacing the card came to 944px,
  // which does not fit a 932px phone, so it ran off the bottom edge with its
  // rounded corner out of sight and read as broken however far you scrolled.
  card: {
    position: 'relative', zIndex: 1, width: '100%', maxWidth: 460, margin: 'auto',
    background: 'var(--onb-card, rgba(20,14,28,0.86))',
    border: '1px solid var(--onb-border, rgba(255,255,255,0.09))',
    borderRadius: 22, padding: 'clamp(20px, 5vw, 30px)',
    backdropFilter: 'blur(22px)', boxShadow: '0 28px 70px rgba(0,0,0,0.5)',
  },
  grantedWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10px 0 6px' },
  badge: {
    width: 42, height: 42, borderRadius: 13, marginBottom: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--onb-accent-soft, rgba(168,85,247,0.16))',
    color: 'var(--onb-accent, #c084fc)',
  },
  title: { fontFamily: 'Sora, sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 8px', color: 'var(--onb-text1, #fff)' },
  sub: { fontSize: 14, lineHeight: 1.5, color: 'var(--onb-text3, rgba(255,255,255,0.62))', margin: '0 0 18px' },
  label: { display: 'block', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.01em', color: 'var(--onb-text2, rgba(255,255,255,0.8))', marginBottom: 5 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '11px 14px', marginBottom: 11,
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
  altModes: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 2, marginTop: 6,
  },
  switchMode: {
    display: 'block', width: '100%', padding: '5px 0',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--onb-text4, rgba(255,255,255,0.5))',
    fontSize: 12.5, textDecoration: 'underline', fontFamily: 'inherit',
  },
  rescueWrap: {
    marginTop: 12, paddingTop: 12,
    borderTop: '1px solid var(--onb-border, rgba(255,255,255,0.08))',
  },
  rescue: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', padding: '11px 16px', borderRadius: 12, cursor: 'pointer',
    background: 'var(--onb-input, rgba(255,255,255,0.05))',
    border: '1px solid var(--onb-border, rgba(255,255,255,0.11))',
    color: 'var(--onb-text2, rgba(255,255,255,0.8))',
    fontFamily: 'Sora, sans-serif', fontWeight: 600, fontSize: 13.5,
  },
  rescueNote: {
    fontSize: 11.5, lineHeight: 1.55, textAlign: 'center',
    color: 'var(--onb-text4, rgba(255,255,255,0.42))', margin: '7px 0 0',
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
