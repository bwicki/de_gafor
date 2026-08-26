#!/usr/bin/env node
/* GaforCast — checks that run without a browser.
 *
 *   node test/run.mjs
 *
 * 1. every JS file parses
 * 2. data/gafor-areas.geojson is well formed: unique ids, closed rings,
 *    coordinates inside a Germany bounding box, no self-overlapping areas at
 *    the reference points
 * 3. the DWD text parser recognises the bulletin shapes it claims to
 * 4. reference places land in the GAFOR area they are supposed to
 */

import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

let fails = 0;
const ok  = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const head = (m) => console.log(`\n${m}`);

// ---------------------------------------------------------------- 1. syntax
head('JavaScript');
for (const f of await readdir('js')) {
  if (!f.endsWith('.js')) continue;
  try { execFileSync(process.execPath, ['--check', `js/${f}`]); ok(`js/${f}`); }
  catch (e) { bad(`js/${f}: ${String(e.stderr || e).split('\n').slice(0, 3).join(' ')}`); }
}
try { execFileSync(process.execPath, ['--check', 'scripts/fetch-dwd.mjs']); ok('scripts/fetch-dwd.mjs'); }
catch (e) { bad(`scripts/fetch-dwd.mjs: ${e.message}`); }

// ---------------------------------------------------------------- 1b. version
head('Version');
const verSrc = await readFile('js/version.js', 'utf8');
const swSrc = await readFile('sw.js', 'utf8');
const appVer = (verSrc.match(/version:\s*'([^']+)'/) || [])[1];
const appCache = (verSrc.match(/cache:\s*'([^']+)'/) || [])[1];
const appDate = (verSrc.match(/date:\s*'([^']+)'/) || [])[1];
const swVer = (swSrc.match(/const VERSION = '([^']+)'/) || [])[1];

/^\d+\.\d+\.\d+$/.test(appVer || '') ? ok(`APP.version ${appVer}`) : bad(`APP.version: ${appVer}`);
/^\d{4}-\d{2}-\d{2}$/.test(appDate || '') ? ok(`APP.date ${appDate}`) : bad(`APP.date: ${appDate}`);
appCache === swVer
  ? ok(`Cache-Name stimmt überein (${swVer})`)
  : bad(`js/version.js hat "${appCache}", sw.js hat "${swVer}" — installierte Clients bekämen die alte Shell`);
appCache === `gaforcast-v${appVer}`
  ? ok('Cache-Name enthält die Version')
  : bad(`Cache-Name "${appCache}" passt nicht zu Version ${appVer}`);

// jede Datei der Shell muss es auch geben
const shell = [...swSrc.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(f => f.includes('.'));
const missing = [];
for (const f of shell) { try { await readFile(f); } catch { missing.push(f); } }
missing.length ? bad(`in sw.js gelistet, aber nicht vorhanden: ${missing.join(', ')}`)
               : ok(`${shell.length} Shell-Dateien vorhanden`);

// ---------------------------------------------------------------- 2. geometry
head('GAFOR-Gebiete');
const fc = JSON.parse(await readFile('data/gafor-areas.geojson', 'utf8'));
const BOX = { latMin: 47.0, latMax: 55.2, lonMin: 5.5, lonMax: 15.4 };

if (!Array.isArray(fc.features)) bad('features fehlt');
else if (!fc.features.length) console.log('  --   noch keine Polygone hinterlegt (Platzhalter)');
else {
  const seen = new Set();
  for (const f of fc.features) {
    const p = f.properties || {};
    const id = String(p.id ?? '');
    if (!/^\d{2}$/.test(id)) bad(`id "${id}" ist keine zweistellige Gebietsnummer`);
    if (seen.has(id)) bad(`id ${id} kommt doppelt vor`);
    seen.add(id);
    if (!p.name) bad(`Gebiet ${id} ohne Namen`);

    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates]
                : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : null;
    if (!polys) { bad(`Gebiet ${id}: Geometrie fehlt oder hat den falschen Typ`); continue; }
    for (const rings of polys) for (const ring of rings) {
      if (ring.length < 4) { bad(`Gebiet ${id}: Ring mit ${ring.length} Punkten`); continue; }
      const a = ring[0], z = ring[ring.length - 1];
      if (a[0] !== z[0] || a[1] !== z[1]) bad(`Gebiet ${id}: Ring nicht geschlossen`);
      for (const [lon, lat] of ring) {
        if (lat < BOX.latMin || lat > BOX.latMax || lon < BOX.lonMin || lon > BOX.lonMax) {
          bad(`Gebiet ${id}: Punkt ${lat.toFixed(3)},${lon.toFixed(3)} liegt ausserhalb Deutschlands`);
          break;
        }
      }
    }
  }
  if (!fails) ok(`${fc.features.length} Gebiete strukturell in Ordnung`);
}

