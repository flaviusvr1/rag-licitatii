// lib/converter.ts
// adaptor pentru Cloud LlamaIndex Parsing (implicit: fetch HTTP la API-ul tău deja funcțional)
type UploadAndConvertInput = {
  files: File[];
  target: "md" | "json";
  projectId: string;
};

export const converter = {
  async uploadAndConvert(input: UploadAndConvertInput): Promise<{
    docs: Array<{ id: string; name: string; content: string | object; meta: Record<string, any> }>;
  }> {
    // IMPLICIT: endpoint extern al tău CLOUD_LLAMAINDEX_URL + KEY
    const base = process.env.CLOUD_LLAMAINDEX_URL!;
    const key = process.env.CLOUD_LLAMAINDEX_API_KEY!;
    // exemplu minim; înlocuiește cu ce ai deja pentru upload+download
    const form = new FormData();
    input.files.forEach(f => form.append("files", f));
    form.append("target", input.target);

    const res = await fetch(`${base}/parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error("Cloud parsing failed");

    // așteptăm fie liste de markdown-uri, fie JSON-uri
    const payload = await res.json();
    // Normalizare: content e string pt MD, e object pt JSON
    const docs = (payload.docs as any[]).map(d => ({
      id: d.id ?? crypto.randomUUID(),
      name: d.name ?? "doc",
      content: d.content, // string sau object
      meta: { projectId: input.projectId, source: "cloud-llamaindex", ...(d.meta ?? {}) },
    }));
    return { docs };
  },
};
