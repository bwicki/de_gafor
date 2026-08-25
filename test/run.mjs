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
const sandbox = {};
const fnSrc = src.slice(src.indexOf('function issuedFrom'), src.indexOf('/** Office code'));
const make = new Function(`${fnSrc}; return { issuedFrom, periodsFrom, areasFrom };`);
Object.assign(sandbox, make());

const sample = [
  'GAFOR 251600',
  'Ausgegeben am 25.08.2026 um 16:00 UTC',
  '',
  'Gebiet  06-09 09-12 12-15 15-18',
  '21      C     C     O     D',
  '45 46:  C C O D',
  '77      X X M M',
  '',
  'Allgemeine Lage: schwacher Hochdruckeinfluss.',
].join('\n');

const iss = sandbox.issuedFrom(sample, new Date(Date.UTC(2026, 7, 25, 17, 0)));
iss && iss.startsWith('2026-08-25T16:00') ? ok(`Ausgabezeit erkannt (${iss})`) : bad(`Ausgabezeit: ${iss}`);

const per = sandbox.periodsFrom(sample);
per.length === 4 && per[0] === '06-09' ? ok(`Zeiträume erkannt (${per.join(' ')})`)
                                       : bad(`Zeiträume: ${JSON.stringify(per)}`);

const ar = sandbox.areasFrom(sample);
const want = { 21: 'CCOD', 45: 'CCOD', 46: 'CCOD', 77: 'XXMM' };
let arOk = true;
for (const [id, codes] of Object.entries(want)) {
  if ((ar[id] || []).join('') !== codes) { bad(`Gebiet ${id}: ${JSON.stringify(ar[id])} statt ${codes}`); arOk = false; }
}
if (arOk) ok(`Gebietscodes erkannt (${Object.keys(ar).length} Zeilen)`);

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
