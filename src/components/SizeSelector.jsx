/**
 * SizeSelector.jsx — editor font-size picker.
 *
 * Real pixel sizes (8–96px) applied as inline CSS. A themed ToolbarDropdown
 * (clamped height, flips above near the screen bottom) whose trigger shows
 * the size at the caret — the native <select> did neither.
 */

import React, { useEffect, useState } from 'react';
import ToolbarDropdown, { DropdownRow } from './ToolbarDropdown';

export const PX_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 96];

export default function SizeSelector({ onApply, editorRef }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(null);

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
        const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
        if (px > 0) setCurrent(px);
      });
    };
    document.addEventListener('selectionchange', update);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('selectionchange', update); };
  }, [editorRef]);

  return (
    <ToolbarDropdown
      label={current ? `${current}px` : 'Size…'}
      title="Font size"
      minWidth={58}
      open={open}
      setOpen={setOpen}
    >
      {PX_SIZES.map((s) => (
        <DropdownRow key={s} current={current === s} onClick={() => { onApply?.({ fontSize: `${s}px` }); setOpen(false); }}>
          {s}px
        </DropdownRow>
      ))}
    </ToolbarDropdown>
  );
}
