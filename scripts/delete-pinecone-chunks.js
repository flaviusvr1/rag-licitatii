import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getIndex } from "../lib/vectordb/pinecone.js";

async function main() {
  const index = getIndex().namespace("default");

  const filename = "Raport de expertiza tehnica - scanat.md";
  const fromChunk = 1;
  const toChunk = 50;

  console.log(`🗑 Șterg fragmente ${fromChunk}–${toChunk} din ${filename} ...`);

  // generăm lista de IDs exact ca la ingest
  const ids = [];
  for (let i = fromChunk; i <= toChunk; i++) {
    ids.push(`${filename}::${i}`);
  }

  // aici se trimite direct lista, nu într-un obiect
  await index.deleteMany(ids);

  console.log("✅ Ștergere completă!");
}

main().catch((err) => {
  console.error("❌ Eroare la ștergere:", err);
});
