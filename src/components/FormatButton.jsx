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
    border: "2px solid rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 1.2,
    cursor: "pointer",
    color: "#fff",
    background: "transparent",
    transition: "all 0.2s",
  };

  let dynamic;
  if (isActive) {
    dynamic = isHighlight
      ? { background: "rgba(253,224,71,0.30)", boxShadow: "0 0 0 1px rgba(250,204,21,0.9)" }
      : { background: "rgba(255,255,255,0.30)" };
  } else if (hover) {
    dynamic = isHighlight
      ? { background: "rgba(253,224,71,0.20)" }
      : { background: "rgba(255,255,255,0.10)" };
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
