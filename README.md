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
Änderung. Bei jedem Deploy `VERSION` in `sw.js` und `APP_VERSION` in `js/app.js` hochzählen, damit
installierte Clients die neue Shell ziehen.

## Aufbau

```
index.html                  eine Seite: Suche · Karte · Ortszeile · Gebietskopf · vier Karten
css/base.css                Farbtokens und Bausteine (dunkel/hell), aus dem S2-/StueveCast-Set
css/app.css                 Layout: Handy einspaltig, ab 900 px zweispaltig
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
scripts/fetch-dwd.mjs       der Fetcher (Node 20, ohne Abhängigkeiten)
.github/workflows/fetch-dwd.yml   holt die Berichte dreimal pro Stunde und committet sie
test/run.mjs                Prüfungen ohne Browser
sw.js                       Offline: Shell cache-first, Daten network-first mit Cache-Fallback
```

## Woher die Daten kommen

| Was | Quelle | Weg |
|---|---|---|
| GAFOR-Codes, Flugwetterübersicht | DWD Luftsportberichte | GitHub Action → `data/dwd/index.json` |
| Ballonwetterbericht | DWD Gebietsvorhersagen Ballonsport | GitHub Action → `data/dwd/index.json` |
| METAR / TAF | NOAA Aviation Weather Center | direkt aus dem Browser (CORS erlaubt) |
| Modellprognose, Ortssuche, Höhe | Open-Meteo | direkt aus dem Browser |
| Ortsname zur Kartenmitte | Nominatim / OpenStreetMap | direkt aus dem Browser |
| Kartenkacheln | OpenStreetMap | direkt aus dem Browser |

**Warum eine GitHub Action?** `dwd.de` sendet keine CORS-Header — eine Seite auf `github.io` darf
diese Seiten nicht selbst lesen. Der Workflow holt sie serverseitig, macht Text und JSON daraus und
committet das Ergebnis; die App liest es dann von der eigenen Origin. Nebeneffekt: die Berichte sind
auch offline verfügbar, und `data/dwd/raw/*.txt` zeigt jederzeit, was der DWD tatsächlich geliefert
hat — daran lässt sich der Parser ohne Raten verbessern.

Der Fetcher bricht nie ab: was nicht klappt, landet in `index.json → errors[]`, und die App zeigt
den Berichtstext dann eben unparsed an. Kommt ein Lauf ganz leer zurück, bleibt der letzte gute
Stand stehen.

## Die Gebietsgrenzen

`data/gafor-areas.geojson` ist eine FeatureCollection; jedes Feature ist ein GAFOR-Gebiet:

```json
{ "type": "Feature",
  "properties": { "id": "45", "name": "Sauerland", "region": "Mitte",
                  "office": "EDZF", "balloon": "Mitte-West",
                  "center": [51.23, 8.10] },
  "geometry": { "type": "Polygon", "coordinates": [ [ [8.0,51.1], … ] ] } }
```

* `id` — zweistellige Gebietsnummer, wie sie im Bulletin steht (die Verknüpfung zum Text)
* `office` — ausgebende DWD-Stelle, wählt das richtige GAFOR-Bulletin
* `balloon` — Region der Ballon-Gebietsvorhersage
* `center` — optional; sonst wird der Schwerpunkt gerechnet (Kartenbeschriftung, Nächster-Nachbar-Fallback)

Findet die App keinen Treffer, sucht sie das nächstgelegene Gebietszentrum innerhalb von 60 km und
kennzeichnet das im Kopf als Näherung. Ist die Datei leer, funktioniert alles ausser der
Gebietszuordnung weiter.

Für **öffentlich verfügbare GAFOR-Polygone gibt es keine Quelle** — der DWD veröffentlicht die
Gebiete als Karte, nicht als Datensatz. Der Weg hier: Karte georeferenzieren, Flächen vektorisieren,
Ergebnis gegen Referenzorte prüfen (`test/reference-places.json`).

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
