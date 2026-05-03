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
import { COLORS } from "../DesignSystem";

export default function SizeSelector({ onChange, defaultValue }) {
  return (
    <select
      defaultValue={defaultValue}
      onChange={onChange}
      style={{
        background: "transparent",
        border: `1px solid ${COLORS.borderStrong}`,
        color: "#fff",
        fontSize: 13,
        padding: "4px 8px",
        borderRadius: 6,
        outline: "none",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "#fff")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = COLORS.borderStrong)}
    >
      {SIZE_OPTIONS.map((s) => (
        <option key={s} value={s} style={{ background: COLORS.surface1, color: "#fff" }}>
          {s}
        </option>
      ))}
    </select>
  );
}
