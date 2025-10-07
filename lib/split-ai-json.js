// lib/split-ai-json.js
import OpenAI from "openai";

const CHUNK_DEBUG = (process.env.CHUNK_DEBUG || "1") !== "0";
const approxTokens = (s) => Math.ceil(String(s || "").length / 4);
const clean = (s) => (s || "").replace(/\u00A0/g, " ").trim();

/* =========================
   1) EXTRAGERE UNITĂȚI JSON
   =========================
   Traversăm doc.pages[].items[] și construim unități:
   - HEAD: heading (doar pentru context/etichete)
   - TEXT: paragrafe/liste (vor fi splitate în propoziții)
   - TABLE: tabele (chunk separat, fără LLM)
*/
export function extractJsonUnits(doc) {
  const units = [];                 // { kind:'HEAD'|'TEXT'|'TABLE', text?, html?, page, headingPath:[] }
  let path = [];

  const pushHead = (title, lvl, page) => {
    const t = clean(title);
    if (!t) return;
    const level = Math.max(1, Math.min(6, Number(lvl) || (path.length + 1)));
    path = path.slice(0, level - 1);
    path[level - 1] = t;
    units.push({ kind: "HEAD", text: t, page, headingPath: [...path] });
  };

  const visitItem = (it, page) => {
    if (!it) return;

    // heading
    if (it.type === "heading") {
      pushHead(it.value || it.md || "", it.lvl, page);
      return;
    }

    // text
    if (it.type === "text") {
      const txt = clean(it.value || it.md);
      if (txt) units.push({ kind: "TEXT", text: txt, page, headingPath: [...path] });
      return;
    }

    // list (ca text liniarizat)
    if (it.type === "list" || (Array.isArray(it.items) && it.items.length)) {
      const list = (it.items || [])
        .map((x) => `• ${clean(typeof x === "string" ? x : x?.text || x?.value || x?.md)}`)
        .filter(Boolean)
        .join("\n");
      if (list) units.push({ kind: "TEXT", text: list, page, headingPath: [...path] });
      return;
    }

    // table
    if (it.type === "table") {
      const html = it.html || it.table_html || it.md;
      if (html) units.push({ kind: "TABLE", html: String(html), page, headingPath: [...path] });
      return;
    }

    // fallback: orice alt tip cu value/md ca text
    const any = clean(it.value || it.md || "");
    if (any) units.push({ kind: "TEXT", text: any, page, headingPath: [...path] });
  };

  if (Array.isArray(doc?.pages)) {
    for (const pg of doc.pages) {
      const pageNo = pg?.page ?? pg?.page_number ?? null;

      if (Array.isArray(pg.items) && pg.items.length) {
        for (const it of pg.items) visitItem(it, pageNo);
      } else {
        const big = clean(pg.text || pg.md);
        if (big) units.push({ kind: "TEXT", text: big, page: pageNo, headingPath: [...path] });
      }
    }
  } else {
    // fallback generic (dacă lipsesc pages[])
    const big = clean(doc.text || doc.md);
    if (big) units.push({ kind: "TEXT", text: big, page: null, headingPath: [...path] });
  }

  return units;
}

/* =========================
   2) UTILITARE SPLIT PE TEXT
   ========================= */
