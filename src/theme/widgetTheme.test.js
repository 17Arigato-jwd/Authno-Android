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
import { buildWidgetTheme } from './ThemeBase';
import { BUILTIN_THEMES } from './registry';
import { buildMaterialYouTheme } from './ThemeMaterialYou';

const THEMES = [...BUILTIN_THEMES, buildMaterialYouTheme()];

// Every field the Java side reads as a colour.
const COLOR_FIELDS = [
  'bgColor', 'textPrimary', 'textSecondary',
  'textDim', 'textFaint', 'textHasData', 'progressTrack',
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
    });
  });

  it('is JSON-round-trippable, because that is how it travels', () => {
    THEMES.forEach((theme) => {
      const w = buildWidgetTheme(theme);
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    });
  });
});
