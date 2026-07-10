/**
 * SizeSelector.jsx — editor font-size picker.
 *
 * Real pixel sizes (8–96px) applied as inline CSS, replacing the legacy HTML
 * fontSize 1–7 scale which offered only seven coarse steps.
 */

import React from "react";

export const PX_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 96];

const OPT_STYLE = { background: "var(--modal-bg)", color: "var(--text-1)" };

export default function SizeSelector({ onApply }) {
  return (
    <select
      defaultValue=""
      onChange={(e) => { if (e.target.value) { onApply?.({ fontSize: `${e.target.value}px` }); e.target.value = ""; } }}
      title="Font size"
      style={{
        background: "transparent",
        border: `1px solid var(--toolbar-divider)`,
        color: "var(--toolbar-item)",
        fontSize: 13,
        padding: "4px 6px",
        borderRadius: 6,
        outline: "none",
        cursor: "pointer",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--toolbar-item)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--toolbar-divider)")}
    >
      <option value="" disabled style={OPT_STYLE}>Size…</option>
      {PX_SIZES.map((s) => (
        <option key={s} value={s} style={OPT_STYLE}>{s}px</option>
      ))}
    </select>
  );
}
