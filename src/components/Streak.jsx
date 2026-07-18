/**
 * Streak.jsx — Writing Streak System
 *
 * Changes from original:
 *   - StreakCalendar close button and month-nav buttons → MinimalButton from DesignSystem
 *   - COLORS from tokens replace hardcoded Discord-palette hex strings
 *     (#72767d → COLORS.textSubtle, #4f545c → COLORS.textDisabled, etc.)
 *   - FlameButton counts words with countBookWords (all chapters), not just
 *     the chapter-1 mirror in session.content.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame } from 'lucide-react';
import { hapticGoalMet } from '../utils/haptics';
import { MinimalButton, COLORS, DSIcons, CloseButton } from '../DesignSystem';

// ── Utilities ─────────────────────────────────────────────────────────────────

export function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function countWords(html) {
  if (!html) return 0;
  // Same rule as history.js wordCountOf / authbook's manifest counter — the
  // fallback must agree with the cached word_count it stands in for, or the
  // streak baseline drifts by a few words after the first edit of a chapter.
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Words across the WHOLE book. The streak used to count only
 * `session.content` — which mirrors chapter 1 — so writing in any other
 * chapter never advanced the flame (author bug report). Multi-chapter books
 * now sum every chapter; legacy flat sessions fall back to content.
 */
export function countBookWords(session) {
  const chapters = session?.chapters;
  // Prefer the cached word_count (maintained per edit, loaded from the
  // manifest) — this runs on EVERY FlameButton render, i.e. every editor
  // flush, and used to re-strip the whole book's HTML each time.
  if (chapters?.length) {
    return chapters.reduce((n, c) =>
      n + (typeof c.word_count === 'number' ? c.word_count : countWords(c.content || '')), 0);
  }
  return countWords(session?.content ?? '');
}

function makeDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeLog(rawLog, fallbackGoal) {
  if (!rawLog) return {};
  const result = {};
  for (const [key, val] of Object.entries(rawLog)) {
    result[key] = typeof val === 'number' ? { words: val, goal: fallbackGoal } : val;
  }
  return result;
}

function isEntryMet(entry) { return !!(entry && entry.words >= entry.goal); }
function isKeyMet(log, key) { return isEntryMet(log[key] ?? null); }