export function sentenceSplit(text) {
  const SEP = "<<<SPLIT>>>";
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([.?!;:])\s+(?=[A-ZĂÂÎȘȚ0-9\[\(“"])/gu, `$1${SEP}`)
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

    let size = 0; for (let i = start; i <= end; i++) size += approxTokens(sentences[i]);
    while (size < minTokens && end + 1 < sentences.length && size + approxTokens(sentences[end + 1]) <= maxTokens) {
      end++;
      size += approxTokens(sentences[end]);
    }

    chunksIdx.push([start, end]);
    start = Math.max(end + 1 - overlapSentences, end + 1);
  }
  return chunksIdx.map((p) => p[1]);
}

/* =============================================
   3) GRUPARE TEXT RUNS (contiguu, fără tabelele)
   ============================================= */
function groupTextRuns(units) {
  const groups = []; // { headingPath:[], run:[{text,page,headingPath}] }
  let cur = null;

  const flush = () => { if (cur && cur.run.length) groups.push(cur); cur = null; };

  for (const u of units) {
    if (u.kind === "TABLE") { flush(); continue; }
    if (u.kind === "HEAD")  { flush(); continue; } // HEAD marchează schimbare de context

    // TEXT
    if (!cur) cur = { headingPath: u.headingPath || [], run: [] };
    const keyA = (cur.headingPath || []).join(">");
    const keyB = (u.headingPath || []).join(">");
    if (keyA && keyB && keyA !== keyB) { flush(); cur = { headingPath: u.headingPath || [], run: [] }; }
    cur.run.push({ text: u.text, page: u.page, headingPath: u.headingPath || [] });
  }
  flush();
  return groups;
}

/* ==========================================================
   4) LLM BOUNDARIES pe JSON (trimitem propoziții + meta pagină)
   ========================================================== */
async function llmSuggestBoundariesJSON(client, model, label, sentObjs, targetTokens, maxTokens, minTokens) {
  const system = `Ești un segmentator de text pentru un asistent RAG (achiziții publice).
Returnezi granițe între propoziții pentru a forma chunk-uri coerente.

REGULI:
- Nu tăia în interiorul listelor sau definițiilor consecutive.
- Respectă schimbările de pagină (page_number) când ajută coerența.
- Tabelele NU sunt incluse aici (se tratează separat).
- Țintește ~${targetTokens} tokeni/chunk (±25%), max ${maxTokens}, minim ${minTokens}.
- Output STRICT JSON: {"boundaries":[<index_end_0>, ...]}`;

  const payloadUser = {
    label: label || "",
    sentences: sentObjs.map((s, i) => ({
      i,
      page: s.page ?? null,
      headingPath: s.headingPath || [],
      text: s.text
    }))
  };

  const payload = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payloadUser) },
    ],
  };

  const TIMEOUT_MS = 30000;
  const llmCall = client.chat.completions.create(payload);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS));

  try {
    const t0 = Date.now();
    const resp = await Promise.race([llmCall, timeout]);
    const ms = Date.now() - t0;
    if (CHUNK_DEBUG) console.log(`   ↪ LLM JSON OK [${model}] in ${ms}ms`);
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    const arr = Array.isArray(parsed.boundaries) ? parsed.boundaries : [];
    return arr.filter(n => Number.isInteger(n) && n >= 0 && n < sentObjs.length).sort((a, b) => a - b);
  } catch (err) {
    if (CHUNK_DEBUG) {
      console.warn(`   ⚠ LLM JSON fail on "${label || "(fara label)"}": ${err?.message || err}`);
      console.warn(`   → Fallback: greedyLocalChunk`);
    }
    const sentences = sentObjs.map(s => s.text);
    return greedyLocalChunk(sentences, targetTokens, maxTokens, minTokens, /*overlapSentences not used here*/ 4);
  }
}

/* ============================================
   5) API PRINCIPAL: split pe JSON cu paginare
   ============================================ */
