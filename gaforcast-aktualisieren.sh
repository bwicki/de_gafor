#!/usr/bin/env bash
# GaforCast — Version 1.21.0 einspielen (Landespakete, Etappe 0).
#
# Anders als repo-reparieren.sh leert dieses Skript den Arbeitsbaum NICHT.
# Es legt den Inhalt des ZIP über den bestehenden Stand — data/dwd/ mit den
# geholten Berichten bleibt also unangetastet, und der Workflow muss danach
# nicht von Hand angeworfen werden.
#
# Aufruf, in einem beliebigen Ordner:
#   bash gaforcast-aktualisieren.sh /Pfad/zu/gafor-repo.zip
#
set -euo pipefail

ZIP="${1:-}"
[ -f "$ZIP" ] || { echo "Bitte den Pfad zu gafor-repo.zip angeben."; exit 1; }
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"

WORK="$(mktemp -d)"
echo "Arbeitsordner: $WORK"

# Zum Ausprobieren lässt sich die Quelle setzen: REPO_URL=/pfad/zu/klon bash …
REPO="${REPO_URL:-https://github.com/bwicki/de_gafor.git}"
git clone --quiet "$REPO" "$WORK/de_gafor"
cd "$WORK/de_gafor"

# ---------------------------------------------------------------------------
# Zuerst den Stand festnageln, der HEUTE läuft. Ohne diese Marke gibt es keinen
# Punkt, auf den man zurückkehren könnte — das Repo hat bis jetzt keinen
# einzigen Tag. Danach ist der Weg zurück immer:
#     bash zurueck-auf-stand.sh v1.20.0 <neue Version>
# ---------------------------------------------------------------------------
if git rev-parse -q --verify refs/tags/v1.20.0 >/dev/null; then
  echo "Marke v1.20.0 besteht bereits."
else
  git tag -a v1.20.0 -m "Stand vor dem internationalen Ausbau — Deutschland allein" HEAD
  echo "Marke v1.20.0 auf den heutigen Stand gesetzt ($(git rev-parse --short HEAD))."
fi

# Inhalt des ZIP darüberlegen. -o überschreibt ohne Rückfrage, löscht aber nichts.
unzip -o -q "$ZIP" -d .

# Kontrolle: die Dateien, ohne die 1.21.0 nicht läuft
for f in index.html README.md CHANGELOG.md sw.js manifest.webmanifest CNAME \
         js/app.js js/version.js js/country.js css/app.css css/base.css \
         data/gafor-areas.geojson data/gafor-meta.json \
         data/countries/index.json data/countries/de/meta.json \
         scripts/fetch.mjs scripts/providers/de.mjs scripts/fetch-dwd.mjs \
         .github/workflows/fetch-dwd.yml; do
  [ -f "$f" ] || { echo "FEHLT: $f — Abbruch, nichts wurde gepusht."; exit 1; }
done

# Version gegenprüfen
V="$(grep -o "version: '[^']*'" js/version.js | head -1 | cut -d"'" -f2)"
[ "$V" = "1.21.0" ] || { echo "Im ZIP steht Version $V, erwartet 1.21.0 — Abbruch."; exit 1; }

# Wenn Node da ist: die Prüfungen laufen lassen, bevor irgendetwas gepusht wird
if command -v node >/dev/null 2>&1; then
  echo
  echo "Prüfungen ohne Browser:"
  # einmal laufen lassen, Ausgabe aufheben — sonst liefe alles zweimal
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

git commit --quiet -m "Version 1.21.0 — Landespakete (Etappe 0), Deutschland als erstes Paket"
git tag -a v1.21.0 -m "Landespakete, Etappe 0 — Deutschland als erstes Paket"
git push --quiet origin HEAD
git push --quiet origin --tags

echo
echo "Fertig. data/dwd/ blieb stehen — der Workflow muss NICHT von Hand gestartet werden."
echo "Der nächste planmässige Lauf (:07, :27, :47) holt wie gewohnt weiter."
echo
echo "Marken im Repo:"
git tag -n1
echo
echo "Zurück auf den Stand von heute:  bash zurueck-auf-stand.sh v1.20.0 1.21.1"
