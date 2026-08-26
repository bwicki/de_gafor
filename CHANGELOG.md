# Änderungen

Semantische Versionierung: MAJOR bei Brüchen an Daten oder Bedienung, MINOR bei neuen
Funktionen, PATCH bei Korrekturen. Die Version steht in `js/version.js`; `sw.js` muss
denselben Wert tragen, sonst behalten installierte Clients die alte Shell —
`node test/run.mjs` prüft das.

## 1.4.1 — 2026-08-26

* METAR/TAF **end-to-end geprüft**: die NOAA-Antwort liegt als Testdatensatz im Repo
  (`test/sample-metar.json`, `test/sample-taf.json`), neun Prüfungen decken Kreisfilter,
  Sortierung, Höchstzahl, neueste Meldung je Platz, Sichtumrechnung, Hauptwolkenuntergrenze
  und TAF-Auswahl ab.
* **Behoben:** Die NOAA rechnet in Landmeilen und meldet `10+`, woraus 16 km wurden. Steht im
  METAR `9999`, heisst das nach ICAO „10 km oder mehr" — die Anzeige deckelt jetzt bei
  **≥10 km**.
* Neue Zeile **Wolken** je Platz (alle Schichten), weil die Hauptwolkenuntergrenze allein eine
  SCT-Schicht verschweigt.

## 1.4.0 — 2026-08-26

* **Ballonwetterbericht wird jetzt richtig dargestellt.** Der DWD liefert keine Prosa, sondern
  drei Tabellen: astronomische Angaben, stündliche Bodenwerte (Temperatur, Taupunkt, QNH,
  Bedeckung, Wetter, Windrichtung, Wind und Böen) und die Thermik — letztere rein farbcodiert
  ohne Zahlen. Der Fetcher parst Überschriften, Tabellen, Zellen **und Zellenfarben**; die App
  zeichnet daraus wieder eine Tabelle mit denselben Stufen. Blau ist beim DWD die Farbe der
  Beschriftungszellen und wird deshalb nicht als Wert gelesen.
* Bezugsort samt Koordinaten und Höhe wird aus der Überschrift gezogen und über der Tabelle
  angezeigt — beim Gebiet 55 etwa Schwäbisch Hall, 49.10°N 9.75°O, 1270 ft.
* Die Berichte liegen ab jetzt je Gebiet in einer eigenen Datei (`data/dwd/balloon/45.json`)
  und werden erst beim Anzeigen geladen. `index.json` behält nur das Verzeichnis, sonst müsste
  die App beim Start rund 800 KB für 67 Gebiete ziehen.

## 1.3.0 — 2026-08-26

* **Grenzen deutlich sichtbar.** Drei Ebenen mit abgestufter Stärke, jede mit heller
  Unterlegung, damit sie auf der Karte lesbar bleiben: Landesgrenze kräftig dunkel,
  die fünf Bereiche als dicke Linie in ihrer Farbe, die Gebiete fein. Die Bereichsumrisse
  entstehen aus der Vereinigung ihrer Gebiete (`scripts/digitize/build-boundaries.py` →
  `data/gafor-regions.geojson`, `data/germany.geojson`). Der Kartenknopf schaltet jetzt in
  drei Stufen: alles · nur Bereiche und Landesgrenze · aus.
* **Einstellungen** als eigener Dialog: METAR/TAF-Umkreis (25–300 km, Vorgabe **100 km**),
  Höchstzahl der Plätze, Windeinheit, hell/dunkel, TAF an/aus.
* METAR/TAF: Umkreis wird jetzt als Kreis ausgewertet statt als Rechteck, die Kopfzeile
  nennt Anzahl und Umkreis, und die NOAA-Flugkategorie (VFR/MVFR/IFR/LIFR) steht als eigene
  Marke neben der abgeleiteten GAFOR-Einstufung. Beim TAF wird die gültige Ausgabe gewählt
  (`mostRecent`) statt der erstbesten.
* Textauswertung der DWD-Seiten überarbeitet: `<pre>` gewinnt, sonst der längste Block —
  die Ballonberichte stehen in einer Tabelle, und der erste `content`-Block einer Seite ist
  oft nur ein Einleitungssatz. Zwei Prüfungen halten das fest.

## 1.2.0 — 2026-08-25

* **Ballonwetterbericht** angebunden. Die Zielseiten stehen nicht als Links auf der
  Übersichtsseite, sondern in der anklickbaren Bildkarte; der Fetcher liest sie aus deren
  `<area>`-Tags (`…/gebietsvorhersagen_ballonsport/node_45`, dazu Name und Bezugshöhe aus
  dem `alt`). Damit gibt es keine geratenen URLs, und Umnummerierungen beim DWD werden
  automatisch mitgenommen. 67 Gebiete haben einen Bericht — Gebiet 00 (Deutsche Bucht) nicht.
* Die 67 Seiten werden nur geholt, wenn der gespeicherte Stand älter als vier Stunden ist
  (`BALLOON_MAX_AGE_H`), mit 120 ms Pause zwischen den Abrufen. Das hält die Last bei rund
  840 Abrufen pro Tag statt 4900. `FORCE_BALLOON=1` bzw. der Haken beim Handstart des
  Workflows erzwingt einen sofortigen Durchlauf.

## 1.1.0 — 2026-08-25

* **Flugwetterübersicht** als eigenes Produkt: die fünf Bereichsbulletins
  (`FBEU40 EDZH/EDZB/EDZE/EDZF/EDZM`) werden mit Kennung, Gültigkeitszeitraum und
  Vorhersagebereich gelesen und beim passenden Gebiet angezeigt.
* **GAFOR-Codetabelle** gegen das echte DWD-Format geparst: Gebietsnummer, Name, ein Code je
  Zeitraum und Zusätze wie `ISOL RA`. Ein echtes Bulletin liegt als `test/sample-gafor.txt`
  im Repo, die Testsuite prüft den Parser dagegen.
* Bereichszuordnung der 68 Gebiete gegen die `Vorhersagebereich:`-Zeilen des DWD verifiziert —
  Nord 00–10, Ost 11–28, West 31–39, Mitte 41–47/50–53/61, Süd 54–58/62–64/71–76/81–84.
* Versionsanzeige in der Titelzeile mit Fenster für Version, Datenstand und Quellen,
  inklusive „App aktualisieren" (verwirft Service-Worker-Cache und lädt neu).
* Fetcher schreibt Diagnosedateien nach `data/dwd/raw/`: `_links-*`, `_map-*` und
  `_probe-balloon` — damit lassen sich die noch fehlenden Ballonwetter-URLs finden.
* **Behoben:** Leaflet vergibt intern z-index bis 800, wodurch die Karte über Suchliste,
  Menü und Dialog lag. Die Kartenbox bekommt jetzt einen eigenen Stapelkontext.

## 1.0.0 — 2026-08-25

* Erste Fassung: Ortssuche (Name, ICAO, Koordinaten), GPS, Karte mit Fadenkreuz,
  Gebietsbestimmung aus den digitalisierten GAFOR-Polygonen, farbige Bereiche mit Legende.
* Vier Panels: GAFOR/Flugwetterübersicht, Ballonwetterbericht, METAR/TAF der nächsten
  Plätze, Modellprognose am Ort.
* Alle 68 GAFOR-Gebiete aus der DFS-Karte digitalisiert (`scripts/digitize/`), geprüft
  gegen 41 Referenzorte.
* GitHub Action holt die DWD-Berichte dreimal pro Stunde und legt sie als JSON ab.
* PWA mit Service Worker, hell/dunkel, Wind in kt / km/h / m/s.
