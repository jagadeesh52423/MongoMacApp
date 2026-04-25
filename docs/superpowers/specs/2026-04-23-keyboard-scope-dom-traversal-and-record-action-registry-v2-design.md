# Keyboard Scope DOM-Traversal + Record Action Registry v2

**Date:** 2026-04-23
**Supersedes:** `2026-04-23-keyboard-scope-zone-design.md`, `2026-04-19-record-modal-action-registry-design.md`

## Problem

Two related reliability and extensibility failures surfaced during debugging of F3/F4 (View/Edit Full Record):

**Scope system:** `KeyboardScopeZone` wraps only `<TableView>`, not the full results panel. The global capture-phase mousedown clear in `App.tsx` resets scope to `''` whenever the user clicks the toolbar, pagination, or group tabs — all of which are outside the zone. F3/F4 then silently fail until the user clicks back in the table. The root smell: scope is stored as a mutable singleton string set by event handlers, which is fragile against event ordering and placement errors.

**Record action guard:** `onViewRecord` is gated by `connectionId && database && collection`. `collection` is only set on tabs opened from the connection tree — manual tabs and saved scripts always have `collection: undefined`, so F3 and the context menu "View Full Record" silently no-op. The root smell: view (read-only) and edit (write) capabilities are collapsed into a single existence check.

---

## Design 1: DOM-Traversal Keyboard Scope

### Core principle

Scope is derived from the DOM on every dispatch — not stored. `dispatch` reads `document.activeElement`, walks up the ancestor chain, and collects all `[data-keyboard-scope]` values. A shortcut fires if its scope appears anywhere in that chain.

### `KeyboardService` changes

**Remove:**
- `_activeScope: string`
- `setScope(scope: string): void`
- `getScope(): string`

**Add:**

```typescript
// Walk from el to root, collect all [data-keyboard-scope] values (innermost first)
private resolveScopes(el: Element | null): string[] {
  const scopes: string[] = [];
  let node: Element | null = el;
  while (node) {
    const s = node.getAttribute('data-keyboard-scope');
    if (s) scopes.push(s);
    node = node.parentElement;
  }
  return scopes;
}
```

**`dispatch` guard change:**

```typescript
// Before
if (def.scope !== 'global' && def.scope !== this._activeScope) continue;

// After
const scopes = this.resolveScopes(document.activeElement);
if (def.scope !== 'global' && !scopes.includes(def.scope)) continue;
```

### `KeyboardScopeZone` changes

Remove all event handlers. Becomes a purely declarative wrapper:

```tsx
export function KeyboardScopeZone({ scope, children, style }: Props) {
  return (
    <div style={style} data-keyboard-scope={scope}>
      {children}
    </div>
  );
}
```

No `onMouseDown`, no `onFocus`, no `useKeyboardService()` import.

### `App.tsx` changes

Remove the global capture-phase mousedown scope-clearing listener entirely — it has no purpose in the new model.

### Two scope zones in `ResultsPanel`

Nested scopes enable shortcuts to target different precisions:

| Zone | Wraps | Scope string |
|------|-------|-------------|
| Outer `KeyboardScopeZone` | Entire results panel | `results` |
| Inner `KeyboardScopeZone` | `<TableView>` only | `results-table` |

Scope resolution for a focused element inside the TableView returns `['results-table', 'results']`, so both `results-table` and `results` shortcuts fire correctly.

### Shortcut scope changes in `defaults.ts`

| Shortcut group | Old scope | New scope | Reason |
|----------------|-----------|-----------|--------|
| F3/F4 view/edit, copy actions | `results` | `results` | Should work anywhere in the panel |
| Arrow key navigation | `results` | `results-table` | Must not fire when focus is on toolbar/pagination/select elements |

### `TableView` changes

Remove `onKeyDown={(e) => keyboardService.dispatch(e.nativeEvent)}` — the global window listener handles all dispatch. The div keeps `tabIndex={0}` so it remains focusable and appears in `document.activeElement` for scope resolution.

### Invariants after this change

- Scope is always consistent with DOM focus — zero race conditions, zero event-order issues
- `KeyboardScopeZone` is purely declarative: add a div with an attribute, done
- New scope zones require zero changes to `KeyboardService`
- Nested scopes work naturally — innermost scope is in the resolved list alongside all ancestors
- Panels outside any scope zone are safe: `resolveScopes` returns `[]`, no scoped shortcut fires

---

## Design 2: Record Action Registry v2

### Core principle

Each record action is a self-contained object that declares what it needs to execute (`canExecute`) and what UI it renders (`execute` → `host.openModal`). The modal is a dumb shell. Adding a new action requires zero changes to any existing file.

### `RecordContext` — what an action knows about the environment

```typescript
// src/services/records/RecordContext.ts
export interface RecordContext {
  doc: Record<string, unknown>;
  connectionId?: string;
  database?: string;
  collection?: string; // undefined for manual/saved-script tabs
}
```

### `RecordActionHost` — what an action can do with the UI

```typescript
// src/services/records/RecordActionHost.ts
export interface RecordActionHost {
  openModal(title: string, body: ReactNode, footer: ReactNode): void;
  close(): void;
  triggerDocUpdate(): void;
  executeAction(id: string): void; // allows view to hand off to edit without direct coupling
}
```

### `RecordAction` interface — implement this to add a new record action

