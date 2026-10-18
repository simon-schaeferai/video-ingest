#!/usr/bin/env bash
# ingest.sh — key-freier Fallback (Weg A).
# YouTube-URL → Transkript (transcript.txt) + Keyframes (frame_*.jpg) zum Verstehen.
# Claude liest danach transcript.txt + die Frames (= Vision) und versteht das Video selbst.
#
# Usage: ingest.sh <youtube-url> [max_frames]   (default 40 Keyframes)
# Output: ./output/video-ingest/<id>/ im Arbeitsverzeichnis
# Deps:  yt-dlp, ffmpeg/ffprobe, python3, bc
# Env (optional, für Serienläufe): VIDEO_INGEST_SUB_LANGS (default de,de-orig,en,en-orig,en-US)
#      VIDEO_INGEST_SUB_SLEEP (Sekunden zwischen Untertitel-Requests, default 0)
# Wiederholter Lauf: vorhandenes transcript.txt und ein lesbares video.* werden wiederverwendet.

set -euo pipefail

URL="${1:?Usage: ingest.sh <youtube-url> [max_frames]}"
CAP="${2:-40}"   # max. Keyframes (Scene-Detection liefert oft mehr → wird gleichmäßig auf CAP gedünnt)
FFMPEG="$(command -v ffmpeg)"; FFPROBE="$(command -v ffprobe)"; YTDLP="$(command -v yt-dlp)"
[ -z "$YTDLP" ] && { echo "yt-dlp fehlt: brew install yt-dlp" >&2; exit 1; }

# SICHERHEIT: NIE Account-Cookies/Login — das würde den Nutzer-Account einloggen und
# riskiert dessen Sperre. Dieser Wrapper erzwingt anonymen Abruf bei JEDEM yt-dlp-Aufruf.
# Login-gated Videos scheitern absichtlich, NICHT mit Cookies umgehen.
ytdlp(){ "$YTDLP" --no-cookies --no-cookies-from-browser "$@"; }

VID="$(ytdlp --no-warnings --print id "$URL" | head -1)"
TITLE="$(ytdlp --no-warnings --print title "$URL" | head -1)"
OUT="$PWD/output/video-ingest/$VID"
mkdir -p "$OUT/hook"
echo "▶ $TITLE  [$VID]"
echo "  → $OUT"

# 1) Untertitel (auto + manuell), Deutsch bevorzugt, sonst Englisch
# YouTube drosselt den Untertitel-Endpunkt (HTTP 429), jede Sprache ist ein eigener Request.
# Für Serienläufe z. B. VIDEO_INGEST_SUB_LANGS="en" (1 Request statt 5) + VIDEO_INGEST_SUB_SLEEP=5.
SUB_LANGS="${VIDEO_INGEST_SUB_LANGS:-de,de-orig,en,en-orig,en-US}"
SUB_SLEEP="${VIDEO_INGEST_SUB_SLEEP:-0}"
# Vorhandenes Transkript (früherer Teillauf) wiederverwenden, statt Untertitel erneut abzurufen.
if [ ! -s "$OUT/transcript.txt" ]; then
ytdlp --no-warnings --skip-download --write-auto-subs --write-subs \
  --sub-langs "$SUB_LANGS" --sub-format vtt --sleep-subtitles "$SUB_SLEEP" \
  -o "$OUT/sub" "$URL" >/dev/null 2>&1 || true

VTT="$(ls "$OUT"/sub*.vtt 2>/dev/null | head -1 || true)"
if [ -n "${VTT:-}" ]; then
  python3 - "$VTT" > "$OUT/transcript.txt" <<'PY'
import sys, re
out, last = [], None
for ln in open(sys.argv[1], encoding="utf-8", errors="ignore").read().splitlines():
    ln = ln.strip()
    if not ln or ln == "WEBVTT" or ln.startswith(("Kind:", "Language:", "NOTE")):
        continue
    if "-->" in ln:
        continue
    ln = re.sub(r"<[^>]+>", "", ln)      # Wort-Timing-Tags
    ln = re.sub(r"\{[^}]+\}", "", ln)
    ln = ln.replace("&nbsp;", " ").strip()
    if not ln or ln == last:
        continue
    out.append(ln); last = ln
print(" ".join(out))
PY
  echo "  ✓ Transkript: $(wc -w < "$OUT/transcript.txt" | tr -d ' ') Wörter → transcript.txt"
else
  echo "  ⚠ Keine Untertitel verfügbar → Fallback: Audio aus dem Video ziehen + whisper/Supadata, oder Transkript manuell."
fi
else
  echo "  ✓ Vorhandenes transcript.txt wiederverwendet"
