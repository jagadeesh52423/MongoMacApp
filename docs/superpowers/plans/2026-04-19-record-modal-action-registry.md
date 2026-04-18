# Record Modal Action Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc F3/F4 shortcut wiring with a declarative `useTableActions` hook, remove BrowseTab and inline cell editing, and fix F4 being hidden from the context menu and F3/F4 re-triggering while RecordModal is open.

**Architecture:** A static `TABLE_ACTIONS` config array in `useTableActions.ts` describes every table keyboard action as a `TableActionDef`. A single `useEffect` registers all actions with `KeyboardService`, using a `stateRef` to capture the latest selected cell and handlers without re-registering. `ResultsPanel` is the sole consumer, passing `onViewRecord`/`onEditRecord` handlers.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, userEvent

---

## File Map

| Action | File |
|--------|------|
| CREATE | `src/hooks/useTableActions.ts` |
| DELETE | `src/hooks/useCellShortcuts.ts` |
| DELETE | `src/components/editor/BrowseTab.tsx` |
| DELETE | `src/components/results/InlineCell.tsx` |
| DELETE | `src/__tests__/inline-cell.test.tsx` |
| MODIFY | `src/components/results/RecordModal.tsx` |
| MODIFY | `src/components/results/TableView.tsx` |
| MODIFY | `src/components/results/ResultsPanel.tsx` |
| MODIFY | `src/components/editor/EditorArea.tsx` |
| MODIFY | `src/types.ts` |
| MODIFY | `src/__tests__/cell-selection-context.test.tsx` |
| MODIFY | `src/__tests__/table-view-selection.test.tsx` |

---

## Task 1: Create `useTableActions` hook (TDD)

**Files:**
- Modify: `src/__tests__/cell-selection-context.test.tsx`
- Create: `src/hooks/useTableActions.ts`

- [ ] **Step 1: Add failing tests for `useTableActions` to the test file**

Add this import at the top of `src/__tests__/cell-selection-context.test.tsx` (after existing imports):

```typescript
import { useTableActions } from '../hooks/useTableActions';
```

Add this entire block at the end of the file (after the `useCellShortcuts` describe block):

```typescript
describe('useTableActions', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  function makeWrapper(svc: KeyboardService) {
    return ({ children }: { children: ReactNode }) => (
      <KeyboardServiceContext.Provider value={svc}>
        <CellSelectionProvider>{children}</CellSelectionProvider>
      </KeyboardServiceContext.Provider>
    );
  }

  it('registers 6 actions', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    expect(svc.getAll()).toHaveLength(6);
  });

  it('cell.viewRecord has showInContextMenu: true always', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    expect(s.showInContextMenu).toBe(true);
  });

  it('cell.editRecord has showInContextMenu: true', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    expect(s.showInContextMenu).toBe(true);
  });

  it('F3 calls onViewRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ actions: useTableActions({ onViewRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const viewAction = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewAction.action(); });
    expect(onViewRecord).toHaveBeenCalledWith(doc);
  });

  it('F4 calls onEditRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onEditRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ actions: useTableActions({ onEditRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const editAction = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    act(() => { editAction.action(); });
    expect(onEditRecord).toHaveBeenCalledWith(doc);
  });

  it('F3 does nothing when no cell is selected', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    renderHook(() => useTableActions({ onViewRecord }), { wrapper: makeWrapper(svc) });
    const viewAction = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewAction.action(); });
    expect(onViewRecord).not.toHaveBeenCalled();
  });

  it('cmd+c copies value to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ actions: useTableActions(), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyValue = svc.getAll().find((s) => s.id === 'cell.copyValue')!;
    await act(async () => { copyValue.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alice');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: FAIL — `Cannot find module '../hooks/useTableActions'`

- [ ] **Step 3: Create `src/hooks/useTableActions.ts`**

```typescript
import { useEffect, useRef } from 'react';
import { useCellSelection } from '../contexts/CellSelectionContext';
import type { SelectedCell } from '../contexts/CellSelectionContext';
import { useKeyboardService } from '../services/KeyboardService';
import type { KeyCombo } from '../services/KeyboardService';

export interface TableActionHandlers {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}

interface TableActionDef {
  id: string;
  keys: KeyCombo;
  label: string;
  showInContextMenu: boolean;
  execute: (selected: SelectedCell | null, handlers: TableActionHandlers) => void;
}

