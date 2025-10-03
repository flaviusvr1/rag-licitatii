// lib/split-ai.js
import OpenAI from "openai";

const CHUNK_DEBUG = (process.env.CHUNK_DEBUG || "1") !== "0";
const approxTokens = (s) => Math.ceil(s.length / 4);

// Fără lookbehind; compat Node. Marcăm granițele și apoi split.
const sentenceSplit = (text) => {
  const SEP = "<<<SPLIT>>>";
  return text
    .replace(/\s+/g, " ") // normalizează whitespace
    .replace(/([.?!;:])\s+(?=[A-ZĂÂÎȘȚ0-9\[\(“"])/gu, `$1${SEP}`)
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean);
};

// Greedy local fallback – rupe în bucăți ~targetTokens cu maxTokens hard și overlap în propoziții
function greedyLocalChunk(sentences, targetTokens, maxTokens, minTokens, overlapSentences) {
  const chunksIdx = [];
  let start = 0;
  while (start < sentences.length) {
    let tks = 0;
    let end = start - 1;
    while (end + 1 < sentences.length && tks + approxTokens(sentences[end + 1]) <= maxTokens) {
      end++;
      tks += approxTokens(sentences[end]);
      if (tks >= targetTokens && end + 1 < sentences.length) break;
    }
    if (end < start) end = start;
    // dacă bucata e prea mică și mai avem loc, extinde până la minTokens (dacă încape)
    let size = 0; for (let i = start; i <= end; i++) size += approxTokens(sentences[i]);
    while (size < minTokens && end + 1 < sentences.length && size + approxTokens(sentences[end + 1]) <= maxTokens) {
      end++;
      size += approxTokens(sentences[end]);
    }
    chunksIdx.push([start, end]);
    start = Math.max(end + 1 - overlapSentences, end + 1);
  }
  return chunksIdx.map(pair => pair[1]); // doar indicii „end”
}

const extractSectionBlocks = (md) => {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let buf = [];
  let path = [];
  let blockStart = 0;

  const flush = (endIdx) => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ sectionPath: [...path], text, start: blockStart, end: endIdx });
    buf = [];
  };

  for (let i = 0, pos = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush(pos);
      const level = m[1].length;
      const title = m[2].trim();
      path = path.slice(0, level - 1);
      path[level - 1] = `${"#".repeat(level)} ${title}`;
      blockStart = pos + line.length + 1;
    } else {
      buf.push(line);
    }
    pos += line.length + 1;
  }
  flush(md.length);
  if (blocks.length === 0) blocks.push({ sectionPath: [], text: md, start: 0, end: md.length });
  return blocks;
};

async function llmSuggestBoundaries(client, model, sectionTitle, sentences, targetTokens, maxTokens, minTokens, overlapSentences) {
  const system = `Ești un segmentator de text pentru un asistent RAG în domeniul achizițiilor publice/ licitațiilor.
Scop: delimitezi bucăți (chunk-uri) care răspund bine la întrebări punctuale ulterioare.

PRINCIPII (în ordine):
1) Coerență pentru Q&A: păstrează împreună "cerință → condiții → excepții → criterii de evaluare → referințe".
2) Nu separa articole/puncte care se referă explicit unul la altul (ex: "conform art. 7 alin. (3) … vezi Tabelul 2").
3) Nu tăia în mijlocul listelor, tabelelor, definițiilor sau exemplelor.
4) Păstrează împreună trimiterile normative (legi, HG, OUG, standarde, anexe) cu textul pe care-l clarifică.
5) Preferă granițe la final de paragraf/heading; evită granițe după propoziții de legătură („în continuare”, „vezi mai jos”).
6) Dacă secțiunea este scurtă, poate rămâne un singur chunk.

CONSTRÂNGERI DE DIMENSIUNE:
- Țintește ~${targetTokens} tokeni/ chunk (±25% permis).
- NU depăși ${maxTokens} tokeni (hard).
- Evită chunk-uri sub ${minTokens} tokeni dacă poți (altfel atașează propoziții vecine).
- Output STRICT JSON: {"boundaries":[<index_end_0>, ...]} — fără alte câmpuri, fără text.`;

  const userPrompt =
`Secțiune: ${sectionTitle || "(fără titlu)"}

Ai lista de propoziții numerotate de la 0.
Returnează "boundaries" = lista indicilor (END-INCLUSIV) unde se termină fiecare chunk.

Note speciale pentru domeniu:
- Ține împreună: "Obiectul achiziției" cu "cerințe minime/tehnice", "criteriul de atribuire" cu "ponderi/scoruri",
  "condiții de participare" cu "documente justificative" și "motive de excludere".
- Nu separa "definiții/abrevieri" de prima apariție relevantă dacă sunt scurte.
- Nu separa "tabel + notele tabelului".
- Dacă întâlnești trimiteri (ex: „conform Anexa 3”/„vezi Figura 1”), nu tăia între trimitere și explicație.

Propoziții:
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

Amintește-ți: doar JSON valid, exact {"boundaries":[...]}.
`;

  const payload = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };

  // Timeout soft (nu anulăm requestul, doar ignorăm răspunsul dacă întârzie)
  const TIMEOUT_MS = 30_000;
  const llmCall = client.chat.completions.create(payload);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS));

  try {
    const t0 = Date.now();
    const resp = await Promise.race([llmCall, timeout]);
    const ms = Date.now() - t0;
    if (CHUNK_DEBUG) console.log(`   ↪ LLM OK [${model}] in ${ms}ms`);
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    const arr = Array.isArray(parsed.boundaries) ? parsed.boundaries : [];
    return arr.filter(n => Number.isInteger(n) && n >= 0 && n < sentences.length).sort((a, b) => a - b);
  } catch (err) {
    if (CHUNK_DEBUG) {
      console.warn(`   ⚠ LLM fail on "${sectionTitle || "(fara titlu)"}": ${err?.message || err}`);
      console.warn(`   → Fallback: greedyLocalChunk`);
    }
    return greedyLocalChunk(sentences, targetTokens, maxTokens, minTokens, overlapSentences);
  }
}

