/**
 * Shared types for the RAG core. No runtime dependencies — safe to import
 * from Node scripts, the CLI, or a Cloudflare Worker.
 */

export type SourceType = "study" | "influencer";

/** A slice of source text with enough metadata to attribute and rank it. */
export interface Chunk {
  text: string;
  sourceType: SourceType;
  /** Filename (without extension) the chunk came from. */
  sourceName: string;
}

/** A chunk plus its embedding vector, as stored in index.json. */
export interface IndexEntry extends Chunk {
  embedding: number[];
}

/**
 * The full index.json artifact. Metadata records the values that must match
 * production (embedding model, chunking params) so a mismatched index fails
 * loudly instead of silently returning garbage similarity scores.
 */
export interface RagIndex {
  embeddingModel: string;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  builtAt: string;
  entries: IndexEntry[];
}

/** A retrieved chunk with its cosine similarity to the query. */
export interface ScoredChunk extends Chunk {
  score: number;
}