export async function splitFromJson(llamaJson, docId, opts = {}) {
  const targetTokens = Number(opts.targetTokens ?? process.env.CHUNK_TARGET_TOKENS ?? 1300);
  const maxTokens = Number(opts.maxTokens ?? process.env.CHUNK_MAX_TOKENS ?? 1500);
  const minTokens = Number(opts.minTokens ?? process.env.CHUNK_MIN_TOKENS ?? 450);
  const overlapSentences = Number(opts.overlapSentences ?? process.env.CHUNK_OVERLAP_SENTENCES ?? 4);
  const model = opts.chunkLLMModel ?? process.env.CHUNK_LLM_MODEL ?? "gpt-4.1-mini";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const units = extractJsonUnits(llamaJson);
  const chunks = [];
  let order = 0;

  // 5a) Tabele → chunk separat (fără LLM), cu pagina exactă
  for (const u of units) {
    if (u.kind !== "TABLE") continue;
    const headTitle = u.headingPath?.length ? u.headingPath[u.headingPath.length - 1] : null;
    const prefix = headTitle ? `HEADING: ${headTitle}\n` : "";
    const pg = u.page != null ? `Page: ${u.page}\n` : "";
    chunks.push({
      id: `${docId}::tbl_${order++}`,
      text: `${prefix}${pg}${u.html}`,
      meta: {
        docId,
        headingPath: u.headingPath || [],
        pageStart: u.page,
        pageEnd: u.page,
        type: "table",
        src: "json",
        order: order - 1,
      },
    });
  }

  // 5b) TEXT runs → propoziții + LLM boundaries + garduri hard
  const groups = groupTextRuns(units);

  for (const g of groups) {
    const sentObjs = [];
    for (const item of g.run) {
      const sents = sentenceSplit(item.text);
      for (const s of sents) sentObjs.push({ text: s, page: item.page, headingPath: item.headingPath });
    }
    if (!sentObjs.length) continue;

    let ends = await llmSuggestBoundariesJSON(
      client, model,
      (g.headingPath || []).join(" > "),
      sentObjs,
      targetTokens, maxTokens, minTokens
    );

    // asigurăm că ultimul end acoperă tot
    const lastEnd = ends.length ? ends[ends.length - 1] : sentObjs.length - 1;
    const fixedEnds = [...ends.filter(i => i < sentObjs.length - 1), Math.max(lastEnd, sentObjs.length - 1)];

    let start = 0;
    for (const e of fixedEnds) {
      // garduri hard max/min + overlap în propoziții
      let curStart = start;
      let curEnd = e;

      while (curStart <= curEnd) {
        let tks = 0;
        let lastOk = curStart - 1;
        for (let i = curStart; i <= curEnd; i++) {
          tks += approxTokens(sentObjs[i].text);
          if (tks <= maxTokens) lastOk = i;
          else break;
        }
        if (lastOk < curStart) lastOk = curStart;

        let finalEnd = lastOk;
        let size = 0;
        for (let i = curStart; i <= finalEnd; i++) size += approxTokens(sentObjs[i].text);
        if (size < minTokens && finalEnd < curEnd) {
          let j = finalEnd + 1;
          while (j <= curEnd && size + approxTokens(sentObjs[j].text) <= maxTokens) {
            size += approxTokens(sentObjs[j].text);
            finalEnd = j;
            j++;
            if (size >= minTokens) break;
          }
        }

        // asamblăm chunk-ul
        const text = sentObjs.slice(curStart, finalEnd + 1).map(x => x.text).join(" ").trim();
        const pages = sentObjs.slice(curStart, finalEnd + 1).map(x => x.page).filter((p) => p != null);
        const pageStart = pages.length ? Math.min(...pages) : undefined;
        const pageEnd   = pages.length ? Math.max(...pages) : undefined;
        const hp = sentObjs[finalEnd]?.headingPath || g.headingPath || [];

        chunks.push({
          id: `${docId}::${order++}`,
          text,
          meta: {
            docId,
            headingPath: hp,
            pageStart,
            pageEnd,
            type: "text",
            src: "json",
            order: order - 1,
          },
        });

        const nextStart = Math.max(finalEnd + 1 - overlapSentences, finalEnd + 1);
        curStart = nextStart;
      }

      start = e + 1;
    }
  }

  // stabilitate
  chunks.sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0));
  if (CHUNK_DEBUG) console.log(`📌 splitFromJson → chunks: ${chunks.length}`);
  return chunks;
}
