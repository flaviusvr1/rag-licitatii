// app/layout.tsx
import "./global.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RAG Licitatii",
  description: "Uploader + LlamaIndex Parsing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
