/**
 * Batch document embedding via Voyage, with rate-limit retry.
 * Offline ingestion only — the query-time path lives in core/search.ts.
 */

import { embedTexts, VoyageApiError } from "../core/search.js";

/** Must match the production LiftingTracker value — vectors are not compatible across models. */
export const EMBEDDING_MODEL = "voyage-4";

const BATCH_SIZE = 128;
const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatchWithRetry(
  texts: string[],
  apiKey: string,
  model: string,
): Promise<number[][]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await embedTexts(texts, "document", { apiKey, model });
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof VoyageApiError &&
        (error.status === 429 || error.status >= 500);
      if (!retryable) throw error;
      const delayMs = 2 ** attempt * 1000 + Math.random() * 500;
      console.warn(
        `Voyage ${error.status}; retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Embed all texts as documents, batching and retrying as needed. */
export async function embedDocuments(
  texts: string[],
  apiKey: string,
  model: string = EMBEDDING_MODEL,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const batchVectors = await embedBatchWithRetry(batch, apiKey, model);
    vectors.push(...batchVectors);
    console.log(
      `Embedded ${Math.min(start + BATCH_SIZE, texts.length)}/${texts.length} chunks`,
    );
  }
  return vectors;
}
