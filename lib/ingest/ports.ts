// Interfețe stabile (SOLID: DIP + ISP)
export type RawDoc = { id: string; name: string; content: string | object; meta: Record<string, any> };
export type Chunk  = { id: string; docId: string; name: string; text: string; meta: Record<string, any>; path?: string|null };

export interface Splitter {
  split(doc: RawDoc): Promise<Chunk[]> | Chunk[];
}

export interface Embedder {
  embedMany(texts: string[]): Promise<number[][]>; // 3072 garantat
}

export interface VectorStore {
  upsert(namespace: string, points: { id: string; values: number[]; metadata: Record<string, any> }[]): Promise<void>;
}

export class IngestService {
  constructor(
    private splitter: Splitter,
    private embedder: Embedder,
    private store: VectorStore
  ) {}
  async ingest(projectId: string, docs: RawDoc[]): Promise<number> {
    const allChunks = (await Promise.all(docs.map(d => this.splitter.split(d)))).flat();
    if (!allChunks.length) return 0;

    const vectors = await this.embedder.embedMany(allChunks.map(c => c.text)); // 3072
    const points = allChunks.map((c, i) => ({
      id: c.id,
      values: vectors[i],
      metadata: {
        projectId, docId: c.docId, name: c.name,
        path: c.path ?? null, meta: c.meta ?? {},
        // text: c.text, // opțional; atenție la limitele Pinecone metadata
      },
    }));
    await this.store.upsert(projectId || "default", points);
    return points.length;
  }
}
