import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import { splitMarkdown } from "../lib/split.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  console.log("🚀 Pornim embeddings pentru Raport...");

  // 1. Citește fișierul
  const text = fs.readFileSync(
    "storage/markdown/Raport de expertiza tehnica - scanat.md",
    "utf-8"
  );

  // 2. Split în fragmente
  const chunks = splitMarkdown(text, 1000, 200);
  console.log("📌 Total fragmente:", chunks.length);

  // 3. Embeddings pentru primele 3 fragmente (test)
  const sample = chunks.slice(0, 3);
  const res = await openai.embeddings.create({
    model: process.env.EMBED_MODEL || "text-embedding-3-large",
    input: sample,
  });

  console.log("✅ Am generat embeddings pentru 3 fragmente:");
  res.data.forEach((d, i) => {
    console.log(`   Frag ${i} → vector dim: ${d.embedding.length}`);
  });
}

main().catch((err) => {
  console.error("❌ Eroare:", err);
});
