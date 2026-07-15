/**
 * Local web UI for the RAG bot — a thin HTTP wrapper around core/, same as
 * cli.ts but browser-facing. Replaced by a Worker route at integration time.
 *
 *   npm run web    → http://localhost:8787
 */

import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { answer, DEFAULT_ANSWER_MODEL } from "./core/answer.js";
import { buildPrompt } from "./core/prompt.js";
import { search } from "./core/search.js";
import type { ExperienceLevel, RagIndex } from "./core/types.js";

const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];

const PORT = 8787;
const TOP_K = 6;
const INDEX_PATH = path.resolve(import.meta.dirname, "index.json");
const PAGE_PATH = path.resolve(import.meta.dirname, "web", "index.html");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const keys = {
  voyage: requireEnv("VOYAGE_API_KEY"),
  anthropic: requireEnv("ANTHROPIC_API_KEY"),
};

const index: RagIndex = JSON.parse(await readFile(INDEX_PATH, "utf8"));
console.log(`Loaded index: ${index.entries.length} chunks, model ${index.embeddingModel}`);

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(PAGE_PATH));
      return;
    }

    if (req.method === "POST" && req.url === "/api/ask") {
      const { question, level } = JSON.parse(await readBody(req)) as {
        question?: string;
        level?: string;
      };
      if (!question?.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "question is required" }));
        return;
      }
      const experienceLevel: ExperienceLevel = LEVELS.includes(
        level as ExperienceLevel,
      )
        ? (level as ExperienceLevel)
        : "intermediate";

      const chunks = await search(index, question.trim(), {
        apiKey: keys.voyage,
        k: TOP_K,
      });

      const sources = [...new Set(chunks.map((c) => `${c.sourceName} (${c.score.toFixed(2)})`))];
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Sources": encodeURIComponent(JSON.stringify(sources)),
      });

      await answer(buildPrompt(chunks, question.trim(), experienceLevel), {
        apiKey: keys.anthropic,
        model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANSWER_MODEL,
        onText: (delta) => res.write(delta),
      });
      res.end();
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
    res.end("\n\n[Something went wrong — check the server terminal.]");
  }
});

server.listen(PORT, () => {
  console.log(`RAG bot UI running at http://localhost:${PORT}`);
});
