// lib/ingest/ingestors.ts
import { Chunk, Embedder, Ingestor, RawDoc, Splitter, VectorStore } from "./types";

abstract class BaseIngestor implements Ingestor {
  constructor(
    protected splitter: Splitter,
    protected embedder: Embedder,
    protected store: VectorStore
  ) {}
  async ingest(input: { projectId: string; docs: RawDoc[] }): Promise<number> {
    // split
    const chunks: Chunk[] = input.docs.flatMap(doc => this.splitter.split(doc));
    if (!chunks.length) return 0;

    // embed
    const vectors = await this.embedder.embedMany(chunks.map(c => c.text));

    // upsert
    await this.store.upsert(
      input.projectId,
      chunks.map((c, i) => ({
        id: c.id,
        vector: vectors[i],
        payload: {
          projectId: input.projectId,
          docId: c.docId,
          name: c.name,
          path: c.path ?? null,
          meta: c.meta ?? {},
          text: c.text, // NOTE: scoate din payload în prod dacă vrei confidențialitate
        },
      }))
    );

    return chunks.length;
  }
}

export class MarkdownIngestor extends BaseIngestor {}
export class JsonIngestor extends BaseIngestor {}
