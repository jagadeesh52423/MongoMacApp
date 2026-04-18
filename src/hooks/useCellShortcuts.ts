import { useCellSelection } from '../contexts/CellSelectionContext';
import { useKeyboard } from './useKeyboard';
import { keyboardService, type KeyboardService } from '../services/KeyboardService';

interface CellShortcutsOptions {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}

export function useCellShortcuts(
  svc: KeyboardService = keyboardService,
  options?: CellShortcutsOptions,
): void {
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

  useKeyboard({
    id: 'cell.viewRecord',
    keys: { key: 'F3' },
    label: 'View Full Record',
    showInContextMenu: true,
    action: () => {
      if (!selected) return;
      options?.onViewRecord?.(selected.doc);
    },
  }, svc);

  useKeyboard({
    id: 'cell.editRecord',
    keys: { key: 'F4' },
    label: 'Edit Full Record',
    showInContextMenu: false,
    action: () => {
      if (!selected) return;
      options?.onEditRecord?.(selected.doc);
    },
  }, svc);
}
