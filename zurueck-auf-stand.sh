#!/usr/bin/env bash
# GaforCast — auf einen gesicherten Stand zurückkehren.
#
#   bash zurueck-auf-stand.sh v1.20.0 1.21.1
#                             ^Marke   ^neue Versionsnummer
#
# Was es tut:
#   • holt den Arbeitsbaum exakt auf die Marke zurück — auch Dateien, die es
#     damals noch nicht gab, verschwinden wieder
#   • behält data/dwd/ aus dem aktuellen Stand: die geholten Berichte sind
#     Messwerte, kein Code, und sollen nicht mit zurückfallen
#   • setzt js/version.js und sw.js auf die NEUE Nummer, nicht auf die alte
#   • trägt eine Zeile im CHANGELOG ein
#   • lässt die Prüfungen laufen, bevor irgendetwas gepusht wird
#   • committet vorwärts — die Historie wird nicht verbogen, kein force-push
#
# Warum eine neue Nummer statt der alten: der Cache-Name des Service Workers
# hängt an der Version. Eine rückwärts laufende Nummer ist für installierte
# Geräte mehrdeutig und macht den CHANGELOG unwahr. 1.20.0-Inhalt unter der
# Nummer 1.21.1 ist eindeutig und ehrlich.
#
set -euo pipefail

TAG="${1:-}"
NEU="${2:-}"
[ -n "$TAG" ] && [ -n "$NEU" ] || {
  echo "Aufruf: bash zurueck-auf-stand.sh <Marke> <neue Version>"
  echo "Beispiel: bash zurueck-auf-stand.sh v1.20.0 1.21.1"
  exit 1
}
[[ "$NEU" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Versionsnummer muss X.Y.Z sein: $NEU"; exit 1; }

WORK="$(mktemp -d)"
echo "Arbeitsordner: $WORK"
# Zum Ausprobieren lässt sich die Quelle setzen: REPO_URL=/pfad/zu/klon bash …
REPO="${REPO_URL:-https://github.com/bwicki/de_gafor.git}"
git clone --quiet "$REPO" "$WORK/de_gafor"
cd "$WORK/de_gafor"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || {
  echo "Die Marke $TAG gibt es nicht. Vorhanden:"; git tag -n1; exit 1; }

ALT="$(grep -o "version: '[^']*'" js/version.js | head -1 | cut -d"'" -f2)"
echo "Aktuell im Repo: $ALT  →  zurück auf $TAG, künftig als $NEU"

# 1. Arbeitsbaum exakt auf die Marke — inklusive der Dateien, die seither dazukamen
git read-tree -u --reset "$TAG"

# 2. die geholten Berichte aus dem aktuellen Stand zurückholen
if git cat-file -e "HEAD:data/dwd" 2>/dev/null; then
  git checkout HEAD -- data/dwd
  echo "data/dwd/ aus dem aktuellen Stand übernommen."
fi

# 2b. Auch der CHANGELOG bleibt auf dem aktuellen Stand. Was zurückgenommen
#     wird, soll nachlesbar bleiben — sonst verschwände mit dem Code auch die
#     Aufzeichnung darüber, dass es ihn je gab.
git checkout HEAD -- CHANGELOG.md

# 3. neue Versionsnummer setzen
sed -i "s/version: '[^']*'/version: '$NEU'/" js/version.js
sed -i "s/cache: 'gaforcast-v[^']*'/cache: 'gaforcast-v$NEU'/" js/version.js
sed -i "s/date: '[^']*'/date: '$(date -u +%F)'/" js/version.js
sed -i "s/const VERSION = 'gaforcast-v[^']*'/const VERSION = 'gaforcast-v$NEU'/" sw.js

# 4. CHANGELOG-Eintrag ganz oben, direkt vor dem ersten Versionsabschnitt
python3 - "$NEU" "$TAG" "$ALT" <<'PY'
import sys, re, io
neu, tag, alt = sys.argv[1], sys.argv[2], sys.argv[3]
from datetime import date
p = 'CHANGELOG.md'
s = open(p, encoding='utf-8').read()
eintrag = (f"## {neu} — {date.today().isoformat()}\n\n"
           f"**Rückschritt auf den Stand von {tag}.** Der Inhalt entspricht wieder {tag}; "
           f"was seit {alt} dazugekommen war, ist wieder entfernt. Die Nummer läuft vorwärts, "
           f"weil der Cache-Name des Service Workers daran hängt — ein Rückwärtssprung wäre "
           f"für installierte Geräte mehrdeutig. `data/dwd/` blieb auf dem aktuellen Stand.\n\n")
m = re.search(r'^## \d+\.\d+\.\d+ ', s, re.M)
s = s[:m.start()] + eintrag + s[m.start():] if m else s + '\n' + eintrag
open(p, 'w', encoding='utf-8').write(s)
print(f"  CHANGELOG: Eintrag {neu} ergänzt")
PY

# 5. Prüfungen, bevor etwas gepusht wird
if command -v node >/dev/null 2>&1; then
  echo
  echo "Prüfungen ohne Browser:"
  OUT="$(node test/run.mjs || true)"
  echo "$OUT" | tail -3
  if echo "$OUT" | grep -q FAIL; then
    echo "$OUT" | grep FAIL
    echo "Prüfungen fehlgeschlagen — Abbruch, nichts wurde gepusht."
    exit 1
  fi
else
  echo "Hinweis: node nicht gefunden, die Prüfungen werden übersprungen."
fi

echo
echo "Geänderte Dateien:"
git add -A
git --no-pager diff --cached --stat | tail -25

git commit --quiet -m "Zurück auf den Stand von $TAG (als Version $NEU)"
git tag -a "v$NEU" -m "Rückschritt auf $TAG"
git push --quiet origin HEAD
git push --quiet origin --tags

echo
echo "Fertig. Die Historie ist unangetastet — $TAG und alles danach stehen weiterhin da."
echo "Vorwärts geht es jederzeit wieder mit den Dateien aus der späteren Marke."
