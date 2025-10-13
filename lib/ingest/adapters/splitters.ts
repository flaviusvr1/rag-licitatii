// lib/ingest/adapters/splitters.ts
import type { RawDoc, Chunk, Splitter } from "@/lib/ingest/ports";

/**
 * Așteptări:
 *  - scripts/split-ai exportă una din: default | chunkMarkdown | mdChunk
 *      semnătură: (markdown: string, meta: { docId,name,meta }) => Chunk[]
 *  - scripts/split-ai-json exportă una din: default | chunkJSON | mapJSONToChunks
 *      semnătură: (json: any, meta: { docId,name,meta }) => Chunk[]
 * Dacă exporturile reale diferă, actualizăm 2 linii mai jos.
 */

export class MarkdownSplitterAdapter implements Splitter {
  constructor(
    private splitFn: (markdown: string, meta: { docId: string; name: string; meta: any }) => Chunk[]
  ) {}
  split(doc: RawDoc): Chunk[] {
    return this.splitFn(String(doc.content ?? ""), { docId: doc.id, name: doc.name, meta: doc.meta });
  }
}

export class JsonSplitterAdapter implements Splitter {
  constructor(
    private splitFn: (json: any, meta: { docId: string; name: string; meta: any }) => Chunk[]
  ) {}
  split(doc: RawDoc): Chunk[] {
    return this.splitFn(doc.content, { docId: doc.id, name: doc.name, meta: doc.meta });
  }
}

export async function makeSplitter(target: "md" | "json"): Promise<Splitter> {
  if (target === "json") {
    const mod: any = await import("../../../scripts/"); // ← nume exact din repo
    const fn =
      (typeof mod?.default === "function" && mod.default) ||
      (typeof mod?.chunkJSON === "function" && mod.chunkJSON) ||
      (typeof mod?.mapJSONToChunks === "function" && mod.mapJSONToChunks);
    if (!fn) throw new Error("scripts/split-ai-json nu exportă o funcție de split (default/chunkJSON/mapJSONToChunks).");
    return new JsonSplitterAdapter(fn);
  } else {
    const mod: any = await import("@/scripts/split-ai"); // ← nume exact din repo
    const fn =
      (typeof mod?.default === "function" && mod.default) ||
      (typeof mod?.chunkMarkdown === "function" && mod.chunkMarkdown) ||
      (typeof mod?.mdChunk === "function" && mod.mdChunk);
    if (!fn) throw new Error("scripts/split-ai nu exportă o funcție de split (default/chunkMarkdown/mdChunk).");
    return new MarkdownSplitterAdapter(fn);
  }
}
