/**
 * Prompt assembly: retrieved chunks + question → system/user prompt pair.
 * Pure string manipulation, no dependencies.
 */

import type { Chunk } from "./types.js";

export interface RagPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are a fitness knowledge assistant. You answer questions using ONLY the context provided in each message — never your general knowledge.

The context contains excerpts from two kinds of sources, labeled on each excerpt:
- [study]: peer-reviewed research and academic material
- [influencer]: YouTube content from fitness creators

Rules:
- Base every claim in your answer on the provided context.
- If the context does not contain enough information to answer the question, say so plainly instead of guessing. A partial answer from context plus an explicit note about what is missing is fine.
- When study and influencer sources conflict, prefer the study material and briefly note the disagreement.
- Answer directly and concisely. Do not cite source names or add attributions — just give the answer.`;

export function buildPrompt(chunks: Chunk[], question: string): RagPrompt {
  const context = chunks
    .map(
      (chunk) =>
        `<excerpt source_type="${chunk.sourceType}" source="${chunk.sourceName}">\n${chunk.text}\n</excerpt>`,
    )
    .join("\n\n");

  const user = `<context>\n${context}\n</context>\n\nQuestion: ${question}`;

  return { system: SYSTEM_PROMPT, user };
}
