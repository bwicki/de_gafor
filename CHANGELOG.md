# Änderungen

Semantische Versionierung: MAJOR bei Brüchen an Daten oder Bedienung, MINOR bei neuen
Funktionen, PATCH bei Korrekturen. Die Version steht in `js/version.js`; `sw.js` muss
denselben Wert tragen, sonst behalten installierte Clients die alte Shell —
`node test/run.mjs` prüft das.

## 1.18.0 — 2026-08-26

* **Kurzanalyse durch Claude.** Unter der Modellprognose steht neu eine Karte mit höchstens
  24 Zeilen in drei Abschnitten: **Grosswetterlage**, **Ballonspezifische Gefahren**
  (Bodenwind, Böen, Scherung zwischen Boden und 300–2000 ft, Schauer und Gewitter im
  Umkreis von 100 km — je mit ihrer Entwicklung über den Modellhorizont) und **Startfenster
  im Vergleich**, in dem die Analyse die von der App gerechneten Fenster gegen die Daten
  prüft und sagt, wo sie ihr zu optimistisch oder zu streng erscheinen. Die Analyse wird
  **auf Knopfdruck** geholt, nicht automatisch — jeder Abruf kostet.
* **Der Schlüssel gehört dem Nutzer.** Die App ist eine öffentliche Seite ohne Server; ein
  Schlüssel im Quelltext wäre ein Schlüssel für alle. Er steht darum in den Einstellungen,
  liegt im `localStorage` genau dieses Geräts und geht nur an `api.anthropic.com` — nie ins
  Repo, nie in einen geteilten Link, nie ins Seitenbild. Zwei Modelle zur Wahl: Sonnet 5
  (ausgewogen) und Haiku 4.5 (schnell und günstig).
* **Der DWD-Fliesstext geht ab Werk nicht mit.** Die Luftsportberichte dürfen nach den
  Nutzungsbedingungen des DWD nicht weitergegeben oder weiterverarbeitet werden, und ein
  Abruf bei einem Dritten ist beides. Ein Schalter in den Einstellungen hebt das für den
  auf, der es verantworten will; ohne ihn fällt der Abschnitt zur Grosswetterlage dünner aus.
* Geschickt wird nicht der Rohdatensatz, sondern ein **Lagebericht**: Ort und Gebiet, die
  GAFOR-Stufen, das Stundenraster in Dreierschritten, das Höhenprofil an drei Zeitpunkten,
  die METAR und TAF im Umkreis, die Dämmerungszeiten, die gerechneten Startfenster und die
  eingestellten Schwellen.
* Die **Kopfzeile der Modellprognose** nennt jetzt den absoluten Zeitpunkt, für den die
  Werte gelten (Wochentag, Datum, Uhrzeit), statt nur einer relativen Angabe.
* Im Druck fällt die Karte weg, solange sie leer ist — die zwei A4-Seiten bleiben.

## 1.17.0 — 2026-08-26

* **Eigenes Symbol.** Das bisherige — eine Kartennadel mit einem Stüve-Diagramm darin, in
  Creme und Petrol — gehörte zu StueveCast und kam mit dem Baukasten mit. An seiner Stelle
  steht jetzt das **Stufenband**: vier Balken in den GAFOR-Farben (Charlie · Oscar · Delta ·
  Mike) in den kräftigen Werten des hellen Farbsatzes, auf hellem Grund mit feinem Rand —
  ohne den Rand verschwände die Kachel auf einer weissen Tableiste.
* Die **Jetzt-Marke** aus dem Zeitband der App ist bewusst **nicht** dabei: unter 32 px wird
  sie zum Fleck, und die vier Balken tragen allein. Dafür sind die Balken höher und füllen
  die Kachel.
* Alles liegt **innerhalb des Kreises**, den Android aus einem maskablen Symbol schneidet
  (äusserster Punkt 39,7 von 40); die maskable Fassung ist zusätzlich auf 80 % verkleinert
  und randlos gefüllt, die Apple-Fassung auf 86 % und ohne eigene Rundung, weil iOS seine
  eigene Maske legt.
