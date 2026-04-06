// haptics.js — Centralised haptic feedback utility
// All haptic calls across the app should import from here.
// Requires: npm install @capacitor/haptics

async function _impact(style) {
  try {
    if (window.Capacitor?.isPluginAvailable?.('Haptics')) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle[style] });
      return true;
    }
  } catch (_) {}
  return false;
}

async function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Exported haptic functions ─────────────────────────────────────────────────

/** Opening a book, tapping a chapter */
export async function hapticSelect() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}

/** Auto-save confirmation — Medium, 80ms gap, Light */
export async function hapticSave() {
  try {
    if (window.Capacitor?.isPluginAvailable?.('Haptics')) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
      await _delay(80);
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    }
  } catch (_) {}
  try { navigator.vibrate?.([15, 80, 10]); } catch (_) {}
}

/** Any deletion */
export async function hapticDelete() {
  if (!await _impact('Heavy')) {
    try { navigator.vibrate?.(40); } catch (_) {}
  }
}

/** Pin/unpin */
export async function hapticPin() {
  if (!await _impact('Medium')) {
    try { navigator.vibrate?.(20); } catch (_) {}
  }
}

/** Daily word goal crossed — Med, 150ms, Med, 325ms, Heavy */
export async function hapticGoalMet() {
  try {
    if (window.Capacitor?.isPluginAvailable?.('Haptics')) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
      await _delay(150);
      await Haptics.impact({ style: ImpactStyle.Medium });
      await _delay(325);
      await Haptics.impact({ style: ImpactStyle.Heavy });
      return;
    }
  } catch (_) {}
  try { navigator.vibrate?.([20, 150, 20, 325, 40]); } catch (_) {}
}

/** Prev/Next chapter */
export async function hapticChapterNav() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}

/** Swipe threshold crossed */
export async function hapticSwipeReveal() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}

/** File errors */
export async function hapticError() {
  if (!await _impact('Heavy')) {
    try { navigator.vibrate?.(40); } catch (_) {}
  }
}

/** Focus mode on/off */
export async function hapticFocusToggle() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}

/** Storyboard edge created */
export async function hapticNodeConnect() {
  if (!await _impact('Medium')) {
    try { navigator.vibrate?.(20); } catch (_) {}
  }
}

/** Storyboard node placed */
export async function hapticNodeDrop() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}

/** Custom block template saved */
export async function hapticBlockTemplate() {
  if (!await _impact('Medium')) {
    try { navigator.vibrate?.(20); } catch (_) {}
  }
}

/** Undo/Redo action */
export async function hapticUndoRedo() {
  if (!await _impact('Light')) {
    try { navigator.vibrate?.(10); } catch (_) {}
  }
}
