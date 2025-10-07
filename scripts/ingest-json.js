// scripts/ingest-json.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import { splitFromJson } from "../lib/split-ai-json.js"; // vezi fișierul făcut anterior
import { upsertVectors } from "../lib/vectordb/pinecone.js"; // același adaptor ca la Markdown

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Config =====
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large"; // 3072d
const BATCH_SIZE = Number(process.env.EMBED_BATCH || 50);

// CLI: node scripts/ingest-json.js "Raport de expertiza tehnica - scanat.pdf"
const baseName = process.argv[2] || "Raport de expertiza tehnica - scanat.pdf";
// JSON salvat de cloud-llama: storage/json/<baseName>.json
const jsonPath = path.join(process.cwd(), "storage", "json", baseName.replace(/\.[^.]+$/, ".json"));

async function main() {
  console.log("🚀 Pornim ingest JSON pentru:", baseName);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Nu găsesc JSON: ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  const doc = JSON.parse(raw);

  // 1) Splitare: TEXT prin split-ai, TABEL ca chunk separat (fără tăiere), păstrăm pagini
  console.log("🔹 Split cu AI (JSON-aware)...");
  const chunks = await splitFromJson(doc, baseName, {
    // forward la splitAdaptiveWithAI din split-ai.js
    targetTokens: Number(process.env.CHUNK_TARGET_TOKENS || 1300),
    maxTokens: Number(process.env.CHUNK_MAX_TOKENS || 1500),
    minTokens: Number(process.env.CHUNK_MIN_TOKENS || 450),
    overlapSentences: Number(process.env.CHUNK_OVERLAP_SENTENCES || 4),
    chunkLLMModel: process.env.CHUNK_LLM_MODEL || "gpt-4.1-mini",
  });

  console.log("📌 Total fragmente:", chunks.length);

  // 2) Embeddings (OpenAI 3072) — identic ca la Markdown
  let allEmbeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchTexts = chunks.slice(i, i + BATCH_SIZE).map((c) => c.text);
    console.log(`   → Embeddings ${i} - ${i + batchTexts.length - 1}`);
    const res = await openai.embeddings.create({
      model: EMBED_MODEL, // text-embedding-3-large
      input: batchTexts,
    });
    allEmbeddings.push(...res.data.map((d) => d.embedding));
  }

  // 3) Pregătim vectorii pentru Pinecone (exact ca la ingestul tău Markdown)
  const vectors = chunks.map((c, i) => ({
    id: c.id, // ex: `${baseName}::${index}` setat în split
    values: allEmbeddings[i],
    metadata: {
      filename: baseName,
      order: c.meta?.order ?? i,
      sectionPath: c.meta?.headingPath,
      pageStart: c.meta?.pageStart,
      pageEnd: c.meta?.pageEnd,
      type: c.meta?.type, // 'text' | 'table'
      text: c.text,       // păstrezi textul la fel ca în ingestul MD
    },
  }));

  console.log("📌 Trimit în Pinecone:", vectors.length, "vectori...");
  await upsertVectors("default", vectors);

  console.log("✅ Ingest JSON complet! Documentul este indexat în Pinecone.");
}

main().catch((err) => {
  console.error("❌ Eroare la ingest JSON:", err);
  process.exit(1);
});