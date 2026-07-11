import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flame } from "lucide-react";
import { DSIcons } from "../DesignSystem";
import { requestFullStoragePermission } from "../utils/storage";

const ONBOARDING_KEY = "authno_onboarding_v1";

// ── Update onboarding — bump UPDATE_VERSION each release that warrants a notice
const UPDATE_VERSION = "3";
const UPDATE_KEY = `authno_update_v${UPDATE_VERSION}`;

// ─── Storage helpers (Capacitor Preferences → localStorage fallback) ──────────

async function getPreference(key) {
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key });
      return value;
    }
  } catch {}
  return localStorage.getItem(key);
}

async function setPreference(key, value) {
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value });
      return;
    }
  } catch {}
  localStorage.setItem(key, value);
}

async function removePreference(key) {
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key });
      return;
    }
  } catch {}
  localStorage.removeItem(key);
}

export async function hasSeenOnboarding() {
  const val = await getPreference(ONBOARDING_KEY);
  return val === "done";
}

export async function markOnboardingDone() {
  await setPreference(ONBOARDING_KEY, "done");
}

export async function resetOnboarding() {
  await removePreference(ONBOARDING_KEY);
}

export async function hasSeenUpdate() {
  const val = await getPreference(UPDATE_KEY);
  return val === "done";
}

export async function markUpdateSeen() {
  await setPreference(UPDATE_KEY, "done");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getRandom(min, max) {
  return min + Math.random() * (max - min);
}

function FloatingBlobs({ accentHex = "#5a00d9" }) {
  const blobs = useMemo(() => {
    const palette = [
      accentHex,
      "#06b6d4",
      "#f97316",
      "#22c55e",
      "#ec4899",
      "#8b5cf6",
      "#eab308",
      "#14b8a6",
    ];

    return Array.from({ length: 16 }, (_, i) => {
      const size = clamp(getRandom(120, 420), 120, 420);
      const left = getRandom(0, 100);
      const top = getRandom(0, 100);
      const dx1 = getRandom(-180, 180).toFixed(0);
      const dy1 = getRandom(-180, 180).toFixed(0);
      const dx2 = getRandom(-220, 220).toFixed(0);
      const dy2 = getRandom(-220, 220).toFixed(0);
      const duration = getRandom(14, 28).toFixed(1);
      const delay = (-getRandom(0, 22)).toFixed(1);
      const opacity = getRandom(0.12, 0.24).toFixed(2);
      const blur = getRandom(24, 60).toFixed(0);
      const scale1 = getRandom(0.94, 1.12).toFixed(2);
      const scale2 = getRandom(0.9, 1.06).toFixed(2);

      return {
        id: i,
        color: palette[i % palette.length],
        size,
        left,
        top,
        dx1,
        dy1,
        dx2,
        dy2,
        duration,
        delay,
        opacity,
        blur,
        scale1,
        scale2,
      };
    });
  }, [accentHex]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes blobDrift {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) translate3d(0, 0, 0) scale(0.88);
          }
          12% {
            opacity: var(--o);
          }
          30% {
            transform: translate(-50%, -50%) translate3d(var(--dx1), var(--dy1), 0) scale(var(--s1));
          }
          60% {
            transform: translate(-50%, -50%) translate3d(var(--dx2), var(--dy2), 0) scale(var(--s2));
          }
          85% {
            opacity: var(--o);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) translate3d(calc(var(--dx2) * -0.2), calc(var(--dy2) * -0.2), 0) scale(0.9);
          }
        }

        @keyframes blobPulse {
          0%, 100% { filter: blur(var(--blur)) saturate(135%) brightness(0.95); }
          50%      { filter: blur(calc(var(--blur) + 8px)) saturate(160%) brightness(1.08); }
        }

        @keyframes panelPop {
          from { opacity: 0; transform: translateY(14px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {blobs.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-full"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            "--dx1": `${b.dx1}px`,
            "--dy1": `${b.dy1}px`,
            "--dx2": `${b.dx2}px`,
            "--dy2": `${b.dy2}px`,
            "--o": b.opacity,
            "--blur": `${b.blur}px`,
            "--s1": b.scale1,
            "--s2": b.scale2,
            background: `radial-gradient(circle at 30% 30%, ${b.color}cc 0%, ${b.color}66 30%, transparent 72%)`,
            mixBlendMode: "screen",
            animation: `
              blobDrift ${b.duration}s ease-in-out ${b.delay}s infinite,
              blobPulse ${Math.max(10, Number(b.duration) - 1)}s ease-in-out ${b.delay}s infinite
            `,
          }}
        />
      ))}
    </div>
  );
}

