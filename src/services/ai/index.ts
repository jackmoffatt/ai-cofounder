import "server-only";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider } from "./fake";
import type { AIProvider, ChatRequest } from "./types";

export * from "./types";
export { modelFor, type ModelRole } from "./models";

/** Dev-only stand-in for the extraction model: understands "my name is X" and "I only have N hours a week". */
function fakeExtraction(req: ChatRequest) {
  const text = /<message>\n([\s\S]*)\n<\/message>/.exec(req.messages[0]?.content ?? "")?.[1] ?? "";
  const updates: Array<{ field: string; value: string; evidence: string }> = [];
  const name = /my name is (\w+)/i.exec(text);
  if (name) updates.push({ field: "name", value: name[1], evidence: name[0] });
  const time = /I (?:only )?have (\d+ hours a week)/i.exec(text);
  if (time) updates.push({ field: "constraints", value: time[1], evidence: time[0] });
  return { updates };
}

let provider: AIProvider | undefined;

/** The one place that chooses a provider. Add new providers here. */
export function getProvider(): AIProvider {
  if (!provider) {
    switch (process.env.AI_PROVIDER ?? "anthropic") {
      case "fake":
        provider = new FakeProvider({ delayMs: 15, structuredResult: fakeExtraction });
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
