/**
 * Standalone query entry point — the test harness that a Worker route
 * replaces at integration time.
 *
 *   npm run ask -- "how much protein per day for hypertrophy?"
 *   npm run ask            (interactive loop)
 *
 * Set RAG_DEBUG=1 to print the retrieved chunks and scores to stderr.
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { answer, DEFAULT_ANSWER_MODEL } from "./core/answer.js";
import { buildPrompt } from "./core/prompt.js";
import { search } from "./core/search.js";
import type { RagIndex } from "./core/types.js";

const INDEX_PATH = path.resolve(import.meta.dirname, "index.json");
const TOP_K = 6;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function loadIndex(): Promise<RagIndex> {
  try {
    return JSON.parse(await readFile(INDEX_PATH, "utf8")) as RagIndex;
  } catch {
    console.error(`Could not read ${INDEX_PATH} — run \`npm run build-index\` first.`);
    process.exit(1);
  }
}

async function ask(
  index: RagIndex,
  question: string,
  keys: { voyage: string; anthropic: string },
): Promise<void> {
  const chunks = await search(index, question, {
    apiKey: keys.voyage,
    k: TOP_K,
  });

  if (process.env.RAG_DEBUG) {
    for (const chunk of chunks) {
      console.error(
        `[${chunk.score.toFixed(3)}] [${chunk.sourceType}] ${chunk.sourceName}: ${chunk.text.slice(0, 80).replace(/\n/g, " ")}...`,
      );
    }
  }

  await answer(buildPrompt(chunks, question), {
    apiKey: keys.anthropic,
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANSWER_MODEL,
    onText: (delta) => process.stdout.write(delta),
  });
  process.stdout.write("\n");
}

async function main() {
  const keys = {
    voyage: requireEnv("VOYAGE_API_KEY"),
    anthropic: requireEnv("ANTHROPIC_API_KEY"),
  };
  const index = await loadIndex();
  console.error(
    `Loaded index: ${index.entries.length} chunks, model ${index.embeddingModel}\n`,
  );

  const argQuestion = process.argv.slice(2).join(" ").trim();
  if (argQuestion) {
    await ask(index, argQuestion, keys);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  for (;;) {
    const question = (await rl.question("\nQ: ")).trim();
    if (!question || question === "exit" || question === "quit") break;
    await ask(index, question, keys);
  }
  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
