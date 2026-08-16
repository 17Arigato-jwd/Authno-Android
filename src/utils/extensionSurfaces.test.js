import {
  createSurfaces, colourFor, panelPlacement, DOT_COLOURS, SURFACE_LIMITS,
  surfaces, __resetSurfaces,
} from './extensionSurfaces.js';

const { MIN_MEASURE_CHARS, PANEL_MIN_PX, PANEL_MAX_PX, PHONE_MAX_PX } = SURFACE_LIMITS;

afterEach(() => __resetSurfaces());

function harness() {
  let t = 0;
  let changes = 0;
  const s = createSurfaces({ now: () => t, onChange: () => { changes += 1; } });
  return { s, advance: (ms) => { t += ms; }, changes: () => changes };
}

describe('overlay dots', () => {
  test('an extension sets one line and gets one dot', () => {
    const { s } = harness();
    s.setOverlay('wordcount', '1,204 words');
    const { shown, overflow } = s.dots();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ extId: 'wordcount', text: '1,204 words' });
    expect(overflow).toBe(0);
  });

  test('clearing removes it', () => {
    const { s } = harness();
    s.setOverlay('a', 'x');
    expect(s.clearOverlay('a')).toBe(true);
    expect(s.dots().total).toBe(0);
    expect(s.clearOverlay('a')).toBe(false);
  });

  test('setting empty text clears rather than drawing a blank dot', () => {
    const { s } = harness();
    s.setOverlay('a', 'x');
    s.setOverlay('a', '');
    expect(s.dots().total).toBe(0);
  });

  test('the line is bounded — a dot is not a text field', () => {
    const { s } = harness();
    s.setOverlay('a', 'y'.repeat(500));
    expect(s.dots().shown[0].text.length).toBe(120);
  });

  test('dots stack to three, then a +n', () => {
    const { s } = harness();
    for (const id of ['a', 'b', 'c', 'd', 'e']) s.setOverlay(id, id);
    const { shown, overflow, total } = s.dots();
    expect(shown).toHaveLength(3);
    expect(overflow).toBe(2);
    expect(total).toBe(5);
  });

  test('the touch target is 48dp even though the dot draws at 8dp', () => {
    // A component that used the visual size for both would give a writer an
    // 8dp tap target next to the thing they are typing in.
    const { s } = harness();
    s.setOverlay('a', 'x');
    expect(s.dots().shown[0]).toMatchObject({ sizeDp: 8, targetDp: 48 });
  });

  test('colour is never the only carrier — a label goes with it', () => {
    const { s } = harness();
    s.setOverlay('wordcount', '1,204 words');
    const dot = s.dots().shown[0];
    expect(dot.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(dot.label).toContain('wordcount');
    expect(dot.label).toContain('1,204 words');
  });
});

describe('dot colour is stable', () => {
  test('the same id always gets the same colour', () => {
    // A dot that changes colour because a different extension started first is
    // a dot nobody can learn.
    expect(colourFor('cloud-backup')).toBe(colourFor('cloud-backup'));
    expect(colourFor('a')).not.toBe(colourFor('a-different-one-entirely'));
  });

  test('load order does not affect it', () => {
    const first = harness();
    first.s.setOverlay('alpha', '1');
    first.s.setOverlay('beta', '2');

    const second = harness();
    second.s.setOverlay('beta', '2');
    second.s.setOverlay('alpha', '1');

    const colourOf = (h, id) => h.s.dots().shown.find((d) => d.extId === id).colour;
    expect(colourOf(first, 'alpha')).toBe(colourOf(second, 'alpha'));
    expect(colourOf(first, 'beta')).toBe(colourOf(second, 'beta'));
  });

  test('every colour is from the palette', () => {
    for (const id of ['a', 'b', 'c', 'cloud-backup', 'x'.repeat(50), '']) {
      expect(DOT_COLOURS).toContain(colourFor(id));
    }
  });
});