function PageBadge({ index, total }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 backdrop-blur-md">
      <DSIcons.Sparkle size={13} />
      <span>
        {index + 1} / {total}
      </span>
    </div>
  );
}

function Pill({ children, accentHex }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-white/70"
      style={{ background: `${accentHex}14` }}
    >
      {children}
    </div>
  );
}

function FeatureLine({ icon: Icon, text, accentHex }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10"
        style={{ background: `${accentHex}18` }}
      >
        <Icon size={16} color={accentHex} />
      </div>
      <div className="text-sm text-white/75">{text}</div>
    </div>
  );
}


// ── Theme shim (N3/B1) ────────────────────────────────────────────────────────
// Onboarding was written with Tailwind white/black utility classes, which are
// hardcoded colours and ignored every theme. Rather than rewrite 40+ class
// strings, this component-scoped stylesheet remaps exactly the utilities used
// here onto the theme variables — correct in all five themes and any .thmbk.
const ONB_THEME_CSS = `
.onb .text-white      { color: var(--text-1); }
.onb .text-white\\/85 { color: var(--text-1); }
.onb .text-white\\/80 { color: var(--text-2); }
.onb .text-white\\/75 { color: var(--text-2); }
.onb .text-white\\/70 { color: var(--text-3); }
.onb .text-white\\/65 { color: var(--text-3); }
.onb .text-white\\/60 { color: var(--text-3); }
.onb .text-white\\/55 { color: var(--text-4); }
.onb .text-white\\/45 { color: var(--text-4); }
.onb .text-white\\/40 { color: var(--text-5); }
.onb .bg-white\\/5    { background-color: var(--surface); }
.onb .bg-white\\/8    { background-color: var(--surface); }
.onb .bg-white\\/12   { background-color: var(--surface-md); }
.onb .bg-black\\/35   { background-color: var(--scrim); }
.onb .border-white\\/10 { border-color: var(--border-sm); }
.onb .border-white\\/15 { border-color: var(--border); }
`;

