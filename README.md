# GaforCast — GAFOR-Gebiet, Flugwetter und Ballonwetter

Ort suchen oder auf der Karte anfahren → das zuständige **GAFOR-Gebiet** wird bestimmt und
darunter stehen sofort **GAFOR/Flugwetterübersicht**, **Ballonwetterbericht**, die **METAR/TAF**
der nächstgelegenen Plätze, das **Höhenwindprofil** und eine **Modellprognose** für genau
diesen Punkt.

Läuft als PWA auf Handy, iPad und Desktop, gehostet auf GitHub Pages, ohne eigenen Server.
Gestaltung, Farbtokens und Bedienidiom kommen von [StueveCast](https://github.com/bwicki/stueve_cast),
damit beide Werkzeuge als eine Familie erkennbar sind.

> **Keine amtliche Flugwetterberatung.** Für den Flug gilt allein die offizielle Beratung des DWD
> (flugwetter.de / pc_met).
>
> **Nur zur individuellen Flugvorbereitung.** Die Luftsportberichte des DWD dürfen nach dessen
> Nutzungsbedingungen nicht weitergegeben oder weiterverarbeitet werden. Diese Installation ist
> privat betrieben; die Kennwortabfrage weist darauf hin.

## Kennwortabfrage

Beim ersten Laden fragt die App ein Kennwort ab (`js/app.js`, Konstante `GATE_PW`). Menü →
**Sperren** setzt das zurück, und **nach zwei Stunden ohne Benutzung** wird von selbst wieder
gefragt (`GATE_IDLE_MS`). Gemessen wird die letzte Berührung, nicht die Anmeldung: wer die
App den Tag über benutzt, wird nicht herausgeworfen; wer sie liegen lässt, schon. Der
Zeitstempel liegt im `localStorage`, die Sperre greift also auch, wenn das Fenster
zwischendurch geschlossen war.

Das ist **kein Zugangsschutz.** Die Seite ist statisch und ihr Quelltext öffentlich, das Kennwort
steht dort im Klartext, und wer die Daten will, holt sie ohnehin direkt aus `data/dwd/`. Der Zweck
ist ein sichtbarer Hinweis, dass die Seite privat ist. Wer wirklich aussperren muss, braucht einen
Server mit echter Anmeldung — GitHub Pages kann das nicht.

## Auf GitHub Pages veröffentlichen

1. Repository anlegen (Vorschlag: `gaforcast`) und den Inhalt dieses Ordners in den Root pushen.
   Das Paket enthält **`data/dwd/` absichtlich nicht** — dieser Ordner gehört dem Workflow.
   Wird eine neue Fassung über ein bestehendes Repo gelegt, bleiben die geholten Berichte
   dadurch erhalten.
2. Settings → Pages → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
3. Settings → Actions → General → Workflow permissions: **Read and write permissions** —
   sonst darf der Fetcher seine Daten nicht committen.
4. Actions-Tab → *DWD-Berichte holen* → **Run workflow** (einmal von Hand, danach läuft er
   dreimal pro Stunde).
5. Öffnen unter `https://<user>.github.io/gaforcast/`.
   Homescreen: iPad/iPhone Safari → Teilen → *Zum Home-Bildschirm*; Android Chrome → *App installieren*.

Alle Pfade sind relativ, ein Unterpfad oder eine eigene Domain (`CNAME`) funktioniert also ohne
Änderung.

### Wenn Drag & Drop die Ordnerstruktur plattgemacht hat

Zieht man den entpackten Ordner im Browser auf GitHub, landen die Dateien je nach Browser flach
im Wurzelverzeichnis — `app.js`, `metar.js`, `leaflet.js` und so weiter liegen dann doppelt da,
einmal richtig unter `js/` und einmal als Leiche im Root. Benutzt werden sie nicht, `index.html`
lädt aus `js/`; aber sie veralten still und machen jede Fehlersuche zur Lotterie.

Aufräumen lässt sich das am schnellsten im Web-Editor: im Repository **`.` drücken**
(öffnet github.dev), im Dateibaum die Leichen markieren, löschen, committen. Im Wurzelverzeichnis
gehören nur: `index.html`, `sw.js`, `manifest.webmanifest`, `README.md`, `CHANGELOG.md`,
gegebenenfalls `CNAME` — und die Ordner `css/ data/ icons/ img/ js/ scripts/ test/ tools/
.github/`.

## Einstellungen

Menü → **Einstellungen**: METAR/TAF-Umkreis (25–300 km, Vorgabe 100 km), Höchstzahl der
angezeigten Plätze, Windeinheit (kt · km/h · m/s), hell/dunkel, TAF an/aus, Obergrenze des
Höhenprofils (700/500/400/300 hPa), Höhen in Fuss oder Meter, die relative Feuchte, ab der
die möglichen Wolkenbänder schattiert werden (70 – 95 %, Vorgabe 85 %), und die
Ensemble-Streubreite an/aus. Alles liegt im `localStorage` des Geräts, nichts wird
übertragen.

## Die vier Knöpfe in der Kopfzeile

Sie stehen links vom Logo.

**⟳ Aktualisieren** holt alles neu — DWD-Index, Ballonbericht, METAR/TAF, Modell und Ensemble.
Wer nur eine Karte auffrischen will, klickt auf deren Altersanzeige rechts in der Kartenkopfzeile.

**⎙ Drucken** legt die Seite auf zwei A4-Seiten: Kopf, Karte, Ort, Gebiet, GAFOR-Zeitband und
Flugwetterübersicht auf die erste, Ballonbericht, Höhenwind, METAR/TAF und Modellprognose auf die
zweite. Bedienelemente und Erklärtexte fallen weg, die Übersicht wird dreispaltig gesetzt, die
Farben der GAFOR-Stufen bleiben. Ob es wirklich zwei Seiten bleiben, hängt an der Länge der
Berichte — bei einem sehr langen Ballonbericht kommt eine dritte dazu. `node test/browser.mjs`
erzeugt das PDF und zählt die Seiten nach.

**⤴ Teilen** bietet zweierlei: ein **PNG der ganzen Seite** (gerendert mit dem mitgelieferten
html2canvas, funktioniert offline) oder den **Link auf genau diesen Ort** in die Zwischenablage.

**≡ Menü** enthält Hell/Dunkel, Einstellungen, Neuladen, Über und Sperren.

## Der Kopfbereich

Ab 900 px Bildschirmbreite teilt sich der obere Teil der Seite **40 / 60**: rechts aussen die
Karte, links darunter — in dieser Reihenfolge — das **Suchfeld**, die **Ortszeile** mit
Bundesland und Koordinaten, der **GAFOR-Gebietskopf** und der Kasten mit den
**GAFOR-Stufen**. Die vier Kästchen zusammen sind genau so hoch wie die Karte; die freie
Fläche sammelt sich im letzten Kasten zwischen Zeitband und Legende. Auf dem Handy stapelt
alles in derselben Reihenfolge untereinander.

Die **GAFOR-Stufen** stehen als durchgehendes **Zeitband**: ein Abschnitt je Zeitraum in der
Farbe seiner Stufe, mit Code und Uhrzeit; der laufende Zeitraum ist kräftiger gefüllt und
amber unterstrichen. Sicht, Untergrenze und ein etwaiger Zusatz stehen in der Fusszeile
darunter — für den Abschnitt, den man antippt, sonst für den laufenden. Ein kleiner Punkt
oben rechts markiert die Abschnitte, zu denen ein Zusatz vorliegt. So braucht die Reihe rund
ein Viertel der Höhe der früheren Kacheln und wächst auch bei sechs Zeiträumen nicht in eine
zweite Zeile.

## Karte beim Öffnen

Die App startet immer mit ganz Deutschland im Bild (Zoom 6, Mitte bei 51,1 N / 10,4 E), damit die
Gebiete und die abgegraute Umgebung sichtbar sind. Ein Suchtreffer fährt die Karte auf den Ort:
Zoom 11 für eine Ortschaft, 12 für einen Flugplatz oder eingegebene Koordinaten. Ein Link mit Koordinaten im Fragment
(`#49.2200,8.8000,10`) überschreibt das. Auf den eigenen Standort springt die App nicht mehr von
selbst — dafür ist der Knopf ◎ da.

## Woher die METAR kommen

Die Kopfzeile je Platz ist **einzeilig**: die Kennung in Dunkelamber, mit Abstand der
**Name im Klartext**, am rechten Rand ein **Peilungspfeil vom Vorhersageort zur Station**
und dahinter die Entfernung. Der Pfeil zeigt die rechtweisende Anfangspeilung; Richtung und
Gradzahl stehen im Tooltip. Reicht der Platz nicht, wird der Name gekürzt — Kennung und
Entfernung bleiben stehen.

Die Namen kommen aus der NOAA-Antwort; Abkürzungen wie *Arpt*, *Intl* oder *AB* werden
ausgeschrieben. Das angehängte „DE" sagt in einer Deutschlandkarte nichts und weicht dem
**Kürzel des Bundeslands** (`EDDS` → „Stuttgart Flughafen · BW"). Dahinter liegt eine feste
Tabelle deutscher Plätze in `js/metar.js` — offline richtig oder gar nicht: eine nicht
hinterlegte Kennung bekommt **kein** Kürzel statt eines geratenen. Ausländische Plätze
behalten ihr Land.

Darunter stehen **zwei Zeilen Klartext** und darunter der **Rohtext**. Der Rohtext bleibt
massgebend — die zwei Zeilen sind Lesehilfe, keine Auswertung.

```
EDDS   Stuttgart Flughafen · BW                                 ↗ 60 km
Wind 140°, 5 kt · Sicht ≥10 km · Wolken 3–4/8 ab 2500 ft
15 °C, Taupunkt 13 °C · QNH 1018 hPa · VFR
   EDDS 260620Z 14005KT 9999 SCT025 15/13 Q1018 NOSIG
Vorhersage 26. 06 bis 27. 12 UTC · Wind 140°, 5 kt · Sicht ≥10 km · Wolken 3–4/8 ab 3000 ft
zeitweise 26. 12–18 UTC: Regenschauer, Wolken 5–7/8 ab 1500 ft
   TAF EDDS 260500Z 2606/2712 14005KT 9999 SCT030 TEMPO 2612/2618 SHRA BKN015
```

Beim TAF werden FM, TEMPO, BECMG, INTER und PROB erkannt; PROB30 gehört zur folgenden
TEMPO-Gruppe. Witterungskürzel sind übersetzt (`-SHRA` → Regenschauer, leicht), Bedeckungsgrade
stehen in Achteln (`BKN012` → 5–7/8 ab 1200 ft). Passt die Änderungszeile nicht in eine Zeile,
wird sie mit „…" gekürzt — vollständig steht alles im Rohtext.

Bei der Herkunft gilt seit 1.7.0 die umgekehrte Reihenfolge von früher, und zwar mit Absicht:

1. **`data/dwd/metar.json` aus dem eigenen Repo.** Same-Origin — daran scheitert weder CORS
   noch eine Firewall noch ein Anbieter, der Rechenzentren aussperrt. Der Workflow füllt die
   Datei dreimal pro Stunde; METAR wird halbstündlich ausgegeben, die Kopie ist also nie
   nennenswert alt. Die Kopfzeile schreibt „Kopie vor N min".
2. **NOAA direkt, still im Hintergrund.** Gelingt der Abruf innerhalb von 7 Sekunden, hebt die
   App die Anzeige auf „live von der NOAA". Scheitert er, merkt niemand etwas, weil längst
   etwas dasteht.

Vorher war es andersherum, und wenn der Direktabruf im Browser scheiterte, blieb die Karte leer.

Der Umkreis wird als Bounding-Box angefragt und danach auf den echten Kreisradius gefiltert —
ein Rechteck würde in den Ecken bis zu 40 % zu weit greifen.

Der Fetcher selbst hat ebenfalls zwei Wege: die AWC-API, und falls die nichts liefert die
stündlichen Sammeldateien auf `tgftp.nws.noaa.gov`, deren Rohtext er selbst parst. Geht beides
nicht, bleibt die vorherige Datei stehen, statt leer zu werden.

## Die GAFOR-Codes

Ein GAFOR-Code ist Buchstabe plus — bei Delta und Mike — eine Ziffer. Der Buchstabe ist die
Einstufung, die Ziffer sagt, *welche* Kombination aus Bodensicht und Wolkenuntergrenze
dahintersteckt:

| Code | Bodensicht | Untergrenze über Bezugshöhe |
|---|---|---|
| C — Charlie, frei | ≥ 10 km | ≥ 5000 ft |
| O — Oscar, offen | ≥ 8 km | ≥ 2000 ft |
| D1 — Delta | ≥ 8 km | 1000 – 2000 ft |
| D3 — Delta | 5 – 8 km | ≥ 2000 ft |
| D4 — Delta | 5 – 8 km | 1000 – 2000 ft |
| M2 — Mike | ≥ 8 km | 500 – 1000 ft |
| M5 — Mike | 5 – 8 km | 500 – 1000 ft |
| M6 — Mike | 1,5 – 5 km | ≥ 2000 ft |
| M7 — Mike | 1,5 – 5 km | 1000 – 2000 ft |
| M8 — Mike | 1,5 – 5 km | 500 – 1000 ft |
| X — X-Ray, geschlossen | < 1,5 km | oder < 500 ft |

Zwei Dinge daran werden gern übersehen: die Untergrenze zählt **über der Bezugshöhe des Gebiets**
(`refAltFt` in `data/gafor-meta.json`), nicht über Grund und nicht über NN — und sie zählt erst ab
5/8 Bedeckung, also BKN oder OVC.

D2, M1, M3 und M4 kommen in der Tabelle nicht vor. Die Matrix ist aus zwei wörtlichen Definitionen
des DWD-Merkblatts (D1 und M5) und zwei unabhängigen Wiedergaben der vollständigen Tabelle
rekonstruiert; unbekannte Feinstufen fallen in der App sauber auf die Buchstabenklasse zurück.
Verbindlich ist die GAFOR-Legende des DWD.

## Höhenwind, Stüve-Diagramm, Bewölkung, Nebel, Streubreite

Die Karte **Höhenwind am Ort** zeigt links die Tabelle und rechts ein **Stüve-Diagramm mit
Windfeld**.

Im Stüve steht senkrecht der Druck, skaliert mit p^0,286, waagrecht die Temperatur. Diese
Achse ist der Zweck der Darstellung: sie macht **Trockenadiabaten zu Geraden**. Damit liest
man Inversionen, die Mischungsschicht und die Höhe, bis zu der ein Paket trocken aufsteigt,
direkt ab. Eingezeichnet sind Isothermen, Isobaren, Trockenadiabaten alle 20 K sowie die
**Temperatur-** (rot) und die **Taupunktkurve** (blau) — laufen beide zusammen, ist die Luft
gesättigt.

**Feuchte Schichten sind schattiert**: ab 85 % relativer Feuchte beginnt die Schattierung und
wird bis 100 % kräftiger; zwischen den Druckflächen wird überblendet. Dieselbe Färbung steht
in der Spalte *rF* der Tabelle.

Rechts, auf demselben Höhenraster, das Windfeld. Die **Windfahne** zeigt wie in der
Luftfahrtkarte in den Wind, die Federn geben Knoten (halb 5, ganz 10, Wimpel 50). Der
**Pfeil in der Tabelle** (Spalte *Wind*) zeigt umgekehrt die Richtung, in die es treibt — für
die Fahrtplanung die brauchbarere Angabe. 0°-Grenze und Grenzschichtobergrenze sind in
beiden markiert.

Am linken Rand des Diagramms stehen **zwei Zahlenspalten**: aussen die Höhe in Fuss oder
Meter AMSL (je nach Einstellung), innen der Druck in hPa. Die Windachse rechts ist von 0 an
beschriftet.

**Nicht eingezeichnet** sind Feuchtadiabaten und Mischungsverhältnislinien. Beide brauchen
Iteration und würden das Bild in dieser Grösse zustellen; der Hinweis steht auch unter dem
Diagramm.

Die relative Feuchte kommt von allen Druckflächen mit, der Taupunkt wird daraus nach Magnus
gerechnet — Open-Meteo liefert ihn auf den Flächen nicht. Die bodennahen Flächen (10, 80,
180 m über Grund) haben keinen Druck und werden über ihre Höhe eingehängt.

Auf dem Desktop steht die **Tabelle links, die Grafik rechts** daneben, beide je zur Hälfte
der Kartenbreite; die Grafik ist genauso hoch wie die Tabelle. Auf dem Handy stapeln sie sich.

Über beiden steht die **Modellwahl**, aufsteigend nach Vorhersagehorizont: ICON-D2 (48 h),
ARPEGE (96), ICON-EU (120), ECMWF IFS (144), UKMO (168), ICON global (180), GFS (384) und
zuletzt Auto (nahtloser Mix). Jedes Modell bleibt wählbar.

Darunter wählt ein **Schieber in Ein-Stunden-Schritten** den Zeitpunkt. Sein oberes Ende ist
der Horizont des gewählten Modells — mit ICON-D2 lässt er sich also gar nicht erst über
+48 h ziehen; wer von einem weiten auf ein kurzes Modell wechselt, dessen Zeitpunkt rückt
auf dessen Horizont zurück. Unter dem Schieber steht der gewählte Zeitpunkt mit Uhrzeit und,
ab einem Tag Vorlauf, dem Datum. Im Ausdruck fällt der Schieber weg, seine Beschriftung
bleibt als Zeitangabe stehen.

Die Werte kommen aus den Druckflächen 1000 bis 300 hPa desselben Open-Meteo-Abrufs, ergänzt
um 10, 80 und 180 m über Grund; Flächen unterhalb des Geländes fallen heraus. Die Höhe stammt
aus dem Geopotential, nicht aus der Standardatmosphäre.

In der **Modellprognose** stehen hohe, mittlere und tiefe Bewölkung getrennt, jede Zelle
proportional zur Bedeckung eingefärbt. Zwei Zeilen darunter sind **Schätzungen aus dem
Modell und keine DWD-Aussage** — sie stehen mit derselben Warnung im „Über"-Dialog:

* **Basis** ist das Kondensationsniveau aus Temperatur und Taupunkt (rund 400 ft je Grad
  Spread), gezeigt nur ab 25 % tiefer Bewölkung.
* **Nebelrisiko** ist *hoch* bei Spread ≤ 0,6 K, Feuchte ≥ 97 % und Wind unter 2 m/s,
  *mässig* bei ≤ 1,5 K / ≥ 93 % / unter 3,5 m/s, *gering* bei ≤ 2,5 K / ≥ 88 % / unter
  5 m/s. Modellsicht unter 1 km setzt es auf *hoch*, Einstrahlung über 250 W/m² nimmt eine
  Stufe weg.

Die **Streubreite** darunter kommt aus ICON-D2-EPS: 20 Rechnungen desselben Modells mit leicht
verschiedenen Anfangszuständen. Der Balken zeigt Minimum bis Maximum, der Strich den Median.
Ein schmaler Balken heisst, dass sich die Rechnungen einig sind; ein breiter, dass die Lage
offen ist. Abschaltbar, weil es ein zweiter Abruf gegen einen anderen Host ist.

## Karte

Drei Ebenen, bewusst unterschiedlich stark, jede mit heller Unterlegung, damit sie über
OSM-Kacheln lesbar bleibt: **Landesgrenze** kräftig dunkel, **Bereiche** als dicke Linie in
ihrer Farbe, **Gebiete** fein in derselben Farbe, das gewählte Gebiet gefüllt. Der Knopf ▦
schaltet in drei Stufen: alles · nur Bereiche und Landesgrenze · aus.

Alles **ausserhalb** der GAFOR-Gebiete wird abgegraut: eine Maskenebene deckt die Welt ab und
stanzt die Gebietsumrisse als Löcher heraus. Fällt der gewählte Ort dort hinein, steht überall
dieselbe Meldung — im Gebietskopf, in den Berichtskarten und kurz auf der Karte:
*For the time being, this APP covers only Germany.*

Grenznahe Orte rasten bis **10 km** noch ein (gemessen zum Polygonrand, nicht zum
Gebietsmittelpunkt); das deckt die Digitalisierungstoleranz ab, ohne dass Zürich ein deutsches
Gebiet bekommt.

Die Bereichsumrisse und die Landesgrenze sind reine Darstellung; die Gebietszuordnung rechnet
immer mit `gafor-areas.geojson`. Erzeugt werden sie mit:

```
python3 scripts/digitize/build-boundaries.py
```

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
index.html                  eine Seite: Kopfbereich (Suche · Ort · Gebiet · Stufen | Karte) · fünf Karten
css/base.css                Farbtokens und Bausteine (dunkel/hell), aus dem S2-/StueveCast-Set
css/app.css                 Layout: Handy einspaltig, ab 900 px zweispaltig
js/version.js               Version, Build-Datum, Cache-Name — die einzige Stelle dafür
js/util.js                  Helfer: Geometrie (point-in-polygon), Distanz, Peilung, Formatierung, Storage
js/gafor.js                 Gebietsgeometrie laden, Punkt → Gebiet, Code-Legende C/O/D/M/X
js/geo.js                   Ortssuche (Open-Meteo), Koordinateneingabe, ICAO, Reverse-Geocoding
js/dwd.js                   liest data/dwd/index.json und wählt Bulletin und Ballonbericht aus
js/metar.js                 METAR/TAF: erst die Repo-Kopie, dann still die NOAA; Ceiling/Sicht/Einstufung, Bundeslandtabelle
js/openmeteo.js             Punktprognose, Druckflächen-Windprofil, Nebel- und Basisschätzung, Ensemble
js/wind.js                  Windfahnen und das einfache Windprofil (Rückfall ohne Feuchte)
js/stueve.js                Stüve-Diagramm mit Windfeld, einstellbare Feuchteschattierung (reines SVG)
js/vendor/html2canvas.min.js  Seitenbild als PNG (MIT, Lizenz daneben)
js/mapview.js               Leaflet-Karte, drei Grenzebenen, festes Fadenkreuz in der Mitte
js/app.js                   Zustand, Bedienung, Rendering aller Karten
data/gafor-areas.geojson    die Gebietsgrenzen  ← siehe unten
data/gafor-regions.geojson  Umrisse der fünf Bereiche (aus den Gebieten verschmolzen)
data/germany.geojson        Landesgrenze, vereinfacht — nur zur Darstellung
data/dwd/index.json         von der Action erzeugt: Bulletins als JSON
data/dwd/balloon/NN.json    der Ballonbericht je Gebiet, als Tabellenstruktur mit Farben
data/dwd/raw/*.txt          derselbe Text unparsed, damit der Parser nachgebessert werden kann
data/gafor-meta.json        die 68 Gebiete: Nummer, Bezeichnung, Bezugshöhe, Bereich
scripts/fetch-dwd.mjs       der Fetcher (Node 20, ohne Abhängigkeiten)
scripts/digitize/           Digitalisierung der Gebietskarte (OpenCV), Zuschnitt auf Deutschland,
                            und die daraus abgeleiteten Umrisse
tools/digitize.html         Karte von Hand nachziehen und korrigieren, exportiert GeoJSON
.github/workflows/fetch-dwd.yml   holt die Berichte dreimal pro Stunde und committet sie
test/run.mjs                Prüfungen ohne Browser
test/browser.mjs            Durchlauf in headless Chromium mit gemockten Antworten
test/sample-*.txt           echte DWD-Bulletins, gegen die der Parser geprüft wird
CHANGELOG.md                was sich je Version geändert hat
sw.js                       Offline: Shell cache-first, Daten network-first mit Cache-Fallback
```

## Woher die Daten kommen

| Was | Quelle | Weg |
|---|---|---|
| GAFOR-Codes, Flugwetterübersicht | DWD Luftsportberichte | GitHub Action → `data/dwd/index.json` |
| Ballonwetterbericht (je Gebiet) | DWD Gebietsvorhersagen Ballonsport | GitHub Action → `data/dwd/index.json` |
| METAR / TAF | NOAA Aviation Weather Center | direkt aus dem Browser, sonst über `data/dwd/metar.json` |
| Modellprognose, Höhenwind, Ortssuche, Höhe | Open-Meteo (ICON) | direkt aus dem Browser |
| Streubreite der Prognose | Open-Meteo Ensemble (ICON-D2-EPS, 20 Rechnungen) | direkt aus dem Browser |
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

  Der Bericht selbst ist kein Text, sondern drei Tabellen — astronomische Angaben, stündliche
  Bodenwerte und die Thermik, letztere rein über Zellenfarben ohne Zahlen. Geparst werden
  Überschriften, Zeilen, Zellen und Farben; die App zeichnet daraus wieder eine Tabelle. Weil
  das je Gebiet einige Kilobyte sind, liegt jeder Bericht in einer eigenen Datei unter
  `data/dwd/balloon/` und wird erst beim Anzeigen geladen.

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

Findet die App keinen Treffer, sucht sie den nächstgelegenen **Polygonrand** innerhalb von 10 km
und kennzeichnet das im Kopf als Näherung; weiter draussen kommt die Abdeckungsmeldung. Bis 1.6.0
waren es 60 km zum Gebiets*mittelpunkt* — dadurch bekam Strassburg ein deutsches Gebiet, nur weil
irgendein Mittelpunkt zufällig nah genug lag. Ist die Datei leer, funktioniert alles ausser der
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

Seit 1.7.0 werden die Polygone zusätzlich an der Staatsgrenze beschnitten — die DFS-Karte zeichnet
grosszügig, im Oberrheingraben reichten die Gebiete bis Strassburg und Basel:

```
python3 scripts/digitize/clip-to-germany.py <natural-earth-countries.geojson>
python3 scripts/digitize/build-boundaries.py
```

Erlaubt bleibt Deutschland mit 2,5 km Toleranz plus alles, was in keinem Landpolygon liegt —
sonst verlöre Gebiet 00 „Deutsche Bucht" seine Fläche. Als Ländergrundlage dient
[Natural Earth](https://www.naturalearthdata.com/) (gemeinfrei); mitgeliefert wird nur das
Schnittergebnis.

## Tests

```
node test/run.mjs
```

prüft Syntax aller Module, Struktur und Plausibilität der Gebietsgeometrie (Nummern eindeutig, Ringe
geschlossen, Koordinaten innerhalb Deutschlands), den DWD-Parser gegen Beispieltexte, die
METAR/TAF-Auswahl, das Höhenprofil samt Nebel- und Ensemble-Rechnung, die Windfahnen und die
Zuordnung der Referenzorte. Läuft ohne Netz und ohne Abhängigkeiten.

```
npm i -D playwright && npx playwright install chromium
node test/browser.mjs [--shot bild.png]
```

startet einen lokalen Server, mockt Open-Meteo und die NOAA und spielt die App headless durch:
Rendern aller Karten, Stundenwahl im Höhenprofil, Farbcodierung der Nebelzeile, Ensemble-Balken
und die beiden Aktualisieren-Wege. Mit `--shot` fallen Bildschirmfotos der ganzen Seite sowie
der Höhenwind- und Modellkarte an.

## Lizenz und Nachweise

Eigene Lizenz analog zum S2-Werkzeug: Nutzung erlaubt; Änderung, Weitergabe oder Veröffentlichung
abgeleiteter Fassungen brauchen die vorherige schriftliche Zustimmung des Rechteinhabers und müssen
die Namensnennung erhalten.

Wetterdaten: [DWD](https://www.dwd.de) (Luftsportberichte, frei zugänglich),
[NOAA AWC](https://aviationweather.gov), [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
Karte © OpenStreetMap-Mitwirkende. Enthält Leaflet (BSD-2-Clause).