describe('the measure floor', () => {
  test('a wide window docks the panel at its preferred width', () => {
    const p = panelPlacement({ viewportPx: 1400 });
    expect(p.mode).toBe('dock');
    expect(p.measureChars).toBeGreaterThanOrEqual(MIN_MEASURE_CHARS);
  });

  test('a tighter window shrinks the PANEL, not the text', () => {
    // Reached through LARGE TEXT rather than a narrow window, and that is the
    // case that matters: at the default character width a 320px panel always
    // leaves 45 characters above the phone breakpoint, so the fallback only
    // ever fires for someone who has turned their text size up — which is
    // exactly when squeezing the column would hurt most.
    const p = panelPlacement({ viewportPx: 780, charPx: 10.5 });
    expect(p.mode).toBe('dock');
    expect(p.panelPx).toBe(PANEL_MIN_PX);
    expect(p.measureChars).toBeGreaterThanOrEqual(MIN_MEASURE_CHARS);
  });

  test('when both cannot fit, the panel collapses rather than squeezing prose', () => {
    const p = panelPlacement({ viewportPx: 760, charPx: 14 });
    expect(p.mode).toBe('collapsed');
    expect(p.panelPx).toBe(0);
  });

  test('at the default text size the panel always fits above the phone breakpoint', () => {
    // Worth pinning: it means a reader on default settings never sees a panel
    // collapse, and the yielding logic is a large-text path rather than a
    // common one.
    for (let w = PHONE_MAX_PX; w <= 1600; w += 13) {
      expect({ w, mode: panelPlacement({ viewportPx: w }).mode }).toEqual({ w, mode: 'dock' });
    }
  });

  test('the text column never drops below 45 characters in any docked layout', () => {
    const tooNarrow = [];
    for (let w = PHONE_MAX_PX; w <= 2400; w += 7) {
      for (const charPx of [7, 8.5, 10.5, 14, 18]) {
        const p = panelPlacement({ viewportPx: w, charPx });
        if (p.mode === 'dock' && p.measureChars < MIN_MEASURE_CHARS) {
          tooNarrow.push({ w, charPx, measureChars: p.measureChars });
        }
      }
    }
    expect(tooNarrow).toEqual([]);
  });

  test('a phone gets a sheet, never a side dock', () => {
    for (const w of [320, 390, 428, 600, 719]) {
      const p = panelPlacement({ viewportPx: w });
      expect({ w, mode: p.mode }).toEqual({ w, mode: 'sheet' });
    }
  });

  test('the sheet has a peek and a half detent', () => {
    const p = panelPlacement({ viewportPx: 400 });
    expect(p.detents).toEqual([120, 200]);
  });

  test('a requested width is clamped to the allowed range', () => {
    expect(panelPlacement({ viewportPx: 2000, panelPx: 50 }).panelPx).toBe(PANEL_MIN_PX);
    expect(panelPlacement({ viewportPx: 2000, panelPx: 9000 }).panelPx).toBe(PANEL_MAX_PX);
  });

  test('a nonsense viewport does not throw', () => {
    for (const bad of [0, -100, NaN, undefined, null, 'wide']) {
      expect(() => panelPlacement({ viewportPx: bad })).not.toThrow();
    }
  });
});

describe('panels', () => {
  test('opening one does not move the caret', () => {
    // The contract is explicit in the return, so a component that moves focus
    // is contradicting something rather than merely omitting it.
    const { s } = harness();
    const r = s.openPanel('wordcount', 'stats');
    expect(r).toMatchObject({ ok: true, moveFocus: false });
  });

  test('an extension cannot open its own panel', () => {
    // One that could raise a panel mid-sentence would eat the keystrokes typed
    // into it.
    const { s } = harness();
    const r = s.openPanel('wordcount', 'stats', { bySystem: true });
    expect(r).toMatchObject({ ok: false, reason: 'only-user-can-open' });
    expect(s.open()).toBeNull();
  });

  test('only one panel is open at a time — buttons swap, they do not stack', () => {
    const { s } = harness();
    s.openPanel('a', 'one');
    s.openPanel('b', 'two');
    expect(s.open()).toEqual({ extId: 'b', panelId: 'two' });
  });

  test('pressing the open panel button again closes it', () => {
    const { s } = harness();
    s.togglePanel('a', 'one');
    expect(s.open()).not.toBeNull();
    s.togglePanel('a', 'one');
    expect(s.open()).toBeNull();
  });

  test('toggling a different panel swaps rather than closing', () => {
    const { s } = harness();
    s.togglePanel('a', 'one');
    s.togglePanel('b', 'two');
    expect(s.open()).toEqual({ extId: 'b', panelId: 'two' });
  });

  test('the last open panel is restored on launch', () => {
    const { s } = harness();
    s.openPanel('a', 'one');
    s.closePanel();
    expect(s.restore(['a', 'b'])).toEqual({ extId: 'a', panelId: 'one' });
  });

  test('restore skips a panel whose extension was uninstalled', () => {
    const { s } = harness();
    s.openPanel('gone', 'one');
    s.closePanel();
    expect(s.restore(['still-here'])).toBeNull();
    expect(s.open()).toBeNull();
  });
});

