/* ═══════════════════════════════════════════════════════════════════════════
   fal-router.mjs — Video-Verständnis via Fals OpenRouter-Router.
   Nutzt ein video-fähiges Gemini-Modell über Fals Abrechnung (ein FAL_KEY reicht,
   kein Google-Key nötig). Nimmt die YouTube-URL DIREKT als video_urls →
   kein Download/ffmpeg nötig.

   Immer über den Queue-Weg (queue.fal.run + Polling): die Sync-Endpoints antworteten
   in Tests intermittierend 401, die Queue blieb stabil (Latenz ist hier egal).

   Auth: FAL_KEY aus env, $VIDEO_INGEST_ENV_FILE, ./.env (Arbeitsverzeichnis) oder
   <skill>/.env. Nie loggen.
   Ablage: VIDEO_INGEST_OUTPUT_DIR (default ./output) und VIDEO_INGEST_ANALYSIS_DIR
   (default <output>/video-ingest), siehe outputDir()/analysisDir().
   Modell: FAL_VIDEO_MODEL (default google/gemini-3.8-flash, video-fähig).
   Reasoning: standardmäßig an (gemini-3.8-flash verlangt es); FAL_REASONING=0 lässt das Feld weg.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILLROOT = resolve(__dirname, '..');

// Ablage-Wurzeln. Relative Werte gelten ab dem Arbeitsverzeichnis.
export function outputDir() {
  return resolve(process.cwd(), process.env.VIDEO_INGEST_OUTPUT_DIR || 'output');
}
export function analysisDir() {
  return process.env.VIDEO_INGEST_ANALYSIS_DIR
    ? resolve(process.cwd(), process.env.VIDEO_INGEST_ANALYSIS_DIR)
    : join(outputDir(), 'video-ingest');
}

// Env-Dateien in Suchreihenfolge: VIDEO_INGEST_ENV_FILE (z. B. die .env eines Projekts),
// dann ./.env im Arbeitsverzeichnis, dann <skill>/.env.
function envFiles() {
  const extra = process.env.VIDEO_INGEST_ENV_FILE ? [resolve(process.cwd(), process.env.VIDEO_INGEST_ENV_FILE)] : [];
  return [...extra, resolve(process.cwd(), '.env'), join(SKILLROOT, '.env')];
}

export async function loadEnvValue(names) {
  for (const n of names) if (process.env[n]) return process.env[n].trim();
  for (const p of envFiles()) {
    if (existsSync(p)) {
      const txt = await readFile(p, 'utf8');
      for (const n of names) {
        const m = txt.match(new RegExp(`^\\s*${n}\\s*=\\s*["']?([^"'\\n\\r]+)`, 'm'));
        if (m) return m[1].trim();
      }
    }
  }
  return null;
}

export async function loadFalKey() {
  return loadEnvValue(['FAL_KEY']);
}

export function falVideoModel() {
  return process.env.FAL_VIDEO_MODEL || 'google/gemini-3.8-flash';
}

/** Reasoning-Flag für den Router: an, außer FAL_REASONING=0 (dann wird das Feld nicht gesendet).
 *  gemini-3.8-flash verlangt Reasoning: ohne das Feld antwortet Fal seit 28.09.2026 mit 400.
 *  FAL_REASONING=0 also nur für Modelle ohne diese Pflicht. */
export function falReasoningDefault() {
  return process.env.FAL_REASONING !== '0';
}

/**
 * prompt + optionale videoUrls → Text-Output des Modells.
 * Wirft mit .status bei HTTP-Fehler. Kein system_prompt → freier Text (Markdown), kein JSON-Zwang.
 */
export async function falVideoRouter(prompt, { videoUrls = [], model, maxTokens = 8192, temperature = 0.3, systemPrompt, reasoning = falReasoningDefault() } = {}) {
  const KEY = await loadFalKey();
  if (!KEY) { const e = new Error('FAL_KEY fehlt → in <skill>/.env eintragen (cp .env.example .env), oder als Umgebungsvariable setzen. Key: https://fal.ai/dashboard/keys'); e.status = 0; throw e; }
  const headers = { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' };
  const app = videoUrls.length ? 'openrouter/router/video' : 'openrouter/router';
  const payload = JSON.stringify({
    model: model || falVideoModel(),
    prompt,
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
    temperature,
    max_tokens: maxTokens,
    ...(reasoning ? { reasoning: true } : {}),
    ...(videoUrls.length ? { video_urls: videoUrls } : {}),
  });

  const sub = await fetch(`https://queue.fal.run/${app}`, { method: 'POST', headers, body: payload });
  if (!sub.ok) {
    const e = new Error(`Fal queue ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
    e.status = sub.status;
    throw e;
  }
  const { response_url, status_url, request_id } = await sub.json();
  // Preserve provider diagnostics without exposing the authentication key.
  const failure = async (response, stage) => {
    const detail = (await response.text()).replaceAll(KEY, '[REDACTED]');
    const e = new Error(`Fal ${stage} ${response.status} [request ${request_id}]: ${detail}`);
    e.status = response.status;
    e.requestId = request_id;
    return e;
  };
  const deadline = Date.now() + 360_000; // 6 min — lange Videos brauchen im Router länger
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    if (Date.now() > deadline) throw new Error(`Fal queue: Timeout (6 min) [request ${request_id}]`);
    const st = await fetch(status_url || `${response_url}/status`, { headers });
    if (!st.ok) throw await failure(st, 'status');
    const s = await st.json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error(`Fal queue: ${s.status} [request ${request_id}]: ${JSON.stringify(s).replaceAll(KEY, '[REDACTED]')}`);
  }
  const res = await fetch(response_url, { headers });
  if (!res.ok) throw await failure(res, 'result');
  const d = await res.json();
  const txt = typeof d?.output === 'string' ? d.output.trim() : '';
  if (!txt) throw new Error('Fal: leere Antwort — ' + JSON.stringify(d).slice(0, 200));
  return txt;
}
