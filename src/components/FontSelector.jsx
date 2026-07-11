/**
 * FontSelector.jsx — editor font picker.
 *
 * Fed from the Font Customizer's library (curated Google/system families) plus
 * the user's uploaded custom fonts — one font system for app AND manuscript.
 * Families group their weight variants (Regular / SemiBold / Bold …).
 *
 * Now a themed ToolbarDropdown instead of a native <select>: the old list ran
 * off the bottom of the window, and the trigger never reflected the font of
 * the current selection. The trigger label follows the caret (matched against
 * the library by the computed font-family/weight).
 */

import React, { useEffect, useState } from 'react';
import ToolbarDropdown, { DropdownRow, DropdownHeader } from './ToolbarDropdown';
import {
  FONT_LIBRARY, fontVariants, resolveFontStack, loadGoogleFont,
} from '../utils/fontManager';

function firstFamily(stack) {
  return (stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/** Match a computed font-family/weight back to a library entry. */
function matchFont(computedFamily, computedWeight, customFonts) {
  const fam = firstFamily(computedFamily);
  if (!fam) return null;
  const weight = parseInt(computedWeight, 10) || 400;
  for (const f of FONT_LIBRARY) {
    if (firstFamily(resolveFontStack(f.id, [])) === fam || f.label.toLowerCase() === fam) {
      const v = fontVariants(f).find((x) => x.weight === weight);
      return { id: f.id, weight, label: f.label + (v && v.label !== 'Regular' ? ` ${v.label}` : '') };
    }
  }
  const c = (customFonts || []).find(
    (cf) => firstFamily(resolveFontStack(cf.id, customFonts)) === fam || cf.name?.toLowerCase() === fam
  );
  if (c) return { id: c.id, weight, label: c.name };
  // Unknown family (pasted content) — still show its name.
  const raw = (computedFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  return raw ? { id: null, weight, label: raw } : null;
}

export function FontSelector({ onApply, customFonts = [], editorRef }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(null);

  // Reflect the font at the caret/selection (only while it's in the editor).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = editorRef?.current;
        const sel = window.getSelection();
        const node = sel?.anchorNode;
        if (!root || !node || !root.contains(node)) return;
        const el = node.nodeType === 3 ? node.parentElement : node;
        if (!el) return;
        const cs = getComputedStyle(el);
        setCurrent(matchFont(cs.fontFamily, cs.fontWeight, customFonts));
      });
    };
    document.addEventListener('selectionchange', update);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('selectionchange', update); };
  }, [editorRef, customFonts]);

  const apply = (kind, id, weight) => {
    if (kind === 'lib') loadGoogleFont(id);
    onApply?.({ fontFamily: resolveFontStack(id, customFonts), fontWeight: weight ?? 400 });
    setOpen(false);
  };

  return (
    <ToolbarDropdown
      label={current?.label ?? 'Font…'}
      title="Font family & weight"
      minWidth={86}
      open={open}
      setOpen={setOpen}
    >
      {FONT_LIBRARY.map((f) => {
        const variants = fontVariants(f);
        if (variants.length <= 1) {
          const w = variants[0]?.weight ?? 400;
          return (
            <DropdownRow key={f.id} current={current?.id === f.id} onClick={() => apply('lib', f.id, w)}>
              {f.label}
            </DropdownRow>
          );
        }
        return (
          <React.Fragment key={f.id}>
            <DropdownHeader>{f.label}</DropdownHeader>
            {variants.map((v) => (
              <DropdownRow
                key={v.weight}
                indent
                current={current?.id === f.id && current?.weight === v.weight}
                onClick={() => apply('lib', f.id, v.weight)}
              >
                {f.label} {v.label}
              </DropdownRow>
            ))}
          </React.Fragment>
        );
      })}

      {customFonts.length > 0 && (
        <>
          <DropdownHeader>Your fonts</DropdownHeader>
          {customFonts.map((f) => (
            <DropdownRow key={f.id} indent current={current?.id === f.id} onClick={() => apply('custom', f.id, 400)}>
              {f.name}
            </DropdownRow>
          ))}
        </>
      )}
    </ToolbarDropdown>
  );
}

export default FontSelector;
