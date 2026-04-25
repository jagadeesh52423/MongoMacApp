import type { ChatRole } from './providers/AIProvider';

/**
 * A single turn in an AI conversation, stored in memory per editor tab.
 * `error` is set on assistant messages whose generation failed, so the UI
 * can render a retry affordance.
 */
export interface ChatMessage {
  role: Exclude<ChatRole, 'system'>; // system messages are built fresh each send
  content: string;
  timestamp: number;
  error?: string;
}

/**
 * Per-tab chat history store (singleton).
 *
 * History is intentionally in-memory only — it is lost when the tab closes
 * or the app restarts, matching the spec's "zero persisted chat history"
 * requirement. The AIStore (Zustand) mirrors this for UI reactivity; this
 * class is the authoritative service-layer source used by AIService so the
 * service layer does not depend on the UI store.
 */
export class ChatHistoryManager {
  private readonly historyByTab = new Map<string, ChatMessage[]>();

  /** Return a shallow copy of the history for a tab (never the internal array). */
  getHistory(tabId: string): ChatMessage[] {
    const history = this.historyByTab.get(tabId);
    return history ? [...history] : [];
  }

  /** Append a message to a tab's history. Creates the history if absent. */
  addMessage(tabId: string, message: ChatMessage): void {
    const existing = this.historyByTab.get(tabId);
    if (existing) {
      existing.push(message);
    } else {
      this.historyByTab.set(tabId, [message]);
    }
  }

  /** Clear messages for a tab but keep the tab registered. */
  clearHistory(tabId: string): void {
    this.historyByTab.set(tabId, []);
  }

  /** Drop a tab entirely — called when the editor tab is closed. */
  removeTab(tabId: string): void {
    this.historyByTab.delete(tabId);
  }

  /** Diagnostic helper. */
  hasHistory(tabId: string): boolean {
    const h = this.historyByTab.get(tabId);
    return !!h && h.length > 0;
  }
}

/** Shared service-layer singleton. UI code generally talks to the AIStore instead. */
export const chatHistoryManager = new ChatHistoryManager();
