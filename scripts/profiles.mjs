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

   Profil "edit-anatomy" (nur analyze-file-gemini.mjs): Schnitt-Anatomie eines
   Kurzvideos für den 1:1-Nachbau (Schnittliste, Zooms, Captions, Inserts, Sound)
   als Markdown → edit-anatomy.md.
   ═══════════════════════════════════════════════════════════════════════════ */

export const PROFILES = ['script-anatomy', 'edit-anatomy'];

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

// Longform-Zusatz (env SCRIPT_ANATOMY_LONGFORM=1, nur analyze-gemini.mjs): bei langen
// Videos sprengt das volle Verbatim-Transkript das Output-Limit. Dann wird nur Anfang +
// Ende wörtlich transkribiert, die Anatomie läuft weiter übers GANZE Video.
export const LONGFORM_ADDON = `

WICHTIGE EINSCHRÄNKUNG (Longform-Modus): Das VERBATIM-Transkript umfasst NUR die ersten 8 Minuten UND die letzten 2 Minuten des Videos (dazwischen eine Zeile "[…] Mittelteil ausgelassen (Longform-Modus) […]"). Die SCRIPT-ANATOMIE (Statistik, Übergangsphrasen, Re-Hooks, CTA) analysiert weiterhin das GESAMTE Video. Halte die Gesamtantwort unter 20000 Wörtern.`;

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

/* ── edit-anatomy: Schnitt-Anatomie für den 1:1-Nachbau eines Kurzvideos (Markdown, nur analyze-file-gemini.mjs) ── */
export const EDIT_ANATOMY_PROMPT = `Du analysierst dieses Kurzvideo (9:16) als Cutter, der den Schnitt 1:1 nachbauen soll. Antworte auf DEUTSCH, Zitate aus dem Video wörtlich in Originalsprache. Erfinde NICHTS: Was du nicht sicher siehst oder hörst, markierst du mit „unsicher“. Zeitangaben immer als Sekunden mit einer Nachkommastelle.

Liefere genau diese Abschnitte:

## 1. Überblick
Länge, Thema in einem Satz, Format (Talking Head, Screen, B-Roll-Anteil in Prozent), Gesamtwirkung in drei Adjektiven.

## 2. Aufnahme und Licht
Kleidung und Farbe, Hintergrund, Lichtrichtung, Lichtfarben (auch farbiges Hintergrundlicht), Kameraabstand, Tiefenschärfe, Farbstimmung (Grading: Kontrast, Sättigung, Hauttöne, Vignette).

## 3. Schnittliste
Tabelle mit einer Zeile je Einstellung: Start | Ende | Bildinhalt | Bildausschnitt (nah/halbnah/weit, Zoomstufe in Prozent) | Übergang zur nächsten Einstellung (harter Schnitt, Zoom-Punch, Whip, Blur …) | Grund für den Schnitt (Satzende, Betonung, Pointe …).
Danach: Anzahl Schnitte, Schnitte pro 10 Sekunden, längste und kürzeste Einstellung.

## 4. Bewegung im Bild
Alle digitalen Zooms, Punch-ins, Shakes, Kamerafahrten, Speed-Ramps mit Zeitpunkt, Stärke in Prozent, Dauer und Kurve (hart, weich, mit Überschwinger).

## 5. Captions
Schrift (Stil beschreiben: Breite, Gewicht, Groß/Klein), Größe relativ zur Bildhöhe, Position, Farben, Kontur/Schatten/Leuchten (genau beschreiben: Stärke, Radius, Farbe), Wörter pro Einblendung, Einblendlogik (ganzer Satzteil, Wort für Wort, Karaoke), Einblend-Animation (Skalierung von/auf in Prozent, Dauer, Überschwinger, Unschärfe, Einrasten der ganzen Zeile), Abgang, welche Wörter farbig hervorgehoben werden und nach welcher Regel, Pausen ohne Caption.

## 6. Inserts, Grafiken, B-Roll
Jede Einblendung mit Zeitraum, Inhalt, Art (Screenshot, UI-Nachbau, Stock, AI-Bild, Emoji, Pfeil, Rahmen, Text-Karte), Position, Animation rein und raus, ob die Captions dabei weiterlaufen.

## 7. Sound
Musik (Stimmung, Tempo, Lautstärke relativ zur Stimme, Wechsel), Soundeffekte mit Zeitpunkt und dem Bild-Ereignis, das sie begleiten (Whoosh, Pop, Riser, Hit, Klick), Stille als Stilmittel.

## 8. Hook und Aufbau
Was passiert in den ersten 3 Sekunden (Bild, Text, Ton), Spannungsbogen, Schluss und Call-to-Action mit Zeitpunkt.

## 9. Das Handwerk dahinter
Die 5 Entscheidungen, die diesen Schnitt am stärksten prägen, jeweils so formuliert, dass ein Cutter sie in Premiere oder After Effects umsetzen kann (konkrete Werte).`;
