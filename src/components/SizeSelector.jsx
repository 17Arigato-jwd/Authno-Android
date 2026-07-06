/**
 * SizeSelector.jsx — Font size picker for the editor toolbar
 *
 * Changes from original:
 *   - Tailwind className removed
 *   - Inline styles using COLORS from DesignSystem tokens
 *
 * Props unchanged — drop-in replacement.
 */

import React from "react";
import { SIZE_OPTIONS } from "./constants";

export default function SizeSelector({ onChange, defaultValue }) {
  return (
    <select
      defaultValue={defaultValue}
      onChange={onChange}
      style={{
        background: "transparent",
        border: `1px solid var(--toolbar-divider)`,
        color: "var(--toolbar-item)",
        fontSize: 13,
        padding: "4px 8px",
        borderRadius: 6,
        outline: "none",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--toolbar-item)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--toolbar-divider)")}
    >
      {SIZE_OPTIONS.map((s) => (
        <option key={s} value={s} style={{ background: "var(--modal-bg)", color: "var(--text-1)" }}>
          {s}
        </option>
      ))}
    </select>
  );
}
