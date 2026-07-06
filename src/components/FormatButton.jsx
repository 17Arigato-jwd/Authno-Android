/**
 * FormatButton.jsx — toolbar format toggle (B/I/U/H).
 *
 * v1.1.16: Tailwind colour classes replaced with inline styles. The toolbar
 * sits on an accent-tinted frosted pill, so the button keeps light-on-glass
 * styling in every theme (it's rendered over the accent gradient, not the
 * page background).
 */
import React, { useState } from "react";

export default function FormatButton({
  format,
  label,
  title,
  style,
  isActive,
  onClick,
}) {
  const [hover, setHover] = useState(false);
  const isHighlight = format === "highlight";

  const base = {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--toolbar-divider)",
    fontSize: 14,
    lineHeight: 1.2,
    cursor: "pointer",
    color: "var(--toolbar-item)",
    background: "transparent",
    transition: "all 0.2s",
  };

  let dynamic;
  if (isActive) {
    dynamic = isHighlight
      ? { background: "rgba(253,224,71,0.30)", boxShadow: "0 0 0 1px rgba(250,204,21,0.9)" }
      : { background: "var(--accent-a33)" };
  } else if (hover) {
    dynamic = isHighlight
      ? { background: "rgba(253,224,71,0.20)" }
      : { background: "var(--toolbar-item-hover)" };
  } else {
    dynamic = {};
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{ ...base, ...dynamic, ...style }}
    >
      {label}
    </button>
  );
}
