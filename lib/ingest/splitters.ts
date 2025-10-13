// lib/ingest/splitters.ts
import { RawDoc, Chunk, Splitter } from "./types";

// === Markdown ===
export class MarkdownSplitter implements Splitter {
  constructor(private maxChars = 1200) {}
  split(doc: RawDoc): Chunk[] {
    const md = String(doc.content ?? "");
    const out: Chunk[] = [];
    for (let i = 0; i < md.length; i += this.maxChars) {
      out.push({
        id: `${doc.id}:md:${i}`,
        docId: doc.id,
        name: doc.name,
        text: md.slice(i, i + this.maxChars),
        meta: doc.meta ?? {},
      });
    }
    return out;
  }
}

// === JSON ===
// TODO: înlocuiește DFS-ul de mai jos cu mapperul tău din scripts (dacă ai deja flatten/paths)
export class JsonSplitter implements Splitter {
  split(doc: RawDoc): Chunk[] {
    const out: Chunk[] = [];
    const visit = (node: any, path: string[]) => {
      if (node == null) return;
      const t = typeof node;
      if (t === "string" || t === "number" || t === "boolean") {
        const text = String(node).trim();
        if (text) out.push({
          id: `${doc.id}:json:${path.join(".")}:${out.length}`,
          docId: doc.id,
          name: doc.name,
          text,
          meta: doc.meta ?? {},
          path: path.join("."),
        });
        return;
      }
      if (Array.isArray(node)) node.forEach((v, i) => visit(v, [...path, String(i)]));
      else if (t === "object") Object.entries(node).forEach(([k, v]) => visit(v, [...path, k]));
    };
    visit(doc.content, []);
    return out;
  }
}
