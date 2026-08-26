# Änderungen

Semantische Versionierung: MAJOR bei Brüchen an Daten oder Bedienung, MINOR bei neuen
Funktionen, PATCH bei Korrekturen. Die Version steht in `js/version.js`; `sw.js` muss
denselben Wert tragen, sonst behalten installierte Clients die alte Shell —
`node test/run.mjs` prüft das.

## 1.9.0 — 2026-08-26

* **Die Karte öffnet mit ganz Deutschland im Bild** (Zoom 6, Mitte bei 51,1 N / 10,4 E) statt
  im letzten Ausschnitt. Damit ist auch die Abgrauung ausserhalb der GAFOR-Gebiete zu sehen —
  sie war seit 1.7.0 drin, nur bei Zoom 9 mitten in Deutschland sieht man sie nie. Zusätzlich
  deckt die Maske jetzt kräftiger ab (dunkel 74 %, hell 58 %). Der automatische Sprung auf den
  eigenen Standort beim Start entfällt; der Knopf ◎ holt ihn auf Wunsch.
* **Flugwetterübersicht zweispaltig**, mit **fetten Abschnittstiteln**. Der DWD-Text ist auf
  68 Zeichen hart umbrochen und die Leerzeilen sitzen mitten im Satz — das wird jetzt wieder
  zu Fliesstext zusammengefügt und auf zwei etwa gleich hohe Spalten verteilt. Tabellarische
  Abschnitte wie „Höhenwind und -temperatur" bleiben unangetastet.
* **Höhenwind: Tabelle links, Grafik rechts.** Die Grafik ist deutlich kompakter (236 statt
  360 Einheiten breit, kleinere Fahnen) und hat **Zwischenlinien in beiden Achsen**.
* **Modellwahl über dem Höhenwind:** Auto, ICON-D2, ICON-EU, ICON global, ECMWF IFS, GFS,
  ARPEGE, UKMO. Was den gewählten Vorhersagezeitpunkt nicht mehr abdeckt, wird durchgestrichen
  und lässt sich nicht wählen — ICON-D2 verschwindet also jenseits von +48 h. Die Stundenwahl
  reicht jetzt bis +48 h.
* **Funktionsknöpfe links vom Logo**, jetzt vier: Aktualisieren, Drucken, Teilen, Menü.
* **Drucken.** Eigener Druckteil im Stylesheet: Bedienelemente raus, Erklärtexte raus, alles
  kompakt gesetzt, die Übersicht dreispaltig. Ergebnis mit einem Bulletin normaler Länge:
  **zwei A4-Seiten** — Kopf, Karte, Gebiet, GAFOR und Übersicht auf der ersten, Ballonbericht,
  Höhenwind, METAR und Modellprognose auf der zweiten. Der Testlauf erzeugt das PDF und zählt
  die Seiten nach.
* **Teilen-Knopf** mit zwei Möglichkeiten: **Bild der ganzen Seite als PNG** (html2canvas,
  mitgeliefert, funktioniert offline) oder **Link auf genau diesen Ort** in die Zwischenablage.
  Beim Bild werden `color-mix()`-Farben vorher in `rgba()` umgesetzt — html2canvas kennt die
  moderne Schreibweise nicht und wäre sonst ausgestiegen.

## 1.8.0 — 2026-08-26

