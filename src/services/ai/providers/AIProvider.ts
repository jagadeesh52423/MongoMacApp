/**
 * Core AI provider abstraction (Strategy Pattern).
 *
 * To add a new AI backend (e.g. Anthropic native, Google, Ollama, etc.),
 * implement this interface and register the implementation with
 * `providerRegistry` (see ProviderRegistry.ts). No other layer needs to change.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string;
  usage?: ChatUsage;
}

/**
 * Provider-agnostic configuration passed to provider constructors.
 * Matches the AIConfig stored in the settings layer.
 */
export interface AIConfig {
  baseUrl: string;
  apiToken: string;
  model: string;
  streaming: boolean;
}

/**
 * Implement this interface to add a new AI provider variant.
 * Register the implementation in `ProviderRegistry.ts`.
 *
 * Both methods accept an optional AbortSignal so callers can cancel an
 * in-flight request (e.g. user closes the chat panel during streaming).
 * Implementations should forward the signal to their underlying HTTP client
 * and surface the abort as a rejected promise / thrown AbortError.
 */
export interface AIProvider {
  /** Non-streaming chat completion. Returns the full response at once. */
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  /** Streaming chat completion. Yields content chunks as they arrive. */
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<string>;
}