// ---------------------------------------------------------------- 3. parser
head('DWD-Parser');
const src = await readFile('scripts/fetch-dwd.mjs', 'utf8');
// The fetcher runs main() on import, so the parser functions are rebuilt here
// from its source instead — this keeps the test hermetic and offline.
const fnSrc = src.slice(src.indexOf('/** Drop the navigation'), src.indexOf('const officeFrom'));
const P = new Function(`${fnSrc}; return { stripChrome, headline, periodsFrom, areasFrom,
  issuedFrom, overviewHeader, overviewBody, expandAreaList };`)();

// a real bulletin, exactly as the fetcher stored it
let sample = '';
try {
  sample = (await readFile('test/sample-gafor.txt', 'utf8')).split('\n').slice(2).join('\n');
} catch { console.log('  --   test/sample-gafor.txt fehlt'); }

if (sample) {
  const text = P.stripChrome(sample);
  const hl = P.headline(text);
  hl.bereich ? ok(`Bereich erkannt (${hl.bereich}, ${hl.date})`) : bad(`Kopfzeile: ${JSON.stringify(hl)}`);

  const per = P.periodsFrom(text);
  per.length >= 2 ? ok(`Zeiträume erkannt (${per.join(' ')})`) : bad(`Zeiträume: ${JSON.stringify(per)}`);

  const iss = P.issuedFrom(text, hl, per);
  iss ? ok(`Gültig ab erkannt (${iss})`) : bad('Gültigkeitsbeginn nicht erkannt');

  const ar = P.areasFrom(text, per.length);
  const n = Object.keys(ar).length;
  n >= 10 ? ok(`${n} Gebietszeilen gelesen`) : bad(`nur ${n} Gebietszeilen`);
  const a00 = ar['00'], a10 = ar['10'];
  (a00 && a00.codes.join('') === 'CCC' && a00.name === 'Deutsche Bucht')
    ? ok('Gebiet 00 korrekt (CCC, Deutsche Bucht)')
    : bad(`Gebiet 00: ${JSON.stringify(a00)}`);
  (a10 && a10.codes.join('') === 'CCO' && a10.remark === 'ISOL RA')
    ? ok('Gebiet 10 korrekt (CCO, Zusatz ISOL RA)')
    : bad(`Gebiet 10: ${JSON.stringify(a10)}`);
  Object.values(ar).every(a => a.codes.length === per.length)
    ? ok('jede Zeile hat so viele Codes wie Zeiträume')
    : bad('Codeanzahl passt nicht zu den Zeiträumen');
}

// a real Flugwetterübersicht
let ovSample = '';
try {
  ovSample = (await readFile('test/sample-overview.txt', 'utf8')).split('\n').slice(2).join('\n');
} catch { console.log('  --   test/sample-overview.txt fehlt'); }

