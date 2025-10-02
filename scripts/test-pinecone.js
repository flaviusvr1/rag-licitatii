import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
console.log("🔑 Pinecone key starts with:", process.env.PINECONE_API_KEY?.slice(0, 10));


import OpenAI from "openai";
import { upsertVectors, queryVectors } from "../lib/vectordb/pinecone.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  console.log("🚀 Pornim test Pinecone + OpenAI...");

  // 1. Textele noastre
  const docs = [
    { id: "1", text: "Primăria a lansat o licitație pentru construcția unui pod." },
    { id: "2", text: "Școala centrală intră în renovare printr-un contract public." },
    { id: "3", text: "Se discută despre achiziții publice și infrastructură rutieră." },
  ];

  console.log("📌 Generăm embeddings...");
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: docs.map((d) => d.text),
  });
  console.log("✅ Embeddings generate:", emb.data.length);

  console.log("📌 Trimitem vectorii în Pinecone...");
  await upsertVectors(
    "default",
    docs.map((d, i) => ({
      id: d.id,
      values: emb.data[i].embedding,
      metadata: { text: d.text },
    }))
  );
  console.log("✅ Am inserat documentele în Pinecone.");

  console.log("📌 Facem query...");
  const query = "Unde sunt lucrări de construcții?";
  const qEmb = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: query,
  });

  const results = await queryVectors("default", qEmb.data[0].embedding, 2);

  console.log("🔍 Rezultate:");
  results.forEach((r) =>
    console.log("-", r.metadata?.text, "| scor:", r.score)
  );
}

main().catch((err) => {
  console.error("❌ Eroare în script:", err);
});