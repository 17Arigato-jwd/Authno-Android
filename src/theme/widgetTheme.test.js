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
import { buildWidgetTheme, flattenOver } from './ThemeBase';
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
    describe(theme.meta?.id ?? 'unnamed', () => {
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
