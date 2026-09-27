#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   analyze-gemini.mjs — NATIVES Video-Verständnis via Gemini (Bild + Ton + Ablauf
   in EINEM Call). Schickt die YouTube-URL direkt an Gemini → understanding.md.
   Kein Frame-Sampling, keine lokale Download-/ffmpeg-Pipeline nötig.

   Auth: FAL_KEY aus env, ./.env oder <skill>/.env. Nie loggen.
   Modell: FAL_VIDEO_MODEL (default google/gemini-3.8-flash — video-fähig).
   Usage: node scripts/analyze-gemini.mjs "<youtube-url>" [--profile script-anatomy] [--outdir <pfad>]

   --profile script-anatomy → statt understanding.md entstehen
     transcript-verbatim.md (wortwörtlich, [mm:ss]/Zeile) + script-anatomy.md
     (Delivery-Statistik, Hook-Delivery, Übergangsphrasen, CTA, Rhetorik-Moves).
   --outdir <pfad> → Output-Basis umleiten (Script hängt <video-id> selbst an);
     default: ./output/video-ingest/<id>/ im Arbeitsverzeichnis.
   ═══════════════════════════════════════════════════════════════════════════ */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseCliArgs, SCRIPT_ANATOMY_PROMPT, splitScriptAnatomy, renderTranscriptMd, renderAnatomyMd } from './profiles.mjs';
import { falVideoRouter, falVideoModel, loadEnvValue } from './fal-router.mjs';

const CWD = process.cwd();

async function loadKey() {
  return loadEnvValue(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
}

const { positional, profile, outdir } = parseCliArgs(process.argv.slice(2));
const URL_ = positional[0];
if (!URL_) { console.error('Usage: analyze-gemini.mjs "<youtube-url>" [--profile script-anatomy] [--outdir <pfad>]'); process.exit(2); }
const IS_ANATOMY = profile === 'script-anatomy';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const VID = (URL_.match(/[?&]v=([\w-]{6,})/) || URL_.match(/youtu\.be\/([\w-]{6,})/) || [])[1] || 'video';

const PROMPT = `Du analysierst dieses YouTube-Video umfassend für ein YouTube-Content-System (Bild + Ton + Ablauf zusammen). Antworte auf DEUTSCH, kompakt und strukturiert als Markdown. Erfinde nichts; gib grobe Timestamps (mm:ss).

# 1 Worum geht's (2–3 Sätze) + Zielgruppe
# 2 Der Hook (erste ~30 Sek): gesprochener Inhalt sinngemäß + On-Screen-Text + was visuell zu sehen ist + welcher Hook-Mechanismus greift (Curiosity-Gap / Kontrast / Pattern-Interrupt / Versprechen …)
# 3 Struktur / Kapitel mit groben Timestamps
# 4 Visuals: Format (Talking-Head / Screen-Recording / Diagramme / B-Roll), Schnitt-Tempo, gezeigte Diagramme/Tabellen/Screenshots (INHALT, nicht nur "ein Diagramm"), Branding/Look
# 5 Stärkste Thumbnail- & Hook-Hebel (konkret, fürs Nachbauen)
# 6 Kernaussagen / Takeaways (Bullets)`;

const PROVIDER = (process.env.VIDEO_INGEST_PROVIDER || 'fal').toLowerCase();
const promptText = IS_ANATOMY ? SCRIPT_ANATOMY_PROMPT : PROMPT;
const TEMP = IS_ANATOMY ? 0.2 : 0.3;
const LABEL = PROVIDER === 'fal' ? `Fal · ${falVideoModel()}` : `Gemini ${MODEL}`;
let text = '';

if (PROVIDER === 'fal') {
  // Standard: Fals OpenRouter-Video-Router — ein FAL_KEY reicht für alles.
  try {
    text = await falVideoRouter(promptText, { videoUrls: [URL_], maxTokens: 8192, temperature: TEMP });
  } catch (e) {
    console.error(`Fal-Router fehlgeschlagen (${e.status ?? '?'}): ${e.message}`);
    process.exit(1);
  }
} else {
  // Fallback: direkter Gemini-Key (VIDEO_INGEST_PROVIDER=gemini).
  const KEY = await loadKey();
  if (!KEY) { console.error('GEMINI_API_KEY fehlt → in .env eintragen.'); process.exit(1); }
  const body = {
    contents: [{ parts: [{ fileData: { fileUri: URL_ } }, { text: promptText }] }],
    generationConfig: { temperature: TEMP },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(`Gemini ${res.status} (Modell ${MODEL}): ${(await res.text()).slice(0, 400)}`); process.exit(1); }
  const data = await res.json();
  text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}
// Fal/OpenRouter hängt gelegentlich ein Konversations-Vorwort + ```markdown-Zaun an → entschälen.
if (PROVIDER === 'fal') {
  text = text
    .replace(/^\s*(Absolut|Sure|Klar|Hier ist|Here is|Certainly|Of course|Gerne)[^\n]*\n+/i, '')
    .replace(/^```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
if (!text) { console.error('Leere Antwort vom Provider.'); process.exit(1); }

const outBase = outdir ? resolve(CWD, outdir) : join(CWD, 'output', 'video-ingest');
const out = join(outBase, VID);
await mkdir(out, { recursive: true });

if (IS_ANATOMY) {
  let sections;
  try { sections = splitScriptAnatomy(text); }
  catch (e) { console.error(e.message + '\n' + text.slice(0, 300)); process.exit(1); }
  await writeFile(join(out, 'transcript-verbatim.md'), renderTranscriptMd(VID, URL_, sections.transcript), 'utf8');
  await writeFile(join(out, 'script-anatomy.md'), renderAnatomyMd(VID, URL_, sections.anatomy, LABEL), 'utf8');
  console.log(`✅ Script-Anatomie → ${join(out, 'transcript-verbatim.md').replace(CWD + '/', '')} + ${join(out, 'script-anatomy.md').replace(CWD + '/', '')}  (${text.length} Zeichen, ${LABEL})`);
} else {
  await writeFile(join(out, 'understanding.md'), `# Video-Verständnis (${LABEL}) — ${VID}\n\nQuelle: ${URL_}\n\n${text}\n`, 'utf8');
  console.log(`✅ Analyse (${LABEL}) → ${join(out, 'understanding.md').replace(CWD + '/', '')}  (${text.length} Zeichen)`);
}