describe('panels and dots are one system', () => {
  test('an open panel suppresses that extension dot', () => {
    // One indicator per extension, never two saying the same thing.
    const { s } = harness();
    s.setOverlay('wordcount', '1,204 words');
    s.setOverlay('timer', '25:00');
    expect(s.dots().total).toBe(2);

    s.openPanel('wordcount', 'stats');
    const { shown, total } = s.dots();
    expect(total).toBe(1);
    expect(shown.map((d) => d.extId)).toEqual(['timer']);
  });

  test('closing the panel brings its dot back', () => {
    const { s } = harness();
    s.setOverlay('wordcount', '1,204 words');
    s.openPanel('wordcount', 'stats');
    s.closePanel();
    expect(s.dots().shown.map((d) => d.extId)).toEqual(['wordcount']);
    expect(s.dots().total).toBe(1);
  });

  test('an extension with a panel but no overlay simply has no dot', () => {
    const { s } = harness();
    s.openPanel('a', 'one');
    expect(s.dots().total).toBe(0);
  });

  test('stopping an extension drops both of its surfaces', () => {
    const { s } = harness();
    s.setOverlay('a', 'x');
    s.openPanel('a', 'one');
    s.forget('a');
    expect(s.dots().total).toBe(0);
    expect(s.open()).toBeNull();
    expect(s.restore(['a'])).toBeNull();
  });
});

describe('render throttling', () => {
  test('a closed panel never renders', () => {
    const { s } = harness();
    expect(s.mayRender('a')).toBe(false);
  });

  test('a collapsed panel is paused entirely', () => {
    const { s } = harness();
    s.openPanel('a', 'one');
    expect(s.mayRender('a', { collapsed: true })).toBe(false);
  });

  test('an open panel renders at most four times a second', () => {
    const { s, advance } = harness();
    s.openPanel('a', 'one');

    let allowed = 0;
    for (let i = 0; i < 100; i++) {   // a hundred asks across one second
      if (s.mayRender('a')) allowed += 1;
      advance(10);
    }
    expect(allowed).toBe(4);
  });

  test('a freshly opened panel renders immediately', () => {
    // It used to be refused: lastRenderAt initialised to 0 and the clock starts
    // near 0, so the first ask failed its own throttle and the panel opened
    // blank for a quarter of a second.
    const { s } = harness();
    s.openPanel('a', 'one');
    expect(s.mayRender('a')).toBe(true);
  });

  test('only the open panel may render', () => {
    const { s, advance } = harness();
    s.openPanel('a', 'one');
    advance(1000);
    expect(s.mayRender('b')).toBe(false);
    expect(s.mayRender('a')).toBe(true);
  });

  test('the throttle does not carry over to a different panel', () => {
    const { s, advance } = harness();
    s.openPanel('a', 'one');
    expect(s.mayRender('a')).toBe(true);
    advance(10);
    s.openPanel('b', 'two');
    expect(s.mayRender('b')).toBe(true);
  });
});

describe('change notification', () => {
  test('the UI is told when what should be on screen changes', () => {
    const { s, changes } = harness();
    const before = changes();
    s.setOverlay('a', 'x');
    s.openPanel('a', 'one');
    s.closePanel();
    expect(changes()).toBeGreaterThan(before);
  });

  test('a listener that throws does not break the caller', () => {
    const s = createSurfaces({ onChange: () => { throw new Error('render bug'); } });
    expect(() => s.setOverlay('a', 'x')).not.toThrow();
  });

  test('the shared instance is one object', () => {
    expect(surfaces()).toBe(surfaces());
  });
});
