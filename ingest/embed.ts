/**
 * Batch document embedding via Voyage, with rate-limit retry.
 * Offline ingestion only — the query-time path lives in core/search.ts.
 *
 * Voyage accounts without a payment method are capped at 3 requests/min and
 * 10K tokens/min. Set VOYAGE_FREE_TIER=1 to pace requests under those caps
 * (a full rebuild of a ~300K-token corpus takes ~35 minutes).
 */

import { embedTexts, VoyageApiError } from "../core/search.js";

/** Must match the production LiftingTracker value — vectors are not compatible across models. */
export const EMBEDDING_MODEL = "voyage-4";

const BATCH_SIZE = 128;
const MAX_ATTEMPTS = 5;

// Free-tier caps (no payment method on the Voyage account).
const FREE_TIER_TPM = 10_000;
const FREE_TIER_MIN_REQUEST_GAP_MS = 21_000; // 3 RPM
// Estimated-token budget per request under free tier, with margin for the
// 4-chars/token estimate undercounting.
const FREE_TIER_BATCH_TOKENS = 8_000;

export interface EmbedDocumentsOptions {
  model?: string;
  /** Pace requests to stay under the no-payment-method rate limits. */
  freeTier?: boolean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatchWithRetry(
  texts: string[],
  apiKey: string,
  model: string,
  freeTier: boolean,
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
      // Under free tier the TPM window needs a real pause to drain, so back
      // off much harder than the standard-tier default.
      const baseMs = freeTier ? 20_000 : 1_000;
      const delayMs = 2 ** attempt * baseMs + Math.random() * 500;
      console.warn(
        `Voyage ${error.status}; retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Group texts into batches bounded by count and (optionally) estimated tokens. */
function buildBatches(texts: string[], maxTokens: number | null): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchTokens = 0;
  for (const text of texts) {
    const tokens = estimateTokens(text);
    const overCount = batch.length >= BATCH_SIZE;
    const overTokens = maxTokens !== null && batchTokens + tokens > maxTokens;
    if (batch.length > 0 && (overCount || overTokens)) {
      batches.push(batch);
      batch = [];
      batchTokens = 0;
    }
    batch.push(text);
    batchTokens += tokens;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Embed all texts as documents, batching, retrying, and pacing as needed. */
export async function embedDocuments(
  texts: string[],
  apiKey: string,
  opts: EmbedDocumentsOptions = {},
): Promise<number[][]> {
  const model = opts.model ?? EMBEDDING_MODEL;
  const freeTier = opts.freeTier ?? false;

  const batches = buildBatches(texts, freeTier ? FREE_TIER_BATCH_TOKENS : null);
  if (freeTier) {
    const totalTokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0);
    const etaMin = Math.ceil((totalTokens / FREE_TIER_TPM) * 1.2);
    console.log(
      `Free-tier pacing enabled: ${batches.length} requests, ~${etaMin} min estimated`,
    );
  }

  const vectors: number[][] = [];
  let embedded = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const started = Date.now();
    const batchVectors = await embedBatchWithRetry(batch, apiKey, model, freeTier);
    vectors.push(...batchVectors);
    embedded += batch.length;
    console.log(`Embedded ${embedded}/${texts.length} chunks (request ${i + 1}/${batches.length})`);

    if (freeTier && i < batches.length - 1) {
      // Wait long enough for the TPM window to admit the next batch, and
      // never faster than 3 requests/min.
      const batchTokens = batch.reduce((sum, t) => sum + estimateTokens(t), 0);
      const tpmWaitMs = (batchTokens / FREE_TIER_TPM) * 60_000 * 1.2;
      const waitMs = Math.max(FREE_TIER_MIN_REQUEST_GAP_MS, tpmWaitMs) - (Date.now() - started);
      if (waitMs > 0) await sleep(waitMs);
    }
  }
  return vectors;
}
