#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   mine-reels.mjs — Bulk-Mining einer CSV mit Instagram-Reel-Links.
   Liest die CSV (Spalten: url,date,views,likes,comments,caption), läuft mit
   Concurrency-Cap über alle URLs (ingest-instagram → Gemini-Anatomie), joint die
   Performance-Metadaten in jeden Record und schreibt den Korpus.

   Output: $VIDEO_INGEST_OUTPUT_DIR (default ./output)/reel-mining/_corpus.jsonl  (+ _failures.log)
   Heavy Work bleibt in den Subprozessen — hier kommt nur Text/JSON zusammen.

   Usage:
     node mine-reels.mjs --csv <pfad> [--concurrency 6] [--limit N] [--ids a,b,c]
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ingestOne, reelId } from './ingest-instagram.mjs';
import { outputDir } from './fal-router.mjs';

const CWD = process.cwd();

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const CSV = arg('csv', null);
if (!CSV) { console.error('Usage: mine-reels.mjs --csv <pfad.csv> [--concurrency 6] [--limit N] [--ids a,b,c]'); process.exit(2); }
const CONC = parseInt(arg('concurrency', '6'), 10);
const LIMIT = arg('limit') ? parseInt(arg('limit'), 10) : null;
const ONLY = arg('ids') ? new Set(arg('ids').split(',').map((s) => s.trim())) : null;

// ── Minimal RFC-4180 CSV-Parser (quoted fields, embedded commas/newlines, "") ──
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const num = (s) => { const v = (s || '').replace(/[,\s]/g, ''); return /^\d+$/.test(v) ? parseInt(v, 10) : null; };

const raw = await readFile(CSV, 'utf8');
const rows = parseCSV(raw);
const header = rows.shift().map((h) => h.trim().toLowerCase());
const col = (name) => header.indexOf(name);
let records = rows.map((r) => ({
  url: r[col('url')]?.trim(),
  date: r[col('date')]?.trim() || null,
  views: num(r[col('views')]),
  likes: num(r[col('likes')]),
  comments: num(r[col('comments')]),
  caption: (r[col('caption')] || '').trim(),
})).filter((m) => m.url && reelId(m.url));

// dedupe per id
const seen = new Set();
records = records.filter((m) => { const id = reelId(m.url); if (seen.has(id)) return false; seen.add(id); return true; });
if (ONLY) records = records.filter((m) => ONLY.has(reelId(m.url)));
if (LIMIT) records = records.slice(0, LIMIT);

const outDir = join(outputDir(), 'reel-mining');
await mkdir(outDir, { recursive: true });
const corpusPath = join(outDir, '_corpus.jsonl');
const failPath = join(outDir, '_failures.log');
await writeFile(corpusPath, '', 'utf8');
await writeFile(failPath, '', 'utf8');

console.error(`▶ Mining ${records.length} Reels  (concurrency ${CONC}, csv ${CSV})`);
let ok = 0, skip = 0, fail = 0, done = 0;
const N = records.length;

async function worker(queue) {
  for (;;) {
    const m = queue.shift();
    if (!m) return;
    const eng = m.views ? +(((m.likes || 0) + (m.comments || 0)) / m.views).toFixed(4) : null;
    const meta = { date: m.date, views: m.views, likes: m.likes, comments: m.comments,
      engagement_rate: eng, caption: m.caption.slice(0, 800) };
    let r;
    try { r = await ingestOne(m.url, { meta }); }
    catch (e) { r = { id: reelId(m.url), url: m.url, status: 'fail', error: String(e.message).slice(0, 200) }; }
    done++;
    if (r.status === 'fail') { fail++; await appendFile(failPath, `${r.id || m.url}\t${r.error}\n`); }
    else {
      r.status === 'skip' ? skip++ : ok++;
      const rec = { ...r.record, ...meta, id: r.id, url: m.url, engagement_rate: eng };
      await appendFile(corpusPath, JSON.stringify(rec) + '\n');
    }
    process.stderr.write(`\r  ${done}/${N}  ok:${ok} skip:${skip} fail:${fail}   `);
  }
}
const queue = [...records];
await Promise.all(Array.from({ length: Math.min(CONC, records.length) }, () => worker(queue)));

process.stderr.write('\n');
console.error(`✅ Korpus: ${corpusPath.replace(CWD + '/', '')}  (${ok + skip} Records, ${fail} Fehler → _failures.log)`);
