/**
 * Answer generation via the Anthropic SDK.
 *
 * The SDK is Workers-compatible, and nothing here reads process.env or the
 * filesystem — configuration comes in through AnswerOptions, so this lifts
 * into a Worker route unchanged.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { RagPrompt } from "./prompt.js";

export const DEFAULT_ANSWER_MODEL = "claude-opus-4-8";

export interface AnswerOptions {
  apiKey: string;
  /** Defaults to DEFAULT_ANSWER_MODEL. */
  model?: string;
  maxTokens?: number;
  /** Optional callback for streaming text deltas as they arrive. */
  onText?: (delta: string) => void;
}

/** Call Claude with an assembled RAG prompt and return the text answer. */
export async function answer(
  prompt: RagPrompt,
  opts: AnswerOptions,
): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });

  const stream = client.messages.stream({
    model: opts.model ?? DEFAULT_ANSWER_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  if (opts.onText) {
    stream.on("text", opts.onText);
  }

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to answer this request.");
  }

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
