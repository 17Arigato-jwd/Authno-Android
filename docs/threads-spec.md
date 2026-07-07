# Threads — plot-thread & character-arc tracker (design spec)

> Status: **design** (captured from author Q&A). Nothing here is built yet.
> This document is the source of truth for the feature; update it as decisions change.

## 1. Concept

A **tagging-while-writing** layer over the manuscript. While writing, you mark spots
in the prose and attach them to **Threads** (plotlines, character arcs, …) shown in
side panels. The prose itself stays clean — anchors show as **subtle colored gutter
markers**, not colored text. Clicking jumps + flashes between a panel entry and its
spot in the manuscript (no drawn connector lines). The manuscript sits on the left;
opening a thread tiles a panel into the right region.

This is an annotation/tracking layer, **not** a planner or a separate corkboard — you
use it *as you write*.

## 2. Guiding principle — flexible, not hardcoded

Everything below is a **configured instance of a generic primitive**, never a hardcoded
class. Users can define their own thread types in v1, and the existing extension system
can register more later. Plotline / Character Arc / Reminder / Connection are just the
defaults shipped on top of the generic engine.

## 3. Data model

| Primitive | Shape | Notes |
|-----------|-------|-------|
| **ThreadType** | `{ id, name, icon, color, fields[] }` | **User-definable.** `fields` is a schema of extra metadata a thread of this type carries. Ships with **Plotline** (no extra fields) and **Character Arc** (`character` field). |
| **Thread** | `{ id, typeId, name, colorOverride?, meta{…fields}, entries[] }` | A concrete thread, e.g. a Plotline named "The Heist". |
| **Entry** | `{ id, text, anchors[], todo, done }` | One line in a panel. May be anchored to prose or not. Any entry can be flagged **TODO** (the red "reminder" items). |
| **Anchor** | `{ id, kind: 'span' \| 'point', chapterId, range }` | **Both** kinds supported — a highlighted span *or* a point pin. `range` is resilient to edits (stored against stable offsets / marker nodes). |
| **Relation** | `{ id, aThreadId, bThreadId, label?, note?, directional? }` | A generic **connection** between two threads (the "add connection to Plotline B" idea). Symmetric by default; optional directional label (e.g. "sets up →"). |

Two thread **types** are distinct in the UI (separate lists, own icon/color) but share the
same underlying structure — an Arc is a thread whose type declares a `character` field.

## 4. Interaction

### Creating anchors — selection context menu
Select prose → context menu (desktop right-click / mobile long-press), Google-Docs style:
- **Add to Thread ▸** (existing thread, or **+ New Plotline / + New Character Arc / + New {custom type}**)
- **Mark as TODO**
- **Drop a pin here** (point anchor at the caret)
- When the selection looks like a character name (auto-detect assist): **Start a Character Arc from "{name}"**

### Gutter markers
Thin colored **bars/dots in the margin** next to lines that carry anchors — the prose stays
plain. Multiple anchors on one line stack side-by-side; overflow shows a small count.
Hover = peek (thread + entry text); click = open the thread panel and flash the entry.

### Panels (tiling)
Opening a thread shifts the manuscript left and opens a right panel.
- **Desktop:** up to **2 tiled** panels; opening more adds **tabs** within a pane.
- **Mobile (Android):** a **pop-up sheet covering ~5/8 (62.5%) of the screen from the bottom** — no tiling.

A panel lists its entries and the thread's `meta` fields + a TODO count badge.

### Linking — sync-scroll + flash (no lines)
- Click an entry → manuscript scrolls to its anchor and the span **flashes**.
- Click a gutter marker → panel scrolls to its entry.

### Ordering
Anchored entries **auto-sort by their position in the prose**; unanchored TODOs pinned at
the top; **manual drag override** available per thread.

### TODOs / reminders
Any entry can be a TODO. Per-thread checklist + count badge, plus a global **Reminders**
roll-up aggregating every open TODO across all threads.

### Connections
From a panel: **Link to thread…** creates a `Relation`, shown as a jump-chip in both
threads. Symmetric by default; can carry a note and an optional directional label.

## 5. Storage & export

- **Embedded in the `.authbook` file** (new section) so threads/anchors/relations travel
  with the book and survive import/export.
- **Markdown outline export**: every thread with its entries in manuscript order, TODOs as
  `- [ ]` checkboxes, and relations listed — a synopsis of the whole thread structure.

## 6. Defaults chosen for the four open points (changeable)

1. **Marker style** → thin **vertical colored bars** in the gutter; stack side-by-side per
   line, small "+N" when crowded.
2. **Point-pin visual** → a small **gutter diamond** (gutter-only, consistent with span bars).
3. **v1 type editor depth** → name + icon + color **+ custom fields** (author chose *full
   user-defined types in v1*).
4. **Connection direction** → **symmetric** by default, with an optional directional label.

## 7. Suggested build phases

- **v1 (MVP):** generic engine + **user-defined types** (defaults Plotline & Character Arc),
  span + point anchors via the selection context menu, gutter markers, a **single** right
  panel (desktop side-pane / mobile 5/8 sheet), sync-scroll + flash, TODO flags + counts,
  `.authbook` storage + Markdown outline export.
- **v1.1:** tiling-to-2 + tabs, auto character detection, first-class **Connections**, shared
  Characters/Codex.
- **v1.2:** extension-API hooks for plugin-registered thread types/behaviors; per-type
  custom-field editor UI.

## 8. Open questions for later

- Anchor durability across heavy edits (offset drift) — likely marker DOM nodes in the
  contentEditable, serialized to stable ids.
- Keyboard shortcuts (open thread palette, next/prev anchor, toggle panel).
- How auto character-detection works offline (name-frequency heuristic vs a dictionary).
- Whether TODOs can have due dates / tie into the streak/goal system.
