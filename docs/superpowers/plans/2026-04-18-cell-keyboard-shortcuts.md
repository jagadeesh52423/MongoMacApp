# Cell Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make table cells clickable (selected with highlight), add four clipboard copy shortcuts, and a right-click context menu — all backed by an extensible `KeyboardService`.

**Architecture:** A plain singleton `KeyboardService` holds a registry of shortcuts and dispatches keyboard events. A `CellSelectionContext` holds ephemeral selected-cell state. `TableView` gains click-to-select, `tabIndex` + `onKeyDown` dispatch, and a right-click `ContextMenu`. A `useCellShortcuts` hook registers the four copy actions inside `ResultsPanel`'s `CellSelectionProvider`.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, React Testing Library, `navigator.clipboard.writeText` (no extra Tauri plugin needed)

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/services/KeyboardService.ts` | NEW | Singleton registry; `register`, `dispatch`, `getAll`, `formatKeyCombo` |
| `src/hooks/useKeyboard.ts` | NEW | React wrapper: register on mount, unregister on unmount |
| `src/hooks/useCellShortcuts.ts` | NEW | Registers the 4 copy shortcuts; reads selected cell from context |
| `src/contexts/CellSelectionContext.tsx` | NEW | `SelectedCell` state + `CellSelectionProvider` |
| `src/components/ui/ContextMenu.tsx` | NEW | Generic fixed-position context menu; closes on Escape/outside click |
| `src/components/results/TableView.tsx` | MODIFY | Click-to-select, keydown dispatch, right-click context menu |
| `src/components/results/ResultsPanel.tsx` | MODIFY | Wrap with `CellSelectionProvider`; mount `CellShortcutsRegistrar` |
| `src/__tests__/keyboard-service.test.ts` | NEW | Unit tests for KeyboardService |
| `src/__tests__/cell-selection-context.test.tsx` | NEW | Unit tests for CellSelectionContext |
| `src/__tests__/context-menu.test.tsx` | NEW | Unit tests for ContextMenu |
| `src/__tests__/table-view-selection.test.tsx` | NEW | Integration tests for cell selection + shortcuts |

---

## Task 1: KeyboardService

**Files:**
- Create: `src/services/KeyboardService.ts`
- Create: `src/__tests__/keyboard-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/keyboard-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardService, formatKeyCombo } from '../services/KeyboardService';

let svc: KeyboardService;

beforeEach(() => {
  svc = new KeyboardService();
});

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('KeyboardService', () => {
  it('calls registered action on matching keydown', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire on non-matching event', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'v', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('calls preventDefault when a shortcut matches', () => {
    const e = makeKeyEvent({ key: 'c', metaKey: true });
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action: vi.fn() });
    svc.dispatch(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('requires all modifiers to match', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, shift: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true, shiftKey: false }));
    expect(action).not.toHaveBeenCalled();
  });

  it('unregisters via returned function', () => {
    const action = vi.fn();
    const unregister = svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    unregister();
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('getAll returns registered shortcuts', () => {
    svc.register({ id: 'a', keys: { cmd: true, key: 'c' }, label: 'A', action: vi.fn(), showInContextMenu: true });
    svc.register({ id: 'b', keys: { cmd: true, key: 'v' }, label: 'B', action: vi.fn() });
    expect(svc.getAll()).toHaveLength(2);
  });
});

