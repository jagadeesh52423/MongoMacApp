import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editor';
import type { EditorTab } from '../types';
import { useKeyboardService, type KeyCombo } from '../services/KeyboardService';
import { newScriptTab } from '../utils/newScriptTab';

interface TabActionState {
  tabs: EditorTab[];
  activeTabId: string | null;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  openTab: (tab: EditorTab) => void;
}

interface TabActionDef {
  id: string;
  keys: KeyCombo;
  label: string;
  execute: (state: TabActionState) => void;
}

const TAB_INDEX_COUNT = 9;

const ALL_ACTIONS: TabActionDef[] = [
  {
    id: 'tab.next',
    keys: { ctrl: true, key: 'Tab' },
    label: 'Next Tab',
    execute: ({ tabs, activeTabId, setActive }) => {
      if (tabs.length === 0 || activeTabId === null) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      setActive(tabs[(idx + 1) % tabs.length].id);
    },
  },
  {
    id: 'tab.prev',
    keys: { ctrl: true, shift: true, key: 'Tab' },
    label: 'Previous Tab',
    execute: ({ tabs, activeTabId, setActive }) => {
      if (tabs.length === 0 || activeTabId === null) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      setActive(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    },
  },
  {
    id: 'tab.close',
    keys: { ctrl: true, key: 'w' },
    label: 'Close Tab',
    execute: ({ activeTabId, closeTab }) => {
      if (activeTabId === null) return;
      closeTab(activeTabId);
    },
  },
  {
    id: 'tab.new',
    keys: { ctrl: true, key: 't' },
    label: 'New Tab',
    execute: ({ openTab }) => {
      openTab(newScriptTab());
    },
  },
  ...Array.from({ length: TAB_INDEX_COUNT }, (_, i): TabActionDef => {
    const n = i + 1;
    return {
      id: `tab.goTo.${n}`,
      keys: { ctrl: true, key: String(n) },
      label: `Go to Tab ${n}`,
      execute: ({ tabs, setActive }) => {
        const target = tabs[n - 1];
        if (target) setActive(target.id);
      },
    };
  }),
];

export function useTabActions(): void {
  const svc = useKeyboardService();
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const openTab = useEditorStore((s) => s.openTab);

  const stateRef = useRef<TabActionState>({ tabs, activeTabId, setActive, closeTab, openTab });
  stateRef.current = { tabs, activeTabId, setActive, closeTab, openTab };

  useEffect(() => {
    const unregisters = ALL_ACTIONS.map((def) =>
      svc.register({
        id: def.id,
        keys: def.keys,
        label: def.label,
        action: () => def.execute(stateRef.current),
      }),
    );
    return () => unregisters.forEach((fn) => fn());
  }, [svc]);
}
