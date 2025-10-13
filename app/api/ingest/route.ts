import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// helper: încearcă o listă de căi și ia primul modul care există
async function importFirst<T = any>(candidates: string[]): Promise<T | null> {
  for (const p of candidates) {
    try {
      const mod: any = await import(p);
      return mod;
    } catch {}
  }
  return null;
}

// helper: extrage o funcție din modul după nume posibile (JS/TS, default/CommonJS)
function pickFn(mod: any, names: string[]): Function | null {
  if (!mod) return null;
  for (const n of names) {
    if (typeof mod[n] === "function") return mod[n];
  }
  if (typeof mod.default === "function") return mod.default;
  if (typeof mod === "function") return mod;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, target, docs } = await req.json() as {
      projectId: string;
      target: "md" | "json";
      docs: Array<{ id: string; name: string; content: string | object; meta: any }>;
    };
    if (!docs?.length) return NextResponse.json({ error: "No docs" }, { status: 400 });

    // === 1) Rezolvă ingestorul din scripts pe baza target-ului ===
    // Ajustează dacă în repo ai alte căi; am pus variante uzuale.
    const mod = await importFirst([
      target === "json"
        ? "@/scripts/ingest/ingest-json"
        : "@/scripts/ingest/ingest-md",
      target === "json"
        ? "@/scripts/ingest/json-ingest"
        : "@/scripts/ingest/md-ingest",
      target === "json"
        ? "@/scripts/ingest/json"
        : "@/scripts/ingest/md",
      // fallback: poate sunt în rădăcina scripts
      target === "json" ? "@/scripts/ingest-json" : "@/scripts/ingest-md",
    ]);

    if (!mod) {
      return NextResponse.json(
        { error: `Ingest script missing for target=${target}. Adaugă scriptul tău (JS/TS) și îl chemăm direct.` },
        { status: 501 }
      );
    }

    // === 2) Alege funcția de ingest din modul (suportă diverse denumiri) ===
    const ingestFn =
      pickFn(mod, target === "json"
        ? ["ingestJson", "ingestJSON", "ingest_json"]
        : ["ingestMd", "ingestMD", "ingestMarkdown", "ingest_markdown"]);

    if (!ingestFn) {
      return NextResponse.json(
        { error: `Nu am găsit o funcție de ingest în modulul scripts pentru ${target}. Export așteptat: default sau ingestJson/ingestMd` },
        { status: 501 }
      );
    }

    // === 3) Construiește configurarea din .env (Pinecone, embeddings) și paseaz-o scriptului tău ===
    const cfg = {
      projectId: projectId || "default",
      pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        index: process.env.PINECONE_INDEX,
        host: process.env.PINECONE_HOST, // data plane host (obligatoriu)
      },
      embed: {
        provider: process.env.EMBED_PROVIDER ?? "none",
        model: process.env.EMBED_MODEL ?? "text-embedding-3-large",
        dim: Number(process.env.EMBED_DIM ?? 3072), // respect 3072
        openaiKey: process.env.OPENAI_API_KEY,
      },
      // altele utile scripturilor tale:
      chunk: {
        llm: process.env.CHUNK_LLM_MODEL ?? "gpt-5-mini",
        targetTokens: Number(process.env.CHUNK_TARGET_TOKENS ?? 1300),
        maxTokens: Number(process.env.CHUNK_MAX_TOKENS ?? 1500),
        minTokens: Number(process.env.CHUNK_MIN_TOKENS ?? 450),
        overlapSentences: Number(process.env.CHUNK_OVERLAP_SENTENCES ?? 4),
        debug: (process.env.CHUNK_DEBUG ?? "0") === "1",
      },
    };

    // === 4) Rulează ingest fix cum ai în scripts (split+embed+upsert în Pinecone) ===
    // Convenție: scriptul tău primește (docs, cfg) și returnează { inserted: number } sau count.
    const result = await Promise.resolve(ingestFn(docs, cfg));
    const inserted =
      typeof result === "number" ? result :
      typeof result?.inserted === "number" ? result.inserted :
      Array.isArray(result) ? result.length : 0;

    return NextResponse.json({ ok: true, inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Ingest failed" }, { status: 500 });
  }
}