// app/api/upload/route.ts
import { NextResponse } from "next/server";
import Busboy from "busboy";
import path from "path";
import { createWriteStream, promises as fs } from "fs";
import { Readable } from "stream";
import { uploadFileToLlama, waitForCompletion, downloadMarkdown } from "../../../lib/converter/cloud-llama.ts"

const STORAGE_UPLOADS = path.join(process.cwd(), "storage", "uploads");
const STORAGE_MARKDOWN = path.join(process.cwd(), "storage", "markdown");

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

export async function POST(req: Request) {
  try {
    await fs.mkdir(STORAGE_UPLOADS, { recursive: true });
    await fs.mkdir(STORAGE_MARKDOWN, { recursive: true });

    const files = await saveIncomingFiles(req);
    console.log("[UPLOAD] scrise pe disc:", files);

    const results: any[] = [];
    for (const f of files) {
      const uploadPath = path.join(STORAGE_UPLOADS, f);
      const mdPath = path.join(STORAGE_MARKDOWN, f.replace(/\.[^.]+$/, ".md"));

      // Dacă există deja MD → skip
      try {
        await fs.access(mdPath);
        console.log("[SKIP] există deja MD:", mdPath);
        results.push({ file: f, skipped: true });
        continue;
      } catch {}

      // Trimitem la Cloud Llama
      console.log("[LLAMA] upload →", uploadPath);
      const jobId = await uploadFileToLlama(uploadPath);
      console.log("[LLAMA] job id =", jobId);

      console.log("[LLAMA] aștept finalizare…");
      const status = await waitForCompletion(jobId);
      console.log("[LLAMA] status final =", status);

      console.log("[LLAMA] descarc MD →", mdPath);
      await downloadMarkdown(jobId, mdPath);

      results.push({ file: f, skipped: false, jobId, md: path.basename(mdPath) });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    console.error("[ERROR] /api/upload:", e);
    return NextResponse.json({ error: e.message || "Eroare upload" }, { status: 500 });
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

