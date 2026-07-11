/**
 * Offline index builder: read every file in data/sources/, chunk, embed,
 * write index.json. Run with `npm run build-index`.
 *
 * Source type is inferred from (in priority order):
 *   1. filename prefix:  study_*.txt / influencer_*.txt
 *   2. parent folder:    data/sources/studies/ / data/sources/influencers/
 * Files matching neither convention are skipped with a warning.
 */

import "dotenv/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { Chunk, RagIndex, SourceType } from "../core/types.js";
import { chunkText, CHUNK_OVERLAP_TOKENS, CHUNK_SIZE_TOKENS } from "./chunk.js";
import { embedDocuments, EMBEDDING_MODEL } from "./embed.js";

const SOURCES_DIR = path.resolve(import.meta.dirname, "../data/sources");
const INDEX_PATH = path.resolve(import.meta.dirname, "../index.json");

function inferSourceType(filePath: string): SourceType | null {
  const name = path.basename(filePath).toLowerCase();
  if (name.startsWith("study_")) return "study";
  if (name.startsWith("influencer_")) return "influencer";

  const parent = path.basename(path.dirname(filePath)).toLowerCase();
  if (parent.startsWith("stud")) return "study";
  if (parent.startsWith("influencer")) return "influencer";
  return null;
}

async function extractText(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".txt" || ext === ".md") {
    return readFile(filePath, "utf8");
  }
  if (ext === ".pdf") {
    const parsed = await pdfParse(await readFile(filePath));
    return parsed.text;
  }
  return null;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error("VOYAGE_API_KEY is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  const files = await listSourceFiles(SOURCES_DIR);
  const chunks: Chunk[] = [];

  for (const file of files) {
    const relative = path.relative(SOURCES_DIR, file);
    if (path.basename(file) === ".gitkeep") continue;

    const sourceType = inferSourceType(file);
    if (!sourceType) {
      console.warn(`Skipping ${relative}: cannot infer source type (use a study_/influencer_ prefix or studies/ influencers/ folder)`);
      continue;
    }

    const text = await extractText(file);
    if (text === null) {
      console.warn(`Skipping ${relative}: unsupported extension (expected .txt, .md, or .pdf)`);
      continue;
    }

    const sourceName = path.basename(file, path.extname(file));
    const fileChunks = chunkText(text, sourceType, sourceName);
    console.log(`${relative}: ${fileChunks.length} chunks [${sourceType}]`);
    chunks.push(...fileChunks);
  }

  if (chunks.length === 0) {
    console.error(`No chunks produced — add source files under ${SOURCES_DIR}`);
    process.exit(1);
  }

  console.log(`\nEmbedding ${chunks.length} chunks with ${EMBEDDING_MODEL}...`);
  const vectors = await embedDocuments(
    chunks.map((c) => c.text),
    apiKey,
  );

  const index: RagIndex = {
    embeddingModel: EMBEDDING_MODEL,
    chunkSizeTokens: CHUNK_SIZE_TOKENS,
    chunkOverlapTokens: CHUNK_OVERLAP_TOKENS,
    builtAt: new Date().toISOString(),
    entries: chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
  };

  await writeFile(INDEX_PATH, JSON.stringify(index));

  const studyCount = chunks.filter((c) => c.sourceType === "study").length;
  console.log(
    `\nWrote ${INDEX_PATH}: ${chunks.length} entries (${studyCount} study, ${chunks.length - studyCount} influencer), dimension ${vectors[0].length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
