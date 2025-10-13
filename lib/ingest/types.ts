// lib/ingest/types.ts
export type RawDoc = {
  id: string;
  name: string;
  content: string | object;
  meta: Record<string, any>;
};

export type Chunk = {
  id: string;
  docId: string;
  name: string;
  text: string;
  meta: Record<string, any>;
  path?: string | null; // pentru JSON
};

export interface Splitter {
  split(doc: RawDoc): Chunk[];
}

export interface Embedder {
  embedMany(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(projectId: string, points: { id: string; vector: number[]; payload: any }[]): Promise<void>;
}

export interface Ingestor {
  ingest(input: { projectId: string; docs: RawDoc[] }): Promise<number>;
}