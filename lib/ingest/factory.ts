// lib/ingest/factory.ts
import { Embedder, Ingestor, VectorStore } from "./types";
import { MarkdownSplitter, JsonSplitter } from "./splitters";
import { MarkdownIngestor, JsonIngestor } from "./ingestors";

export function makeIngestor(target: "md" | "json", deps: {
  embedder: Embedder;
  store: VectorStore;
}): Ingestor {
  if (target === "json") {
    return new JsonIngestor(new JsonSplitter(), deps.embedder, deps.store);
  }
  return new MarkdownIngestor(new MarkdownSplitter(), deps.embedder, deps.store);
}
