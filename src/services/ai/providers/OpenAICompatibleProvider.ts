import OpenAI from 'openai';
import type { AIConfig, AIProvider, ChatRequest, ChatResponse } from './AIProvider';

/**
 * Default temperature when the caller doesn't specify one.
 * Matches the value documented in the design spec.
 */
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Provider implementation backed by the official `openai` SDK.
 *
 * Works with any API that exposes an OpenAI-compatible `/v1/chat/completions`
 * endpoint (OpenAI itself, Ollama, vLLM, LM Studio, Azure OpenAI, etc.)
 * The caller selects the backend by passing the right `baseUrl` in AIConfig.
 *
 * Note: `dangerouslyAllowBrowser: true` is required because this app is a
 * Tauri desktop shell — requests originate from the renderer, not a server.
 * The API token is stored locally by the user and never transmitted anywhere
 * except the configured baseUrl.
 */
export class OpenAICompatibleProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiToken,
      dangerouslyAllowBrowser: true,
    });
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        stream: false,
      },
      // The openai SDK accepts an `{ signal }` request-option argument that it
      // forwards to the underlying fetch — this is how cancellation is wired
      // on both the HTTP request and any pending server response parsing.
      { signal },
    );

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined;

    return { content, usage };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        stream: true,
      },
      { signal },
    );

    for await (const chunk of stream) {
      // Cooperative cancellation: if the caller aborts while chunks are still
      // in flight, stop yielding. The SDK should also reject on the next
      // network read, but this bails out immediately and cleanly.
      if (signal?.aborted) break;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** Expose the config the provider was built with (useful for diagnostics / test-connection). */
  getConfig(): AIConfig {
    return this.config;
  }
}
