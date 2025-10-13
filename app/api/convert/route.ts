// app/api/convert/route.ts
import { NextRequest, NextResponse } from "next/server";
// 👉 importă direct adaptorul tău existent
import { uploadAndConvert } from "../../../lib/converter/cloud-llama";
// ^ ajustează calea dacă fișierul e în altă parte

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const uiTarget = (form.get("target") as "md" | "json") ?? "md";
    const target: "markdown" | "json" = uiTarget === "json" ? "json" : "markdown"; // <- fix
    const projectId = (form.get("projectId") as string) || "default";
    const files = form.getAll("files") as File[];
    if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });

    const { docs } = await uploadAndConvert({ files, target, projectId }); // acum tipul se potrivește
    return NextResponse.json({ target: uiTarget, docs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Convert failed" }, { status: 500 });
  }
}