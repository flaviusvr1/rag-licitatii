import { Pinecone } from "@pinecone-database/pinecone";

let pinecone;

export function getIndex() {
  if (!pinecone) {
    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }
  return pinecone.index(process.env.PINECONE_INDEX);
}

export async function upsertVectors(namespace, items) {
  const index = getIndex().namespace(namespace);
  await index.upsert(items);
}

export async function queryVectors(namespace, vector, topK = 3) {
  const index = getIndex().namespace(namespace);
  const res = await index.query({
    topK,
    vector,
    includeMetadata: true,
  });
  return res.matches || [];
}

export async function deleteVectors(namespace, filter) {
  const index = getIndex().namespace(namespace);
  await index.deleteMany({ filter });
}