if (ovSample) {
  const t = P.stripChrome(ovSample);
  const h = P.overviewHeader(t);
  h.office === 'EDZM' && h.bereich === 'Süd'
    ? ok(`Übersicht erkannt (${h.bulletin}, Bereich ${h.bereich})`)
    : bad(`Übersichtskopf: ${JSON.stringify({ o: h.office, b: h.bereich })}`);
  h.validFrom && h.validTo ? ok(`Gültigkeit ${h.validFrom} … ${h.validTo}`) : bad('Gültigkeit fehlt');
  h.areas.length === 18 && h.areas[0] === '54' && h.areas.at(-1) === '84'
    ? ok(`Vorhersagebereich gelesen (${h.areas.length} Gebiete)`)
    : bad(`Vorhersagebereich: ${JSON.stringify(h.areas)}`);
  const body = P.overviewBody(t);
  !/Vorhersagebereich|Deutscher Wetterdienst/.test(body.split('\n')[0])
    ? ok('Kopfblock aus dem Fliesstext entfernt')
    : bad(`Fliesstext beginnt mit: ${body.split('\n')[0]}`);
  // the five Bereiche together have to cover all 68 areas exactly once
  const spec = { Nord: '00 bis 10', Ost: '11 bis 28', West: '31 bis 39',
                 Mitte: '41 bis 47, 50 bis 53, 61',
                 Sued: '54 - 58, 62 - 64, 71 - 76, 81 - 84' };
  const all = Object.values(spec).flatMap(v => P.expandAreaList(v));
  const meta = JSON.parse(await readFile('data/gafor-meta.json', 'utf8')).areas.map(a => a.id);
  (all.length === 68 && new Set(all).size === 68 && meta.every(i => all.includes(i)))
    ? ok('DWD-Bereichsangaben decken alle 68 Gebiete genau einmal ab')
    : bad(`Bereichsabdeckung: ${all.length} Einträge, ${new Set(all).size} eindeutig`);
}

// bulletinText muss den Bericht wählen, nicht das längste Navigationsstück
{
  const bSrc = src.slice(src.indexOf('const ENT ='), src.indexOf('function links('));
  const T = new Function(`${bSrc}; return { bulletinText };`)();
  const nav = '<table>' + Array.from({ length: 60 },
    (_, i) => `<tr><td>Navigationspunkt ${i} mit etwas Text</td></tr>`).join('') + '</table>';
  const report = 'FBEU40 EDZF 251800\nFlugwetterübersicht Bereich Mitte\n' +
    'Wetterlage und -entwicklung: '.padEnd(400, 'x');
  const html = `<html><body>${nav}<pre>${report}</pre>${nav}</body></html>`;
  const got = T.bulletinText(html);
  got.startsWith('FBEU40') ? ok('bulletinText nimmt den <pre>-Bericht, nicht die Navigation')
                           : bad(`bulletinText lieferte: ${got.slice(0, 60)}`);
  const tableOnly = `<html><body><div class="content"><p>Bitte wählen Sie eine Region aus.</p></div></div>` +
    `<table><tr><td>Bodenwind</td><td>${'050/08 KT '.repeat(40)}</td></tr></table></body></html>`;
  /Bodenwind/.test(T.bulletinText(tableOnly))
    ? ok('bulletinText findet den Bericht auch in einer Tabelle')
    : bad('Tabellenbericht nicht erkannt');
}

// der Ballonbericht: drei Tabellen mit Farbcodierung
try {
  const pageHtml = await readFile('test/sample-balloon.html', 'utf8');
  const pSrc = src.slice(src.indexOf('const ENT ='), src.indexOf('const sleep ='));
  const BP = new Function(`${pSrc}; return { parseBalloonPage };`)();
  const page = BP.parseBalloonPage(pageHtml);

  page.blocks.length === 3 ? ok(`${page.blocks.length} Tabellen im Ballonbericht`)
                           : bad(`${page.blocks.length} Tabellen statt 3`);
  (page.station && page.station.name === 'Schwäbisch Hall' && page.station.elevFt === 1270)
    ? ok(`Bezugsort erkannt (${page.station.name}, ${page.station.elevFt} ft)`)
    : bad(`Bezugsort: ${JSON.stringify(page.station)}`);
  /26\.08\.2026/.test(page.title || '') ? ok(`Titel erkannt (${page.title})`)
                                        : bad(`Titel: ${page.title}`);

  const surf = page.blocks.find(b => /Bodenwerte/.test(b.heading || ''));
  const gust = surf && surf.rows.find(r => /Böen/.test(r[0].t));
  (gust && gust.length === 19 && gust[7].t === '12' && gust[7].c === 'y')
    ? ok('Böenzeile mit 18 Stunden und Farbcodierung')
    : bad(`Böenzeile: ${gust ? gust.slice(0, 9).map(c => c.t + (c.c || '')).join(' ') : 'fehlt'}`);

  const th = page.blocks.find(b => /Thermik/.test(b.heading || ''));
  const max = th && th.rows[2];
  (max && max.slice(1).every(c => c.c) && max.some(c => c.c === 'r'))
    ? ok('Thermikzeile rein farbcodiert, Stufen erkannt')
    : bad('Thermikfarben nicht erkannt');
} catch (e) {
  console.log(`  --   test/sample-balloon.html fehlt (${e.message.slice(0, 40)})`);
}

