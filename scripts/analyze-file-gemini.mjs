#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   analyze-file-gemini.mjs — NATIVES Video-Verständnis via Gemini für eine
   LOKALE Videodatei (z.B. ein heruntergeladenes Instagram-Reel). Schwester von
   analyze-gemini.mjs (das nur YouTube-URLs kann).

   Die Datei wird in einen Supabase-Storage-Bucket gespiegelt (der Fal-Router
   braucht eine abrufbare URL statt Inline-Bytes) und dann analysiert. Gibt
   STRUKTURIERTES JSON (Script-Anatomie) auf stdout zurück; der Aufrufer
   schreibt record.json/understanding.md.

   Auth: FAL_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY aus env, ./.env
   oder <skill>/.env. Bucket via VIDEO_INGEST_BUCKET (default research-videos,
   muss public-read sein). Nie loggen.
   Modell: FAL_VIDEO_MODEL (default google/gemini-2.5-flash — video-fähig).
   Usage: node analyze-file-gemini.mjs <video-datei> [--profile script-anatomy] [--outdir <pfad>]

   --profile script-anatomy → Verbatim-Transkript + Delivery-Anatomie statt der
     Default-Script-Rekonstruktion; stdout-JSON = { profile, transcript_verbatim_md,
     script_anatomy_md, … }. Ohne Flag: exakt heutiges Verhalten.
   --outdir <pfad> → schreibt die Outputs ZUSÄTZLICH als Dateien direkt in <pfad>
     (script-anatomy: transcript-verbatim.md + script-anatomy.md · default: record.json).
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { parseCliArgs, SCRIPT_ANATOMY_PROMPT, splitScriptAnatomy, renderTranscriptMd, renderAnatomyMd } from './profiles.mjs';
import { falVideoRouter, loadEnvValue } from './fal-router.mjs';

