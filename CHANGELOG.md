# Änderungen

Semantische Versionierung: MAJOR bei Brüchen an Daten oder Bedienung, MINOR bei neuen
Funktionen, PATCH bei Korrekturen. Die Version steht in `js/version.js`; `sw.js` muss
denselben Wert tragen, sonst behalten installierte Clients die alte Shell —
`node test/run.mjs` prüft das.

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
