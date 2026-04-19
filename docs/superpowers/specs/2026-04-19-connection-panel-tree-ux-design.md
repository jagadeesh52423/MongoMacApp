# Connection Panel Tree UX Design

**Date:** 2026-04-19

## Goal

Three UX improvements to the connection panel sidebar:
1. Open script editor on double-click (not single-click) on a collection.
2. Clicking a connected connection name toggles the database tree. Connect auto-expands; Disconnect auto-collapses.
3. Render the connection → database → collection hierarchy as a VS Code-style file-explorer tree with continuous CSS guide lines.

---

## Changes

### `src/components/connections/ConnectionPanel.tsx`

**Expand/collapse state:**
- Add `const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set())`.
- Helper: `toggleConnExpanded(id)` — toggles the id in the set.

**Connect behaviour:**
- After `markConnected(c.id)` in `handleConnect`, also call `setExpandedConns(s => new Set(s).add(c.id))` to auto-expand.

**Disconnect behaviour:**
- After `markDisconnected(c.id)` in `handleDisconnect`, remove the id: `setExpandedConns(s => { const n = new Set(s); n.delete(c.id); return n; })`.

**Connection row:**
- The connection name `<span>` gets `onClick={() => connected && toggleConnExpanded(c.id)}` and `style={{ cursor: connected ? 'pointer' : 'default' }}`.
- `ConnectionTree` renders only when `connected && expandedConns.has(c.id)`.

---

### `src/components/connections/ConnectionTree.tsx`

**Double-click on collections:**
- Change `onClick={() => onOpenCollection(db, c.name)}` to `onDoubleClick`.

**File-explorer tree rendering:**

Replace the current flat `paddingLeft` divs with guide-cell rows.

**Guide CSS classes** (each guide cell is 16px wide, `position: relative`, `align-self: stretch`):

| Class | Vertical line | Horizontal stub | When to use |
|-------|--------------|-----------------|-------------|
| `line`   | Full height (top→bottom) | None | Ancestor level where that ancestor has more siblings below |
| `branch` | Full height (top→bottom) | At 50% | Current item is NOT the last sibling |
| `last`   | Half height (top→50%)    | At 50% | Current item IS the last sibling |
| `empty`  | None | None | Ancestor level where that ancestor was the last sibling |

**DB rows** (1 guide, from connection level):
- `branch` if this DB is not the last DB.
- `last` if this DB is the last DB.

**Collection rows** (2 guides):
- Guide 1 (connection level): `line` if the parent DB is not the last DB, `empty` if it is.
- Guide 2 (DB level): `branch` if this collection is not the last in its DB, `last` if it is.

**Row layout:**
```
[guide?][guide?][caret (DBs only)][label]
```
Collections have no caret. DBs retain the `▶`/`▼` caret to toggle expansion.

**Hover highlight:** `background: rgba(255,255,255,0.06)` on `.t-row:hover`.

**Double-click target:** only collection rows fire `onDoubleClick` → `onOpenCollection`.

---

## Unchanged

- `ConnectionDialog` modal — untouched.
- `ContextMenu` (right-click Edit/Delete) — untouched.
- Connect/Disconnect button placement — stays inline on the connection row.
- IPC calls (`listDatabases`, `listCollections`) — untouched.
- DB expand/collapse toggle (`toggle(db)` function) — logic unchanged, only visual rendering changes.
