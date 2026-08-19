# Testplan — video-ingest

Was tatsächlich gelaufen ist, mit gemessenen Zahlen. **Keine geschätzten Werte:** Was hier steht,
wurde ausgeführt und abgelesen. Wo eine Zahl fehlt, steht „nicht gemessen".

Zuletzt ausgeführt: **19.08.2026**

---

## T1 · Weg B — kurzes YouTube-Video

**Wie geprüft:** `node scripts/analyze-gemini.mjs "<youtube-url>"` auf ein 31-Sekunden-Video,
Ausgabe gezählt.

**Ergebnis:** Läuft durch. 11.626 Zeichen strukturierte Analyse aus einem einzigen Call,
sechs Abschnitte vollständig belegt.

---

## T2 · Weg B — mittellanges YouTube-Video (Praxislauf)

**Wie geprüft:** `analyze-gemini.mjs` auf ein Tutorial von rund 26 Minuten
(`MY6f9xnYOwU`, letzter erkannter Kapitelpunkt 25:41). Die Analyse wurde anschließend als
Quelle für eine Infografik benutzt, also Zeile für Zeile gegengelesen.

**Ergebnis:** 9.866 Zeichen `understanding.md`. 15 Kapitel mit Timestamps, 23 einzeln
beschriebene Screenshots inklusive Inhalt, Hook-Mechanismus benannt. Kein Frame-Sampling nötig.

---

## T3 · Weg B — Videolänge, obere Grenze

**Wie geprüft:** Drei Läufe mit steigender Länge gegen dieselbe Pipeline.

**Ergebnis:** **57:59 läuft durch** — 7.108 Zeichen, 77 Sekunden Laufzeit.
**Ergebnis:** **60:11 wird abgelehnt** — `Fal result 400` nach 50 Sekunden.
**Ergebnis:** **124:46 wird abgelehnt** — 400 nach 69 Sekunden.

Die Schwelle liegt bei 3.600 Sekunden. Die Ablehnung kommt schnell und ist **kein** Timeout:
Der längste erfolgreiche Lauf brauchte 77 Sekunden, das Polling-Limit liegt bei 6 Minuten
(`fal-router.mjs:68`). Längere Videos müssen vorher geteilt werden.

---

## T4 · Weg C — lokale Videodatei

**Wie geprüft:** `analyze-file-gemini.mjs` auf ein bereits heruntergeladenes Reel von
41 Sekunden, Ausgabe gegen das reine Transkript gehalten.

**Ergebnis:** 69 Sekunden Laufzeit. 9 Beats mit Timing, dazu 18 Bild-Angaben, die im
Transkript an keiner Stelle stehen — genau der Mehrwert gegenüber einem Transkript-Dienst.

---

## T5 · Weg C — Instagram-URL direkt

**Wie geprüft:** Instagram-Reel-URL an `ingest-instagram.mjs`, anonym wie vom Skript erzwungen.

**Ergebnis:** **Scheitert an der Login-Wall.** Das ist das gewollte Verhalten — der Skript
setzt `--no-cookies --no-cookies-from-browser`, ein Umweg über Account-Cookies würde die
Sperre des Instagram-Accounts riskieren. Instagram funktioniert, **wenn das Video schon als
Datei vorliegt** (dann T4).

---

## T6 · Fehlerverhalten ohne Argumente

**Wie geprüft:** Jede Datei in `scripts/` ohne Argumente aufgerufen, Exit-Code abgelesen.

**Ergebnis:** Die fünf ausführbaren Skripte (`analyze-gemini`, `analyze-file-gemini`,
`ingest-instagram`, `mine-reels`, `transcribe-gemini`) geben eine Usage-Zeile aus und beenden
mit Exit-Code 2. Kein Traceback, kein halb geschriebener Output. `fal-router.mjs` und
`profiles.mjs` sind Bibliotheken ohne CLI und beenden erwartungsgemäß mit 0.

---

## Aus dem Quelltext abgelesen (kein Testlauf)

| Befund | Fundstelle |
|---|---|
| Antwort-Deckel Weg B: 8.192 Tokens | `analyze-gemini.mjs:54` |
| Antwort-Deckel Transkription: 8.192 Tokens | `transcribe-gemini.mjs:41` |
| Antwort-Deckel Weg C: 24.576 Tokens | `analyze-file-gemini.mjs:91` |
| Polling-Limit der Queue: 6 Minuten | `fal-router.mjs:68` |
| Bucket ist für Weg C Pflicht | `analyze-file-gemini.mjs`, `uploadToBucket` wirft ohne Supabase-Keys |

## Was nicht getestet ist

- Die Stunden-Grenze wurde **am YouTube-Weg** gemessen, nicht am Datei-Weg.
- Weg A (key-frei) wurde funktional benutzt, aber nicht systematisch über verschiedene
  Untertitel-Lagen hinweg vermessen.
- Kein Lasttest: `mine-reels.mjs` lief mit kleiner Concurrency, nicht am Limit.
