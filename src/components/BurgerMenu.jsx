import React, { useState, useRef, useEffect } from "react";
import { Save, SaveAll, Settings as SettingsIcon, Share2 } from "lucide-react";
import { saveBook, saveAsBook, exportBook } from "../utils/storageAdapter";
import { isMobile } from "../utils/platform";

export default function BurgerMenu({ open, onClose, current, setSessions, onOpenSettings, accentHex }) {
  const [status, setStatus] = useState("idle");
  const menuRef = useRef(null);
  const mobile = isMobile();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose?.();
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  const handleSave = async () => {
    if (!current) return;
    setStatus("saving");
    try {
      const result = await saveBook(current);
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
      setStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      alert("⚠️ Save failed. Check permissions or try Export.");
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 2000);
  };

  const handleSaveAs = async () => {
    if (!current) return;
    try {
      const result = await saveAsBook(current);
      if (result?.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
    } catch (err) {
      console.error("Save As failed:", err);
    }
  };

  const handleExport = async () => {
    if (!current) return;
    try {
      await exportBook(current);
    } catch (err) {
      alert("⚠️ Export failed.");
    }
  };

  useEffect(() => {
    const handler = () => handleSave();
    document.addEventListener("triggerSave", handler);
    return () => document.removeEventListener("triggerSave", handler);
  }, [current]);

  if (!open) return null;

  const btnBase =
    "flex items-center gap-2 w-full px-3 py-2 rounded-md border-2 text-sm font-semibold transition-all duration-300 justify-center";

  return (
    <div
      ref={menuRef}
      className={`fixed z-50 w-52 rounded-xl p-3 shadow-lg backdrop-blur-md border border-white/20 animate-fadeIn
        ${mobile ? "bottom-[env(safe-area-inset-bottom,16px)] right-4" : "top-14 right-6"}`}
      style={{
        bottom: mobile ? `calc(env(safe-area-inset-bottom, 0px) + 16px)` : undefined,
        top: mobile ? undefined : "3.5rem",
        background: `linear-gradient(to bottom right, ${accentHex}F2, rgba(0,0,0,0.95))`,
      }}
    >
      {/* SAVE */}
      <button
        disabled={status === "saving"}
        onClick={handleSave}
        className={`${btnBase} ${
          status === "saving"
            ? "border-yellow-400 text-yellow-400 opacity-50 cursor-not-allowed"
            : status === "saved"
            ? "border-green-400 text-green-400"
            : "border-white text-white hover:bg-white/10"
        }`}
      >
        <Save className="w-4 h-4" />
        {status === "saving" ? "Saving..." : status === "saved" ? "Saved ✓" : "Save"}
      </button>

      <div className="h-px my-1" />

      {/* SAVE AS (desktop) / EXPORT (mobile share sheet) */}
      {mobile ? (
        <button onClick={handleExport} className={`${btnBase} border-white text-white hover:bg-white/10`}>
          <Share2 className="w-4 h-4" />
          Export / Share
        </button>
      ) : (
        <button onClick={handleSaveAs} className={`${btnBase} border-white text-white hover:bg-white/10`}>
          <SaveAll className="w-4 h-4" />
          Save As...
        </button>
      )}

      <div className="h-px my-1" />

      {/* SETTINGS */}
      <button onClick={onOpenSettings} className={`${btnBase} border-white text-white hover:bg-white/10`}>
        <SettingsIcon className="w-4 h-4" />
        Settings
      </button>
    </div>
  );
}
