import { ContextCollector } from './ContextCollector';
import { chatHistoryManager, ChatHistoryManager, type ChatMessage } from './ChatHistoryManager';
import type {
  AIConfig,
  AIProvider,
  ChatMessage as ProviderChatMessage,
  ChatResponse,
} from './providers/AIProvider';
import { OPENAI_COMPATIBLE, providerRegistry, ProviderRegistry } from './providers/ProviderRegistry';

/** Default system prompt preamble — concatenated with the live context block. */
const SYSTEM_PROMPT_PREAMBLE =
  'You are an AI assistant embedded in MongoMacApp, a MongoDB GUI. ' +
  'Help the user understand queries, results, schema, and MongoDB in general. ' +
  'Be concise, correct, and prefer showing small, runnable query snippets when helpful.';

/** Options for a single sendMessage call. */
export interface SendMessageOptions {
  /** If true, stream chunks via the onChunk callback; otherwise return the full response. */
  streaming?: boolean;
  /** Chunk-by-chunk callback for streaming mode. */
  onChunk?: (chunk: string, accumulated: string) => void;
  /**
   * Cancellation signal. Forwarded to the provider, which forwards it to the
   * underlying fetch. When aborted mid-stream, whatever was accumulated so far
   * is still recorded in history with an `error` flag so the UI can offer
   * Edit & Retry.
   */
  signal?: AbortSignal;
}

/** Result returned by sendMessage once the full response is available. */
export interface SendMessageResult {
  content: string;
  usage?: ChatResponse['usage'];
}

/**
 * Orchestrates chat turns:
 *   1. Collect context from editor / results / connection / schema.
 *   2. Build the provider's message array (system + history + user).
 *   3. Call provider.chat() or provider.streamChat() per caller preference.
 *   4. Append both the user and assistant messages to tab history.
 *
 * The active provider is rebuilt per call from the current AIConfig so
 * the user can change settings at runtime without a service reset.
 */
export class AIService {
  private readonly contextCollector: ContextCollector;
  private readonly historyManager: ChatHistoryManager;
  private readonly registry: ProviderRegistry;
  private providerName: string;
  private config: AIConfig | null;

  constructor(params?: {
    contextCollector?: ContextCollector;
    historyManager?: ChatHistoryManager;
    registry?: ProviderRegistry;
    providerName?: string;
    config?: AIConfig;
  }) {
    this.contextCollector = params?.contextCollector ?? new ContextCollector();
    this.historyManager = params?.historyManager ?? chatHistoryManager;
    this.registry = params?.registry ?? providerRegistry;
    this.providerName = params?.providerName ?? OPENAI_COMPATIBLE;
    this.config = params?.config ?? null;
  }

  /** Update the AI backend config (called when user saves settings). */
  setConfig(config: AIConfig): void {
    this.config = config;
  }

  getConfig(): AIConfig | null {
    return this.config;
  }

  /** Change the active provider strategy (e.g. 'openai-compatible' → 'anthropic'). */
  setProviderName(name: string): void {
    this.providerName = name;
  }

  /** Access to the underlying history manager for UI/store synchronization. */
  getHistoryManager(): ChatHistoryManager {
    return this.historyManager;
  }

  /**
   * Send a user message on behalf of the given tab and return the assistant reply.
   *
   * Streaming is selected via `options.streaming` (falls back to config.streaming,
   * then to true). In streaming mode, `options.onChunk` is invoked for each chunk
   * and the final accumulated content is returned as well.
   *
   * On failure, an assistant message with an `error` field is appended to history
   * so the UI can render an "Edit & Retry" affordance, and the error re-throws.
   */
  async sendMessage(
    tabId: string,
    userMessage: string,
    options: SendMessageOptions = {},
  ): Promise<SendMessageResult> {
    if (!this.config) {
      throw new Error('AI is not configured. Please set baseUrl, apiToken, and model in Settings.');
    }

    const provider: AIProvider = this.registry.get(this.providerName, this.config);

    // 1. Record the user turn first so it shows up in history even if generation fails.
    const userTurn: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    this.historyManager.addMessage(tabId, userTurn);

    // 2. Build the provider message array: [system, ...history, user].
    // NOTE: history already contains the just-appended user turn, so we don't
    // re-append it separately.
    const contextBlock = await this.contextCollector.collectAll();
    const systemContent = contextBlock
      ? `${SYSTEM_PROMPT_PREAMBLE}\n\n${contextBlock}`
      : SYSTEM_PROMPT_PREAMBLE;

    const messages: ProviderChatMessage[] = [
      { role: 'system', content: systemContent },
      ...this.historyManager.getHistory(tabId).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // 3. Dispatch to streaming or non-streaming path.
    const shouldStream = options.streaming ?? this.config.streaming ?? true;

    // Preserve any partially-streamed content so cancellations leave a
    // meaningful breadcrumb in history (not a blank assistant turn).
    let accumulated = '';
    try {
      let content: string;
      let usage: ChatResponse['usage'];

      if (shouldStream) {
        accumulated = await this.consumeStream(
          provider.streamChat({ messages, model: this.config.model }, options.signal),
          options.onChunk,
        );
        content = accumulated;
      } else {
        const response = await provider.chat(
          { messages, model: this.config.model },
          options.signal,
        );
        content = response.content;
        usage = response.usage;
      }

      this.historyManager.addMessage(tabId, {
        role: 'assistant',
        content,
        timestamp: Date.now(),
      });

      return { content, usage };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.historyManager.addMessage(tabId, {
        role: 'assistant',
        // Keep whatever streamed through before the abort/error so the UI
        // can render the partial response alongside the error indicator.
        content: accumulated,
        timestamp: Date.now(),
        error: errorMessage,
      });
      throw err;
    }
  }

  private async consumeStream(
    stream: AsyncGenerator<string>,
    onChunk?: (chunk: string, accumulated: string) => void,
  ): Promise<string> {
    let accumulated = '';
    for await (const chunk of stream) {
      accumulated += chunk;
      onChunk?.(chunk, accumulated);
    }
    return accumulated;
  }
}

/**
 * Shared service-layer singleton. Configured by the settings layer at startup
 * (and whenever the user updates AI settings) via `aiService.setConfig(...)`.
 */
export const aiService = new AIService();
