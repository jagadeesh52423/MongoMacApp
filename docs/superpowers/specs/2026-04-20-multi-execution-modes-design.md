# Multi-Execution Modes — Design Spec

**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

The script editor gains three execution modes, replacing the current single "run entire script" behavior. The default smart-run adapts to context (cursor position or selection), with a dedicated button for full-script execution.

---

## Execution Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Inline** | `Run` button / `Cmd+Enter` (no selection) | Executes the statement block at cursor |
| **Selection** | `Run` button / `Cmd+Enter` (text selected) | Executes selected text only |
| **Full Script** | `Run Script` button / `Shift+Cmd+Enter` | Executes entire script content |

**Smart default:** if any text is selected → Selection mode; otherwise → Inline mode. The `Run` button and `Cmd+Enter` always follow this rule.

---

## Button Layout (ContextBar)

Two buttons replace the current single `Run` button:

- **`Run`** — outline/secondary style. Smart mode (inline or selection).
- **`Run Script`** — filled/primary style. Always full script.

Both buttons disable while a script is running. The existing `Cancel` button continues to appear during execution.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Enter` | Smart run (inline or selection) |
| `Shift+Cmd+Enter` | Run Script (full) |

---

## Statement Detection (`src/utils/statementDetection.ts`)

### Types

```typescript
interface Statement {
  startLine: number; // 1-based, inclusive
  endLine: number;   // 1-based, inclusive
  text: string;
}
```

### API

```typescript
function detectStatements(script: string): Statement[]
function getStatementAtCursor(script: string, cursorLine: number): Statement | null
```

### Algorithm (Approach A' — blank-line split + dot-continuation merge)

1. Split the script by blank lines into raw blocks, recording `startLine` and `endLine` for each.
2. Walk blocks in order. For each block, trim each line and check if the **first non-empty trimmed line starts with `.`**. If yes, merge this block with the immediately preceding block (extend its `endLine`, append text).
3. Return the final merged list of `Statement` objects.

**Rationale:** MongoDB scripts conventionally separate queries with blank lines. Chained methods (`.sort()`, `.limit()`, etc.) often appear on separate lines — sometimes with leading whitespace — after a blank line. Trimming before the dot-check handles all whitespace variants. Full AST parsing is unnecessary for this convention.

**Handled cases:**
```js
// Standard blank-line separation
db.col.find({})

db.col.insertOne({ x: 1 })

// Chained with blank lines + varied whitespace
db.getCollection("t").find({ channel: 'sms' })

  . sort({ lastModifiedOn: -1 })

.   limit(5)

// Multi-line argument + chaining
db.getCollection("t").find({
    channel: 'sms'
})

  . sort(
  {
      lastModifiedOn: -1
  })

.   limit(5)
```

All three examples above resolve to a single `Statement`.

---

## Current Statement Highlight (Monaco Decorations)

In `ScriptEditor.tsx`, on every cursor position change:

1. Call `getStatementAtCursor(content, cursorLine)`.
2. If a statement is found and no text is selected, apply a Monaco **line range decoration** across `startLine → endLine`.
3. Decoration style: subtle background highlight (`#0d3a4f` — one step above the editor background `#001e2b`), consistent with the existing line-highlight color.
4. Clear the decoration when text is selected (selection mode takes over visually).
5. Clear the decoration when no statement is found at cursor.

The highlight updates live as the cursor moves, always previewing what `Cmd+Enter` will run.

---

## Results Tabs

### Behavior

- Each run **replaces** all previous results (no append/accumulation across runs).
- If a run produces multiple `ResultGroup`s (multiple queries), the results panel shows a **tab bar** above the result content — one tab per group.
- Inline execution always produces exactly one tab.

### Tab Labels

Tabs are labeled **`Query 1`, `Query 2`, ...** by default. The active tab is highlighted; clicking switches the result view.

### Store

No store changes needed. `ResultGroup[]` already exists in `store/results.ts`. The results panel adds a tab bar UI driven by this array.

---

## Files Affected

| File | Change |
|------|--------|
| `src/utils/statementDetection.ts` | New file — statement detection logic |
| `src/components/editor/ScriptEditor.tsx` | Cursor tracking, Monaco decorations, expose `getSelection()` |
| `src/components/editor/ContextBar.tsx` | Add `Run Script` button, update `onRun` / `onRunScript` props |
| `src/components/editor/EditorArea.tsx` | Smart-run handler, full-run handler, `Shift+Cmd+Enter` shortcut |
| `src/components/results/ResultsPanel.tsx` | Add tab bar for multiple result groups |

---

## Out of Scope

- Bracket/paren balance tracking for blank lines inside `{}` arguments (not needed based on confirmed conventions).
- Per-query result history / accumulation across runs.
- Named tabs (snippet-based labels) — `Query N` is sufficient for now.