const TABLE_ACTIONS: TableActionDef[] = [
  {
    id: 'cell.copyValue',
    keys: { cmd: true, key: 'c' },
    label: 'Copy Value',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(String(selected.value));
    },
  },
  {
    id: 'cell.copyField',
    keys: { ctrl: true, cmd: true, key: 'c' },
    label: 'Copy Field',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
    },
  },
  {
    id: 'cell.copyFieldPath',
    keys: { shift: true, alt: true, cmd: true, key: 'c' },
    label: 'Copy Field Path',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(selected.colKey);
    },
  },
  {
    id: 'cell.copyDocument',
    keys: { shift: true, cmd: true, key: 'c' },
    label: 'Copy Document',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
    },
  },
  {
    id: 'cell.viewRecord',
    keys: { key: 'F3' },
    label: 'View Full Record',
    showInContextMenu: true,
    execute: (selected, { onViewRecord }) => {
      if (!selected) return;
      onViewRecord?.(selected.doc);
    },
  },
  {
    id: 'cell.editRecord',
    keys: { key: 'F4' },
    label: 'Edit Full Record',
    showInContextMenu: true,
    execute: (selected, { onEditRecord }) => {
      if (!selected) return;
      onEditRecord?.(selected.doc);
    },
  },
];

export function useTableActions(handlers: TableActionHandlers = {}): void {
  const svc = useKeyboardService();
  const { selected } = useCellSelection();
  const stateRef = useRef({ selected, handlers });
  stateRef.current = { selected, handlers };

  useEffect(() => {
    const unregisters = TABLE_ACTIONS.map((def) =>
      svc.register({
        id: def.id,
        keys: def.keys,
        label: def.label,
        showInContextMenu: def.showInContextMenu,
        action: () =>
          def.execute(stateRef.current.selected, stateRef.current.handlers),
      })
    );
    return () => unregisters.forEach((fn) => fn());
  }, [svc]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: All `useTableActions` describe tests PASS. The existing `useCellShortcuts` tests also still PASS (hook not yet deleted).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTableActions.ts src/__tests__/cell-selection-context.test.tsx
git commit -m "feat(shortcuts): add useTableActions hook with declarative action registry"
```

---

## Task 2: Fix `RecordModal` — focus trap and keyboard guard

**Files:**
- Modify: `src/components/results/RecordModal.tsx`

- [ ] **Step 1: Write a failing test for modal focus**

Create `src/__tests__/record-modal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordModal } from '../components/results/RecordModal';

const baseProps = {
  doc: { _id: '507f1f77bcf86cd799439011', name: 'alice', age: 30 },
  initialMode: 'view' as const,
  connectionId: 'c1',
  database: 'mydb',
  collection: 'users',
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

describe('RecordModal', () => {
  it('dialog is focused on mount', () => {
    render(<RecordModal {...baseProps} />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('keyboard events on modal do not propagate to parent', () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <RecordModal {...baseProps} />
      </div>
    );
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true }));
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx vitest run src/__tests__/record-modal.test.tsx
```

Expected: FAIL — dialog not focused, and keydown propagates.

- [ ] **Step 3: Update `RecordModal.tsx` — add autoFocus and stopPropagation**

Replace the outer `<div>` (the overlay) opening tag at line 81 with:

```tsx
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
```

Replace the inner `<div role="dialog" ...>` opening tag (lines 88-104) with:

```tsx
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'view' ? 'Full Record' : 'Edit Record'}
        tabIndex={-1}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 600,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12,
          outline: 'none',
        }}
      >
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/record-modal.test.tsx
```

Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/RecordModal.tsx src/__tests__/record-modal.test.tsx
git commit -m "fix(modal): add focus trap and keyboard stopPropagation to RecordModal"
```

---

## Task 3: Strip `TableView` of `onEditCell` and `onDelete`

**Files:**
- Modify: `src/components/results/TableView.tsx`

- [ ] **Step 1: Verify existing tests pass before changes**

```bash
npx vitest run src/__tests__/table-view-selection.test.tsx
```

Expected: All 5 tests PASS (baseline).

- [ ] **Step 2: Rewrite `src/components/results/TableView.tsx`**

Replace the entire file with:

```typescript
import { useRef, useMemo, useState, useCallback } from 'react';
import { renderCell } from './cellRenderers';
import { useCellSelection } from '../../contexts/CellSelectionContext';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { useKeyboardService, formatKeyCombo } from '../../services/KeyboardService';

interface Props {
  docs: unknown[];
}

function columnsOf(docs: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of docs) {
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  return out;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export function TableView({ docs }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const svc = useKeyboardService();
  const containerRef = useRef<HTMLDivElement>(null);
  const { selected, select, clear } = useCellSelection();

  const sorted = useMemo(() => {
    if (!sortKey) return docs;
    const arr = [...docs];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as unknown;
      const bv = (b as Record<string, unknown>)[sortKey] as unknown;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return String(av) < String(bv) ? -sortDir : sortDir;
    });
    return arr;
  }, [docs, sortKey, sortDir]);

  const handleCellClick = useCallback(
    (rowIndex: number, colKey: string, doc: Record<string, unknown>) => {
      select({ rowIndex, colKey, doc, value: doc[colKey] });
      containerRef.current?.focus();
    },
    [select]
  );

  const handleCellContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number, colKey: string, doc: Record<string, unknown>) => {
      e.preventDefault();
      select({ rowIndex, colKey, doc, value: doc[colKey] });
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [select]
  );

  const contextMenuItems: ContextMenuItem[] = svc
    .getAll()
    .filter((s) => s.showInContextMenu)
    .map((s) => ({
      label: s.label,
      shortcutHint: formatKeyCombo(s.keys),
      action: s.action,
      disabled: !selected,
    }));

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{ overflow: 'auto', flex: 1, outline: 'none' }}
      onKeyDown={(e) => svc.dispatch(e.nativeEvent)}
      onMouseDown={(e) => {
        if (e.target === containerRef.current) clear();
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => {
                  if (sortKey === c) setSortDir((d) => (d === 1 ? -1 : 1));
                  else {
                    setSortKey(c);
                    setSortDir(1);
                  }
                }}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '4px 8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: 'var(--bg-panel)',
                  position: 'sticky',
                  top: 0,
                }}
              >
                {c} {sortKey === c ? (sortDir === 1 ? '↑' : '↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const doc = d as Record<string, unknown>;
                const raw = doc[c];
                const isSelected = selected?.rowIndex === i && selected?.colKey === c;
                return (
                  <td
                    key={c}
                    aria-selected={isSelected}
                    onClick={() => handleCellClick(i, c, doc)}
                    onContextMenu={(e) => handleCellContextMenu(e, i, c, doc)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      outline: isSelected ? '2px solid var(--accent-blue, #3b82f6)' : 'none',
                      outlineOffset: '-2px',
                      background: isSelected ? 'var(--bg-selected, rgba(59,130,246,0.08))' : undefined,
                    }}
                  >
                    {renderCell(raw)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run existing table-view tests to verify they still pass**

```bash
npx vitest run src/__tests__/table-view-selection.test.tsx
```

Expected: All 5 existing tests PASS (they don't use onEditCell/onDelete).

- [ ] **Step 4: Commit**

```bash
git add src/components/results/TableView.tsx
git commit -m "feat(table): remove onEditCell and onDelete props from TableView"
```

---

## Task 4: Update `ResultsPanel` to use `useTableActions`

**Files:**
- Modify: `src/components/results/ResultsPanel.tsx`

- [ ] **Step 1: Replace the top of `ResultsPanel.tsx` imports and the `CellShortcutsRegistrar` component**

Replace lines 1-22 (imports + CellShortcutsRegistrar) with:

```typescript
import { useEffect, useMemo, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useResultsStore } from '../../store/results';
import { JsonView } from './JsonView';
import { TableView } from './TableView';
import { RecordModal } from './RecordModal';
import { toCsv, toJsonText } from '../../utils/export';
import { CellSelectionProvider, useCellSelection } from '../../contexts/CellSelectionContext';
import { useTableActions } from '../../hooks/useTableActions';
import { KeyboardServiceProvider } from '../../services/KeyboardService';

function TableActionsRegistrar({
  onViewRecord,
  onEditRecord,
}: {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}) {
  useTableActions({ onViewRecord, onEditRecord });
  return null;
}
```

- [ ] **Step 2: Replace all three occurrences of `<CellShortcutsRegistrar` with `<TableActionsRegistrar`**

The file has `CellShortcutsRegistrar` used twice (lines 90-97 and 121-128 approximately). Replace both occurrences:

```tsx
      <TableActionsRegistrar
        onViewRecord={connectionId && database && collection
          ? (doc) => setRecordModal({ doc, mode: 'view' })
          : undefined}
        onEditRecord={connectionId && database && collection
          ? (doc) => setRecordModal({ doc, mode: 'edit' })
          : undefined}
      />
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: All tests PASS (the `useCellShortcuts` tests still pass because the hook still exists).

- [ ] **Step 4: Commit**

```bash
git add src/components/results/ResultsPanel.tsx
git commit -m "feat(results): wire ResultsPanel to useTableActions"
```

---

## Task 5: Update `table-view-selection.test.tsx` — replace hook + add F3/F4 tests

**Files:**
- Modify: `src/__tests__/table-view-selection.test.tsx`

- [ ] **Step 1: Replace the file content**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TableView } from '../components/results/TableView';
import { CellSelectionProvider } from '../contexts/CellSelectionContext';
import { useTableActions } from '../hooks/useTableActions';
import { KeyboardServiceProvider } from '../services/KeyboardService';

