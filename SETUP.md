# Setup

## Voraussetzungen

- **Node.js 18+** (für die `scripts/*.mjs`)
- **Fal-Account** mit API-Key: https://fal.ai/dashboard/keys (Weg B/C, wenige Cent pro Video)
- Nur für Weg A und C: **yt-dlp** + **ffmpeg** (`brew install yt-dlp ffmpeg`)

## 1 · Als Claude-Code-Skill installieren

In ein Projekt (der Skill steht dann in diesem Projekt bereit):

```bash
git clone https://github.com/<owner>/video-ingest .claude/skills/video-ingest
```

Oder global (steht in ALLEN Projekten bereit):

```bash
git clone https://github.com/<owner>/video-ingest ~/.claude/skills/video-ingest
```

## 2 · Key hinterlegen

```bash
cd <skill-verzeichnis>
cp .env.example .env
# FAL_KEY in .env eintragen
```

Die Scripts suchen den Key in dieser Reihenfolge: Umgebungsvariable → Datei aus `VIDEO_INGEST_ENV_FILE` (falls gesetzt) → `.env` im Arbeitsverzeichnis → `.env` im Skill-Verzeichnis.

## 3 · Erster Lauf

```bash
node <skill-verzeichnis>/scripts/analyze-gemini.mjs "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Wenn `✅ Analyse … understanding.md` erscheint, funktioniert das Setup. Der Output liegt in `./output/video-ingest/<id>/`. Ablage pro Projekt umstellen: `VIDEO_INGEST_OUTPUT_DIR` und `VIDEO_INGEST_ANALYSIS_DIR` (siehe SKILL.md, „Konfiguration pro Projekt“).

## 4 · Nur für Weg C: Supabase-Bucket (Reels / lokale Dateien)

Der Fal-Router braucht eine abrufbare URL. Lokale Dateien werden deshalb in einen Supabase-Storage-Bucket gespiegelt:

1. Kostenloses Projekt auf https://supabase.com anlegen.
2. Storage → neuen Bucket `research-videos` anlegen, **Public bucket** aktivieren.
3. In `.env` eintragen: `SUPABASE_URL` (Projekt-URL) + `SUPABASE_SERVICE_ROLE_KEY` (Settings → API).

Hinweis: Hochgeladene Videos bleiben im Bucket liegen (öffentliche URL). Regelmäßig aufräumen, besonders bei fremdem Material.

## Fehlerbilder

| Symptom | Ursache / Lösung |
|---|---|
| `FAL_KEY fehlt` | `.env` fehlt oder Key nicht eingetragen (Schritt 2) |
| `Fal queue: Timeout (6 min)` | Video sehr lang → kürzeres Video oder Weg A |
| `yt-dlp fehlt` | `brew install yt-dlp` (nur Weg A/C nötig) |
| `Supabase-Config fehlt` | Weg C ohne Bucket-Setup (Schritt 4) |
| Reel-Download scheitert | Login-gated/gelöscht — wird gemeldet, nicht still verschluckt |
