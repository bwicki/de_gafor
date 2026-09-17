#!/usr/bin/env node
/* GaforCast — den Berichtsabruf eines Landes starten.
 *
 *   node scripts/fetch.mjs de
 *   node scripts/fetch.mjs de --dry     nur auflösen, nichts holen
 *
 * Das Skript schlägt den Landescode in data/countries/index.json nach, lädt
 * scripts/providers/<code>.mjs und ruft dessen run(). Mehr tut es nicht — die
 * Arbeit steht im Bezugsmodul, siehe scripts/providers/README.md.
 *
 * Es bricht mit Rückgabewert 0 ab, auch wenn etwas schiefgeht: der Workflow
 * soll danach trotzdem committen, was er hat. Ein fehlgeschlagener Abruf darf
 * nie dazu führen, dass die bestehende Kopie im Repo verschwindet.
 */
import { readFile } from 'node:fs/promises';

const code = String(process.argv[2] || 'de').toLowerCase();
const dry = process.argv.includes('--dry');

async function main() {
  let index;
  try {
    index = JSON.parse(await readFile('data/countries/index.json', 'utf8'));
  } catch (e) {
    console.error(`data/countries/index.json nicht lesbar: ${e.message}`);
    return 1;
  }

  const entry = (index.countries || []).find(c => c.code === code);
  if (!entry) {
    console.error(`Unbekanntes Land "${code}". Bekannt: ` +
      (index.countries || []).map(c => c.code).join(', '));
    return 1;
  }
  if (entry.state !== 'live') {
    console.error(`Land "${code}" ist noch nicht freigeschaltet (state: ${entry.state}).` +
      (entry.note ? `\n  ${entry.note}` : ''));
    return 1;
  }

  let mod;
  try {
    mod = (await import(`./providers/${code}.mjs`)).default;
  } catch (e) {
    console.error(`Bezugsmodul scripts/providers/${code}.mjs fehlt oder wirft: ${e.message}`);
    return 1;
  }

  const need = ['code', 'name', 'out', 'run'];
  const missing = need.filter(k => mod == null || mod[k] == null);
  if (missing.length) {
    console.error(`Bezugsmodul ${code} unvollständig — es fehlt: ${missing.join(', ')}`);
    return 1;
  }

  console.log(`${mod.name} (${mod.code}) → ${mod.out}` +
    (mod.products ? `  ·  ${mod.products.join(', ')}` : ''));
  if (dry) { console.log('--dry: nichts geholt.'); return 0; }

  await mod.run();
  return 0;
}

/* Immer mit 0 enden — siehe Kopfkommentar. Der Grund steht in der Ausgabe,
   damit im Actions-Protokoll trotzdem sichtbar ist, dass nichts geholt wurde. */
main()
  .then(rc => { if (rc) console.error('\u2014 nichts geholt.'); })
  .catch(e => { console.error('Abruf fehlgeschlagen:', e); });