function ShortcutsRegistrar({
  onViewRecord,
  onEditRecord,
}: {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
} = {}) {
  useTableActions({ onViewRecord, onEditRecord });
  return null;
}

const docs = [{ name: 'alice', age: 30 }, { name: 'bob', age: 25 }];

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <KeyboardServiceProvider>
      <CellSelectionProvider>
        <ShortcutsRegistrar />
        {children}
      </CellSelectionProvider>
    </KeyboardServiceProvider>
  );
}

describe('TableView cell selection', () => {
  it('clicking a cell gives it a selected style', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    expect(cell.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking a different cell deselects the previous one', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cells = screen.getAllByRole('cell');
    const alice = cells.find((c) => c.textContent === 'alice')!;
    const bob = cells.find((c) => c.textContent === 'bob')!;
    await user.click(alice);
    await user.click(bob);
    expect(alice.getAttribute('aria-selected')).toBe('false');
    expect(bob.getAttribute('aria-selected')).toBe('true');
  });

  it('right-clicking a cell opens context menu', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('context menu shows copy actions', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('Copy Value')).toBeInTheDocument();
    expect(screen.getByText('Copy Field')).toBeInTheDocument();
    expect(screen.getByText('Copy Field Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Document')).toBeInTheDocument();
  });

  it('context menu shows View Full Record action', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('View Full Record')).toBeInTheDocument();
  });

  it('context menu shows Edit Full Record action', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('Edit Full Record')).toBeInTheDocument();
  });

  it('context menu closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('F3 on selected cell calls onViewRecord', async () => {
    const user = userEvent.setup();
    const onViewRecord = vi.fn();

    function WrapperWithHandlers({ children }: { children: ReactNode }) {
      return (
        <KeyboardServiceProvider>
          <CellSelectionProvider>
            <ShortcutsRegistrar onViewRecord={onViewRecord} />
            {children}
          </CellSelectionProvider>
        </KeyboardServiceProvider>
      );
    }

    render(<TableView docs={docs} />, { wrapper: WrapperWithHandlers });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F3}');
    expect(onViewRecord).toHaveBeenCalledWith({ name: 'alice', age: 30 });
  });

  it('F4 on selected cell calls onEditRecord', async () => {
    const user = userEvent.setup();
    const onEditRecord = vi.fn();

    function WrapperWithHandlers({ children }: { children: ReactNode }) {
      return (
        <KeyboardServiceProvider>
          <CellSelectionProvider>
            <ShortcutsRegistrar onEditRecord={onEditRecord} />
            {children}
          </CellSelectionProvider>
        </KeyboardServiceProvider>
      );
    }

    render(<TableView docs={docs} />, { wrapper: WrapperWithHandlers });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(onEditRecord).toHaveBeenCalledWith({ name: 'alice', age: 30 });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/__tests__/table-view-selection.test.tsx
```

Expected: All 9 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/table-view-selection.test.tsx
git commit -m "test(table): replace useCellShortcuts with useTableActions, add F3/F4 tests"
```

---

## Task 6: Replace `useCellShortcuts` tests in `cell-selection-context.test.tsx`

**Files:**
- Modify: `src/__tests__/cell-selection-context.test.tsx`

- [ ] **Step 1: Remove the `useCellShortcuts` import and entire `describe('useCellShortcuts', ...)` block**

Remove line:
```typescript
import { useCellShortcuts } from '../hooks/useCellShortcuts';
```

Remove the entire `describe('useCellShortcuts', () => { ... })` block (lines 46–188).

The file should now contain only:
1. The remaining imports (vitest, testing-library, react, CellSelectionContext, useTableActions, KeyboardService)
2. The `TestConsumer` component
3. `describe('CellSelectionContext', ...)` block
4. `describe('useTableActions', ...)` block (added in Task 1)

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: All tests PASS (no useCellShortcuts references remain).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/cell-selection-context.test.tsx
git commit -m "test(shortcuts): remove useCellShortcuts tests, keep useTableActions tests"
```

---

## Task 7: Delete `BrowseTab` — update `EditorArea` and `types.ts`

**Files:**
- Delete: `src/components/editor/BrowseTab.tsx`
- Modify: `src/components/editor/EditorArea.tsx`
- Modify: `src/types.ts`

- [ ] **Step 1: Delete `BrowseTab.tsx`**

```bash
rm src/components/editor/BrowseTab.tsx
```

- [ ] **Step 2: Update `src/components/editor/EditorArea.tsx`**

Remove the `BrowseTab` import (line 5):
```typescript
import { BrowseTab } from './BrowseTab';
```

Remove the browse tab rendering branch (lines 130–137):
```tsx
        {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
          <BrowseTab
            key={active.id}
            connectionId={active.connectionId}
            database={active.database}
            collection={active.collection}
          />
        )}
```

- [ ] **Step 3: Update `src/types.ts`**

Change the `EditorTab` type from:
```typescript
  type: 'script' | 'browse';
```
to:
```typescript
  type: 'script';
```

Remove the `BrowsePage` interface (lines 77–82):
```typescript
export interface BrowsePage {
  docs: unknown[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All tests PASS (no tests reference BrowseTab or BrowsePage).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove BrowseTab — all document editing goes through RecordModal"
```

---

## Task 8: Delete dead code — `useCellShortcuts` and `InlineCell`

**Files:**
- Delete: `src/hooks/useCellShortcuts.ts`
- Delete: `src/components/results/InlineCell.tsx`
- Delete: `src/__tests__/inline-cell.test.tsx`

- [ ] **Step 1: Delete the three files**

```bash
rm src/hooks/useCellShortcuts.ts
rm src/components/results/InlineCell.tsx
rm src/__tests__/inline-cell.test.tsx
```

- [ ] **Step 2: Run all tests and TypeScript check**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: All tests PASS. TypeScript reports no errors related to deleted files. (There is a pre-existing unrelated TS error in `keyboard-service.test.ts:92` — do not fix in this task.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete useCellShortcuts, InlineCell — replaced by useTableActions"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `useTableActions` with `TABLE_ACTIONS` config array — Task 1
- ✅ F4 `showInContextMenu: true` — Task 1 (TABLE_ACTIONS definition)
- ✅ RecordModal keyboard trap + focus — Task 2
- ✅ Strip `onEditCell`/`onDelete` from TableView — Task 3
- ✅ ResultsPanel uses `useTableActions` — Task 4
- ✅ BrowseTab removed — Task 7
- ✅ EditorArea updated — Task 7
- ✅ `types.ts` cleaned up — Task 7
- ✅ `useCellShortcuts` deleted — Task 8
- ✅ `InlineCell` deleted — Task 8
- ✅ Tests updated throughout — Tasks 1, 2, 5, 6

**No placeholders** — every step has exact code.

**Type consistency:**
- `TableActionHandlers` defined in Task 1, used in Tasks 1 and 4
- `TableActionsRegistrar` defined in Task 4 (same props as old `CellShortcutsRegistrar`)
- `ShortcutsRegistrar` updated to `useTableActions` in Task 5
- `TABLE_ACTIONS: TableActionDef[]` — `TableActionDef` defined and used only in `useTableActions.ts`
