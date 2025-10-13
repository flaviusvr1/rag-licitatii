// app/components/Uploader.tsx
"use client";
import React, { useState } from "react";

export default function Uploader() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [target, setTarget] = useState<"md" | "json">("md");
  const [projectId, setProjectId] = useState<string>("default"); // implicit

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length) return;

    const form = new FormData();
    Array.from(files).forEach(f => form.append("files", f));
    form.append("target", target);
    form.append("projectId", projectId);

    // 1) conversie in Cloud LlamaIndex Parsing -> MD sau JSON
    const convRes = await fetch("/api/convert", { method: "POST", body: form });
    if (!convRes.ok) { alert("Conversie eșuată"); return; }
    const converted = await convRes.json(); // { docs: Array<{id,name,content,meta}>, target }

    // 2) ingest în vector DB (split + embed + upsert)
    const ingestRes = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        target: converted.target, // "md" | "json"
        docs: converted.docs,     // conținut normalizat
      }),
    });
    if (!ingestRes.ok) { alert("Ingest eșuat"); return; }
    alert("Gata – documentele sunt indexate.");
  }

  return (
    <form onSubmit={handleUpload} className="space-y-3 p-4 border rounded-xl">
      <div className="flex gap-3 items-center">
        <input
          type="file"
          name="files"
          multiple
          onChange={(e) => setFiles(e.currentTarget.files)}
          className="block"
          accept=".pdf,.docx,.md,.json"
        />
        <select
          value={target}
          onChange={e => setTarget(e.target.value as "md"|"json")}
          className="border rounded-md p-2"
          title="Format de ieșire din parser"
        >
          <option value="md">Markdown</option>
          <option value="json">JSON</option>
        </select>
        <input
          placeholder="projectId"
          value={projectId}
          onChange={(e)=>setProjectId(e.target.value)}
          className="border rounded-md p-2"
        />
        <button type="submit" className="px-3 py-2 rounded-lg bg-black text-white">
          Procesează & Ingest
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Limită ~250MB/fișier (implicit). Tipuri: PDF/DOCX/MD/JSON.
      </p>
    </form>
  );
}