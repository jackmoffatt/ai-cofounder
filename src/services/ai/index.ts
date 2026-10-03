import "server-only";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider } from "./fake";
import type { AIProvider } from "./types";

export * from "./types";
export { modelFor, type ModelRole } from "./models";

let provider: AIProvider | undefined;

/** The one place that chooses a provider. Add new providers here. */
export function getProvider(): AIProvider {
  if (!provider) {
    switch (process.env.AI_PROVIDER ?? "anthropic") {
      case "fake":
        provider = new FakeProvider({ delayMs: 15 });
        break;
      case "anthropic":
        provider = new AnthropicProvider();
        break;
      default:
        throw new Error(`Unknown AI_PROVIDER "${process.env.AI_PROVIDER}"`);
    }
  }
  return provider;
}
