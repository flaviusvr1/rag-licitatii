"use client";
import { useEffect, useState } from "react";

export default function Uploader() {
  const [status, setStatus] = useState("");
  const [files, setFiles] = useState<string[]>([]);

  async function refresh() {
    const r = await fetch("/api/upload");
    const d = await r.json();
    setFiles(d.files || []);
  }

  useEffect(() => { refresh(); }, []);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("⏳ Se încarcă...");
    const fd = new FormData(e.currentTarget);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) {
      setStatus("❌ " + (d.error || "Eroare"));
      return;
    }
    setStatus("✅ Încărcat cu succes");
    refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onUpload} className="space-y-2">
        <input type="file" name="file" multiple required />
        <button type="submit" className="border px-3 py-1">Încarcă</button>
        <div className="text-sm opacity-80">{status}</div>
      </form>

      <div>
        <h2 className="font-medium mb-2">Fișiere încărcate:</h2>
        <ul className="list-disc pl-5 text-sm">
          {files.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
    </div>
  );
}
