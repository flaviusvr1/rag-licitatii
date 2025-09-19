import { createReadStream, promises as fs } from "fs";
import path from "path";

const API_URL = process.env.LLAMA_PARSING_API_URL!;
const API_KEY = process.env.LLAMA_PARSING_API_KEY!;
const POLL_MS = Number(process.env.LLAMA_POLL_MS || 60000);
const TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 90 * 60 * 1000);

export async function uploadFileToLlama(filePath: string): Promise<string> {
  const form = new FormData();
  console.log(`${API_URL}/upload`)
  // @ts-ignore – Node stream compat
  form.append("file", createReadStream(filePath), path.basename(filePath));
  form.append("parse_mode", "parse_page_with_agent");
  form.append("model", "openai-gpt-4-1-mini");
  form.append("high_res_ocr", "true");
  form.append("adaptive_long_table", "true");
  form.append("outlined_table_extraction", "true");
  form.append("output_tables_as_HTML", "true");

  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form as any,
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
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

export async function downloadMarkdown(jobId: string, outPath: string): Promise<void> {
  const res = await fetch(`${API_URL}/job/${jobId}/result/raw/markdown`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  await fs.writeFile(outPath, text, "utf-8");
}
