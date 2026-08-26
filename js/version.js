/* GaforCast — die eine Stelle, an der die Version steht.
 *
 * Semantisch versioniert: MAJOR bei Änderungen, die bestehende Daten oder
 * Bedienung brechen, MINOR bei neuen Funktionen, PATCH bei Korrekturen.
 *
 * Beim Release genau drei Dinge anfassen:
 *   1. APP.version und APP.date hier
 *   2. VERSION in sw.js auf denselben Wert (der Cache-Name hängt daran, sonst
 *      behalten installierte Clients die alte Shell)
 *   3. den Eintrag in CHANGELOG.md
 * `node test/run.mjs` prüft, dass 1 und 2 zusammenpassen, und meckert sonst.
 */
const APP = {
  name: 'GaforCast',
  version: '1.12.0',
  date: '2026-08-26',
  cache: 'gaforcast-v1.12.0',      // muss identisch zu VERSION in sw.js sein
  repo: 'https://github.com/bwicki/de_gafor',
};
