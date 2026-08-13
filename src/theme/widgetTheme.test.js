/**
 * buildWidgetTheme is one half of a contract with Java.
 *
 * The other half is android/.../WidgetTheme.java, which parses #rgb, #rrggbb
 * and #aarrggbb and *deliberately refuses* rgba(...) — a widget sits on an
 * unknown wallpaper, so a translucent card would show the wallpaper through it.
 * Refusing means falling back, which means the app's theme silently does not
 * reach the home screen.
 *
 * That is exactly what happened to progressTrack, which was wired to
 * surfaces.mid — an rgba() token. Nothing in JS could notice: the value was a
 * perfectly good CSS colour. So the assertion has to live here, on the shape of
 * what crosses the bridge, for every theme that can be selected.
 */
import { buildWidgetTheme, flattenOver, onAccent } from './ThemeBase';
import { BUILTIN_THEMES } from './registry';
import { buildMaterialYouTheme } from './ThemeMaterialYou';

const THEMES = [...BUILTIN_THEMES, buildMaterialYouTheme()];

// Every field the Java side reads as a colour.
const COLOR_FIELDS = [
  'bgColor', 'textPrimary', 'textSecondary',
  'textDim', 'textFaint', 'textHasData', 'progressTrack',
  'surface', 'surfaceRaised', 'border',
];

/** The subset of CSS colours WidgetTheme.color() can actually parse. */
const PARSEABLE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

describe('buildWidgetTheme', () => {
  it('covers every selectable theme', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(6);
  });

  THEMES.forEach((theme) => {
    // The suite is generated from the theme registry on purpose — a theme
    // added later gets covered without anyone remembering to add a describe.
    // That makes the title dynamic, which is the only thing the rule objects to.
    // eslint-disable-next-line jest/valid-title
    describe(String(theme.meta?.id ?? 'unnamed'), () => {
      const w = buildWidgetTheme(theme);

      it('sends a colour the native parser accepts for every field', () => {
        COLOR_FIELDS.forEach((f) => {
          expect(typeof w[f]).toBe('string');
          expect(`${f}=${w[f]}`).toMatch(new RegExp(`^${f}=` + PARSEABLE.source.slice(1, -1) + '$', 'i'));
        });
      });

      it('never sends rgba(), which would fall back to the wrong theme', () => {
        COLOR_FIELDS.forEach((f) => {
          expect(String(w[f])).not.toMatch(/rgba?\(/i);
        });
      });

      it('states its own lightness rather than leaving it to a guess', () => {
        expect(typeof w.isDark).toBe('boolean');
        expect(w.isDark).toBe(theme.meta.isDark !== false);
      });

      it('carries an id so a payload can be traced back to a theme', () => {
        expect(w.themeId).toBe(theme.meta.id);
      });

      /**
       * The card and the text on it are painted from two different fields; if
       * they land on the same colour the widget renders blank.
       */
      it('does not paint text in the background colour', () => {
        ['textPrimary', 'textSecondary', 'textDim'].forEach((f) => {
          expect(String(w[f]).toLowerCase()).not.toBe(String(w.bgColor).toLowerCase());
        });
      });

      /**
       * The surfaces are the widget-config rows and the progress track. A
       * surface that composited to the background exactly would render the
       * whole list as one flat sheet.
       */
      it('keeps its raised surfaces distinguishable from the sheet', () => {
        ['surface', 'surfaceRaised', 'progressTrack', 'border'].forEach((f) => {
          expect(`${f}=${w[f]}`).not.toBe(`${f}=${w.bgColor}`);
        });
      });
    });
  });

  it('is JSON-round-trippable, because that is how it travels', () => {
    THEMES.forEach((theme) => {
      const w = buildWidgetTheme(theme);
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    });
  });
});

