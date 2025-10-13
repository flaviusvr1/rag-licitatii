// lib/ingest/adapters/embedder.ts
export class OpenAIEmbedder3072 {
  private readonly dim = Number(process.env.EMBED_DIM ?? 3072);
  private readonly provider = process.env.EMBED_PROVIDER ?? "none";
  private readonly model = process.env.EMBED_MODEL ?? "text-embedding-3-large";

  async embedMany(texts: string[]): Promise<number[][]> {
    if (this.provider !== "openai") {
      return texts.map(() => Array(this.dim).fill(0));
    }
    const key = process.env.OPENAI_API_KEY!;
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
    const json = await res.json();
    const vecs: number[][] = json.data.map((d: any) => d.embedding);
    return vecs.map(v => v.length === this.dim ? v :
      (v.length > this.dim ? v.slice(0, this.dim) : [...v, ...Array(this.dim - v.length).fill(0)]));
  }
}
