// lib/normalize.js
export function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")                   // separă diacriticele
    .replace(/[\u0300-\u036f]/g, "")    // elimină diacritice
    .replace(/[^a-z0-9\s]/g, " ")       // păstrează doar litere/cifre/spațiu
    .replace(/\s+/g, " ")               // spații multiple → 1 spațiu
    .trim();
}
