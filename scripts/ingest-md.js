import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import { splitMarkdown } from "../lib/split.js";
import { normalizeText } from "../lib/normalize.js";
import { upsertVectors } from "../lib/vectordb/pinecone.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  console.log("🚀 Pornim ingest pentru Raport...");

  // 1. Citește documentul
  const filename = "Raport de expertiza tehnica - scanat.md";
  const filepath = `storage/markdown/${filename}`;
  const text = fs.readFileSync(filepath, "utf-8");

  // 2. Split în fragmente
  const chunks = splitMarkdown(text, 100, 80).map(normalizeText);
  console.log("📌 Total fragmente:", chunks.length);

  // 3. Embeddings în batch-uri (max 100 inputuri / request)
  const batchSize = 50;
  let allEmbeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`   → Procesez fragmente ${i} - ${i + batch.length - 1}`);
    const res = await openai.embeddings.create({
      model: process.env.EMBED_MODEL || "text-embedding-3-large",
      input: batch,
    });
    allEmbeddings.push(...res.data.map((d) => d.embedding));
  }

  // 4. Pregătim vectorii pentru Pinecone
  const vectors = chunks.map((chunk, i) => ({
    id: `${filename}::${i}`,
    values: allEmbeddings[i],
    metadata: {
      filename,
      chunk: i,
      text: chunk,
    },
  }));

  console.log("📌 Trimit în Pinecone:", vectors.length, "vectori...");

  // 5. Upsert în Pinecone
  await upsertVectors("default", vectors);

  console.log("✅ Ingest complet! Documentul este indexat în Pinecone.");
}

main().catch((err) => {
  console.error("❌ Eroare la ingest:", err);
});