export async function splitAdaptiveWithAI(md, docId, opts = {}) {
  const targetTokens = opts.targetTokens ?? Number(process.env.CHUNK_TARGET_TOKENS ?? 1300);
  const maxTokens = opts.maxTokens ?? Number(process.env.CHUNK_MAX_TOKENS ?? 1500);
  const minTokens = opts.minTokens ?? Number(process.env.CHUNK_MIN_TOKENS ?? 450);
  const overlapSentences = opts.overlapSentences ?? Number(process.env.CHUNK_OVERLAP_SENTENCES ?? 4);

  const model = opts.chunkLLMModel ?? process.env.CHUNK_LLM_MODEL ?? "gpt-4.1-mini";

  if (CHUNK_DEBUG) {
    console.log(`ℹ️  Chunking model: ${model} | target≈${targetTokens}, max=${maxTokens}, min=${minTokens}, overlapSent=${overlapSentences}`);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sections = extractSectionBlocks(md);

  const chunks = [];
  let globalOrder = 0;

  for (const sec of sections) {
    const sents = sentenceSplit(sec.text);
    if (sents.length === 0) continue;

    if (CHUNK_DEBUG) {
      console.log(`   • Secțiune: "${sec.sectionPath.at(-1) ?? "(fara titlu)"}" | propoziții: ${sents.length}`);
    }

    // 1) cere granițele de la LLM (+ fallback local)
    let ends = await llmSuggestBoundaries(
      client,
      model,
      sec.sectionPath.at(-1) ?? "",
      sents,
      targetTokens,
      maxTokens,
      minTokens,
      overlapSentences
    );
    if (ends.length === 0 || ends[ends.length - 1] !== sents.length - 1) {
      ends = [...ends.filter((i) => i < sents.length - 1), sents.length - 1];
    }

    // 2) offseturi char pe secțiune
    let start = 0;
    let charOffsetInSection = 0;
    const sentChar = sents.map((s) => {
      const idx = sec.text.indexOf(s, charOffsetInSection);
      const res = { start: idx, end: idx + s.length };
      charOffsetInSection = res.end;
      return res;
    });

    const pushChunk = (sIdx, eIdx) => {
      const text = sents.slice(sIdx, eIdx + 1).join(" ").trim();
      if (!text) return;
      const charStart = sec.start + (sentChar[sIdx]?.start ?? 0);
      const charEnd = sec.start + (sentChar[eIdx]?.end ?? sec.end);
      chunks.push({
        id: `${docId}::${globalOrder}`,
        text,
        meta: {
          docId,
          sectionPath: sec.sectionPath,
          order: globalOrder,
          charStart,
          charEnd,
          sentStart: sIdx,
          sentEnd: eIdx,
        },
      });
      globalOrder++;
    };

    // 3) garduri hard: max/min + overlap (în propoziții)
    for (const end of ends) {
      let curStart = start;
      let curEnd = end;

      while (curStart <= curEnd) {
        let tks = 0;
        let lastOk = curStart - 1;
        for (let i = curStart; i <= curEnd; i++) {
          tks += approxTokens(sents[i]);
          if (tks <= maxTokens) lastOk = i;
          else break;
        }
        if (lastOk < curStart) lastOk = curStart;

        let finalEnd = lastOk;
        let size = 0;
        for (let i = curStart; i <= finalEnd; i++) size += approxTokens(sents[i]);

        if (size < minTokens && finalEnd < curEnd) {
          let j = finalEnd + 1;
          while (j <= curEnd && size + approxTokens(sents[j]) <= maxTokens) {
            size += approxTokens(sents[j]);
            finalEnd = j;
            j++;
            if (size >= minTokens) break;
          }
        }

        pushChunk(curStart, finalEnd);

        const nextStart = Math.max(finalEnd + 1 - overlapSentences, finalEnd + 1);
        curStart = nextStart;
      }

      start = end + 1;
    }
  }

  return chunks;
}
