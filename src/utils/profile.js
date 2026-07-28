/**
 * profile.js — Local profile store for user personalization.
 *
 * Stores: name, username, writingGoal (genre/niche), personalization prefs.
 * Uses localStorage as the backing store; designed as a seam for future
 * cloud account integration — only this module changes when migrating.
 */

const STORAGE_KEY = 'authno_profile';

export const DEFAULT_PROFILE = {
  name: '',
  username: '',
  writingGoal: { type: 'novel', audience: 'beginner', wordCount: 'some' },
  personalization: {},
  onboardingCompleted: false,
  onboardingCompletedAt: null,
};

const listeners = new Set();

export function getProfile() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PROFILE };
    return JSON.parse(stored);
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function setProfile(updates) {
  const current = getProfile();
  const merged = { ...current, ...updates };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    for (const fn of listeners) {
      try { fn(merged); } catch (e) { console.error(e); }
    }
  } catch (e) {
    console.error('[profile] setProfile failed:', e);
  }
  return merged;
}

export function subscribeProfile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const fn of listeners) {
      try { fn({ ...DEFAULT_PROFILE }); } catch (e) { console.error(e); }
    }
  } catch (e) {
    console.error('[profile] clearProfile failed:', e);
  }
}