```typescript
// src/services/records/RecordAction.ts
// implement this interface and register in recordActionRegistry to add a new record action
export interface RecordAction {
  id: string;
  label: string;
  keyBinding?: KeyCombo;       // auto-registers keyboard shortcut when provided
  scope?: string;              // defaults to 'results' if omitted
  showInContextMenu?: boolean;
  canExecute(context: RecordContext): boolean;
  execute(context: RecordContext, host: RecordActionHost): void;
}
```

### `RecordActionRegistry` — singleton

```typescript
// src/services/records/RecordActionRegistry.ts
class RecordActionRegistry {
  private actions: RecordAction[] = [];

  // Call at module load time to register a new action
  register(action: RecordAction): void

  getAll(): RecordAction[]
  getExecutable(context: RecordContext): RecordAction[]
  getById(id: string): RecordAction | undefined
}

export const recordActionRegistry = new RecordActionRegistry();
```

When an action with a `keyBinding` is registered, the registry defines the shortcut with `keyboardService.defineShortcut(...)`. The handler (which needs the current `selected` cell) is still bound by a React hook — same lifecycle pattern as `useTableActions` today.

### `RecordModalShell` — dumb container used by all actions

```tsx
// src/components/results/RecordModalShell.tsx
interface RecordModalShellProps {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}
```

Renders: backdrop, title bar with close button, body slot, footer slot. Dismisses on Escape and click-outside. Knows nothing about view vs edit vs delete.

### Built-in actions (registered at module load)

**`viewRecord` (F3)** — `canExecute: () => true`

```
body:   read-only <pre>{JSON.stringify(doc, null, 2)}</pre>
footer: [Close] [Edit (F4)]  ← Edit button only if editRecord.canExecute(ctx)
        Edit button calls host.executeAction('editRecord')
```

**`editRecord` (F4)** — `canExecute: (ctx) => !!ctx.collection`

```
body:   editable <textarea> with JSON
footer: [Cancel] [Submit]
        Submit calls updateDocument(connectionId, database, collection!, ...)
        then host.triggerDocUpdate()
```

### How `onViewRecord` / `onEditRecord` disappear

`ResultsPanel` no longer passes `onViewRecord`/`onEditRecord` callbacks. Instead it passes a `RecordContext` down to `useTableActions` (renamed `useRecordActions`). The hook reads from the registry, registers handlers for all actions with `keyBinding`, and builds the context menu from `registry.getExecutable(context)`.

The old conditional guard:
```typescript
// Before — viewRecord silently no-ops when collection is undefined
onViewRecord={connectionId && database && collection ? ... : undefined}
```
Is replaced by `canExecute` on each action, which is the correct place for capability logic.

### Example future action (zero existing-file changes needed)

```typescript
// src/services/records/actions/deleteRecordAction.ts
recordActionRegistry.register({
  id: 'deleteRecord',
  label: 'Delete Record',
  keyBinding: { key: 'Delete' },
  showInContextMenu: true,
  canExecute: (ctx) => !!ctx.collection,
  execute: (ctx, host) => {
    host.openModal(
      'Delete Record',
      <p>Delete document {String(ctx.doc._id)}?</p>,
      <>
        <button onClick={host.close}>Cancel</button>
        <button onClick={async () => {
          await deleteDocument(ctx.connectionId!, ctx.database!, ctx.collection!, String(ctx.doc._id));
          host.triggerDocUpdate();
          host.close();
        }}>Delete</button>
      </>,
    );
  },
});
```

---

## Files Changed

### Scope system

| File | Change |
|------|--------|
| `src/services/KeyboardService.ts` | Remove `_activeScope`, `setScope`, `getScope`; add `resolveScopes`; update `dispatch` guard |
| `src/components/shared/KeyboardScopeZone.tsx` | Remove event handlers — purely declarative |
| `src/App.tsx` | Remove global capture mousedown scope-clearing listener |
| `src/components/results/ResultsPanel.tsx` | Add inner `KeyboardScopeZone scope="results-table"` around `<TableView>` |
| `src/components/results/TableView.tsx` | Remove `onKeyDown` dispatch handler |
| `src/shortcuts/defaults.ts` | Arrow key shortcuts: `scope: 'results'` → `scope: 'results-table'` |

### Record action registry

| File | Change |
|------|--------|
| `src/services/records/RecordContext.ts` | New — `RecordContext` interface |
| `src/services/records/RecordActionHost.ts` | New — `RecordActionHost` interface |
| `src/services/records/RecordAction.ts` | New — `RecordAction` interface |
| `src/services/records/RecordActionRegistry.ts` | New — singleton registry |
| `src/services/records/actions/viewRecordAction.ts` | New — built-in view action |
| `src/services/records/actions/editRecordAction.ts` | New — built-in edit action |
| `src/components/results/RecordModalShell.tsx` | New — dumb modal container |
| `src/components/results/RecordModal.tsx` | Deleted — replaced by shell + actions |
| `src/hooks/useTableActions.ts` | Rename → `useRecordActions`; read from registry; accept `RecordContext` |
| `src/components/results/ResultsPanel.tsx` | Remove `onViewRecord`/`onEditRecord` props; pass `RecordContext`; remove inline guard logic |
| `src/shortcuts/defaults.ts` | Remove F3/F4 entries — actions self-register |
