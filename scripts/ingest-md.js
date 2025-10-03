import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import { splitMarkdown } from "../lib/split.js";          // chunking fix
import { splitAdaptiveWithAI } from "../lib/split-ai.js"; // chunking AI
import { normalizeText } from "../lib/normalize.js";
import { upsertVectors } from "../lib/vectordb/pinecone.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔹 setează "fix" sau "ai"
const MODE = "ai";  // doar string, fără tipaj TS

async function main() {
  console.log("🚀 Pornim ingest pentru Raport...");

  const filename = "Raport de expertiza tehnica - scanat.md";
  const filepath = `storage/markdown/${filename}`;
  const text = fs.readFileSync(filepath, "utf-8");

  let chunks = [];

  // 1. Splitare text
  if (MODE === "fix") {
    console.log("🔹 Folosesc split FIX (100/80)...");
    chunks = splitMarkdown(text, 100, 80)
      .map(normalizeText)
      .map((c, i) => ({
        id: `${filename}::${i}`,
        text: c,
        meta: { filename, order: i }
      }));
  } else {
    console.log("🔹 Folosesc split AI...");
    chunks = await splitAdaptiveWithAI(text, filename, {
      targetTokens: process.env.CHUNK_TARGET_TOKENS,    // mai mare
      maxTokens: process.env.CHUNK_MAX_TOKENS,       // limită hard
      minTokens: process.env.CHUNK_MIN_TOKENS,        // bucăți minime
      overlapSentences: process.env.CHUNK_OVERLAP_SENTENCES,   // overlap mai mare
      chunkLLMModel: process.env.CHUNK_LLM_MODEL || "gpt-5o-mini"
    });
  }

  console.log("📌 Total fragmente:", chunks.length);

  // 2. Embeddings (în batch-uri)
  const batchSize = 50;
  let allEmbeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batchTexts = chunks.slice(i, i + batchSize).map(c => c.text);
    console.log(`   → Procesez fragmente ${i} - ${i + batchTexts.length - 1}`);
    const res = await openai.embeddings.create({
      model: process.env.EMBED_MODEL || "text-embedding-3-large",
      input: batchTexts,
    });
    allEmbeddings.push(...res.data.map(d => d.embedding));
  }

  // 3. Pregătim vectorii pentru Pinecone
  const vectors = chunks.map((c, i) => ({
    id: c.id,
    values: allEmbeddings[i],
    metadata: {
      filename,
      order: c.meta?.order ?? i,
      sectionPath: c.meta?.sectionPath,
      text: c.text,
    },
  }));

  console.log("📌 Trimit în Pinecone:", vectors.length, "vectori...");

  // 4. Upsert în Pinecone
  await upsertVectors("default", vectors);

  console.log("✅ Ingest complet! Documentul este indexat în Pinecone.");
}

main().catch((err) => {
  console.error("❌ Eroare la ingest:", err);
});