export function computeStreak(log) {
  if (!log) return 0;
  let streak = 0;
  const todayKey = getTodayKey();
  const cursor = new Date();
  if (!isKeyMet(log, todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (true) {
    const key = makeDateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    if (isKeyMet(log, key)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

// ── Day Tooltip ───────────────────────────────────────────────────────────────

function DayTooltip({ entry, dayLabel, accentHex, cellRef }) {
  const tipRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false });

  useEffect(() => {
    if (!cellRef?.current || !tipRef.current) return;
    const cell = cellRef.current.getBoundingClientRect();
    const tip  = tipRef.current.getBoundingClientRect();
    let left = cell.left + cell.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
    const top = cell.top - tip.height - 8 < 8 ? cell.bottom + 8 : cell.top - tip.height - 8;
    setPos({ top, left, ready: true });
  }, [cellRef]);

  const met = isEntryMet(entry);
  const words = entry?.words ?? 0;
  const goal  = entry?.goal  ?? null;

  return createPortal(
    <div ref={tipRef} style={{
      position: 'fixed', top: pos.top, left: pos.left,
      zIndex: 10000, opacity: pos.ready ? 1 : 0,
      background: COLORS.surface2,
      border: `1px solid ${met ? accentHex + '55' : COLORS.border}`,
      borderRadius: 8, padding: '8px 12px',
      pointerEvents: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
      whiteSpace: 'nowrap', transition: 'opacity 0.08s ease',
    }}>
      <div style={{ fontSize: 11, color: COLORS.textSubtle, marginBottom: 5 }}>{dayLabel}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        {met
          ? <DSIcons.CheckCircle size={12} color={accentHex} style={{ flexShrink: 0, alignSelf: "center" }} />
          : <DSIcons.XCircle size={12} color={COLORS.textDisabled} style={{ flexShrink: 0, alignSelf: "center" }} />
        }
        <span style={{ fontSize: 14, fontWeight: 700, color: met ? accentHex : COLORS.textSubtle }}>
          {words.toLocaleString()}
        </span>
        {goal !== null && (
          <span style={{ fontSize: 10, fontWeight: 500, color: COLORS.textDisabled, position: 'relative', top: 2 }}>
            /{goal.toLocaleString()}
          </span>
        )}
        <span style={{ fontSize: 11, color: COLORS.textDisabled }}>words</span>
      </div>
    </div>,
    document.body
  );
}

// ── Calendar Cell ─────────────────────────────────────────────────────────────

function CalendarCell({ day, cellIndex, daysInMonth, viewYear, viewMonth, log, accentHex, todayKey }) {
  const [hovered, setHovered] = useState(false);
  const cellRef = useRef(null);

  if (!day) return <div style={{ height: 34 }} />;

  const key     = makeDateKey(viewYear, viewMonth, day);
  const entry   = log[key] ?? null;
  const met     = isEntryMet(entry);
  const isToday = key === todayKey;
  const hasData = entry !== null;

  const posInRow     = cellIndex % 7;
  const isFirstInRow = posInRow === 0;
  const isLastInRow  = posInRow === 6;
  const prevKey = day > 1           ? makeDateKey(viewYear, viewMonth, day - 1) : null;
  const nextKey = day < daysInMonth ? makeDateKey(viewYear, viewMonth, day + 1) : null;
  const prevMet = !isFirstInRow && prevKey && isKeyMet(log, prevKey);
  const nextMet = !isLastInRow  && nextKey && isKeyMet(log, nextKey);

  const fill   = accentHex + '30';
  const border = accentHex + '90';

  let cellStyle = {};
  if (met) {
    if (prevMet && nextMet)     cellStyle = { background: fill, borderRadius: 0, borderTop: `1.5px solid ${border}`, borderBottom: `1.5px solid ${border}` };
    else if (prevMet)           cellStyle = { background: fill, borderRadius: '0 50% 50% 0', borderTop: `1.5px solid ${border}`, borderBottom: `1.5px solid ${border}`, borderRight: `1.5px solid ${border}` };
    else if (nextMet)           cellStyle = { background: fill, borderRadius: '50% 0 0 50%', borderTop: `1.5px solid ${border}`, borderBottom: `1.5px solid ${border}`, borderLeft: `1.5px solid ${border}` };
    else                        cellStyle = { background: fill, borderRadius: '50%', border: `1.5px solid ${border}` };
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div ref={cellRef}
      onMouseEnter={() => hasData && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ height: 34, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...cellStyle }}
    >
      <span style={{ fontSize: 12, fontWeight: isToday ? 700 : met ? 600 : 400, color: met ? accentHex : isToday ? 'var(--text-1)' : hasData ? COLORS.textMuted : COLORS.textSubtle, position: 'relative', zIndex: 1, lineHeight: 1 }}>
        {day}
      </span>
      {isToday && !met && (
        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: '50%', background: accentHex }} />
      )}
      {hasData && !met && !isToday && entry.goal > 0 && (
        <div style={{ position: 'absolute', bottom: 3, left: '20%', right: '20%', height: 2, borderRadius: 1, background: 'var(--surface-md)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 1, background: accentHex + '60', width: `${Math.min(100, (entry.words / entry.goal) * 100)}%` }} />
        </div>
      )}
      {hovered && hasData && (
        <DayTooltip entry={entry} dayLabel={`${MONTH_NAMES[viewMonth]} ${day}, ${viewYear}`} accentHex={accentHex} cellRef={cellRef} />
      )}
    </div>
  );
}

// ── Calendar Popup ────────────────────────────────────────────────────────────

const DAY_LABELS  = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function StreakCalendar({ currentStreak, log, wordsToday, goalWords, accentHex, anchorRef, onClose }) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const popW = 308;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    setPos({ top: rect.bottom + 10, left });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (popRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const startPad    = (firstDow + 6) % 7;
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey    = getTodayKey();
  const todayEntry  = log[todayKey] ?? null;
  const todayMet    = wordsToday >= goalWords;
  const displayGoal = todayEntry?.goal ?? goalWords;

  const streakLabel = currentStreak === 0 ? 'No streak yet — start writing!' : currentStreak === 1 ? '1 day streak 🔥' : `${currentStreak} day streak 🔥`;

  return createPortal(
    <motion.div ref={popRef}
      data-tour="streak-panel"
      initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
      style={{
      position: 'fixed', top: pos.top, left: pos.left,
      width: 308, zIndex: 9999,
      background: COLORS.surface1,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16, boxShadow: `0 16px 48px rgba(0,0,0,0.8), 0 0 40px ${accentHex}18`,
      padding: 20,
    }}>

      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <CloseButton onClick={onClose} />
      </div>

      {/* Streak count */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
          <Flame size={32} color={currentStreak > 0 ? accentHex : COLORS.textDisabled} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 42, fontWeight: 800, lineHeight: 1, color: currentStreak > 0 ? accentHex : COLORS.textDisabled }}>
            {currentStreak}
          </span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textSubtle, marginBottom: 8 }}>{streakLabel}</div>
        <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: COLORS.textSubtle, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Today</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: todayMet ? accentHex : COLORS.textSubtle }}>{wordsToday.toLocaleString()}</span>
              <span style={{ fontSize: 10, color: COLORS.textDisabled, position: 'relative', top: 1 }}>/{displayGoal.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: COLORS.textDisabled }}>words</span>
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--surface-md)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: accentHex, width: `${Math.min(100, (wordsToday / displayGoal) * 100)}%`, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      </div>

      {/* Month nav — MinimalButton from DesignSystem */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <MinimalButton variant="smooth" size="xs" color={COLORS.textSubtle} onClick={prevMonth}
          style={{ width: 28, height: 28, borderRadius: 6, justifyContent: 'center', padding: 0 }}>
          <DSIcons.ChevronLeft size={15} />
        </MinimalButton>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary }}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <MinimalButton variant="smooth" size="xs" color={COLORS.textSubtle} onClick={nextMonth}
          style={{ width: 28, height: 28, borderRadius: 6, justifyContent: 'center', padding: 0 }}>
          <DSIcons.ChevronRight size={15} />
        </MinimalButton>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: COLORS.textDisabled, padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
        {cells.map((day, i) => (
          <CalendarCell key={i} day={day} cellIndex={i} daysInMonth={daysInMonth} viewYear={viewYear} viewMonth={viewMonth} log={log} accentHex={accentHex} todayKey={todayKey} />
        ))}
      </div>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: 11, color: COLORS.textDisabled, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <DSIcons.Target size={11} color={COLORS.textDisabled} />
        Current goal: {goalWords.toLocaleString()} words/day
      </div>
    </motion.div>,
    document.body
  );
}

