/**
 * Query embedding + cosine top-k retrieval.
 *
 * Framework-free: uses global fetch (Node 18+, Cloudflare Workers). The index
 * is always passed in as an argument — this module never touches the
 * filesystem, so it lifts into a Worker untouched.
 */

import type { RagIndex, ScoredChunk } from "./types.js";

export const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

export interface EmbedOptions {
  apiKey: string;
  model: string;
}

/**
 * Embed a batch of texts via the Voyage REST API.
 * `inputType` matters for retrieval quality: "document" at ingest time,
 * "query" at search time.
 */
export async function embedTexts(
  texts: string[],
  inputType: "document" | "query",
  opts: EmbedOptions,
): Promise<number[][]> {
  const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: opts.model,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new VoyageApiError(response.status, body);
  }

  const json = (await response.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  // Voyage returns entries with an index field; sort defensively.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export class VoyageApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`Voyage API error ${status}: ${body}`);
    this.name = "VoyageApiError";
  }
}

export async function embedQuery(
  query: string,
  opts: EmbedOptions,
): Promise<number[]> {
  const [vector] = await embedTexts([query], "query", opts);
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch (${a.length} vs ${b.length}) — was the index built with a different embedding model?`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Pure top-k retrieval over an in-memory index. */
export function topK(
  index: RagIndex,
  queryVector: number[],
  k: number,
): ScoredChunk[] {
  return index.entries
    .map((entry) => ({
      text: entry.text,
      sourceType: entry.sourceType,
      sourceName: entry.sourceName,
      score: cosineSimilarity(queryVector, entry.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export interface SearchOptions {
  apiKey: string;
  /** Defaults to the model recorded in the index, guaranteeing compatibility. */
  model?: string;
  k?: number;
}

/** Embed the question and return the top-k most similar chunks. */
export async function search(
  index: RagIndex,
  question: string,
  opts: SearchOptions,
): Promise<ScoredChunk[]> {
  const queryVector = await embedQuery(question, {
    apiKey: opts.apiKey,
    model: opts.model ?? index.embeddingModel,
  });
  return topK(index, queryVector, opts.k ?? 6);
}
