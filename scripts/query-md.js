import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import { queryVectors } from "../lib/vectordb/pinecone.js";
import { normalizeText } from "../lib/normalize.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const question = "Care este scopul adăugării scării și liftului exterior?";

  const normalizedQ = normalizeText(question);
  console.log("❓ Întrebare:", question);

  // 1. Embedding pentru întrebare
  const qEmb = await openai.embeddings.create({
    model: process.env.EMBED_MODEL || "text-embedding-3-large",
    input: normalizedQ,
  });

  // 2. Query în Pinecone
  const topK = 10;
  const results = await queryVectors("default", qEmb.data[0].embedding, topK);

  console.log(`🔍 Rezultate top ${topK}:`);
  results.forEach((r, i) => {
    // console.log(r);
    console.log(`\n--- Rezultat ${i + 1} (scor: ${r.score}) ---`);
    console.log(r.metadata?.text);
  });
}

main().catch((err) => {
  console.error("❌ Eroare la query:", err);
});