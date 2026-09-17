# Bezugsmodule

Ein Bezugsmodul holt die amtlichen Berichte **eines** Landes und legt sie als
JSON im Repo ab. Es ist die einzige Stelle, an der landesspezifischer Code
stehen darf; die App sieht davon nichts mehr — sie liest nur das Zwischenformat.

Warum überhaupt ein Modul und nicht ein Abruf aus dem Browser: kein
Wetterdienst schickt CORS-Kopfzeilen, und eine statische Seite auf GitHub Pages
kann fremde Domänen deshalb nicht lesen. Der Umweg über eine GitHub-Action ist
kein Umweg, sondern die einzige Möglichkeit.

## Aufruf

```
node scripts/fetch.mjs de          # Deutschland holen
node scripts/fetch.mjs de --dry    # nur prüfen, ob das Modul auflösbar ist
```

`scripts/fetch.mjs` schlägt das Land in `data/countries/index.json` nach, lädt
`scripts/providers/<code>.mjs` und ruft dessen `run()`.

## Oberfläche

Jedes Modul liefert als Vorgabeausfuhr ein Objekt:

```js
export default {
  code: 'de',            // Landescode, gleich dem Ordnernamen im Landespaket
  name: 'Deutschland',
  out:  'data/dwd',      // Ordner, in den geschrieben wird
  products: ['gafor', 'overview', 'balloon', 'metar'],
  async run(opts) { … }  // holt alles und schreibt out/index.json
};
```

`run()` darf nicht werfen, wenn eine einzelne Quelle ausfällt: ein fehlendes
Produkt ist ein Eintrag in `errors`, kein Abbruch. Ein Abbruch liesse die
bestehende Kopie im Repo unangetastet zurück, was richtig ist — aber die
übrigen Produkte blieben dann ebenfalls alt.

## Ausgabeformat

`<out>/index.json` trägt immer dieselben Schlüssel. Fehlt ein Produkt im Land,
bleibt der Schlüssel leer, er entfällt nicht:

```json
{
  "generated": "2026-09-17T11:20:00Z",
  "country":   "de",
  "gafor":     { "<id>": { "title", "issued", "validFrom", "validTo", "source",
                           "text", "periods": ["06-09"], "areas": { "45": ["C","O"] } } },
  "overview":  { "<id>": { "title", "issued", "source", "text", "areas": ["45"] } },
  "balloon":   { "<id>": { "title", "issued", "source", "text", "file" } },
  "errors":    [ { "product", "url", "message" } ]
}
```

`id` ist der Schlüssel, unter dem das Land seine Berichte führt — beim DWD das
ausgebende Amt (`EDZF`), bei Austro Control die Bulletinkennung (`FXOS43`),
bei meteoam die WMO-Kennung (`FBIY61`).

Der Rohtext wandert **ungekürzt** mit. Alles, was die App daraus macht —
Abschnitte, Tabellen, Gebietslisten — entsteht erst im Browser, damit ein
Parserfehler nie die Quelle verfälscht, sondern nur die Darstellung.

## Was ein neues Land braucht

1. `data/countries/<cc>/meta.json` — Fähigkeiten, Geometrie, Modell, Lizenz
2. `scripts/providers/<cc>.mjs` — dieses Modul
3. den Eintrag in `data/countries/index.json` von `planned` auf `live`

Mehr nicht. Insbesondere keine Zeile in `js/app.js`.
