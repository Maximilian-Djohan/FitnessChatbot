/**
 * Split raw source text into overlapping chunks on semantic boundaries.
 *
 * Targets ~500 tokens per chunk with ~75 tokens of overlap (approximated at
 * 4 chars/token — Voyage and Claude tokenizers both land near that on English
 * prose). These values must match production before merging into
 * LiftingTracker; they are recorded in index.json for verification.
 */

import type { Chunk, SourceType } from "../core/types.js";

export const CHUNK_SIZE_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 75;

const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN; // 2000
const OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN; // 300
// Synthetic units (sentence groups, hard splits) leave room for the overlap
// tail that gets prepended, so packed chunks stay near TARGET_CHARS.
const PACK_CHARS = TARGET_CHARS - OVERLAP_CHARS; // 1700

/**
 * Split text into semantic units: paragraphs where they exist, sentence
 * groups where a "paragraph" is one giant block (typical of caption dumps).
 */
function toUnits(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= TARGET_CHARS) {
      units.push(paragraph);
      continue;
    }
    // Oversized block: split into sentences, then re-group below.
    const sentences = paragraph.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [
      paragraph,
    ];
    let group = "";
    for (const sentence of sentences) {
      if (group.length + sentence.length > PACK_CHARS && group.length > 0) {
        units.push(group.trim());
        group = "";
      }
      // A single sentence longer than the limit (no punctuation, e.g. raw
      // captions): hard-split on whitespace near the limit.
      if (sentence.length > PACK_CHARS) {
        for (const piece of hardSplit(sentence, PACK_CHARS)) {
          units.push(piece.trim());
        }
        continue;
      }
      group += sentence;
    }
    if (group.trim().length > 0) units.push(group.trim());
  }
  return units;
}

function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= 0) cut = maxChars;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim().length > 0) pieces.push(rest);
  return pieces;
}

/** Trailing slice of a chunk to prepend to the next one, cut at a word boundary. */
function overlapTail(chunkText: string): string {
  if (chunkText.length <= OVERLAP_CHARS) return chunkText;
  const tail = chunkText.slice(-OVERLAP_CHARS);
  const firstSpace = tail.indexOf(" ");
  return firstSpace === -1 ? tail : tail.slice(firstSpace + 1);
}

/**
 * Chunk raw text from one source file. Greedily packs semantic units up to
 * the target size, carrying an overlap tail between consecutive chunks.
 */
export function chunkText(
  rawText: string,
  sourceType: SourceType,
  sourceName: string,
): Chunk[] {
  const units = toUnits(rawText);
  const chunks: Chunk[] = [];
  let current = "";

  const emit = () => {
    const text = current.trim();
    if (text.length > 0) {
      chunks.push({ text, sourceType, sourceName });
    }
  };

  for (const unit of units) {
    if (current.length > 0 && current.length + unit.length + 2 > TARGET_CHARS) {
      emit();
      current = overlapTail(current);
    }
    current = current.length > 0 ? `${current}\n\n${unit}` : unit;
  }
  emit();

  return chunks;
}
