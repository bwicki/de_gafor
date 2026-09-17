/* Bezugsmodul Deutschland — DWD Luftsportberichte.
 *
 * Die Arbeit selbst steht unverändert in scripts/fetch-dwd.mjs: GAFOR-Tabellen
 * und Flugwetterübersichten je Amt, 67 Ballonwetterberichte, dazu METAR und
 * TAF von der NOAA. Dieses Modul ist nur der Steckverbinder in die
 * Länderstruktur — es gibt dem Fetcher einen Namen, einen Ausgabeordner und
 * eine Liste seiner Produkte.
 *
 * Absichtlich kein Umbau: der deutsche Abruf läuft seit Monaten und ist die
 * Eichung für alles, was danach kommt. Er wird erst angefasst, wenn ein
 * zweites Land zeigt, welche Gemeinsamkeit sich wirklich herausziehen lässt.
 */
import { main } from '../fetch-dwd.mjs';

export default {
  code: 'de',
  name: 'Deutschland',
  out: 'data/dwd',
  products: ['gafor', 'overview', 'balloon', 'metar'],
  /** Alle Produkte holen und data/dwd/index.json schreiben. */
  async run() { return main(); },
};