export function Onboarding({ accentHex = "#5a00d9", onDone }) {
  const [page, setPage] = useState(0);
  const contentRef = useRef(null);

  const pages = [
    {
      icon: (p) => <DSIcons.Shield {...p} />,
      title: "Write offline, stay focused",
      body:
        "AuthNo is built around a local-first workflow.\n\nNo cloud dependency. No account wall. No internet required to keep writing.",
      chips: [
        { icon: (p) => <DSIcons.Shield {...p} />, text: "Everything stays on device" },
        { icon: (p) => <DSIcons.Refresh {...p} />, text: "Open it anytime, anywhere" },
      ],
    },
    {
      icon: (p) => <DSIcons.List {...p} />,
      title: "Books and quick export",
      body:
        "Create books, organise them into chapters, and keep moving without breaking your flow.\n\nUse Save As when you need a copy somewhere else.",
      chips: [
        { icon: (p) => <DSIcons.BookOpen {...p} />, text: "Books for long-form writing" },
        { icon: (p) => <DSIcons.Edit {...p} />, text: "Chapters to stay organised" },
        { icon: (p) => <DSIcons.Save {...p} />, text: "Save As for export" },
      ],
    },
    {
      icon: Flame,
      title: "Track streaks and build momentum",
      body:
        "Each book can track its own progress.\n\nSet a daily goal, watch your streak grow, and turn it into your own writing challenge.",
      chips: [
        { icon: (p) => <DSIcons.Target {...p} />, text: "Set a daily goal" },
        { icon: Flame, text: "Keep a streak alive" },
      ],
    },
    {
      icon: (p) => <DSIcons.Palette {...p} />,
      title: "Make the space feel like yours",
      body:
        "Tune the accent color, light mode, and ambient background to match your mood.\n\nThe frosted glass look stays, but the vibe is yours.",
      chips: [
        { icon: (p) => <DSIcons.Palette {...p} />, text: "Accent and theme controls" },
        { icon: (p) => <DSIcons.Sparkle {...p} />, text: "Ambient background effects" },
      ],
    },
    {
      icon: (p) => <DSIcons.Shield {...p} />,
      title: "New .authbook format",
      body:
        "Your .authbook files now use VCHS-ECS instead of plain JSON.\n\nThink of it as AuthNo’s \"uncorruptable\" era: stronger structure, better resilience, and a format that is built to survive real-world file problems.\n\nOld files still open, but new saves use the upgraded format.",
      chips: [
        { icon: (p) => <DSIcons.Shield {...p} />, text: "VCHS-ECS container format" },
        { icon: (p) => <DSIcons.FolderOpen {...p} />, text: "Old files still supported" },
      ],
    },
    {
      icon: (p) => <DSIcons.Key {...p} />,
      title: "One permission to rule them all",
      body:
        "To open and save .authbook files from anywhere on your device — Downloads, USB drives, cloud folders — AuthNo needs the \"All files access\" permission.\n\nTap the button below to open the system settings page. Toggle the switch for AuthNo, then come back.",
      chips: [
        { icon: (p) => <DSIcons.Key {...p} />, text: "Open files from any folder" },
        { icon: (p) => <DSIcons.Save {...p} />, text: "Save to any location" },
      ],
      permissionPage: true,
      last: true,
    },
  ];

  const current = pages[page];
  const CurrentIcon = current.icon;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        markOnboardingDone().catch(() => {});
        onDone?.();
      }
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault();
        if (current.permissionPage) {
          requestFullStoragePermission().catch(() => {});
          markOnboardingDone().catch(() => {});
          onDone?.();
        } else if (page < pages.length - 1) {
          setPage((p) => p + 1);
        } else {
          markOnboardingDone().catch(() => {});
          onDone?.();
        }
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (page > 0) setPage((p) => p - 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, onDone, pages.length]);

  // Seeing (or skipping) the tour once is enough — it used to persist only
  // when the "don't show again" box was ticked, so it replayed on every
  // launch. It stays reachable from Settings via resetOnboarding().
  const finish = async () => {
    await markOnboardingDone().catch(() => {});
    onDone?.();
  };

  const next = async () => {
    if (current.permissionPage) {
      await requestFullStoragePermission();
      await finish();
      return;
    }
    if (page < pages.length - 1) setPage((p) => p + 1);
    else await finish();
  };

  const back = () => setPage((p) => Math.max(0, p - 1));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="onb fixed inset-0 z-[20000] overflow-y-auto"
      style={{
        background: "var(--scrim-strong)",
        backdropFilter: "blur(10px)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <style>{ONB_THEME_CSS}</style>
      <FloatingBlobs accentHex={accentHex} />

      <div className="min-h-full px-4 py-4 sm:px-6 sm:py-8 flex items-center justify-center">
        <div
          className="relative z-10 w-full max-w-md"
          style={{
            animation: "panelPop 0.22s ease-out",
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <PageBadge index={page} total={pages.length} />
            <button
              onClick={finish}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/55 backdrop-blur-md transition hover:text-white/80"
            >
              Skip
            </button>
          </div>

          <div
            className="rounded-[28px] border border-white/10 bg-black/35 shadow-2xl backdrop-blur-xl"
            style={{
              boxShadow: "0 24px 80px rgba(0,0,0,0.58)",
              maxHeight: "min(84dvh, 760px)",
              overflow: "hidden",
            }}
          >
            <div
              ref={contentRef}
              className="overflow-y-auto px-5 py-6 sm:px-6 sm:py-7"
              style={{
                maxHeight: "min(84dvh, 760px)",
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
              }}
            >
              <div className="mb-5 flex items-center justify-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10"
                  style={{ background: `${accentHex}18` }}
                >
                  <CurrentIcon size={28} color={accentHex} />
                </div>
              </div>

              <h2 className="mb-3 text-center text-2xl font-bold tracking-tight text-white">
                {current.title}
              </h2>

              <p className="whitespace-pre-line text-center text-sm leading-relaxed text-white/65">
                {current.body}
              </p>

              <div className="mt-6 grid gap-3">
                {current.chips.map((chip, idx) => (
                  <Pill key={idx} accentHex={accentHex}>
                    <chip.icon size={12} color={accentHex} />
                    <span>{chip.text}</span>
                  </Pill>
                ))}
              </div>

              <div className="mt-6 grid gap-3">
                {current.pageNote ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                    {current.pageNote}
                  </div>
                ) : null}
                {current.permissionPage && (
                  <button
                    onClick={() => requestFullStoragePermission()}
                    className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-medium text-white/85 transition hover:bg-white/12 active:scale-95"
                    style={{ background: "var(--surface-md)" }}
                  >
                    <DSIcons.Key size={15} />
                    Grant All Files Access
                  </button>
                )}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={back}
                  disabled={page === 0}
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/70 transition disabled:opacity-35"
                >
                  <span className="inline-flex items-center gap-2">
                    <DSIcons.ChevronLeft size={16} />
                    Back
                  </span>
                </button>

                <button
                  onClick={next}
                  className="flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition"
                  style={{
                    background: `linear-gradient(135deg, ${accentHex}, ${accentHex}cc)`,
                    boxShadow: `0 12px 30px ${accentHex}33`,
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {page === pages.length - 1 ? "Start writing" : "Next"}
                    {page === pages.length - 1 ? <DSIcons.ChevronRight size={16} /> : <DSIcons.ChevronRight size={16} />}
                  </span>
                </button>
              </div>

              <div className="mt-5 flex items-center justify-center gap-2">
                {pages.map((_, i) => (
                  <div
                    key={i}
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: i === page ? 22 : 6,
                      background: i <= page ? accentHex : "var(--border)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Update Onboarding ───────────────────────────────────────────────────────
//
// Shown once per UPDATE_VERSION on first launch after an app update.
// Define UPDATE_NOTES as an array of { icon, title, body } objects — one per
// notable change. The modal is dismissed when the user taps "Got it" and
// markUpdateSeen() persists the flag so it never shows again for that version.

const UPDATE_NOTES = [
  {
    icon: (p) => <DSIcons.Pin {...p} />,
    title: "Threads",
    body: "Track plotlines, character arcs and TODOs alongside your prose. Select text (or long-press) to anchor a note, then follow every beat from the Threads panel — it scrolls with your manuscript.",
  },
  {
    icon: (p) => <DSIcons.Text {...p} />,
    title: "A proper writing toolbar",
    body: "The toolbar now docks above your keyboard like a real editor, with way more fonts, sizes, colors and formatting — plus a custom selection menu with tagging built in.",
  },
  {
    icon: (p) => <DSIcons.Palette {...p} />,
    title: "App icons & smoother everything",
    body: "Pick a launcher icon under Settings → Appearance (Dark, or Light with Retro and Space Gold variants). Menus, pages and the gradient background are also much faster on phones.",
  },
];

export function UpdateOnboarding({ accentHex = "#5a00d9", onDone }) {
  const [page, setPage] = useState(0);
  const contentRef = useRef(null);
  const current = UPDATE_NOTES[page];
  const CurrentIcon = current.icon;
  const isLast = page === UPDATE_NOTES.length - 1;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") { markUpdateSeen().catch(() => {}); onDone?.(); }
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault();
        if (current.permissionPage) {
          requestFullStoragePermission().catch(() => {});
          markUpdateSeen().catch(() => {});
          onDone?.();
        } else if (!isLast) {
          setPage((p) => p + 1);
        } else {
          markUpdateSeen().catch(() => {}); onDone?.();
        }
      }
      if ((e.key === "ArrowLeft" || e.key === "PageUp") && page > 0) {
        e.preventDefault();
        setPage((p) => p - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, isLast, onDone]);

  const finish = async () => { await markUpdateSeen(); onDone?.(); };
  const next = async () => {
    if (current.permissionPage) {
      await requestFullStoragePermission();
      await finish();
      return;
    }
    if (!isLast) setPage((p) => p + 1);
    else await finish();
  };
  const back = () => setPage((p) => Math.max(0, p - 1));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="onb fixed inset-0 z-[20001] overflow-y-auto"
      style={{
        background: "var(--scrim-strong)",
        backdropFilter: "blur(10px)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <style>{ONB_THEME_CSS}</style>
      <FloatingBlobs accentHex={accentHex} />

      <div className="min-h-full px-4 py-4 sm:px-6 sm:py-8 flex items-center justify-center">
        <div className="relative z-10 w-full max-w-md" style={{ animation: "panelPop 0.22s ease-out" }}>

          {/* Header row */}
          <div className="mb-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 backdrop-blur-md">
              <DSIcons.Lightning size={12} style={{ color: accentHex }} />
              <span>What's new — {page + 1} / {UPDATE_NOTES.length}</span>
            </div>
            <button
              onClick={finish}
              className="rounded-full border border-white/10 bg-white/5 p-1.5 text-white/40 backdrop-blur-md transition hover:text-white/70"
              aria-label="Dismiss"
            >
              <DSIcons.X size={14} />
            </button>
          </div>

          {/* Card */}
          <div
            className="rounded-[28px] border border-white/10 bg-black/35 shadow-2xl backdrop-blur-xl"
            style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.55)", overflow: "hidden" }}
          >
            <div
              ref={contentRef}
              className="overflow-y-auto px-5 py-6 sm:px-6 sm:py-7"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {/* Icon */}
              <div className="mb-5 flex items-center justify-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10"
                  style={{ background: `${accentHex}18` }}
                >
                  <CurrentIcon size={28} color={accentHex} />
                </div>
              </div>

              <h2 className="mb-3 text-center text-2xl font-bold tracking-tight text-white">
                {current.title}
              </h2>
              <p className="whitespace-pre-line text-center text-sm leading-relaxed text-white/65">
                {current.body}
              </p>

              {current.permissionPage && (
                <button
                  onClick={() => requestFullStoragePermission()}
                  className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white/85 transition hover:bg-white/12 active:scale-95"
                  style={{ background: "var(--surface-md)" }}
                >
                  <DSIcons.Key size={15} />
                  Grant All Files Access
                </button>
              )}

              {/* Navigation */}
              <div className="mt-8 flex gap-3">
                <button
                  onClick={back}
                  disabled={page === 0}
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/70 transition disabled:opacity-30"
                >
                  <span className="inline-flex items-center gap-2">
                    <DSIcons.ChevronLeft size={16} /> Back
                  </span>
                </button>
                <button
                  onClick={next}
                  className="flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${accentHex}, ${accentHex}cc)`,
                    boxShadow: `0 12px 30px ${accentHex}33`,
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {isLast ? "Got it" : "Next"}
                    {isLast ? <DSIcons.Check size={16} /> : <DSIcons.ChevronRight size={16} />}
                  </span>
                </button>
              </div>

              {/* Dots */}
              <div className="mt-5 flex items-center justify-center gap-2">
                {UPDATE_NOTES.map((_, i) => (
                  <div
                    key={i}
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: i === page ? 22 : 6,
                      background: i <= page ? accentHex : "var(--border)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