fi

# 2) Video (klein, ≤480p) für Frames laden — ein lesbares video.* aus einem früheren Lauf
#    wird wiederverwendet; Download-Fehler landen sichtbar in download.log statt im Nichts.
find_video(){ find "$OUT" -maxdepth 1 -type f \( -name 'video.mp4' -o -name 'video.webm' -o -name 'video.mkv' \) -print | head -1; }
VIDEO="$(find_video)"
if [ -z "$VIDEO" ] || ! "$FFPROBE" -v error "$VIDEO" >/dev/null 2>&1; then
  if ! { ytdlp --no-warnings -f "bv*[height<=480]+ba/b[height<=480]/18/b" \
           --merge-output-format mp4 -o "$OUT/video.%(ext)s" "$URL" \
         || ytdlp --no-warnings -f "best[height<=720]/best" -o "$OUT/video.%(ext)s" "$URL"; } > "$OUT/download.log" 2>&1; then
    cat "$OUT/download.log" >&2
    echo "  ✗ Ingest unvollständig: Video-Download fehlgeschlagen (privat/region/age-gated? HTTP 403 → yt-dlp --version prüfen)." >&2
    echo "    Keine Frames, keine visuelle Analyse. $([ -s "$OUT/transcript.txt" ] && echo "transcript.txt liegt vor." || echo "Auch kein Transkript.")" >&2
    exit 1
  fi
  VIDEO="$(find_video)"
fi

# 3) Keyframes (gleichmäßig) + dichte Hook-Frames (erste 30 Sek)
if [ -n "${VIDEO:-}" ]; then
  DUR="$("$FFPROBE" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO")"
  RES="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$VIDEO" 2>/dev/null || echo '?')"
  printf 'title=%s\nid=%s\nduration_seconds=%s\nresolution=%s\n' "$TITLE" "$VID" "$DUR" "$RES" > "$OUT/metadata.txt"
  # Frames eines früheren Laufs entfernen, sonst mischen sie sich mit den neuen (gleiche Dateinamen).
  rm -f "$OUT"/frame_*.jpg "$OUT"/hook/hook_*.jpg
  # Keyframes via SCENE-DETECTION: ein Bild bei JEDEM echten Bildwechsel (Slides/Diagramme/Schnitte),
  # nicht stur alle X Sek. Zu viele → gleichmäßig auf CAP gedünnt; zu wenige → gleichmäßige Frames.
  "$FFMPEG" -v error -i "$VIDEO" -vf "select='gt(scene,0.27)',scale=854:-2" -vsync vfr -q:v 3 "$OUT/frame_%03d.jpg" 2>/dev/null || true
  shopt -s nullglob; FR=( "$OUT"/frame_*.jpg ); shopt -u nullglob
  N=${#FR[@]}
  if (( N < 10 )); then
    rm -f "$OUT"/frame_*.jpg
    FPSF="$(echo "scale=6; 16 / $DUR" | bc)"
    "$FFMPEG" -v error -i "$VIDEO" -vf "fps=$FPSF,scale=854:-2" -q:v 3 "$OUT/frame_%03d.jpg"
    N="$(ls "$OUT"/frame_*.jpg 2>/dev/null | wc -l | tr -d ' ')"
    echo "  ✓ $N Keyframes (gleichmäßig — wenig Szenenwechsel) → frame_*.jpg"
  else
    if (( N > CAP )); then
      step=$(( (N + CAP - 1) / CAP )); i=0
      for f in "${FR[@]}"; do (( i % step != 0 )) && rm -f "$f"; i=$((i+1)) || true; done
      N="$(ls "$OUT"/frame_*.jpg 2>/dev/null | wc -l | tr -d ' ')"
    fi
    echo "  ✓ $N Szenen-Keyframes (bei jedem Bildwechsel, max $CAP) → frame_*.jpg"
  fi
  # Hook: erste 30 Sek dichter (alle 5s ≈ 6 Frames) — die teuersten Sekunden
  "$FFMPEG" -v error -i "$VIDEO" -t 30 -vf "fps=0.2" -q:v 3 "$OUT/hook/hook_%02d.jpg" 2>/dev/null || true
  echo "  ✓ Hook-Frames (erste 30 Sek) → hook/hook_*.jpg"
else
  echo "  ⚠ Konnte Video nicht laden (privat/region/age-gated?) — nur Transkript verfügbar."
fi

echo "✅ Extraktion fertig. Nächster Schritt: ein Vision-Subagent liest die frame_*.jpg (und hook/), schreibt visual-analysis.md; danach mit transcript.txt abgleichen."
echo "$OUT"
