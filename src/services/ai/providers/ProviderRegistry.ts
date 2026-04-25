import type { AIConfig, AIProvider } from './AIProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

/**
 * Factory signature used by the registry — a provider is built from AIConfig
 * at the point of use so runtime config changes (new baseUrl, new token)
 * produce a fresh client without a global reset.
 */
export type ProviderFactory = (config: AIConfig) => AIProvider;

/**
 * Built-in provider name for the OpenAI-compatible backend.
 * External code should reference this constant instead of the raw string.
 */
export const OPENAI_COMPATIBLE = 'openai-compatible';

/**
 * Registry of AI provider factories keyed by name.
 *
 * To add a new provider variant:
 *   1. Implement the AIProvider interface (see AIProvider.ts).
 *   2. Call `providerRegistry.register('my-provider', cfg => new MyProvider(cfg))`.
 * No other code needs to change — AIService reads from this registry.
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(name: string, factory: ProviderFactory): void {
    this.factories.set(name, factory);
  }

  /**
   * Build a provider instance by name using the given config.
   * Throws if the name is not registered.
   */
  get(name: string, config: AIConfig): AIProvider {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(
        `Unknown AI provider: "${name}". Registered providers: ${this.listNames().join(', ') || '(none)'}`,
      );
    }
    return factory(config);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  listNames(): string[] {
    return Array.from(this.factories.keys());
  }
}

/** Shared registry instance with built-in providers pre-registered. */
export const providerRegistry = new ProviderRegistry();

providerRegistry.register(
  OPENAI_COMPATIBLE,
  (config) => new OpenAICompatibleProvider(config),
);