* **GAFOR-Codes werden richtig gelesen.** Ein Code ist Buchstabe *plus Ziffer* — `M2`, `D1`,
  `D4`, `M8`. Der Parser kannte nur nackte Buchstaben, und dadurch waren **41 der 68
  Gebiete** falsch oder gar nicht da: 25 fielen ganz weg, 16 verloren den ersten Zeitraum,
  bei 7 landete der Code im Gebietsnamen („Kraichgau M2"). Jetzt stimmen alle 68.
* **Zusätze stehen am richtigen Zeitraum.** `O  O ISOL SHRA  O ISOL TSRA` heisst, dass nur
  der mittlere Zeitraum Schauer bekommt — bisher wurden alle Zusätze ans Zeilenende gehängt.
* **Die Übersichtsseite wird in ihre fünf Bereichstabellen zerlegt.** Vorher hingen alle
  Gebiete unter der ersten Überschrift, sodass in Bayern „Bereich LBZ Hamburg" stand.
* **Die Codetabelle ist hinterlegt und wird angezeigt.** Jede Kachel nennt Sicht und
  Untergrenze zu ihrem Code, die Legende zeigt alle elf gebräuchlichen Stufen. Wichtig und
  bisher nirgends gesagt: die Untergrenze zählt **über der Bezugshöhe des Gebiets**, nicht
  über Grund, und erst ab 5/8 Bedeckung. Die Bezugshöhe steht jetzt unter den Kacheln.
* **Korrigiert:** Die alten Schwellen waren falsch — Charlie verlangt 5000 ft, nicht 2000 ft,
  und Mike beginnt bei 1,5 km Sicht, nicht bei 5 km.
* **METAR/TAF nur noch im Rohformat**, dafür mit dem **Platznamen im Klartext**
  („EDDS · Stuttgart Flughafen"). Die abgeleitete Zeile mit Wind, Sicht, Basis und die
  selbst gerechnete GAFOR-Einstufung sind raus — entschlüsseln muss diese App nicht.
* **Kennwortabfrage beim ersten Laden** (Menü → *Sperren* setzt sie zurück). Das ist
  ausdrücklich **kein Zugangsschutz**: die Seite ist statisch, das Kennwort steht im
  Quelltext. Es hält die private Flugvorbereitung aus dem Weg von Zufallsbesuchern.

## 1.7.0 — 2026-08-26

* **METAR/TAF: Reihenfolge umgedreht.** Bisher fragte die App zuerst die NOAA und nahm die
  Repo-Kopie nur als Rückfall — genau umgekehrt zur Fehlerwahrscheinlichkeit. Jetzt liest sie
  `data/dwd/metar.json` von der eigenen Domain (kein CORS, keine Fremdsperre, kein fremdes
  Netzsegment) und frischt danach still aus dem Netz auf. Gelingt die Auffrischung, steht
  „live von der NOAA" in der Kopfzeile, sonst „Kopie vor N min" — und die Karte ist in beiden
  Fällen gefüllt. Der Direktabruf hat jetzt 7 s Zeitlimit, damit er nichts aufhält.
* **Zweite Quelle im Fetcher.** Liefert die AWC-API nichts, holt der Workflow die stündlichen
  Sammeldateien von `tgftp.nws.noaa.gov` und parst den Rohtext selbst (Wind, Sicht, Wolken,
  T/Td, QNH, Flugkategorie); die Platzkoordinaten kommen aus dem vorigen Lauf. Scheitert auch
  das, bleibt die alte Datei stehen statt leer zu werden.
* **GAFOR-Zeitreihe als Kacheln** statt als einzeilige Tabelle: je Zeitraum eine Kachel mit
  Zeit, Buchstabe und Klartext in der Farbe der Stufe, umbrechend statt seitlich scrollend.
  Der laufende Zeitraum ist hervorgehoben.
* **Stufenerklärung aufklappbar.** Die fünf linksbündigen Zeilen, die den Lesefluss
  zerschnitten haben, stecken jetzt hinter „Was bedeuten C, O, D, M und X?" — zugeklappt eine
  Zeile hoch.
* **Karte graut alles ausserhalb der GAFOR-Gebiete ab.** Eine Maskenebene deckt die Welt ab
  und stanzt die Gebiete als Löcher heraus; hell und dunkel getrennt abgestimmt.
* **Meldung „For the time being, this APP covers only Germany"** im Gebietskopf, in den
  Berichtskarten und als kurzer Hinweis auf der Karte, sobald ein Ort ausserhalb liegt.
* **Gebietsgrenzen auf Deutschland zugeschnitten.** Die von der DFS-Karte abdigitalisierten
  Polygone reichten stellenweise weit ins Ausland — Strassburg und Basel lagen mitten in
  Gebiet 50. `scripts/digitize/clip-to-germany.py` schneidet sie an der Staatsgrenze
  (2,5 km Toleranz) und lässt die offene See stehen, damit Gebiet 00 bleibt.
* **Einrasten von 60 km auf 10 km** und gemessen zum Polygonrand statt zum Gebietsmittelpunkt.
  Vorher bekam Strassburg ein deutsches Gebiet, weil irgendein Mittelpunkt näher als 60 km lag.
* Der Browser-Testlauf prüft jetzt auch Kacheln, Legende, Maske, Auslandsmeldung und die
  Reihenfolge der METAR-Quellen; dazu neun Prüfungen für den Rohtext-Parser der Zweitquelle
  und sechs für die Abdeckung.

## 1.6.0 — 2026-08-26

* **Höhenwindprofil** als eigene Karte unter dem Ballonwetterbericht. Ein Diagramm mit
  Windfahnen — waagrecht die Geschwindigkeit, senkrecht die Höhe in ft AMSL — und darunter
  dieselben Werte als Tabelle mit Driftrichtung und Temperatur. Nullgradgrenze und
  Grenzschichtobergrenze sind in beiden markiert. Stunden-Chips für jetzt bis +12 h.
  Die Druckflächen kommen im selben Open-Meteo-Abruf mit, kosten also keine zusätzliche
  Anfrage; die Obergrenze (700/500/400/300 hPa) steht in den Einstellungen.
* **Bewölkung geschichtet.** Statt einer Summenzeile jetzt hoch, mittel und tief einzeln,
  mit einer Flächenfüllung proportional zur Bedeckung, dazu eine geschätzte Wolkenbasis.
* **Nebelrisiko** als farbcodierte Stundenzeile und als Kachel mit dem nächsten Zeitfenster.
  Abgeleitet aus Taupunktdifferenz, Feuchte, Wind und Modellsicht; kräftige Einstrahlung
  nimmt eine Stufe weg. Die Regel steht offen im „Über"-Dialog — es ist eine Schätzung
  aus dem Modell, keine DWD-Aussage.
* **Ensemble-Streubreite** aus ICON-D2-EPS (20 Rechnungen) als Balken für Wind, Böen und
  Bewölkung, mit Minimum, Median und Maximum und dem Anteil trockener Rechnungen. Zweiter
  Abruf gegen `ensemble-api.open-meteo.com`, in den Einstellungen abschaltbar.
* **Aktualisieren-Knopf** in der Kopfzeile, der alles neu holt und sich dabei dreht.
  Zusätzlich lädt ein Klick auf die Altersanzeige einer Karte nur diese eine Karte nach.
* Neuer Testlauf `node test/browser.mjs` — spielt die App headless mit gemockten Antworten
  durch und prüft, dass alle vier Karten wirklich rendern.

## 1.5.0 — 2026-08-26

* **METAR/TAF mit Rückfallebene.** Der Workflow holt jetzt zusätzlich einmal je Lauf alle
  Meldungen für Deutschland samt Rand (zwei Abrufe) und legt sie als `data/dwd/metar.json` ab.
  Die App fragt weiterhin zuerst die NOAA direkt; scheitert das im Browser — CORS, Firewall,
  gesperrtes Netz —, nimmt sie die Kopie und schreibt „aus dem Repo" in die Kopfzeile.
* Die Auslieferung enthält **`data/dwd/` nicht mehr**. Wird das ZIP über ein bestehendes Repo
  gelegt, überschrieb der mitgelieferte Platzhalter sonst die vom Workflow geholten Daten —
  genau das ist passiert, und danach waren alle drei Berichtskarten leer.
* Behoben: Als Titel des Ballonberichts stand „MetaNavigation" — die erste Überschrift der
  Seite ist die Navigation, gesucht ist die mit „Vorhersagen für …".

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