describe('flattenOver', () => {
  it('composites an overlay the way the browser would', () => {
    // 50% white over black is mid grey.
    expect(flattenOver('rgba(255,255,255,0.5)', '#000000')).toBe('#808080');
    expect(flattenOver('rgba(0,0,0,0.5)', '#ffffff')).toBe('#808080');
  });

  it('leaves a fully opaque overlay alone', () => {
    expect(flattenOver('rgba(18,52,86,1)', '#ffffff')).toBe('#123456');
    expect(flattenOver('rgb(18,52,86)', '#ffffff')).toBe('#123456');
  });

  it('is a no-op at zero alpha', () => {
    expect(flattenOver('rgba(255,0,0,0)', '#123456')).toBe('#123456');
  });

  it('passes a solid straight through — nothing to composite', () => {
    expect(flattenOver('#abcdef', '#000000')).toBe('#abcdef');
  });

  /**
   * Returning the background makes the element invisible, which is the safe
   * failure: better than painting it in a colour nobody chose.
   */
  it('falls back to the background on anything it cannot read', () => {
    expect(flattenOver('hsl(200 50% 50%)', '#123456')).toBe('#123456');
    expect(flattenOver('rebeccapurple', '#123456')).toBe('#123456');
    expect(flattenOver(undefined, '#123456')).toBe('#123456');
    expect(flattenOver(null, '#123456')).toBe('#123456');
  });

  it('tolerates the whitespace real CSS carries', () => {
    expect(flattenOver('  rgba( 255 , 255 , 255 , 0.5 )  ', '#000000')).toBe('#808080');
  });
});

/**
 * onAccent decides the label colour on an accent-filled button, and the same
 * rule is implemented natively in WidgetTheme.readableOn — the two have to
 * agree or a button reads differently in the app and on the home screen.
 */
describe('onAccent', () => {
  const WHITE = '#ffffff';
  const INK   = '#111113';

  it('puts white on a dark accent', () => {
    expect(onAccent('#5a00d9')).toBe(WHITE); // the default violet
    expect(onAccent('#a855f7')).toBe(WHITE); // Violet
    expect(onAccent('#ec4899')).toBe(WHITE); // Rose
  });

  /**
   * The two shipped presets that were already unreadable in white — both sit
   * near 2:1 against it, well under the 4.5:1 that counts as readable. This is
   * the case that makes the whole helper worth having.
   */
  it('puts ink on the pale presets', () => {
    expect(onAccent('#f59e0b')).toBe(INK); // Gold
    expect(onAccent('#22c55e')).toBe(INK); // Sage
  });

  /**
   * These clear 3:1 in white and have read as white buttons since the app
   * shipped, so the rule leaves them alone. Pinned because the obvious
   * "maximise contrast" threshold would flip both, which is a redesign rather
   * than a fix.
   */
  it('leaves the mid-tone presets as they were', () => {
    expect(onAccent('#ff4500')).toBe(WHITE); // Ember, 3.4:1
    expect(onAccent('#3b82f6')).toBe(WHITE); // Ocean, 3.8:1
  });

  it('handles the extremes the colour wheel allows', () => {
    expect(onAccent('#ffffff')).toBe(INK);
    expect(onAccent('#000000')).toBe(WHITE);
    expect(onAccent('#00ff00')).toBe(INK);   // green dominates luminance
    expect(onAccent('#0000ff')).toBe(WHITE); // blue barely registers
  });

  it('does not throw on a missing or malformed accent', () => {
    expect(onAccent(undefined)).toBe(WHITE);
    expect(onAccent('')).toBe(WHITE);
    expect(onAccent('not a colour')).toBe(WHITE);
  });

  it('agrees with the native rule, which uses the same threshold', () => {
    // WidgetTheme.readableOn returns 0xFF000000 / 0xFFFFFFFF for these inputs;
    // pinned here so a change on one side fails on this side too.
    const nativeSaysBlack = ['#ffffff', '#f59e0b', '#22c55e', '#00ff00'];
    const nativeSaysWhite = ['#000000', '#5a00d9', '#1a1b1e', '#0000ff'];
    nativeSaysBlack.forEach((h) => expect(onAccent(h)).toBe(INK));
    nativeSaysWhite.forEach((h) => expect(onAccent(h)).toBe(WHITE));
  });
});