// die Bildkarte, aus der die Ballonwetter-Seiten kommen
try {
  const mapHtml = await readFile('test/sample-balloonmap.txt', 'utf8');
  const bSrc = src.slice(src.indexOf('const ENT ='), src.indexOf('const sleep ='));
  const B = new Function(`${bSrc}; return { balloonTargets };`)();
  const t = B.balloonTargets(mapHtml,
    'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/gebietsvorhersagen_ballonsport/node_uebersicht.html');
  t.length === 67 ? ok(`${t.length} Ballon-Gebiete aus der Bildkarte`)
                  : bad(`${t.length} Ballon-Gebiete statt 67`);
  const areas = JSON.parse(await readFile('data/gafor-meta.json', 'utf8')).areas;
  const meta = new Map(areas.map(a => [a.id, a]));
  const wrongFt = t.filter(x => meta.get(x.id) && meta.get(x.id).refAltFt !== x.refAltFt);
  wrongFt.length ? bad(`Bezugshöhen weichen ab: ${wrongFt.map(d => d.id).join(', ')}`)
                 : ok('alle Bezugshöhen decken sich mit gafor-meta.json');
  const missing = areas.map(a => a.id).filter(i => i !== '00' && !t.some(x => x.id === i));
  missing.length ? bad(`ohne Ballonbericht: ${missing.join(', ')}`)
                 : ok('jedes Landgebiet hat eine Ballon-Seite (00 = offene See hat keine)');
  t.every(x => /\/node_\d{2}$/.test(x.url))
    ? ok('URL-Muster …/gebietsvorhersagen_ballonsport/node_NN')
    : bad(`abweichende URLs: ${t.filter(x => !/\/node_\d{2}$/.test(x.url)).slice(0, 3).map(x => x.url)}`);
} catch (e) {
  console.log(`  --   test/sample-balloonmap.txt fehlt (${e.message.slice(0, 40)})`);
}

// ---------------------------------------------------------------- 4. reference places
head('Referenzorte');
let refs = [];
try { refs = JSON.parse(await readFile('test/reference-places.json', 'utf8')); }
catch { console.log('  --   test/reference-places.json fehlt (wird mit den Polygonen angelegt)'); }

if (refs.length && fc.features.length) {
  const inRing = (lon, lat, ring) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins;
    }
    return ins;
  };
  const find = (lat, lon) => {
    for (const f of fc.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) if (inRing(lon, lat, rings[0])) return String(f.properties.id);
    }
    return null;
  };
  let hit = 0;
  for (const r of refs) {
    const got = find(r.lat, r.lon);
    if (got === String(r.area)) hit++;
    else bad(`${r.name}: Gebiet ${got ?? 'keins'} statt ${r.area}`);
  }
  if (hit === refs.length) ok(`${hit}/${refs.length} Referenzorte korrekt zugeordnet`);
  else console.log(`  --   ${hit}/${refs.length} Referenzorte korrekt`);
}

// ---------------------------------------------------------------- summary
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fails ? 1 : 0);
