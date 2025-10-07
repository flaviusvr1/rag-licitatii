// app/api/upload/route.ts
import { NextResponse } from "next/server";
import Busboy from "busboy";
import path from "path";
import { createWriteStream, promises as fs } from "fs";
import { Readable } from "stream";
import {
  uploadFileToLlama,
  waitForCompletion,
  downloadMarkdown,
  downloadJson,              // <- ADD
} from "../../../lib/converter/cloud-llama";

const STORAGE_UPLOADS  = path.join(process.cwd(), "storage", "uploads");
const STORAGE_MARKDOWN = path.join(process.cwd(), "storage", "markdown");
const STORAGE_JSON     = path.join(process.cwd(), "storage", "json"); // <- ADD

// format global (din .env) — nu se schimbă la runtime
const PARSE_RESULT_FORMAT = (process.env.PARSE_RESULT_FORMAT || "markdown").toLowerCase() as "markdown" | "json";

const MAX_CONCURRENCY = 6;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveIncomingFiles(req: Request): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const bb = Busboy({ headers });

    const saved: string[] = [];
    let active = 0;
    let finished = false;

    bb.on("file", (_name, file, info) => {
      const originalName = info.filename || `upload-${Date.now()}`;
      const destPath = path.join(STORAGE_UPLOADS, originalName);
      console.log("[UPLOAD] primit:", originalName, "→", destPath);

      const ws = createWriteStream(destPath);
      active++;
      file.pipe(ws);

      ws.on("finish", () => {
        saved.push(originalName);
        active--;
        if (finished && active === 0) resolve(saved);
      });

      ws.on("error", reject);
    });

    bb.on("error", reject);

    bb.on("finish", () => {
      finished = true;
      if (active === 0) {
        if (saved.length > 0) resolve(saved);
        else reject(new Error("Niciun fișier primit"));
      }
    });

    const nodeStream = Readable.fromWeb(req.body as any);
    nodeStream.pipe(bb);
  });
}

// helper asyncPool
async function asyncPool<T, R>(
  limit: number,
  items: T[],
  iterator: (item: T) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing = new Set<Promise<any>>();

  for (const item of items) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);

    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

export async function POST(req: Request) {
  try {
    // asigură directoare
    await fs.mkdir(STORAGE_UPLOADS, { recursive: true });
    await fs.mkdir(STORAGE_MARKDOWN, { recursive: true });
    await fs.mkdir(STORAGE_JSON, { recursive: true }); // <- ADD

    const files = await saveIncomingFiles(req);
    console.log("[UPLOAD] scrise pe disc:", files);

    const results = await asyncPool(MAX_CONCURRENCY, files, async (f) => {
      const uploadPath = path.join(STORAGE_UPLOADS, f);

      // decide output dir/ext in funcție de env
      const isJson = PARSE_RESULT_FORMAT === "json";
      const outDir = isJson ? STORAGE_JSON : STORAGE_MARKDOWN;
      const outExt = isJson ? ".json" : ".md";
      const outPath = path.join(outDir, f.replace(/\.[^.]+$/, outExt));

      try {
        // skip dacă există deja
        await fs.access(outPath);
        console.log("[SKIP] există deja:", outPath);
        return { file: f, skipped: true, path: path.basename(outPath), format: PARSE_RESULT_FORMAT };
      } catch {}

      try {
        console.log("[LLAMA] upload →", uploadPath);
        const jobId = await uploadFileToLlama(uploadPath);
        console.log("[LLAMA] job id =", jobId);

        console.log("[LLAMA] aștept finalizare…");
        await waitForCompletion(jobId); // nu presupunem că returnează status

        if (isJson) {
          console.log("[LLAMA] descarc JSON →", outPath);
          await downloadJson(jobId, outPath);
        } else {
          console.log("[LLAMA] descarc MD →", outPath);
          await downloadMarkdown(jobId, outPath);
        }

        return { file: f, ok: true, jobId, path: path.basename(outPath), format: PARSE_RESULT_FORMAT };
      } catch (err: any) {
        console.error("[ERROR] procesare fișier:", f, err);
        return { file: f, ok: false, error: err.message };
      }
    });

    return NextResponse.json({ ok: true, format: PARSE_RESULT_FORMAT, results });
  } catch (e: any) {
    console.error("[ERROR] /api/upload:", e);
    return NextResponse.json(
      { error: e.message || "Eroare upload" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await fs.mkdir(STORAGE_UPLOADS, { recursive: true });
    const files = await fs.readdir(STORAGE_UPLOADS);
    return NextResponse.json({ files });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}