/* ═══════════════════════════════════════════════════════════════════════════
   profiles.mjs — geteilte Mining-Profile für video-ingest.
   Genutzt von analyze-gemini.mjs (YouTube-URL), analyze-file-gemini.mjs
   (lokale Datei) und ingest-instagram.mjs (Orchestrator).

   ADDITIV: ohne --profile bleibt das Default-Verhalten der Scripts exakt
   unverändert. Profile werden nur via CLI-Flag aktiv.

   Profil "script-anatomy": Verbatim-Transkript (wortwörtlich, [mm:ss] pro
   Sinneinheit) + Script-Anatomie (Delivery-Statistik, Hook-Delivery,
   Übergangsphrasen, CTA-Delivery, Rhetorik-Moves) als zwei Markdown-Dateien:
   transcript-verbatim.md + script-anatomy.md.
   ═══════════════════════════════════════════════════════════════════════════ */

export const PROFILES = ['script-anatomy'];

/* ── CLI-Args: positional + --profile <name> + --outdir <pfad> ─────────────── */
export function parseCliArgs(argv) {
  const out = { positional: [], profile: null, outdir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') out.profile = argv[++i] ?? null;
    else if (a.startsWith('--profile=')) out.profile = a.slice('--profile='.length);
    else if (a === '--outdir') out.outdir = argv[++i] ?? null;
    else if (a.startsWith('--outdir=')) out.outdir = a.slice('--outdir='.length);
    else out.positional.push(a);
  }
  if (out.profile && !PROFILES.includes(out.profile)) {
    console.error(`Unbekanntes Profil "${out.profile}" — verfügbar: ${PROFILES.join(', ')}`);
    process.exit(2);
  }
  return out;
}

/* ── script-anatomy: Gemini-Prompt (Text-Antwort mit Markern, KEIN JSON) ───── */
export const TRANSCRIPT_MARKER = '<<<TRANSCRIPT-VERBATIM>>>';
export const ANATOMY_MARKER = '<<<SCRIPT-ANATOMY>>>';

export const SCRIPT_ANATOMY_PROMPT = `Du analysierst dieses Video als Script-Anatomie-Miner für ein Scriptwriting-System. Analyse-Text auf DEUTSCH — aber ALLES Transkribierte und alle wörtlichen Zitate bleiben exakt in der Originalsprache des Sprechers. Erfinde NICHTS.

WICHTIGSTE REGEL — VERBATIM-TREUE:
Transkribiere WÖRTLICH, inklusive Füllwörter wie „ähm", „äh", „halt", „einfach", „also", „like", „you know" — und inklusive Wiederholungen und Selbstkorrekturen („das ist… das war eigentlich…"). Paraphrasiere NICHT, glätte NICHTS, lasse NICHTS weg. Fasse NIEMALS zusammen. Wenn du ein Wort nicht verstehst, schreibe [unverständlich].

Gib deine Antwort EXAKT in dieser Struktur zurück. Die beiden Marker-Zeilen ${TRANSCRIPT_MARKER} und ${ANATOMY_MARKER} müssen unverändert und jeweils allein auf einer Zeile stehen. Vor dem ersten Marker steht nichts.

${TRANSCRIPT_MARKER}
Das komplette gesprochene Transkript, wortwörtlich. EINE Zeile pro gesprochener Sinneinheit/Atemzug (dort umbrechen, wo der Sprecher absetzt oder Luft holt). Jede Zeile beginnt mit dem Timestamp [mm:ss]. Keine Überschriften, keine Kommentare, keine Sprecher-Labels — nur Timestamp-Zeilen.

${ANATOMY_MARKER}
## Delivery-Statistik
- Wörter pro Zeile: min … · Median … · max …
- Geschätzte WPM (Wörter pro Minute): …
- Sprechtempo-Charakteristik: … (gleichmäßig? Sprints mit harten Stopps? wo zieht das Tempo an?)
- Pausen-Stellen: [mm:ss] — wozu die Pause dient (Betonung, Beat-Wechsel, Nachwirken lassen)

## Hook-Delivery
### Sekunde 0-3
- Exakter Wortlaut: „…"
- Satzbau-Analyse: … (Satzart, Wortstellung, was zuerst kommt)
- Stimme/Betonung: … (welche Wörter betont, Tonhöhe, Energie, Tempo)
### Sekunde 0-15
- Exakter Wortlaut: „…"
- Satzbau-Analyse: …
- Stimme/Betonung: …

## Übergangsphrasen-Inventar
- [mm:ss] „wortwörtliche Phrase" — Funktion (z.B. Wechsel zu Schritt 2, Spannungs-Reset, Open Loop)
(ALLE Phrasen auflisten, mit denen der Creator zwischen Beats wechselt — z.B. „Und jetzt kommt's:", „Das Verrückte:", „But here's the thing:")

## CTA-Delivery
- Exakter Wortlaut: „…"
- Position: [mm:ss] (Anfang/Mitte/Ende, vor/nach welchem Beat)
- Framing: … (Befehl? Einladung? Belohnungs-Versprechen? Follow-Gate?)

## Rhetorik-Moves
- Direkte Ansprache: … (wortwörtliche Beispiele)
- Rhetorische Fragen: [mm:ss] „…"
- Zahlen-Nutzung: … (welche Zahlen, wie eingesetzt)
- Satzlängen-Rhythmus: … (z.B. kurz/kurz/lang — mit wortwörtlichem Beispiel)`;

/* ── Antwort in die zwei Sektionen splitten (wirft bei kaputter Struktur) ──── */
export function splitScriptAnatomy(text) {
  const ti = text.indexOf(TRANSCRIPT_MARKER);
  const ai = text.indexOf(ANATOMY_MARKER);
  if (ti === -1 || ai === -1 || ai < ti) {
    throw new Error(`script-anatomy: Marker fehlen in der Gemini-Antwort (erwartet ${TRANSCRIPT_MARKER} … ${ANATOMY_MARKER})`);
  }
  const transcript = text.slice(ti + TRANSCRIPT_MARKER.length, ai).trim();
  const anatomy = text.slice(ai + ANATOMY_MARKER.length).trim();
  if (!transcript) throw new Error('script-anatomy: Transkript-Sektion ist leer');
  if (!anatomy) throw new Error('script-anatomy: Anatomie-Sektion ist leer');
  return { transcript, anatomy };
}

/* ── Datei-Renderer (einheitliche Header, maschinell parsebar) ─────────────── */
export function renderTranscriptMd(id, source, transcript) {
  return `# Verbatim-Transkript — ${id}\n\nQuelle: ${source}\nProfil: script-anatomy (video-ingest)\n\n${transcript}\n`;
}

export function renderAnatomyMd(id, source, anatomy, model) {
  return `# Script-Anatomie — ${id}\n\nQuelle: ${source}\nProfil: script-anatomy (video-ingest)${model ? ` · Modell: ${model}` : ''}\n\n${anatomy}\n`;
}
