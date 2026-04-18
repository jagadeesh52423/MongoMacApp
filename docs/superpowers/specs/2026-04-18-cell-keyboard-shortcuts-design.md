# Cell Click + Keyboard Shortcuts Design

**Date:** 2026-04-18  
**Scope:** Table view only — clickable cells, keyboard copy shortcuts, right-click context menu, extensible keyboard service

---

## Overview

Users can click any cell in the Table view to select it (highlighted). Once selected, four keyboard shortcuts copy different levels of the data to the clipboard. Right-clicking a cell opens a context menu with the same actions listed alongside their shortcut hints. The keyboard shortcut system is built as an extensible service so shortcuts can be added or remapped in future without touching component code.

---

## Architecture

### KeyboardService (`src/services/KeyboardService.ts`)

Singleton. No React dependency. Holds a registry of `ShortcutDef` entries.

```typescript
interface KeyCombo {
  cmd?: boolean;    // metaKey (Mac ⌘)
  ctrl?: boolean;   // ctrlKey (Mac ⌃)
  shift?: boolean;  // shiftKey (Mac ⇧)
  alt?: boolean;    // optionKey (Mac ⌥)
  key: string;      // e.g. 'c'
}

interface ShortcutDef {
  id: string;
  keys: KeyCombo;
  label: string;
  action: () => void;
  showInContextMenu?: boolean;
}
```

**API:**
- `register(def: ShortcutDef): () => void` — returns unsubscribe function
- `dispatch(e: KeyboardEvent): void` — matches event against registry and fires action
- `getAll(): ShortcutDef[]` — returns full registry (used for context menu population)

A helper `formatKeyCombo(combo: KeyCombo): string` converts a combo to a human-readable hint string (e.g. `⌘C`, `⌃⌘C`, `⇧⌥⌘C`).

### `useKeyboard` hook (`src/hooks/useKeyboard.ts`)

Thin React wrapper: calls `KeyboardService.register(def)` on mount, calls the returned unsubscribe on unmount.

```typescript
function useKeyboard(def: ShortcutDef): void
```

### `useCellShortcuts` hook (`src/hooks/useCellShortcuts.ts`)

Reads `selected` from `CellSelectionContext`. Registers all four copy shortcuts via `useKeyboard`. Uses `navigator.clipboard.writeText()` (works natively in Tauri WebView — no extra plugin required).

| Shortcut | Keys | What is copied |
|---|---|---|
| Copy Value | `⌘C` | `String(value)` |
| Copy Field | `⌃⌘C` | `"colKey": <JSON value>` |
| Copy Field Path | `⇧⌥⌘C` | `colKey` |
| Copy Document | `⇧⌘C` | `JSON.stringify(doc, null, 2)` |

All four have `showInContextMenu: true`. When `selected` is `null`, actions are no-ops.

---

## CellSelectionContext (`src/contexts/CellSelectionContext.tsx`)

Ephemeral React context — not persisted to Zustand.

```typescript
interface SelectedCell {
  rowIndex: number;
  colKey: string;                      // field name, e.g. "name"
  doc: Record<string, unknown>;        // full row document
  value: unknown;                      // doc[colKey]
}

interface CellSelectionContextValue {
  selected: SelectedCell | null;
  select: (cell: SelectedCell) => void;
  clear: () => void;
}
```

`CellSelectionProvider` wraps `ResultsPanel`. Selection is cleared automatically when `tabId` changes or `isRunning` becomes `true` (new query started).

---

## ContextMenu Component (`src/components/ui/ContextMenu.tsx`)

Generic, not cell-specific. Receives a position and a list of items.

```typescript
interface ContextMenuItem {
  label: string;
  shortcutHint?: string;   // e.g. "⌘C"
  action: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}
```

Rendered as a `position: fixed` div. Closes on:
- `Escape` key
- Click outside the menu
- Any item action fires

Items are built by the parent (`TableView`) from `KeyboardService.getAll()` filtered by `showInContextMenu: true`, with actions bound to the current selected cell at render time.

---

## TableView Modifications (`src/components/results/TableView.tsx`)

### Cell click → selection
- Each `<td>` gets `onClick` calling `select({ rowIndex, colKey, doc, value })`
- Selected cell receives a highlight class: `ring-2 ring-blue-500 bg-blue-50`
- Clicking the container div outside any cell calls `clear()`

### Keyboard dispatch
- Table container `<div>` gets `tabIndex={0}` to be focusable
- `onKeyDown={(e) => KeyboardService.dispatch(e)}`
- On cell select, `containerRef.current?.focus()` is called so shortcuts work immediately without an extra Tab press

### Right-click context menu
- Each `<td>` gets `onContextMenu`
- If the right-clicked cell is not already selected, it is selected first
- Sets `contextMenuPos: { x: e.clientX, y: e.clientY }` in local state
- Renders `<ContextMenu>` with items from `KeyboardService.getAll()` bound to the current `selected`
- On close: `contextMenuPos` set to `null`

---

## ResultsPanel Modifications (`src/components/results/ResultsPanel.tsx`)

- Wrap render output with `<CellSelectionProvider>`
- Mount `useCellShortcuts()` inside the provider so shortcuts have access to selection context

---

## Files Changed

| File | Status |
|---|---|
| `src/services/KeyboardService.ts` | NEW |
| `src/hooks/useKeyboard.ts` | NEW |
| `src/hooks/useCellShortcuts.ts` | NEW |
| `src/contexts/CellSelectionContext.tsx` | NEW |
| `src/components/ui/ContextMenu.tsx` | NEW |
| `src/components/results/TableView.tsx` | MODIFY |
| `src/components/results/ResultsPanel.tsx` | MODIFY |

---

## Extensibility

Adding a new shortcut in future:

```typescript
useKeyboard({
  id: 'cell.copyAsHex',
  keys: { cmd: true, shift: true, key: 'h' },
  label: 'Copy as Hex',
  action: () => { /* ... */ },
  showInContextMenu: true,
});
```

User-remappable shortcuts: replace `keys` values in `ShortcutDef` from a user preferences store. `KeyboardService` is already decoupled from hardcoded keys.

---

## Out of Scope

- JSON view support (Table view only)
- Multi-cell selection
- User-facing shortcut remapping UI (architecture supports it, UI deferred)