// ── FlameButton ───────────────────────────────────────────────────────────────

export function FlameButton({ current, accentHex = '#3b82f6', goalWords = 300, onStreakUpdate }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [shaking, setShaking]           = useState(false);

  // Guided tour: the "Your streak, up close" step opens the calendar so the
  // spotlight can walk through it; any other step (or tour end) closes it.
  useEffect(() => {
    const h = (e) => { setCalendarOpen(e.detail?.action === 'streak' && !!current); };
    document.addEventListener('authno-tour-action', h);
    return () => document.removeEventListener('authno-tour-action', h);
  }, [current]);
  const buttonRef      = useRef(null);
  const hwRef          = useRef(0);
  const baselineSetRef = useRef(null);

  const streak        = current?.streak ?? {};
  const rawLog        = streak.log      ?? {};
  const effectiveGoal = streak.goalWords ?? goalWords;
  const log           = normalizeLog(rawLog, effectiveGoal);
  const todayKey      = getTodayKey();
  const currentWords  = countBookWords(current);

  if (currentWords > hwRef.current) hwRef.current = currentWords;

  useEffect(() => {
    if (!current) return;
    const key = `${current.id}:${todayKey}`;
    if (baselineSetRef.current === key) return;
    baselineSetRef.current = key;
    const existing = current.streak?.dailyBaseline?.[todayKey];
    if (existing !== undefined) return;
    const wc = countBookWords(current);
    hwRef.current = wc;
    onStreakUpdate?.({ ...streak, dailyBaseline: { ...(streak.dailyBaseline ?? {}), [todayKey]: wc } });
  }, [current?.id, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { hwRef.current = countBookWords(current); }, [current?.id, todayKey]); // eslint-disable-line

  const baseline   = streak.dailyBaseline?.[todayKey] ?? currentWords;
  const wordsToday = Math.max(0, hwRef.current - baseline);
  const todayMet   = wordsToday >= effectiveGoal;
  const currentStreak = computeStreak(log);

  const prevMetRef = useRef(false);
  useEffect(() => {
    if (!current) return;
    const existing   = log[todayKey] ?? null;
    // Compare against effectiveGoal — the value actually written below. With a
    // per-book goal set, comparing to the global goalWords made needsWrite
    // permanently true and rewrote the log on every effect run.
    const needsWrite = !existing || existing.words !== wordsToday || existing.goal !== effectiveGoal;
    if (needsWrite) {
      const updatedLog    = { ...rawLog, [todayKey]: { words: wordsToday, goal: effectiveGoal } };
      const updatedStreak = { ...streak, log: updatedLog };
      onStreakUpdate?.(updatedStreak);
    }
    const justMet = todayMet && !prevMetRef.current;
    prevMetRef.current = todayMet;
    if (justMet) { setShaking(true); setTimeout(() => setShaking(false), 600); hapticGoalMet(); }
  }, [wordsToday, goalWords, todayKey, current?.id]); // eslint-disable-line

  return (
    <>
      <style>{`@keyframes flameShake{0%,100%{transform:rotate(0deg) scale(1)}20%{transform:rotate(-12deg) scale(1.15)}40%{transform:rotate(12deg) scale(1.15)}60%{transform:rotate(-8deg) scale(1.08)}80%{transform:rotate(8deg) scale(1.08)}}.flame-shaking{animation:flameShake 0.55s ease}`}</style>
      <button
        ref={buttonRef}
        onClick={() => { if (current) setCalendarOpen(v => !v); }}
        title={!current ? 'Open a book to track your streak' : `${wordsToday.toLocaleString()} / ${effectiveGoal.toLocaleString()} words written today${todayMet ? ' ✓' : ''}`}
        style={{
          padding: 8,
          border: `1px solid ${todayMet ? accentHex : 'var(--border)'}`,
          borderRadius: 6, background: todayMet ? `${accentHex}15` : 'transparent',
          boxShadow: todayMet ? `0 0 14px 3px ${accentHex}44` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: current ? 'pointer' : 'default', transition: 'all 0.3s', position: 'relative',
        }}
      >
        <Flame size={22} color={todayMet ? accentHex : 'var(--text-1)'} className={shaking ? 'flame-shaking' : ''} style={{ transition: 'color 0.3s', display: 'block' }} />
        {currentStreak > 0 && (
          <div style={{ position: 'absolute', top: -7, right: -7, background: accentHex, color: '#fff', fontSize: 9, fontWeight: 800, lineHeight: 1, borderRadius: 999, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', border: '2px solid var(--app-bg)' }}>
            {currentStreak > 99 ? '99+' : currentStreak}
          </div>
        )}
      </button>
      <AnimatePresence>
        {calendarOpen && (
          <StreakCalendar key="streak-cal" currentStreak={currentStreak} log={log} wordsToday={wordsToday} goalWords={effectiveGoal} accentHex={accentHex} anchorRef={buttonRef} onClose={() => setCalendarOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
