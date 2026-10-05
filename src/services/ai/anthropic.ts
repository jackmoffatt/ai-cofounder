import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import { AIError, type AIProvider, type ChatEvent, type ChatMessage, type ChatRequest, type StopReason, type Usage } from "./types";

function mapStopReason(reason: string | null | undefined): StopReason {
  if (reason === "end_turn" || reason === "max_tokens" || reason === "refusal" || reason === "tool_use") return reason;
  return "other";
}

/** App messages to API messages. An assistant turn with native content is replayed exactly as received. */
function toApiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.native) return { role: "assistant" as const, content: m.native as never };
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: m.content.map((p) =>
        p.type === "text"
          ? { type: "text" as const, text: p.text }
          : p.type === "tool_use"
            ? { type: "tool_use" as const, id: p.id, name: p.name, input: p.input }
            : { type: "tool_result" as const, tool_use_id: p.toolUseId, content: p.content, ...(p.isError ? { is_error: true } : {}) },
      ),
    };
  }) as never;
}

const toApiTools = (tools: ChatRequest["tools"]) =>
  tools?.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as never })) : undefined;

function mapError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AIError("aborted");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth");
  }
  if (err instanceof Anthropic.RateLimitError) return new AIError("rate_limited");
  if (err instanceof Anthropic.BadRequestError) return new AIError("bad_request");
  if (err instanceof Anthropic.APIConnectionError) return new AIError("unavailable");
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return new AIError("unavailable");
  return new AIError("unknown");
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) throw new AIError("missing_key");
    return (this.client ??= new Anthropic());
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      // Beta endpoint so a safety-classifier decline is retried server-side on a fallback model
      // instead of surfacing as a refusal (Anthropic's recommended default for current models).
      const stream = this.getClient().beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: toApiMessages(req.messages),
          ...(toApiTools(req.tools) ? { tools: toApiTools(req.tools) } : {}),
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      for (const block of final.content) {
        if (block.type === "tool_use") yield { type: "tool_call", id: block.id, name: block.name, input: block.input };
      }
      yield {
        type: "done",
        native: final.stop_reason === "tool_use" ? final.content : undefined,
        stopReason: mapStopReason(final.stop_reason),
        usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
        model: final.model,
      };
    } catch (err) {
      throw mapError(err);
    }
  }

  async complete(req: ChatRequest): Promise<{ text: string; usage: Usage }> {
    try {
      const res = await this.getClient().messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: toApiMessages(req.messages),
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
        },
        { signal: req.signal },
      );
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    } catch (err) {
      throw mapError(err);
    }
  }

  async structured<T>(req: ChatRequest, schema: ZodType<T>): Promise<{ data: T; usage: Usage }> {
    try {
      const res = await this.getClient().messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: toApiMessages(req.messages),
          output_config: { format: zodOutputFormat(schema as never), ...(req.effort ? { effort: req.effort } : {}) },
        },
        { signal: req.signal },
      );
      if (res.parsed_output == null) throw new AIError("unknown");
      return {
        data: res.parsed_output as T,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}
