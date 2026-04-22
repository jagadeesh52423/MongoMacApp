import { create } from 'zustand';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  error?: string;
}

interface AIState {
  panelOpen: boolean;
  chatHistories: Map<string, ChatMessage[]>;
  loadingStates: Map<string, boolean>;
  setPanelOpen: (open: boolean) => void;
  addMessage: (tabId: string, msg: ChatMessage) => void;
  /**
   * Patch the most recent message in a tab's history. Used by the streaming
   * send path to update an in-progress assistant bubble as tokens arrive.
   * No-op if the tab has no history yet.
   */
  updateLastMessage: (tabId: string, patch: Partial<ChatMessage>) => void;
  clearHistory: (tabId: string) => void;
  removeTab: (tabId: string) => void;
  setLoading: (tabId: string, loading: boolean) => void;
}

export const useAIStore = create<AIState>((set) => ({
  panelOpen: false,
  chatHistories: new Map(),
  loadingStates: new Map(),
  setPanelOpen: (open) => set({ panelOpen: open }),
  addMessage: (tabId, msg) =>
    set((s) => {
      const next = new Map(s.chatHistories);
      const existing = next.get(tabId) ?? [];
      next.set(tabId, [...existing, msg]);
      return { chatHistories: next };
    }),
  updateLastMessage: (tabId, patch) =>
    set((s) => {
      const history = s.chatHistories.get(tabId);
      if (!history || history.length === 0) return s;
      const next = new Map(s.chatHistories);
      const updated = history.slice();
      updated[updated.length - 1] = { ...updated[updated.length - 1], ...patch };
      next.set(tabId, updated);
      return { chatHistories: next };
    }),
  clearHistory: (tabId) =>
    set((s) => {
      const next = new Map(s.chatHistories);
      next.set(tabId, []);
      return { chatHistories: next };
    }),
  removeTab: (tabId) =>
    set((s) => {
      const nextHistories = new Map(s.chatHistories);
      nextHistories.delete(tabId);
      const nextLoading = new Map(s.loadingStates);
      nextLoading.delete(tabId);
      return { chatHistories: nextHistories, loadingStates: nextLoading };
    }),
  setLoading: (tabId, loading) =>
    set((s) => {
      const next = new Map(s.loadingStates);
      if (loading) {
        next.set(tabId, true);
      } else {
        next.delete(tabId);
      }
      return { loadingStates: next };
    }),
}));
