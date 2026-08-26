# GaforCast — GAFOR-Gebiet, Flugwetter und Ballonwetter

Ort suchen oder auf der Karte anfahren → das zuständige **GAFOR-Gebiet** wird bestimmt und
darunter stehen sofort **GAFOR/Flugwetterübersicht**, **Ballonwetterbericht**, die **METAR/TAF**
der nächstgelegenen Plätze und eine **Modellprognose** für genau diesen Punkt.

Läuft als PWA auf Handy, iPad und Desktop, gehostet auf GitHub Pages, ohne eigenen Server.
Gestaltung, Farbtokens und Bedienidiom kommen von [StueveCast](https://github.com/bwicki/stueve_cast),
damit beide Werkzeuge als eine Familie erkennbar sind.

> **Keine amtliche Flugwetterberatung.** Für den Flug gilt allein die offizielle Beratung des DWD
> (flugwetter.de / pc_met).

## Auf GitHub Pages veröffentlichen

1. Repository anlegen (Vorschlag: `gaforcast`) und den Inhalt dieses Ordners in den Root pushen.
2. Settings → Pages → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
3. Settings → Actions → General → Workflow permissions: **Read and write permissions** —
   sonst darf der Fetcher seine Daten nicht committen.
4. Actions-Tab → *DWD-Berichte holen* → **Run workflow** (einmal von Hand, danach läuft er
   dreimal pro Stunde).
5. Öffnen unter `https://<user>.github.io/gaforcast/`.
   Homescreen: iPad/iPhone Safari → Teilen → *Zum Home-Bildschirm*; Android Chrome → *App installieren*.

Alle Pfade sind relativ, ein Unterpfad oder eine eigene Domain (`CNAME`) funktioniert also ohne
Änderung.

## Versionierung

Die Version steht an einer einzigen Stelle: `js/version.js`. Sie erscheint als Chip neben dem
Titel; ein Klick darauf öffnet Version, Build-Datum, Anzahl der Gebiete, Stand der DWD-Berichte,
Abrufprobleme und die Quellenliste — plus **App aktualisieren**, das den Service-Worker-Cache
verwirft und neu lädt (für den Fall, dass ein Gerät auf einer alten Fassung klebt).

Beim Release drei Dinge anfassen:

1. `APP.version`, `APP.date` und `APP.cache` in `js/version.js`
2. `VERSION` in `sw.js` auf denselben Wert wie `APP.cache`
3. den Eintrag in `CHANGELOG.md`

`node test/run.mjs` prüft, dass 1 und 2 zusammenpassen, dass die Version dem Muster
`MAJOR.MINOR.PATCH` folgt und dass jede in `sw.js` gelistete Shell-Datei existiert. Ohne
Versionswechsel behalten installierte Clients die alte Shell — das ist der häufigste Fehler
bei PWAs und deshalb der einzige Test, der hier hart fehlschlägt.

## Aufbau

```
index.html                  eine Seite: Suche · Karte · Ortszeile · Gebietskopf · vier Karten
css/base.css                Farbtokens und Bausteine (dunkel/hell), aus dem S2-/StueveCast-Set
css/app.css                 Layout: Handy einspaltig, ab 900 px zweispaltig
js/version.js               Version, Build-Datum, Cache-Name — die einzige Stelle dafür
js/util.js                  Helfer: Geometrie (point-in-polygon), Distanz, Formatierung, Storage
js/gafor.js                 Gebietsgeometrie laden, Punkt → Gebiet, Code-Legende C/O/D/M/X
js/geo.js                   Ortssuche (Open-Meteo), Koordinateneingabe, ICAO, Reverse-Geocoding
js/dwd.js                   liest data/dwd/index.json und wählt Bulletin und Ballonbericht aus
js/metar.js                 METAR/TAF von der NOAA-AWC-API, Ceiling/Sicht/Klassifikation
js/openmeteo.js             Punktprognose (Wind 10/80/180 m, Sicht, Wolken, Grenzschicht, CAPE)
js/mapview.js               Leaflet-Karte, Gebietslayer, festes Fadenkreuz in der Mitte
js/app.js                   Zustand, Bedienung, Rendering aller Karten
data/gafor-areas.geojson    die Gebietsgrenzen  ← siehe unten
data/dwd/index.json         von der Action erzeugt: Bulletins als JSON
data/dwd/raw/*.txt          derselbe Text unparsed, damit der Parser nachgebessert werden kann
data/gafor-meta.json        die 68 Gebiete: Nummer, Bezeichnung, Bezugshöhe, Bereich
scripts/fetch-dwd.mjs       der Fetcher (Node 20, ohne Abhängigkeiten)
scripts/digitize/           die Digitalisierung der Gebietskarte (OpenCV)
tools/digitize.html         Karte von Hand nachziehen und korrigieren, exportiert GeoJSON
.github/workflows/fetch-dwd.yml   holt die Berichte dreimal pro Stunde und committet sie
test/run.mjs                Prüfungen ohne Browser
test/sample-*.txt           echte DWD-Bulletins, gegen die der Parser geprüft wird
CHANGELOG.md                was sich je Version geändert hat
sw.js                       Offline: Shell cache-first, Daten network-first mit Cache-Fallback
```

## Woher die Daten kommen

| Was | Quelle | Weg |
|---|---|---|
| GAFOR-Codes, Flugwetterübersicht | DWD Luftsportberichte | GitHub Action → `data/dwd/index.json` |
| Ballonwetterbericht (je Gebiet) | DWD Gebietsvorhersagen Ballonsport | GitHub Action → `data/dwd/index.json` |
| METAR / TAF | NOAA Aviation Weather Center | direkt aus dem Browser (CORS erlaubt) |
| Modellprognose, Ortssuche, Höhe | Open-Meteo | direkt aus dem Browser |
| Ortsname zur Kartenmitte | Nominatim / OpenStreetMap | direkt aus dem Browser |
| Kartenkacheln | OpenStreetMap | direkt aus dem Browser |

**Warum eine GitHub Action?** `dwd.de` sendet keine CORS-Header — eine Seite auf `github.io` darf
diese Seiten nicht selbst lesen. Der Workflow holt sie serverseitig, macht Text und JSON daraus und
committet das Ergebnis; die App liest es dann von der eigenen Origin. Nebeneffekt: die Berichte sind
auch offline verfügbar, und `data/dwd/raw/*.txt` zeigt jederzeit, was der DWD tatsächlich geliefert
hat — daran lässt sich der Parser ohne Raten verbessern.

Drei Produkte, drei Zuschnitte:

* **GAFOR-Codetabelle** — C/O/D/M/X je Gebiet und Zeitraum. Die Übersichtsseite zeigt immer nur
  einen Bereich; was da steht, wird geparst.
* **Flugwetterübersicht** — ein Prosabulletin je Bereich (`FBEU40 EDZH/EDZB/EDZE/EDZF/EDZM`), mit
  Gültigkeitszeitraum und der Zeile `Vorhersagebereich: GAFOR-Gebiete …`, aus der die Zuordnung
  Gebiet → Bulletin kommt.
* **Ballonwetterbericht** — einer je GAFOR-Gebiet, 67 Stück (Gebiet 00 über See hat keinen). Die
  Seiten stehen nicht als Links auf der Übersicht, sondern in deren anklickbarer Bildkarte; der
  Fetcher liest Ziel, Name und Bezugshöhe aus den `<area>`-Tags. Nichts geraten, und eine
  Umnummerierung beim DWD wird automatisch mitgenommen.

67 Seiten dreimal pro Stunde wären unverhältnismässig für ein Produkt mit festen Ausgabezeiten,
deshalb greift eine Altersschwelle: die Ballonberichte werden nur geholt, wenn der gespeicherte
Stand älter als `BALLOON_MAX_AGE_H` (Vorgabe 4 h) ist, mit 120 ms Pause zwischen den Abrufen. Das
sind rund 840 statt 4900 Abrufe pro Tag. `FORCE_BALLOON=1` — oder der Haken beim Handstart des
Workflows — erzwingt einen Durchlauf.

Der Fetcher bricht nie ab: was nicht klappt, landet in `index.json → errors[]`, und die App zeigt
den Berichtstext dann eben unparsed an. Kommt ein Lauf ganz leer zurück, bleibt der letzte gute
Stand stehen.

## Die Gebietsgrenzen

`data/gafor-areas.geojson` ist eine FeatureCollection; jedes Feature ist ein GAFOR-Gebiet:

```json
{ "type": "Feature",
  "properties": { "id": "36", "name": "Sauerland", "region": "West",
                  "refAltFt": 2400, "center": [51.23, 8.10] },
  "geometry": { "type": "Polygon", "coordinates": [ [ [8.0,51.1], … ] ] } }
```

* `id` — zweistellige Gebietsnummer, wie sie im Bulletin steht (die Verknüpfung zum Text)
* `region` — GAFOR-Bereich Nord · Ost · West · Mitte · Süd; daraus kommt die ausgebende DWD-Stelle
* `refAltFt` — Bezugshöhe des Gebiets in ft MSL
* `center` — Schwerpunkt; Kartenbeschriftung und Nächster-Nachbar-Ersatzregel

Findet die App keinen Treffer, sucht sie das nächstgelegene Gebietszentrum innerhalb von 60 km und
kennzeichnet das im Kopf als Näherung. Ist die Datei leer, funktioniert alles ausser der
Gebietszuordnung weiter.

Nummer, Bezeichnung, Bezugshöhe und Bereich stehen getrennt in `data/gafor-meta.json` und werden
beim Laden über die `id` dazugemischt — die Geometrie lässt sich also neu erzeugen, ohne die Liste
anzufassen, und umgekehrt.

Die Polygone in diesem Repository sind aus der DFS-Karte **„GAFOR-Gebiete / GAFOR Areas"
(Stand 11 FEB 2021)** digitalisiert. Der Ablauf steht in `scripts/digitize/` und ist
reproduzierbar:

```
python3 scripts/digitize/fit-projection.py     # Kartengitter -> Kegelprojektion
python3 scripts/digitize/extract-areas.py      # Flächen zwischen den Grenzlinien
python3 scripts/digitize/number-montage.py     # Gebietsnummern zum Ablesen
python3 scripts/digitize/build-areas.py        # Watershed -> gafor-areas.geojson
```

1. **Georeferenzierung.** Die Karte trägt ein Gradnetz (7°–14° O, 47°–55° N). Aus den
   Gitterschnitten am Kartenrahmen werden Kegelkonstante, Zentralmeridian, Apex und
   Breitenmassstab bestimmt; das eingepasste Gitter deckt sich mit dem gedruckten, und die
   eingezeichneten Verkehrsflughäfen liegen an ihren realen Koordinaten.
2. **Flächen.** Die schwarzen Grenzlinien trennen die Gebiete. Die deutsche Staatsgrenze ist
   auf der Karte nur hellgrau gedruckt, deshalb wird sie zusätzlich aus
   [deutschlandGeoJSON](https://github.com/isellsoap/deutschlandGeoJSON) in dieselbe Projektion
   gerechnet und als Sperre gelegt — sonst laufen die Randgebiete ins Ausland aus.
3. **Nummern.** Jede Fläche bekommt ihre gedruckte Nummer als Bildausschnitt in einer Montage;
   daraus entsteht die Tabelle `BLOB2ID` in `build-areas.py`.
4. **Watershed.** Fünf Gebiete (31, 38, 52, 71, 83) haben Lücken in ihren Grenzlinien und
   werden von Hand angesät. Anschliessend wächst jedes Gebiet bis an die gedruckten Linien —
   das ergibt eine Aufteilung ohne Löcher, wie sie eine Punktabfrage braucht.

**Genauigkeit.** Der Kartenmassstab liegt bei rund 0,6 km je Pixel, die Grenzen sitzen auf
etwa **±2 km**. Über Landpunkten fällt rund 1,5 % ohne Gebiet aus (dafür greift die
Nächster-Nachbar-Ersatzregel) und rund 5 % liegt in zwei überlappenden Gebieten — beides
entlang der Grenzlinien. Für die Zuordnung eines Startplatzes reicht das; für alles, was auf
den Kilometer genau sein muss, gilt die amtliche Karte.

Die Kartenvorlage selbst liegt **nicht** im Repository (© DFS Deutsche Flugsicherung GmbH).
`scripts/digitize/*.py` erwartet sie als `maps/dfs.jpg`.

## Tests

```
node test/run.mjs
```

prüft Syntax aller Module, Struktur und Plausibilität der Gebietsgeometrie (Nummern eindeutig, Ringe
geschlossen, Koordinaten innerhalb Deutschlands), den DWD-Parser gegen Beispieltexte und die
Zuordnung der Referenzorte.

## Lizenz und Nachweise

Eigene Lizenz analog zum S2-Werkzeug: Nutzung erlaubt; Änderung, Weitergabe oder Veröffentlichung
abgeleiteter Fassungen brauchen die vorherige schriftliche Zustimmung des Rechteinhabers und müssen
die Namensnennung erhalten.

Wetterdaten: [DWD](https://www.dwd.de) (Luftsportberichte, frei zugänglich),
[NOAA AWC](https://aviationweather.gov), [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
Karte © OpenStreetMap-Mitwirkende. Enthält Leaflet (BSD-2-Clause).