* Neu `scripts/build-icons.mjs`: erzeugt aus einer Geometrie den ganzen Satz — `favicon.svg`,
  `favicon.ico` (16/32/48), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` und
  `apple-touch-icon.png`. Zehn Prüfungen in `test/run.mjs` halten das fest: Dateien vorhanden,
  keine Schrift im Symbol (die fehlt auf fremden Geräten), die vier Stufenfarben, der
  maskable Kreis, die Kantenlängen, und dass `index.html` und Manifest dieselben Dateien
  nennen.

## 1.16.1 — 2026-08-26

Nur Dokumentation: **README konsolidiert.** Es war über die Versionen hinweg gewachsen, mit
Abschnitten an der Stelle, an der die jeweilige Funktion entstand. Jetzt in fünf Teilen, in
der Reihenfolge, in der man sie braucht:

1. **Die Seite von oben nach unten** — Kopfbereich, Zeitschieber, Startfenster,
   Flugwetterübersicht, Ballonbericht, Höhenwind, METAR/TAF, Modellprognose, Karte.
2. **Bedienung** — die vier Knöpfe, Einstellungen (jetzt als Tabelle in der Reihenfolge des
   Dialogs), Aktualität, Kennwort und Gastzugang.
3. **Die GAFOR-Codes** und **Woher die Daten kommen** — Herkunft, die drei DWD-Produkte, die
   METAR-Reihenfolge.
4. **Die Gebietsgrenzen** samt Digitalisierung.
5. **Betrieb** (Pages, Versionierung), **Aufbau**, **Tests**, **Lizenz**.

Dabei aufgeräumt: die Karte wurde an zwei Stellen beschrieben, „Die vier Knöpfe" enthielt
Dinge, die keine Knöpfe sind (automatisches Nachladen, Altersalarm), der Zeitschieber stand
doppelt, ein Absatz über die GAFOR-Kacheln endete mitten in einem Vergleich mit einer
Darstellung, die es nicht mehr gibt. Versionsnummern im Fliesstext („seit 1.14.0") sind weg,
wo sie dem Leser nichts sagen; wo sie eine Entscheidung erklären (60 km zum Mittelpunkt →
10 km zum Polygonrand), stehen sie als Begründung ohne Nummer. Der Testabschnitt nennt jetzt,
was wirklich geprüft wird — Gastzettel, Sonnenstand, Startfensterampel, Druckseiten.

## 1.16.0 — 2026-08-26

* **Der Knopf „neu laden" im Warnhinweis sagt jetzt, was er tut.** Er sah untätig aus, weil
  der DWD oft schlicht nichts Neues hat und die Seite danach gleich aussieht. Jetzt zeigt er
  während des Ladens „lädt…" und ist gesperrt, unten links meldet die Karte „Berichte werden
  geladen …", und danach steht entweder frischer Stand da (der Hinweis verschwindet von
  selbst) oder ausdrücklich: „Um 14:32 neu geholt — der DWD-Stand ist unverändert."
* **Geteilte Links öffnen sich ohne Kennwort — für 30 Minuten und für genau diesen Ort.**
  Der Link aus ⤴ → *Link zu diesem Ort kopieren* trägt jetzt einen Zettel mit Ort, Zoom,
  Ablaufzeit und einer Prüfsumme. Beim Empfänger:
  * kein Kennwort, und es wird auch **nichts dauerhaft freigeschaltet** — sein Browser bleibt
    ohne den Link gesperrt;
  * die **Ortswahl ist stillgelegt**: an ihrer Stelle steht der Hinweis „Fester Ort" samt
    Restzeit, Suche, Standort und Merken sind weg, die Karte lässt sich nicht mehr
    verschieben (zoomen schon), und ein Kartenschwenk ändert den Vorhersagepunkt nicht;
  * **Wettermodell, Vergleichsmodell und Zeitschieber bleiben frei bedienbar** — nur eben
    für diesen einen Punkt;
  * nach 30 Minuten läuft der Zettel ab, die Seite lädt neu und meldet an der Sperre „Der
    Gastzugang über den Link ist abgelaufen."
  Ein abgelaufener, verfälschter oder auf einen anderen Ort umgeschriebener Zettel öffnet
  nichts.

### Was der Gastzettel ist und was nicht

Er ist **keine Kryptographie**, und er soll auch keine sein. Die Seite ist statisch, ihr
Quelltext öffentlich, das Kennwort steht darin — wer den Quelltext liest, kann sich einen
Zettel selbst ausstellen. Der Zettel verhindert, was praktisch passiert: dass ein
weitergeleiteter Link Wochen später noch aufgeht oder dass jemand damit durch ganz
Deutschland fährt. Echter Schutz bräuchte einen Server mit Sitzungen; GitHub Pages kann das
nicht, und daran hat sich seit 1.8.0 nichts geändert.

## 1.15.0 — 2026-08-26

* **Die Tabellen im Flugwetterbericht sind jetzt echte Tabellen.** Höhenwind und
  Dämmerungszeiten kamen als ASCII-Kunstwerk mit „|": die Striche standen zwar da, aber die
  Zahlen darunter verrutschten, sobald ein Ortsname länger war. Sie werden nun geparst und
  als `<table>` gesetzt, die Spalten richten sich damit von selbst aus. Zwei Regeln machen
  das allgemein genug für beide Formen: eine **Spalte wird geteilt**, wenn alle Datenzellen
  ein durch zwei Leerzeichen getrenntes Paar enthalten („010/05KT  20C", „Gießen  18.24") —
  die Kopfzelle bekommt dann colspan 2; und eine **kurze Zeile wird gespannt**, wenn die
  Breite glatt aufgeht — so steht „heute | morgen" über je zwei Zeitspalten. Zeilen ohne „|"
  darunter sind Fussnoten und bleiben Text.
* **Nur noch die Höhenwindtabelle des eigenen Gebiets.** Ein Bereichsbulletin enthält zwei
  oder drei, jede mit einer Überschrift wie „GAFOR-Gebiete 54 - 58, 63, 64". Die anderen
  gehen einen nichts an und fallen weg. Ist für das Gebiet keine dabei, steht das als Satz
  da statt einer leeren Überschrift. Lässt sich die Liste nicht lesen, bleibt alles stehen —
  lieber zu viel als das Falsche weg.
* Zwischen dem Text eines Abschnitts und einer darauf folgenden Tabelle steht jetzt Luft.
* **Startfenster: die fahrbaren Fenster liegen als Balken unter dem Streifen**, an genau
  der Stelle, an der sie zeitlich liegen — statt als drei Kästchen untereinander, aus denen
  man erst zurückrechnen musste. Was nicht in den Balken passt, wird weggelassen statt
  abgeschnitten; vollständig steht alles im Tooltip.
* **Die Startfenster-Schwellen stehen in den Einstellungen.** Bodenwind, Böen, Böigkeit und
  CAPE je zweimal (grenzwertig ab / nein ab), dazu Niederschlag, Mindestsicht,
  Mindest-Wolkenbasis und ob die bürgerliche Dämmerung Pflicht ist. Windangaben in der
  gewählten Einheit; „nein ab" rutscht nie unter „grenzwertig ab". Ein Knopf stellt die
  Vorgaben wieder her.
* **Unter jedem GAFOR-Abschnitt steht seine Stufendefinition** — Sicht und Untergrenze in
  einem eigenen kleinen Kästchen, bündig unter dem Farbfeld. Bisher stand sie nur in der
  Fusszeile des angetippten Abschnitts; für den Vergleich zweier Zeiträume musste man hin-
  und herklicken.

## 1.14.0 — 2026-08-26

Sechs neue Funktionen aus der Vorschlagsliste.

* **Startfenster.** Die neue oberste Karte beantwortet die Frage, mit der man die App
  öffnet: eine Ampel je Stunde — *fahrbar*, *grenzwertig*, *nein* — mit dem Grund dahinter,
  ein Streifen über den ganzen Vorhersagezeitraum und darunter die nächsten drei
  durchgehend fahrbaren Fenster mit Dauer. Ein Klick auf eine Stunde oder ein Fenster setzt
  den Zeitschieber dorthin. Bewertet werden Bodenwind (4 / 6 m/s), Böen (6 / 8 m/s),
  Böigkeit, Niederschlag, CAPE (300 / 800 J/kg), Sicht, Wolkenbasis und die **bürgerliche
  Dämmerung**. Ausdrücklich eine eigene Einschätzung aus dem Punktmodell, keine DWD-Aussage
  — das steht auch unter der Karte.
* **Dämmerung wird gerechnet, nicht geschätzt.** Neu `js/sun.js`: Sonnenauf- und
  -untergang und die bürgerliche Dämmerung (Sonnenhöhe −6°) für genau den gewählten Punkt,
  nach der üblichen NOAA-Formel. Open-Meteo liefert nur Auf- und Untergang, der DWD nennt
  die Dämmerung nur für einzelne Städte.
* **Ein Zeitschieber für die ganze Seite.** Er steht jetzt zwischen Karte und Berichten und
  steuert Startfenster, GAFOR-Band, Gebietskopf, Höhenwind und Modellprognose gemeinsam.
  Die Skala ist **fest** über sieben Tage — so bleiben Tageseinteilung und
  Nachtschattierung beim Modellwechsel an derselben Stelle. Darüber die Wochentage, in der
  Spur Striche alle zwei Stunden und die **Nacht grau hinterlegt**; was das gewählte Modell
  nicht mehr rechnet, ist **schraffiert und nicht erreichbar** — der Griff rastet am
  Horizont ein. Mit ICON-D2 endet er also bei +48 h, mit ECMWF bei +144 h.
* **Zwei Modelle im Höhenprofil.** Über dem Diagramm eine zweite Reihe „Vergleich": das
  gewählte Modell wird **gestrichelt und blasser** über das erste gelegt — Temperatur,
  Taupunkt und Windprofil. Laufen die Kurven eng, sind sich die Modelle einig; laufen sie
  auseinander, weiss man es auch. Das ist das ehrlichste Vertrauensmass ohne Ensemble.
* **Automatisches Nachladen.** Solange der Tab sichtbar ist: METAR alle 10 Minuten, DWD
  alle 20, Modell alle 30. Im Hintergrund läuft nichts; beim Zurückkommen wird das
  Überfällige einmal nachgeholt. Abschaltbar in den Einstellungen.
* **Gespeicherte Orte als Nadeln auf der Karte.** Ein Klick fährt hin — der schnellste Weg
  zwischen zwei Startplätzen.
* **Warnhinweis bei alten Daten.** Ist ein GAFOR-Bulletin über seinen letzten Zeitraum
  hinaus oder seit über drei Stunden nicht mehr aktualisiert, steht ein deutlicher Hinweis
  direkt über den Stufen — mit Knopf zum Neuladen. Das ist der gefährliche Fall: die
  Kacheln sehen unverändert aus und sagen trotzdem nichts mehr.
* Nebenbei: Die Modellprognose zeigt zwölf Stunden **um** die gewählte herum (drei
  rückwärts), nicht mehr zwölf ab jetzt.

### Was dabei gedeckelt wurde

GFS rechnet 384 Stunden, ICON global 180. Die App deckelt **alle Modelle auf 168 Stunden**
(`OM.SPAN_H`) und holt acht Tage. Ein Höhenprofil zwei Wochen im Voraus ist Zahlenmystik,
und die Druckflächen für 16 Tage wären ein Vielfaches an Daten auf dem Handy. Sieben Tage
decken jede Fahrtplanung ab.

## 1.13.1 — 2026-08-26

* **Behoben: „Inversionen" und alles danach stand in der Schreibmaschinenschrift.** Ein
  Abschnitt galt als Tabelle, sobald **irgendwo** darin ein `|` vorkam — und unter
  „Inversionen" folgen die Dämmerungszeiten, also kippte auch der Prosaabsatz davor mit,
  samt den harten Zeilenumbrüchen des DWD. Jetzt wird **absatzweise** entschieden: ein
  Absatz bekommt die feste Breite nur, wenn er selbst `|` enthält oder wenn seine Zeilen
  mit mehrfachen Leerzeichen ausgerichtet sind. Fliesstext steht damit im ganzen Bericht in
  derselben Schrift; die beiden Höhenwindtabellen und die Dämmerungszeiten behalten ihre
  Ausrichtung, weil sie ohne feste Breite unlesbar wären.
* Zwischen mehreren Absätzen eines Abschnitts steht jetzt Luft — vorher liefen sie
  zusammen und der Absatzwechsel war unsichtbar.

## 1.13.0 — 2026-08-26

* **Behoben: die rechte Spalte der Flugwetterübersicht war die längere.** Der Schnitt wurde
  über die **Zeichenzahl** geschätzt, und die lag verlässlich daneben — Überschriften haben
  Abstände, Fliesstext bricht unterschiedlich um, und eine Höhenwindtabelle wiegt pro
  Zeichen ein Vielfaches. Jetzt wird **gemessen**: die Abschnitte werden nach dem Setzen
  durchprobiert, gesucht ist der kleinste Schnitt, bei dem die linke Spalte in Pixeln
  mindestens so hoch ist wie die rechte. Da links mit jedem Abschnitt wächst und rechts
  schrumpft, ist der erste Treffer zugleich der ausgewogenste. Ändert sich die
  Fensterbreite, wird neu ausgemessen.
* **Die Bereichslegende liegt jetzt unten links in der Karte** statt als eigene Zeile
  darunter. Auf schmalen Schirmen rückt sie eine Zeile höher, damit sie der
  Leaflet-Herkunftszeile nicht ins Gehege kommt.
* **Höhenwind 45 / 55:** die Tabelle bekommt 45 % der Breite, das Stüve-Diagramm 55 %.

## 1.12.1 — 2026-08-26

Aufräumen, plus ein Fehler, der dabei aufgefallen ist.

* **Behoben: Gebietskopf und Zeitband konnten verschiedene Stufen zeigen.** Die Kachel oben
  rechts nahm den **ersten** Zeitraum des Bulletins, das Zeitband hebt den **laufenden**
  hervor. Am Nachmittag stand oben also noch der Vormittag. Beide fragen jetzt dieselbe
  Stelle (`currentPeriod`). Der Browsertest prüft das, mit einem Testbulletin, dessen
  erster Zeitraum absichtlich in der Vergangenheit liegt.
* **Toter Code entfernt.** Nicht mehr aufgerufene Funktionen (`GAFOR.near`, `GAFOR.byId`,
  `metaFor`, `allMeta`, `OM.modelsFor`, `METAR.cloudText`, `U.fmtLocal`,
  `MAPVIEW.getLevel`), 14 Namen, die nur noch aus Gewohnheit exportiert wurden, und die
  CSS-Reste abgelöster Ansichten (`.gafor-grid`, `.gafor-unit`, `.wp-wrap`, `.ver.stale`,
  `.search-results .row.sel`, `.chip.off`, `.fc-table td.hour/.now`, `.sw-b`, `.mono`).
* **Wirkungsloses entfernt:** die Klasse `clickable` an der Altersanzeige überlebte das
  nächste Rendern nie; die Klassen `now`/`hour` in der Zeitzeile der Modellprognose lagen
  auf dem `<span>`, während die Regeln auf das `<td>` zielten — gefärbt wurde die Spalte
  ohnehin per Stil.
* **Doppeltes zusammengelegt:** `renderAreaHead()` lief bei jedem Ortswechsel zweimal; die
  Umrechnungstabelle m/s → kt/km/h stand in `util.js` **und** in `app.js`; die Bodenhöhe
  wurde im Höhenprofil zweimal aus denselben Feldern gebildet.
* Zustandsfelder ohne Leser (`state.busy`, `state.lastFetchAt`) und der nie gesetzte
  `explicit`-Schalter der Startposition sind weg.

## 1.12.0 — 2026-08-26

* **Neuer Kopfbereich.** Ab 900 px teilt er sich 40 / 60: rechts aussen die Karte, links
  untereinander Suchfeld, Ortszeile, GAFOR-Gebiet und ein neuer Kasten mit den
  GAFOR-Stufen. Die vier Kästchen zusammen sind so hoch wie die Karte. Auf dem Handy
  stapelt alles wie bisher.
* **GAFOR-Stufen als Zeitband.** Die Kacheln sind weg; an ihrer Stelle steht ein
  durchgehendes Band, ein Abschnitt je Zeitraum in der Farbe seiner Stufe, der laufende
  kräftiger und amber unterstrichen. Sicht, Untergrenze und ein etwaiger Zusatz stehen in
  der Fusszeile — für den Abschnitt, den man antippt, sonst für den laufenden; ein Punkt
  oben rechts markiert die Abschnitte mit Zusatz. Statt rund 230 px braucht die Reihe
  jetzt knapp 50 und wächst auch bei sechs Zeiträumen nicht in die zweite Zeile.
* **Erneutes Kennwort nach zwei Stunden Pause.** Gemessen wird die letzte Berührung, nicht
  die Anmeldung: wer die App benutzt, wird nicht herausgeworfen; wer sie liegen lässt,
  schon. Der Zeitstempel liegt im `localStorage`, die Sperre greift also auch, wenn das
  Fenster zwischendurch zu war.
* **Höhenwind:** Tabelle und Stüve-Diagramm teilen sich die Breite jetzt hälftig — die
  Tabelle war deutlich zu breit. Im Diagramm ist die **Null der Windachse beschriftet**,
  und links stehen **zwei Zahlenspalten**: aussen die Höhe in Fuss oder Meter AMSL (je
  nach Einstellung), innen der Druck.
* **Tabelle:** „Drift" heisst jetzt **Wind** und steht rechtsbündig unter seiner
  Überschrift; „Td" heisst **TP** (Taupunkt); aus „Nullgradgrenze" wird **0°-Grenze**.
* **Der Zeitstempel läuft mit dem Schieber mit** und steht immer unter dem Griff, statt in
  einer festen Zeile. Er nennt jetzt immer **Wochentag und Datum**: `Mi 26. Aug · 14:00
  CEST · +4 h`.
* **Feuchteschattierung einstellbar.** In den Einstellungen lässt sich die relative
  Feuchte wählen, ab der die möglichen Wolkenbänder schattiert werden (70 – 95 %, Vorgabe
  85 %). Gilt für das Stüve-Diagramm und die Spalte *rF*.
* Die **Erklärung unter dem Stüve-Diagramm** ist entfallen — sie steht im README. Wer das
  Diagramm einmal verstanden hat, liest sie nie wieder, und sie kostete ein Drittel der
  Kartenhöhe.
* Bricht die **Flugwetterübersicht** in zwei Spalten nicht gleichmässig um, ist ab jetzt
  die **linke die längere**; das liest sich angenehmer als umgekehrt.

## 1.11.0 — 2026-08-26

* **Ort und GAFOR-Gebiet stehen nebeneinander.** Auf Schirmen ab 820 px teilen sich die
  beiden Kästchen eine Zeile (das Gebiet bekommt etwas mehr Platz, weil dort mehr Text
  steht); darunter stapeln sie wie bisher.
* **Der METAR-Kopf ist einzeilig.** Kennung in Dunkelamber, mit Abstand der Platzname, am
  rechten Rand ein **Peilungspfeil vom Vorhersageort zur Station** und dahinter die
  Entfernung. Der Pfeil zeigt die rechtweisende Anfangspeilung; im Tooltip stehen Richtung
  und Gradzahl. Der Platzname ist gekürzt, wenn er nicht passt — Kennung und Entfernung
  bleiben immer stehen.
* **Statt „DE" das Bundesland.** Die NOAA hängt an jeden deutschen Platznamen ein „DE", das
  in einer Deutschlandkarte nichts sagt. An seiner Stelle steht jetzt das Kürzel des
  Bundeslands (`Stuttgart Flughafen · BW`). Dahinter liegt eine feste Tabelle von 103
  deutschen Plätzen — offline richtig oder gar nicht: eine nicht hinterlegte Kennung
  bekommt **kein** Kürzel statt eines geratenen. Ausländische Plätze behalten ihr Land.
* **Zeitwahl als Schieber.** Die Stunden-Pillen sind weg; an ihrer Stelle steht ein
  Schieber in Ein-Stunden-Schritten. Sein oberes Ende ist der **Vorhersagehorizont des
  gewählten Modells** — mit ICON-D2 lässt er sich also gar nicht erst über +48 h ziehen.
  Unter dem Schieber steht der gewählte Zeitpunkt mit Uhrzeit und, ab einem Tag Vorlauf,
  dem Datum. Im Ausdruck fällt der Schieber weg, seine Beschriftung bleibt als
  Zeitangabe stehen.
* **Modellpillen aufsteigend nach Horizont:** ICON-D2 (48 h) → ARPEGE (96) → ICON-EU (120)
  → ECMWF IFS (144) → UKMO (168) → ICON global (180) → GFS (384) → Auto. Kein Modell wird
  mehr ausgegraut; wer auf ein kürzeres wechselt, dessen Zeitpunkt rückt auf dessen
  Horizont zurück.
* Nebenbei: Beim Ziehen des Schiebers und beim Ändern der Fensterbreite werden nur noch
  Tabelle und Diagramm neu gezeichnet, nicht die Bedienelemente — der Schieber behält
  Wert und Fokus.

## 1.10.0 — 2026-08-26

* **Stüve-Diagramm statt des reinen Windprofils.** Links das Stüve — senkrecht der Druck in
  p^0,286, waagrecht die Temperatur. Diese Achse ist der ganze Witz daran: sie macht
  **Trockenadiabaten zu Geraden**, und damit sieht man Inversionen, die Mischungsschicht und
  die Höhe, bis zu der ein Paket trocken aufsteigt, ohne zu rechnen. Eingezeichnet sind
  Isothermen, Isobaren, Trockenadiabaten alle 20 K, die **Temperaturkurve** (rot) und die
  **Taupunktkurve** (blau). Rechts, auf demselben Höhenraster, das Windfeld mit den Fahnen.
* **Feuchte Schichten sind schattiert:** ab 85 % relativer Feuchte beginnt die Schattierung
  und wird bis 100 % kräftiger. Zwischen den Druckflächen wird überblendet (ein Farbverlauf,
  keine harten Balken), so dass die Schichtung als solche sichtbar wird. Dieselbe Färbung
  steht in der neuen Spalte **rF** der Tabelle.
* Dafür holt die App jetzt die **relative Feuchte auf allen Druckflächen** mit; der Taupunkt
  wird daraus nach Magnus gerechnet, weil Open-Meteo ihn auf den Flächen nicht liefert. Die
  Tabelle hat deshalb zwei neue Spalten: **Td** und **rF**.
* Die bodennahen Flächen (10, 80, 180 m über Grund) haben keinen Druck und werden über ihre
  Höhe eingehängt — für die Ballonfahrt sind gerade sie die wichtigsten.
* Nicht eingezeichnet sind **Feuchtadiabaten und Mischungsverhältnislinien**; beide brauchen
  Iteration und würden das Bild in dieser Grösse zustellen. Der Hinweis steht unter dem
  Diagramm.
* **Kein „Kartenmitte" mehr.** Die Ortszeile nennt immer den nächstgelegenen Ort mit
  Koordinaten und zieht beim Verschieben der Karte nach. Solange der neue Name unterwegs ist,
  bleibt der letzte blass stehen, statt dass die Zeile leer wird. Die Rückwärtssuche merkt
  sich Antworten (auf gut hundert Meter gerundet) und hält Nominatims Bitte um höchstens eine
  Anfrage pro Sekunde ein.

## 1.9.2 — 2026-08-26

* **Behoben: Menü und Teilen-Auswahl liessen sich nicht öffnen.** Sie hingen am Seitenanfang
  statt an der Kopfzeile — `position:absolute` ohne positionierten Vorfahren rechnet vom
  Dokument, nicht vom Sichtfenster. Bei gescrollter Seite öffneten sie sich also weit oberhalb
  des Bildschirms. Jetzt sitzen beide Menüs in der Kopfzeile und folgen ihr. Der Testlauf
  scrollt eigens 1400 px herunter und prüft nach, dass sie im Sichtfenster erscheinen.
* Nebenher abgesichert: Karte und Bedienung werden getrennt aufgesetzt. Scheitert eines von
  beiden, funktioniert wenigstens das andere, statt dass die ganze Seite tot ist.
* **METAR und TAF wieder mit Klartext**, je höchstens zwei Zeilen über dem Rohtext:
  * METAR — Wind, Sicht, Witterung, Wolken in Achteln; darunter Temperatur, Taupunkt, QNH
    und die Flugkategorie der NOAA.
  * TAF — Gültigkeit und Grundlage in der ersten Zeile, die Änderungsgruppen in der zweiten:
    `zeitweise 26. 12–18 UTC: Regenschauer, Wolken 5–7/8 ab 1500 ft`. FM, TEMPO, BECMG, INTER
    und PROB werden erkannt, PROB30 wird der folgenden TEMPO-Gruppe zugeordnet.
  * Witterungskürzel sind übersetzt (`-SHRA` → Regenschauer, leicht; `FZFG` → gefrierender
    Nebel; `NSW` → keine signifikante Witterung), Bedeckungsgrade in Achteln
    (`BKN012` → 5–7/8 ab 1200 ft), und umlaufender Wind heisst „umlaufend" statt „VRB°".
  * Der Rohtext steht unverändert darunter und bleibt massgebend.
* Der Druck bleibt bei zwei A4-Seiten — der Klartext ist dort kleiner gesetzt und die Karte
  4 mm flacher.

## 1.9.1 — 2026-08-26

* **Behoben: im Bereich West (Gebiete 31–39) fehlte die Flugwetterübersicht komplett.** Die
  Kopfzeile lautete `FBEU40 EDZE 260600 COR` — ein Korrekturvermerk, den das Muster für die
  Kopfzeile nicht kannte. Damit wurde die ausgebende Stelle nicht erkannt und der ganze Bericht
  verworfen. Jetzt werden COR, AMD, RRA und CCA mitgelesen; und falls die Kopfzeile künftig
  wieder anders aussieht, wird der Bericht trotzdem abgelegt und der Fall in `errors[]`
  vermerkt, statt lautlos zu verschwinden. **Wirkt erst nach dem nächsten Workflow-Lauf** —
  die App kann nicht nachliefern, was nie in `index.json` stand.
* **Behoben: nach einem Suchtreffer ging der Ortsname wieder verloren.** Die Karte meldet
  während ihrer Zoomfahrt laufend neue Mittelpunkte, und jede dieser Meldungen setzte den
  gerade gefundenen Namen auf „Kartenmitte" zurück. Programmatische Fahrten sind jetzt als
  solche gekennzeichnet.
* **Suchtreffer werden näher angefahren:** Zoom 11 für einen Ort, 12 für einen Flugplatz oder
  eingegebene Koordinaten (vorher pauschal 10).
* **Die Höhenwindgrafik füllt jetzt den Platz rechts neben der Tabelle aus** und ist genauso
  hoch wie diese. Ihre Grösse wird nach dem Layout gemessen und beim Ändern der Fensterbreite
  neu gezeichnet — vorher stand sie mit festen 264 px verloren im Weissraum.

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
