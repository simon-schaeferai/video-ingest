#!/usr/bin/env bash
# export-md.sh — legt Transkript + visuelle Analyse eines ingesteten Videos als
# sauber benannte MD-Dateien im Download-Ordner ab.
#
# Usage: export-md.sh <video-id> [zielordner]   (default: ~/Downloads)
# Quelle: ./output/video-ingest/<id>/ im Arbeitsverzeichnis
#   (transcript.md|txt, visual-analysis.md, understanding.md, metadata.txt)
# Schreibt: <slug>-TRANSKRIPT.md + <slug>-VISUELLE-ANALYSE.md (Fallback: <slug>-VERSTAENDNIS.md)

set -euo pipefail

VID="${1:?Usage: export-md.sh <video-id> [zielordner]}"
DEST="${2:-$HOME/Downloads}"
mkdir -p "$DEST"

LOCAL="$PWD/output/video-ingest/$VID"

# Titel ermitteln (für Dateinamen)
TITLE=""
[ -f "$LOCAL/metadata.txt" ] && TITLE="$(sed -n 's/^title=//p' "$LOCAL/metadata.txt" | head -1)"
[ -z "$TITLE" ] && TITLE="$VID"

# Slug: lowercase, Umlaute → ascii, nicht-alnum → '-' (POSIX-safe via tr), squeeze, trim, max 60
SLUG="$(printf '%s' "$TITLE" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/ä/ae/g; s/ö/oe/g; s/ü/ue/g; s/ß/ss/g' \
  | tr -c 'a-z0-9' '-' \
  | tr -s '-' \
  | sed -e 's/^-*//; s/-*$//' \
  | cut -c1-60 | sed 's/-*$//')"
[ -z "$SLUG" ] && SLUG="$VID"

WROTE=()

# --- Transkript: bevorzugt transcript.md, sonst transcript.txt (umhüllen) ---
T_DEST="$DEST/$SLUG-TRANSKRIPT.md"
if [ -f "$LOCAL/transcript.md" ]; then
  cp "$LOCAL/transcript.md" "$T_DEST"; WROTE+=("$T_DEST")
elif [ -s "$LOCAL/transcript.txt" ]; then
  { printf '# Transkript — %s\n\nVideo-ID: %s\n\n> Aus Untertiteln extrahiert (eine Zeile pro Cue zusammengeführt).\n\n---\n\n' "$TITLE" "$VID";
    cat "$LOCAL/transcript.txt"; printf '\n'; } > "$T_DEST"
  WROTE+=("$T_DEST")
else
  echo "  ⚠ Kein Transkript gefunden ($LOCAL/transcript.md|.txt) — übersprungen." >&2
fi

# --- Visuelle Analyse: bevorzugt visual-analysis.md, sonst understanding.md (Weg B) ---
if [ -f "$LOCAL/visual-analysis.md" ]; then
  V_DEST="$DEST/$SLUG-VISUELLE-ANALYSE.md"
  cp "$LOCAL/visual-analysis.md" "$V_DEST"; WROTE+=("$V_DEST")
elif [ -f "$LOCAL/understanding.md" ]; then
  V_DEST="$DEST/$SLUG-VERSTAENDNIS.md"
  cp "$LOCAL/understanding.md" "$V_DEST"; WROTE+=("$V_DEST")
  echo "  ℹ Keine visual-analysis.md — stattdessen Gemini-Verständnis exportiert." >&2
else
  echo "  ⚠ Keine visuelle Analyse gefunden ($LOCAL/visual-analysis.md, $LOCAL/understanding.md) — übersprungen." >&2
fi

if [ ${#WROTE[@]} -eq 0 ]; then
  echo "✗ Nichts exportiert — wurde das Video schon ingestet (ingest.sh / analyze-gemini.mjs)?" >&2
  exit 1
fi

echo "✅ Export → $DEST"
for f in "${WROTE[@]}"; do echo "   • $(basename "$f")"; done