describe('formatKeyCombo', () => {
  it('formats cmd+c as ⌘C', () => {
    expect(formatKeyCombo({ cmd: true, key: 'c' })).toBe('⌘C');
  });

  it('formats ctrl+cmd+c as ⌃⌘C', () => {
    expect(formatKeyCombo({ ctrl: true, cmd: true, key: 'c' })).toBe('⌃⌘C');
  });

  it('formats shift+alt+cmd+c as ⇧⌥⌘C', () => {
    expect(formatKeyCombo({ shift: true, alt: true, cmd: true, key: 'c' })).toBe('⇧⌥⌘C');
  });

  it('formats shift+cmd+c as ⇧⌘C', () => {
    expect(formatKeyCombo({ shift: true, cmd: true, key: 'c' })).toBe('⇧⌘C');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/keyboard-service.test.ts
```

Expected: FAIL — `Cannot find module '../services/KeyboardService'`

- [ ] **Step 3: Implement KeyboardService**

Create `src/services/KeyboardService.ts`:

```typescript
export interface KeyCombo {
  cmd?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export interface ShortcutDef {
  id: string;
  keys: KeyCombo;
  label: string;
  action: () => void;
  showInContextMenu?: boolean;
}

export function formatKeyCombo(keys: KeyCombo): string {
  const parts: string[] = [];
  if (keys.ctrl) parts.push('⌃');
  if (keys.alt) parts.push('⌥');
  if (keys.shift) parts.push('⇧');
  if (keys.cmd) parts.push('⌘');
  parts.push(keys.key.toUpperCase());
  return parts.join('');
}

export class KeyboardService {
  private _registry = new Map<string, ShortcutDef>();

  register(def: ShortcutDef): () => void {
    this._registry.set(def.id, def);
    return () => this._registry.delete(def.id);
  }

  dispatch(e: KeyboardEvent): void {
    for (const def of this._registry.values()) {
      const k = def.keys;
      if (
        e.key.toLowerCase() === k.key.toLowerCase() &&
        !!e.metaKey === !!k.cmd &&
        !!e.ctrlKey === !!k.ctrl &&
        !!e.shiftKey === !!k.shift &&
        !!e.altKey === !!k.alt
      ) {
        e.preventDefault();
        def.action();
        return;
      }
    }
  }

  getAll(): ShortcutDef[] {
    return Array.from(this._registry.values());
  }
}

export const keyboardService = new KeyboardService();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/keyboard-service.test.ts
```

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/KeyboardService.ts src/__tests__/keyboard-service.test.ts
git commit -m "feat(keyboard): add KeyboardService with register/dispatch/formatKeyCombo"
```

---

## Task 2: `useKeyboard` hook

**Files:**
- Create: `src/hooks/useKeyboard.ts`

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/keyboard-service.test.ts` (append at bottom):

```typescript
import { renderHook } from '@testing-library/react';
import { useKeyboard } from '../hooks/useKeyboard';

describe('useKeyboard', () => {
  it('registers shortcut on mount and unregisters on unmount', () => {
    const svc2 = new KeyboardService();
    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboard({ id: 'hook-test', keys: { cmd: true, key: 'z' }, label: 'Test', action }, svc2)
    );
    expect(svc2.getAll()).toHaveLength(1);
    unmount();
    expect(svc2.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/keyboard-service.test.ts
```

Expected: FAIL — `Cannot find module '../hooks/useKeyboard'`

- [ ] **Step 3: Implement `useKeyboard`**

Create `src/hooks/useKeyboard.ts`:

```typescript
import { useEffect } from 'react';
import { keyboardService, type ShortcutDef, type KeyboardService } from '../services/KeyboardService';

export function useKeyboard(def: ShortcutDef, svc: KeyboardService = keyboardService): void {
  useEffect(() => {
    return svc.register(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/keyboard-service.test.ts
```

Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useKeyboard.ts
git commit -m "feat(keyboard): add useKeyboard hook"
```

---

## Task 3: CellSelectionContext

**Files:**
- Create: `src/contexts/CellSelectionContext.tsx`
- Create: `src/__tests__/cell-selection-context.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/cell-selection-context.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellSelectionProvider, useCellSelection } from '../contexts/CellSelectionContext';

function TestConsumer() {
  const { selected, select, clear } = useCellSelection();
  return (
    <div>
      <span data-testid="col">{selected?.colKey ?? 'none'}</span>
      <span data-testid="value">{selected ? String(selected.value) : 'none'}</span>
      <button onClick={() => select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' })}>
        Select
      </button>
      <button onClick={clear}>Clear</button>
    </div>
  );
}

describe('CellSelectionContext', () => {
  it('starts with no selection', () => {
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    expect(screen.getByTestId('col').textContent).toBe('none');
  });

  it('select() updates selected cell', async () => {
    const user = userEvent.setup();
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    await user.click(screen.getByText('Select'));
    expect(screen.getByTestId('col').textContent).toBe('name');
    expect(screen.getByTestId('value').textContent).toBe('alice');
  });

  it('clear() resets selection', async () => {
    const user = userEvent.setup();
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    await user.click(screen.getByText('Select'));
    await user.click(screen.getByText('Clear'));
    expect(screen.getByTestId('col').textContent).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: FAIL — `Cannot find module '../contexts/CellSelectionContext'`

- [ ] **Step 3: Implement CellSelectionContext**

Create `src/contexts/CellSelectionContext.tsx`:

```typescript
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SelectedCell {
  rowIndex: number;
  colKey: string;
  doc: Record<string, unknown>;
  value: unknown;
}

interface CellSelectionContextValue {
  selected: SelectedCell | null;
  select: (cell: SelectedCell) => void;
  clear: () => void;
}

const CellSelectionContext = createContext<CellSelectionContextValue | null>(null);

export function CellSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  return (
    <CellSelectionContext.Provider value={{ selected, select: setSelected, clear: () => setSelected(null) }}>
      {children}
    </CellSelectionContext.Provider>
  );
}

export function useCellSelection(): CellSelectionContextValue {
  const ctx = useContext(CellSelectionContext);
  if (!ctx) throw new Error('useCellSelection must be used inside CellSelectionProvider');
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/CellSelectionContext.tsx src/__tests__/cell-selection-context.test.tsx
git commit -m "feat(table): add CellSelectionContext for selected cell state"
```

---

## Task 4: ContextMenu component

**Files:**
- Create: `src/components/ui/ContextMenu.tsx`
- Create: `src/__tests__/context-menu.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/context-menu.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu } from '../components/ui/ContextMenu';

const items = [
  { label: 'Copy Value', shortcutHint: '⌘C', action: vi.fn() },
  { label: 'Copy Document', shortcutHint: '⇧⌘C', action: vi.fn() },
];

describe('ContextMenu', () => {
  it('renders all item labels', () => {
    render(<ContextMenu x={100} y={200} items={items} onClose={vi.fn()} />);
    expect(screen.getByText('Copy Value')).toBeInTheDocument();
    expect(screen.getByText('Copy Document')).toBeInTheDocument();
  });

  it('renders shortcut hints', () => {
    render(<ContextMenu x={100} y={200} items={items} onClose={vi.fn()} />);
    expect(screen.getByText('⌘C')).toBeInTheDocument();
  });

  it('calls action and onClose when item clicked', async () => {
    const onClose = vi.fn();
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu x={100} y={200} items={[{ label: 'Copy Value', action }]} onClose={onClose} />
    );
    await user.click(screen.getByText('Copy Value'));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={100} y={200} items={items} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render disabled items as clickable', async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu
        x={100} y={200}
        items={[{ label: 'Copy Value', action, disabled: true }]}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText('Copy Value'));
    expect(action).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/context-menu.test.tsx
```

Expected: FAIL — `Cannot find module '../components/ui/ContextMenu'`

- [ ] **Step 3: Implement ContextMenu**

Create `src/components/ui/ContextMenu.tsx`:

```typescript
import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcutHint?: string;
  action: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        minWidth: 200,
        zIndex: 1000,
        padding: '4px 0',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          role="menuitem"
          aria-disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.action();
            onClose();
          }}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 12px',
            cursor: item.disabled ? 'default' : 'pointer',
            color: item.disabled ? 'var(--fg-dim)' : 'inherit',
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover, rgba(0,0,0,0.06))';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = '';
          }}
        >
          <span>{item.label}</span>
          {item.shortcutHint && (
            <span style={{ color: 'var(--fg-dim)', marginLeft: 24, fontFamily: 'var(--font-mono)' }}>
              {item.shortcutHint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/context-menu.test.tsx
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ContextMenu.tsx src/__tests__/context-menu.test.tsx
git commit -m "feat(ui): add generic ContextMenu component"
```

---

## Task 5: `useCellShortcuts` hook

**Files:**
- Create: `src/hooks/useCellShortcuts.ts`
- Test: append to `src/__tests__/cell-selection-context.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/cell-selection-context.test.tsx`:

```typescript
import { vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCellShortcuts } from '../hooks/useCellShortcuts';
import { CellSelectionProvider, useCellSelection } from '../contexts/CellSelectionContext';
import { KeyboardService } from '../services/KeyboardService';
import type { ReactNode } from 'react';

describe('useCellShortcuts', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  function makeWrapper(svc: KeyboardService) {
    return ({ children }: { children: ReactNode }) => (
      <CellSelectionProvider>{children}</CellSelectionProvider>
    );
  }

  it('registers 4 shortcuts', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    expect(svc.getAll()).toHaveLength(4);
  });

  it('all 4 shortcuts have showInContextMenu: true', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    expect(svc.getAll().every((s) => s.showInContextMenu)).toBe(true);
  });

  it('cmd+c copies value to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyValue = svc.getAll().find((s) => s.id === 'cell.copyValue')!;
    await act(async () => { copyValue.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alice');
  });

  it('ctrl+cmd+c copies field to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyField = svc.getAll().find((s) => s.id === 'cell.copyField')!;
    await act(async () => { copyField.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"name": "alice"');
  });

  it('shift+alt+cmd+c copies field path', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyPath = svc.getAll().find((s) => s.id === 'cell.copyFieldPath')!;
    await act(async () => { copyPath.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('name');
  });

  it('shift+cmd+c copies full document', async () => {
    const svc = new KeyboardService();
    const doc = { name: 'alice', age: 30 };
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const copyDoc = svc.getAll().find((s) => s.id === 'cell.copyDocument')!;
    await act(async () => { copyDoc.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(doc, null, 2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: FAIL — `Cannot find module '../hooks/useCellShortcuts'`

- [ ] **Step 3: Implement `useCellShortcuts`**

Create `src/hooks/useCellShortcuts.ts`:

```typescript
import { useCellSelection } from '../contexts/CellSelectionContext';
import { useKeyboard } from './useKeyboard';
import { keyboardService, type KeyboardService } from '../services/KeyboardService';

export function useCellShortcuts(svc: KeyboardService = keyboardService): void {
  const { selected } = useCellSelection();

  useKeyboard({
    id: 'cell.copyValue',
    keys: { cmd: true, key: 'c' },
    label: 'Copy Value',
    showInContextMenu: true,
    action: () => {
      if (!selected) return;
      navigator.clipboard.writeText(String(selected.value));
    },
  }, svc);

  useKeyboard({
    id: 'cell.copyField',
    keys: { ctrl: true, cmd: true, key: 'c' },
    label: 'Copy Field',
    showInContextMenu: true,
    action: () => {
      if (!selected) return;
      navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
    },
  }, svc);

  useKeyboard({
    id: 'cell.copyFieldPath',
    keys: { shift: true, alt: true, cmd: true, key: 'c' },
    label: 'Copy Field Path',
    showInContextMenu: true,
    action: () => {
      if (!selected) return;
      navigator.clipboard.writeText(selected.colKey);
    },
  }, svc);

  useKeyboard({
    id: 'cell.copyDocument',
    keys: { shift: true, cmd: true, key: 'c' },
    label: 'Copy Document',
    showInContextMenu: true,
    action: () => {
      if (!selected) return;
      navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
    },
  }, svc);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/cell-selection-context.test.tsx
```

Expected: All tests PASS (3 original + 6 new = 9 total)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCellShortcuts.ts
git commit -m "feat(table): add useCellShortcuts hook with 4 copy actions"
```

---

## Task 6: TableView modifications

**Files:**
- Modify: `src/components/results/TableView.tsx`
- Create: `src/__tests__/table-view-selection.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/table-view-selection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableView } from '../components/results/TableView';
import { CellSelectionProvider } from '../contexts/CellSelectionContext';
import { KeyboardService } from '../services/KeyboardService';
import type { ReactNode } from 'react';

const docs = [{ name: 'alice', age: 30 }, { name: 'bob', age: 25 }];

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

function Wrapper({ children }: { children: ReactNode }) {
  return <CellSelectionProvider>{children}</CellSelectionProvider>;
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

  it('context menu closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/table-view-selection.test.tsx
```

Expected: FAIL — cells have no `aria-selected`, no context menu

- [ ] **Step 3: Rewrite `TableView`**

Replace the full content of `src/components/results/TableView.tsx`:

```typescript
import { useRef, useMemo, useState, useCallback } from 'react';
import { InlineCell } from './InlineCell';
import { renderCell, cellEditString } from './cellRenderers';
import { useCellSelection } from '../../contexts/CellSelectionContext';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { keyboardService, formatKeyCombo } from '../../services/KeyboardService';

interface Props {
  docs: unknown[];
  onEditCell?: (rowIdx: number, key: string, newValue: string) => void;
  onDelete?: (rowIdx: number) => void;
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

export function TableView({ docs, onEditCell, onDelete }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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

  const contextMenuItems: ContextMenuItem[] = keyboardService
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
      onKeyDown={(e) => keyboardService.dispatch(e.nativeEvent)}
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
            {onDelete && <th />}
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
                    {onEditCell ? (
                      <InlineCell
                        value={cellEditString(raw)}
                        onSave={(next) => {
                          const cur = cellEditString(raw);
                          if (next !== cur) onEditCell(i, c, next);
                        }}
                      />
                    ) : (
                      renderCell(raw)
                    )}
                  </td>
                );
              })}
              {onDelete && (
                <td style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}>
                  <button onClick={() => onDelete(i)} title="Delete row">🗑</button>
                </td>
              )}
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

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/table-view-selection.test.tsx
```

Expected: All 5 tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All existing tests PASS (the only change to TableView is additive — new props are optional, old markup is preserved)

- [ ] **Step 6: Commit**

```bash
git add src/components/results/TableView.tsx src/__tests__/table-view-selection.test.tsx
git commit -m "feat(table): add cell selection, keyboard dispatch, and context menu to TableView"
```

---

## Task 7: ResultsPanel modifications

**Files:**
- Modify: `src/components/results/ResultsPanel.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/__tests__/results-panel.test.tsx`:

```typescript
import { useResultsStore } from '../store/results';

describe('ResultsPanel cell shortcuts integration', () => {
  beforeEach(() => {
    useResultsStore.setState({ byTab: {} });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('clicking a table cell and pressing Cmd+C copies the value', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ city: 'Tokyo' }] }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
    await user.click(cell);
    await user.keyboard('{Meta>}c{/Meta}');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Tokyo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/results-panel.test.tsx
```

Expected: FAIL — `useCellSelection must be used inside CellSelectionProvider`

- [ ] **Step 3: Modify ResultsPanel**

In `src/components/results/ResultsPanel.tsx`, add these imports at the top:

```typescript
import { CellSelectionProvider } from '../../contexts/CellSelectionContext';
import { useCellShortcuts } from '../../hooks/useCellShortcuts';
```

Add this component just above `ResultsPanel`:

```typescript
function CellShortcutsRegistrar() {
  useCellShortcuts();
  return null;
}
```

Wrap the entire return value of `ResultsPanel` (both the early-return and the main return) with `<CellSelectionProvider>`:

Replace the early return:
```typescript
// BEFORE:
if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError && !res.pagination)) {
  return (
    <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
      Run a script to see results.
    </div>
  );
}

// AFTER:
if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError && !res.pagination)) {
  return (
    <CellSelectionProvider>
      <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
        Run a script to see results.
      </div>
    </CellSelectionProvider>
  );
}
```

Replace the main return:
```typescript
// BEFORE:
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    ...
  </div>
);

// AFTER:
return (
  <CellSelectionProvider>
    <CellShortcutsRegistrar />
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      ...
    </div>
  </CellSelectionProvider>
);
```

- [ ] **Step 4: Run the new test**

```bash
npx vitest run src/__tests__/results-panel.test.tsx
```

Expected: All tests PASS (including the new integration test)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/results/ResultsPanel.tsx
git commit -m "feat(table): wire CellSelectionProvider and useCellShortcuts into ResultsPanel"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Click to select cell → Task 6 (`handleCellClick`, `aria-selected`, selection highlight style)
- ✅ KeyboardService singleton + registry → Task 1
- ✅ `useKeyboard` hook → Task 2
- ✅ `formatKeyCombo` utility → Task 1
- ✅ `CellSelectionContext` → Task 3
- ✅ `useCellShortcuts` with 4 shortcuts → Task 5
- ✅ `ContextMenu` component → Task 4
- ✅ Right-click opens context menu → Task 6 (`handleCellContextMenu`)
- ✅ Context menu items from `KeyboardService.getAll()` → Task 6 (`contextMenuItems`)
- ✅ `CellSelectionProvider` in `ResultsPanel` → Task 7
- ✅ `navigator.clipboard.writeText` for clipboard → Task 5
- ✅ `tabIndex={0}` + `onKeyDown` dispatch → Task 6
- ✅ Auto-focus container on cell select → Task 6 (`containerRef.current?.focus()`)

**Placeholder scan:** No TBDs, TODOs, or "similar to task N" references found.

**Type consistency check:**
- `SelectedCell` defined in Task 3, used in Task 5 (`useCellShortcuts`) and Task 6 (`handleCellClick`) ✅
- `ShortcutDef.keys: KeyCombo` defined in Task 1, used in `formatKeyCombo` call in Task 6 ✅
- `ContextMenuItem` defined in Task 4, imported in Task 6 ✅
- `keyboardService` singleton exported from Task 1, used in Tasks 2, 5, 6 ✅
- `useCellSelection()` defined in Task 3, used in Tasks 5 and 6 ✅
