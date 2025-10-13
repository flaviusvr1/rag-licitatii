// lib/ingest/adapters/pinecone.ts
type Point = { id: string; values: number[]; metadata: Record<string, any> };

export class PineconeVectorStore {
  private host = process.env.PINECONE_HOST!;
  private key  = process.env.PINECONE_API_KEY!;
  private index= process.env.PINECONE_INDEX!; // doar pentru log/consistență

  async upsert(namespace: string, points: Point[]): Promise<void> {
    if (!this.host || !this.key) throw new Error("PINECONE_HOST sau PINECONE_API_KEY lipsesc.");
    const res = await fetch(`${this.host}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: namespace || "default", vectors: points }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Pinecone upsert failed: ${res.status} ${txt}`);
    }
  }
}
