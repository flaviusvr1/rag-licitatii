// lib/split.js
export function splitMarkdown(text, size, overlap) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk);
    start += size - overlap;
  }

  return chunks;
}
