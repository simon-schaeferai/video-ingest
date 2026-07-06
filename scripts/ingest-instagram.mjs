#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   ingest-instagram.mjs — eine Instagram-Reel-URL → Script-Anatomie.
   yt-dlp lädt das Reel (≤720p mp4) → analyze-file-gemini.mjs (Gemini sieht das
   ganze Video) → schreibt record.json (strukturiert) + understanding.md (lesbar)
   nach ./output/reel-mining/<id>/.

   IDEMPOTENT: vorhandenes record.json → skip. Fehler (Login-gated/gelöscht)
   werden zurückgegeben, nicht still verschluckt.

   CLI:    node ingest-instagram.mjs "<reel-url>" [--profile script-anatomy] [--outdir <pfad>]
   Import: import { ingestOne } from './ingest-instagram.mjs'

   --profile script-anatomy → wird an analyze-file-gemini.mjs durchgereicht;
     statt understanding.md entstehen transcript-verbatim.md + script-anatomy.md
     (+ record-script-anatomy.json — koexistiert mit dem Default-record.json,
     Idempotenz-Check läuft pro Profil).
   --outdir <pfad> → Output-Basis umleiten (Script hängt <reel-id> selbst an);
     default: ./output/reel-mining/<id>/ im Arbeitsverzeichnis.
   ═══════════════════════════════════════════════════════════════════════════ */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, renderTranscriptMd, renderAnatomyMd } from './profiles.mjs';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();
const ANALYZE = join(__dirname, 'analyze-file-gemini.mjs');

export function reelId(url) {
  const m = url.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function renderUnderstanding(r) {
  const beats = (r.beats || []).map((b) =>
    `${b.idx ?? '·'}. **${b.label || ''}** (${b.start_s ?? '?'}s, ${b.dur_s ?? '?'}s) — ${b.purpose || ''}\n   - 🎙️ ${b.spoken_gist || ''}\n   - 📱 ${b.onscreen_en || '—'}\n   - 🎬 ${b.visual || ''}`
  ).join('\n');
  return `# Reel-Verständnis — ${r.id}

Quelle: ${r.url}  ·  ${r.views ? r.views.toLocaleString('de-DE') + ' Views' : ''} ${r.likes ? '· ' + r.likes.toLocaleString('de-DE') + ' Likes' : ''}
Thema: ${r.topic || ''}  ·  Dauer: ${r.duration_s || '?'}s  ·  Format: ${r.format || ''}

## Hook (${r.hook?.type || '?'})
- 🎙️ ${r.hook?.verbatim_en || ''}
- 📱 ${r.hook?.onscreen_en || '—'}
- 🎬 ${r.hook?.visual_0_3s || ''}
- ⚙️ ${r.hook?.mechanism || ''}

## Beats (Reason: ${r.reason_pattern || '?'})
${beats}

## CTA (${r.cta?.type || '?'})
- ${r.cta?.verbatim_en || ''}  ·  Keyword: **${r.cta?.keyword || '—'}**  ·  @ ${r.cta?.placement_s ?? '?'}s

## Pacing & Visuals
- Schnitt: ${r.pacing?.cuts_per_sec_tier || '?'} · ${r.pacing?.hold_on_key_frames || ''}
- Visual-Devices: ${(r.visual_devices || []).join(', ')}
- Retention: ${(r.retention_devices || []).join(', ')}

## Transkript (verbatim, Original)
${r.transcript_verbatim || ''}

${r.notes ? '## Notizen\n' + r.notes + '\n' : ''}`;
}

export async function ingestOne(url, { keepVideo = true, meta = null, profile = null, outdir = null } = {}) {
  const id = reelId(url);
  if (!id) return { id: null, url, status: 'fail', error: 'keine Reel-ID in URL' };
  const isAnatomy = profile === 'script-anatomy';
  const dir = outdir
    ? join(resolve(CWD, outdir), id)
    : join(CWD, 'output', 'reel-mining', id);
  // Idempotenz pro Profil: script-anatomy hat eine eigene Record-Datei,
  // damit ein bereits default-geminte Reel nicht fälschlich geskippt wird.
  const recPath = join(dir, isAnatomy ? 'record-script-anatomy.json' : 'record.json');
  if (existsSync(recPath)) {
    try { return { id, url, status: 'skip', record: JSON.parse(await readFile(recPath, 'utf8')), dir }; } catch {}
  }
  await mkdir(dir, { recursive: true });
  const videoPath = join(dir, 'video.mp4');
  const infoPath = join(dir, 'video.info.json');
  try {
    if (!existsSync(videoPath)) {
      await exec('yt-dlp', ['--no-warnings', '-f', 'bv*+ba/b', '-S', 'res:720',
        '--merge-output-format', 'mp4', '--write-info-json',
        '-o', join(dir, 'video.%(ext)s'), url], { timeout: 180000, maxBuffer: 1 << 26 });
    }
  } catch (e) {
    return { id, url, status: 'fail', error: 'yt-dlp: ' + String(e.stderr || e.message).slice(0, 200), dir };
  }
  if (!existsSync(videoPath)) return { id, url, status: 'fail', error: 'kein video.mp4 nach Download', dir };

  let infoDur = null, infoTitle = null;
  if (existsSync(infoPath)) { try { const j = JSON.parse(await readFile(infoPath, 'utf8')); infoDur = j.duration; infoTitle = j.title; } catch {} }

  let rec;
  try {
    const analyzeArgs = [ANALYZE, videoPath];
    if (profile) analyzeArgs.push('--profile', profile);
    const { stdout } = await exec('node', analyzeArgs, { timeout: 240000, maxBuffer: 1 << 26 });
    rec = JSON.parse(stdout);
  } catch (e) {
    return { id, url, status: 'fail', error: 'gemini: ' + String(e.stderr || e.message).slice(0, 200), dir };
  }
  rec.id = id; rec.url = url;
  if (!rec.duration_s && infoDur) rec.duration_s = Math.round(infoDur);
  if (infoTitle) rec.source_title = infoTitle;
  if (meta) Object.assign(rec, meta); // Performance-Metadaten (views/likes/…) aus der CSV

  await writeFile(recPath, JSON.stringify(rec, null, 2), 'utf8');
  if (isAnatomy) {
    await writeFile(join(dir, 'transcript-verbatim.md'), renderTranscriptMd(id, url, rec.transcript_verbatim_md || ''), 'utf8');
    await writeFile(join(dir, 'script-anatomy.md'), renderAnatomyMd(id, url, rec.script_anatomy_md || '', rec.model), 'utf8');
  } else {
    await writeFile(join(dir, 'understanding.md'), renderUnderstanding(rec), 'utf8');
  }
  if (!keepVideo) await rm(videoPath, { force: true });
  return { id, url, status: 'ok', record: rec, dir };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { positional, profile, outdir } = parseCliArgs(process.argv.slice(2));
  const url = positional[0];
  if (!url) { console.error('Usage: ingest-instagram.mjs "<reel-url>" [--profile script-anatomy] [--outdir <pfad>]'); process.exit(2); }
  const r = await ingestOne(url, { profile, outdir });
  if (r.status === 'fail') { console.error(`✗ ${r.id || url}: ${r.error}`); process.exit(1); }
  const mainFile = profile === 'script-anatomy' ? 'script-anatomy.md' : 'record.json';
  console.log(`${r.status === 'skip' ? '↩︎ skip' : '✅'} ${r.id} → ${r.dir.replace(CWD + '/', '')}/${mainFile}`);
}
