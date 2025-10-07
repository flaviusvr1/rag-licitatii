import fs from "fs";                  // pentru createReadStream, existsSync etc.
import fetch from "node-fetch";
import { promises as fsp } from "fs"; // pentru readFile, writeFile async
import path from "path";
import FormData from "form-data";


type ParseResultFormat = "markdown" | "json";
const API_URL = process.env.LLAMA_PARSING_API_URL!;
const API_KEY = process.env.LLAMA_PARSING_API_KEY!;
const POLL_MS = Number(process.env.LLAMA_POLL_MS || 60000);
const TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 90 * 60 * 1000);

const PARSE_RESULT_FORMAT = (
  process.env.PARSE_RESULT_FORMAT || "markdown"
).toLowerCase() as "markdown" | "json";

function safeBase(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function outPathFor(baseName: string, fmt: "markdown" | "json") {
  const ext = fmt === "json" ? ".json" : ".md";
  const folder = fmt === "json" ? "json" : "markdown";
  // respectă structura ta: storage/<folder>/<nume>.<ext>
  const file = safeBase(baseName).replace(/\.[^.]+$/, ext);
  return path.join(process.cwd(), "storage", folder, file);
}

export async function uploadFile(filePath: string): Promise<string> {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  console.log("🔹 Am adăugat fișier:", filePath, "→", path.basename(filePath));
  // aceleași setări ca în script
  form.append("parse_mode", "parse_page_with_agent");
  form.append("model", "openai-gpt-4-1-mini");
  form.append("high_res_ocr", "true");
  form.append("adaptive_long_table", "true");
  form.append("outlined_table_extraction", "true");
  form.append("output_tables_as_HTML", "true");

  // atenție: NU punem form.getHeaders() aici
  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Upload failed ${res.status}: ${res.statusText} ${txt}`);
  }

  const data = await res.json();
  if (!data?.id) throw new Error(`Răspuns upload fără id: ${JSON.stringify(data)}`);
  return data.id;
}


export async function waitForCompletion(jobId: string): Promise<void> {
  const start = Date.now();
  while (true) {
    const res = await fetch(`${API_URL}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    const status = String(data.status || "").toUpperCase();

    if (status === "SUCCESS" || status === "PARTIAL_SUCCESS") return;
    if (status === "ERROR" || status === "CANCELLED") throw new Error(`Job ${jobId} failed`);

    if (Date.now() - start > TIMEOUT_MS) throw new Error(`Timeout job ${jobId}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// asigură dir înainte de scriere (mic patch util)
export async function downloadMarkdown(jobId: string, outPath: string): Promise<void> {
  const res = await fetch(`${API_URL}/job/${jobId}/result/raw/markdown`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  await fsp.mkdir(path.dirname(outPath), { recursive: true }); // <- adăugat
  await fsp.writeFile(outPath, text, "utf-8"); 
}

// helper ca să vezi unde ar salva, pentru “skip dacă există”
export function plannedOutPath(baseName: string) {
  return outPathFor(baseName, PARSE_RESULT_FORMAT);
}

// ✅ wrapper “download general” — route-ul cheamă DOAR asta
export async function downloadResult(jobId: string, baseName: string) {
  const fmt = PARSE_RESULT_FORMAT; // la tine: "markdown"
  const outPath = outPathFor(baseName, fmt);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  if (fmt === "json") {
    await downloadJson(jobId, outPath);
  } else {
    await downloadMarkdown(jobId, outPath);
  }
  return { format: fmt, path: outPath };
}

export async function downloadJson(jobId: string, outPath?: string): Promise<any> {
  const res = await fetch(`${API_URL}/job/${jobId}/result/raw/json`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Download JSON failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  // opțional: persistă local pentru debug/mapper
  if (outPath) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(data, null, 2), "utf-8");
  }
  return data;
}

export { uploadFile as uploadFileToLlama };