// Supabase-Config aus env / ./.env / <skill>/.env (für den Bucket-Upload; FAL_KEY holt fal-router selbst).
async function loadSupabase() {
  return {
    url: await loadEnvValue(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']),
    key: await loadEnvValue(['SUPABASE_SERVICE_ROLE_KEY']),
    bucket: (await loadEnvValue(['VIDEO_INGEST_BUCKET'])) || 'research-videos',
  };
}

const { positional, profile, outdir } = parseCliArgs(process.argv.slice(2));
const FILE = positional[0];
if (!FILE || !existsSync(FILE)) { console.error('Usage: analyze-file-gemini.mjs <video-datei> [--profile script-anatomy] [--outdir <pfad>]'); process.exit(2); }
const IS_ANATOMY = profile === 'script-anatomy';
const OUTDIR = outdir ? resolve(process.cwd(), outdir) : null;
const MODEL = 'Fal · ' + (process.env.FAL_VIDEO_MODEL || 'google/gemini-2.5-flash');

const PROMPT = `Du analysierst dieses Instagram-Reel, um sein SCRIPT zu rekonstruieren (für ein Reel-Content-System). Bild + Ton + Ablauf zusammen. Erfinde NICHTS; was unklar ist, lass leer.

Gib NUR ein JSON-Objekt zurück, exakt mit diesen Feldern:
{
 "duration_s": number,
 "topic": "worum geht's, 3-6 Wörter",
 "hook": {
   "type": "einer von: result-first | problem-callout | contrarian-claim | question | bold-promise | curiosity-gap | stat-shock | tutorial-direct",
   "verbatim_en": "die ERSTEN gesprochenen Worte, wortwörtlich (Originalsprache)",
   "onscreen_en": "On-Screen-Text in den ersten ~3s, wortwörtlich",
   "visual_0_3s": "was in den ersten ~3s zu SEHEN ist (visual payoff?)",
   "mechanism": "warum es stoppt, 1 Satz"
 },
 "beats": [ { "idx": number, "label": "kurz", "start_s": number, "dur_s": number, "purpose": "was dieser Beat tut", "spoken_gist": "sinngemäß", "onscreen_en": "On-Screen-Text wortwörtlich oder leer", "visual": "was zu sehen ist" } ],
 "reason_pattern": "einer von: demo | step-by-step | listicle | story | teardown | reaction",
 "cta": { "type": "z.B. comment-keyword-followgate | follow | link-in-bio | none", "keyword": "z.B. AI oder leer", "verbatim_en": "der CTA wortwörtlich", "placement_s": number },
 "format": "einer von: talkinghead+screenrec | screenrec | aroll | ai-visual-montage | mixed",
 "visual_devices": ["z.B. ai-visuals, dense-onscreen-text, zoom-punch-ins, captions"],
 "pacing": { "cuts_per_sec_tier": "slow | medium | fast | very-fast", "hold_on_key_frames": "halten Key-Frames lang genug? kurze Einschätzung" },
 "retention_devices": ["z.B. open-loop, numbered-steps, before-after, pattern-interrupt"],
 "transcript_verbatim": "das KOMPLETTE gesprochene Transkript, wortwörtlich, Originalsprache",
 "notes": "alles Auffällige fürs Nachbauen"
}`;

// Lokale Datei in den Supabase-Bucket spiegeln → Public-URL (der Fal-Router braucht eine URL
// statt Inline-Bytes; dadurch entfällt auch der frühere 14MB-Inline-Cap).
async function uploadToBucket(sb) {
  if (!sb.url || !sb.key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen in .env — für den Fal-Video-Upload nötig (siehe SETUP.md)');
  const buf = await readFile(FILE);
  const key = `ingest/${Date.now()}-${basename(FILE)}`.replace(/[^a-zA-Z0-9._/-]/g, '_');
  const up = await fetch(`${sb.url}/storage/v1/object/${sb.bucket}/${key}`, {
    method: 'POST',
    headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) throw new Error(`Bucket-Upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  console.error(`→ Fal-Upload ${(buf.length / 1e6).toFixed(1)} MB → ${sb.bucket}/${key}`);
  return `${sb.url}/storage/v1/object/public/${sb.bucket}/${key}`;
}

const sb = await loadSupabase();
const videoUrl = await uploadToBucket(sb);
let text;
try {
  text = await falVideoRouter(IS_ANATOMY ? SCRIPT_ANATOMY_PROMPT : PROMPT, { videoUrls: [videoUrl], maxTokens: 24576, temperature: 0.2 });
} catch (e) {
  console.error(`Fal-Router fehlgeschlagen (${e.status ?? '?'}): ${e.message}`);
  process.exit(1);
}
if (!text) { console.error('Leere Antwort vom Fal-Router.'); process.exit(1); }
text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); // Fal hängt manchmal einen Codezaun an

if (IS_ANATOMY) {
  let sections;
  try { sections = splitScriptAnatomy(text); }
  catch (e) { console.error(e.message + '\n' + text.slice(0, 300)); process.exit(1); }
  if (OUTDIR) {
    await mkdir(OUTDIR, { recursive: true });
    await writeFile(join(OUTDIR, 'transcript-verbatim.md'), renderTranscriptMd(basename(FILE), FILE, sections.transcript), 'utf8');
    await writeFile(join(OUTDIR, 'script-anatomy.md'), renderAnatomyMd(basename(FILE), FILE, sections.anatomy, MODEL), 'utf8');
    console.error(`→ geschrieben: ${join(OUTDIR, 'transcript-verbatim.md')} + ${join(OUTDIR, 'script-anatomy.md')}`);
  }
  process.stdout.write(JSON.stringify({
    profile: 'script-anatomy', model: MODEL, source_file: basename(FILE),
    transcript_verbatim_md: sections.transcript, script_anatomy_md: sections.anatomy,
  }) + '\n');
} else {
  // Validitäts-Check (Default-Verhalten unverändert)
  try { JSON.parse(text); } catch (e) { console.error('Kein valides JSON: ' + e.message + '\n' + text.slice(0, 300)); process.exit(1); }
  if (OUTDIR) {
    await mkdir(OUTDIR, { recursive: true });
    await writeFile(join(OUTDIR, 'record.json'), text + '\n', 'utf8');
    console.error(`→ geschrieben: ${join(OUTDIR, 'record.json')}`);
  }
  process.stdout.write(text + '\n');
}
