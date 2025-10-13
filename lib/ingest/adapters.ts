// lib/ingest/adapters.ts
export class OpenAIOllamaEmbedder {
  private dim = Number(process.env.EMBED_DIM ?? 3072); // implicit 3072

  async embedMany(texts: string[]): Promise<number[][]> {
    const provider = process.env.EMBED_PROVIDER ?? "none";

    if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY!;
      // large = 3072
      const model = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-large";
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: texts, model }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
      const json = await res.json();
      const vecs: number[][] = json.data.map((d: any) => d.embedding);
      // validare/padding/truncate la 3072
      return vecs.map(v => v.length === this.dim
        ? v
        : (v.length > this.dim ? v.slice(0, this.dim) : [...v, ...Array(this.dim - v.length).fill(0)]));
    }

    if (provider === "ollama") {
      const model = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
      const res = await fetch("http://localhost:11434/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`Ollama embeddings failed: ${res.status}`);
      const json = await res.json();
      const arr: number[][] = Array.isArray(json.embeddings)
        ? json.embeddings
        : json.data?.map((d: any) => d.embedding);
      return arr.map(v => v.length === this.dim
        ? v
        : (v.length > this.dim ? v.slice(0, this.dim) : [...v, ...Array(this.dim - v.length).fill(0)]));
    }

    // none → vectori zero 3072 (dry-run)
    return texts.map(() => Array(this.dim).fill(0));
  }
}
