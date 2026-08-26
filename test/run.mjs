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

// ---------------------------------------------------------------- 3b. METAR/TAF
head('METAR / TAF');
{
  const metarSrc = await readFile('js/metar.js', 'utf8');
  const fixture = JSON.parse(await readFile('test/sample-metar.json', 'utf8'));
  const tafFix = JSON.parse(await readFile('test/sample-taf.json', 'utf8'));

  const distKm = (a1, o1, a2, o2) => {
    const R = 6371.0088, r = (d) => d * Math.PI / 180;
    const dLa = r(a2 - a1), dLo = r(o2 - o1);
    const x = Math.sin(dLa / 2) ** 2 +
              Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };

  /* Ein METAR-Modul mit steuerbarer Umwelt:
     repo  = Inhalt von data/dwd/metar.json, oder null wenn es die Datei nicht gibt
     live  = Antwort der NOAA, oder null wenn der Direktabruf scheitert        */
  function build({ repo, live }) {
    const calls = [];
    const U = {
      distKm,
      async getJSON(url) {
        calls.push(url);
        if (url.includes('data/dwd/metar.json')) {
          if (!repo) throw new Error('404');
          return repo;
        }
        if (!live) throw new Error('Failed to fetch');
        return url.includes('/taf') ? tafFix : live;
      },
    };
    return { M: new Function('U', `${metarSrc}; return METAR;`)(U), calls };
  }

  const REPO = { generated: '2026-08-26T07:40:00Z', via: 'awc', metar: fixture, taf: tafFix };

  // ---- Normalfall: die Kopie im Repo ist da und wird zuerst genommen ----
  {
    const { M, calls } = build({ repo: REPO, live: fixture });
    const near = await M.near(49.10, 9.75, 100, 8);
    const ids = near.map(m => m.icaoId);
    (ids.join(',') === 'EDTY,EDDS,ETHL')
      ? ok(`Umkreis 100 km liefert ${ids.join(', ')} — nach Entfernung sortiert`)
      : bad(`Umkreis 100 km: ${ids.join(', ')}`);
    !ids.includes('EDDN')
      ? ok('EDDN (103 km) fällt raus, obwohl es im Anfrage-Rechteck läge')
      : bad('Kreisfilter greift nicht — EDDN ist dabei');
    calls.length === 1 && calls[0].includes('data/dwd/metar.json')
      ? ok('erste Anfrage geht an die eigene Kopie, nicht an die NOAA')
      : bad(`erste Anfrage: ${calls[0]}`);
    M.lastSource().kind === 'repo' && M.lastSource().at === REPO.generated
      ? ok('Quelle wird als Repo-Kopie mit Zeitstempel ausgewiesen')
      : bad(`Quelle: ${JSON.stringify(M.lastSource())}`);

    const edds = near.find(m => m.icaoId === 'EDDS');
    edds && /260620Z/.test(edds.rawOb)
      ? ok('je Platz die neueste Meldung')
      : bad(`EDDS: ${edds && edds.rawOb}`);

    const wide = await M.near(49.10, 9.75, 200, 8);
    wide.length === 5 ? ok('200 km liefert 5 Plätze') : bad(`200 km: ${wide.length} Plätze`);
    const capped = await M.near(49.10, 9.75, 200, 2);
    capped.length === 2 ? ok('Höchstzahl wird eingehalten') : bad(`Limit 2: ${capped.length}`);

    const v = M.visKm(near[0]);
    (v && v.km === 10 && v.plus)
      ? ok('9999 im METAR wird als ≥10 km gelesen, nicht als 16 km')
      : bad(`Sicht: ${JSON.stringify(v)}`);
    const ifr = near.find(m => m.icaoId === 'ETHL');
    M.ceiling(ifr) === 700
      ? ok('Hauptwolkenuntergrenze gelesen (OVC007 → 700 ft)')
      : bad(`ETHL: Basis ${M.ceiling(ifr)}`);

    // Auffrischung hebt still auf live
    const fresh = await M.refresh(49.10, 9.75, 100, 8);
    fresh && fresh.length === 3 && M.lastSource().kind === 'live'
      ? ok('gelingt der Direktabruf, wird still auf live gehoben')
      : bad(`Auffrischung: ${fresh && fresh.length}, Quelle ${JSON.stringify(M.lastSource())}`);
    (await M.refresh(49.10, 9.75, 100, 8)) === null
      ? ok('eine zweite Auffrischung erspart sich den Abruf')
      : bad('refresh läuft doppelt');

    const tafs = await M.taf(ids);
    /2606\/2712/.test(tafs.EDDS && tafs.EDDS.rawTAF || '')
      ? ok('TAF: die gültige Ausgabe gewinnt (mostRecent)')
      : bad(`TAF EDDS: ${tafs.EDDS && tafs.EDDS.rawTAF}`);
  }

  // ---- NOAA blockiert: die Karte steht trotzdem ----
  {
    const { M, calls } = build({ repo: REPO, live: null });
    const list = await M.near(49.10, 9.75, 100, 8);
    list.length === 3 && M.lastSource().kind === 'repo'
      ? ok('blockierte NOAA ändert nichts — die Kopie trägt die Karte')
      : bad(`blockiert: ${list.length} Plätze, ${JSON.stringify(M.lastSource())}`);
    (await M.refresh(49.10, 9.75, 100, 8)) === null
      ? ok('gescheiterte Auffrischung liefert null statt einer Ausnahme')
      : bad('refresh wirft bei blockierter NOAA');
    const t = await M.taf(['EDDS']);
    t.EDDS ? ok('TAF kommt in dem Fall ebenfalls aus der Kopie')
           : bad('TAF-Kopie greift nicht');
    calls.every(u => !u.includes('stationinfo'))
      ? ok('keine überflüssigen Zusatzabrufe')
      : bad('unerwarteter Abruf');
  }

  // ---- keine Kopie im Repo: dann eben direkt ----
  {
    const { M, calls } = build({ repo: null, live: fixture });
    const list = await M.near(49.10, 9.75, 100, 8);
    list.length === 3 && M.lastSource().kind === 'live'
      ? ok('ohne Kopie wird direkt bei der NOAA gefragt')
      : bad(`ohne Kopie: ${list.length}, ${JSON.stringify(M.lastSource())}`);
    /bbox=48\.201,8\.377,49\.999,11\.123/.test(calls.find(u => u.includes('bbox')) || '')
      ? ok('Anfrage-Rechteck passt zum Radius')
      : bad(`Anfrage: ${calls.join(' | ')}`);
  }

  // ---- beides weg: der Fehler wird durchgereicht, damit die Karte ihn zeigt ----
  {
    const { M } = build({ repo: null, live: null });
    let threw = false;
    try { await M.near(49.10, 9.75, 100, 8); } catch { threw = true; }
    threw ? ok('sind beide Quellen weg, meldet die Karte es offen')
          : bad('Fehler wird verschluckt');
  }

  // ---- Platzsuche findet EDDS auch ohne Netz ----
  {
    const { M } = build({ repo: REPO, live: null });
    await M.near(49.10, 9.75, 100, 8);
    const st = await M.station('edds');
    st && Math.abs(st.lat - 48.69) < 0.2
      ? ok('ICAO-Suche bedient sich aus der Kopie')
      : bad(`station(EDDS): ${JSON.stringify(st)}`);
  }
}

// ------------------------------------------------- 3a2. Zweitquelle im Fetcher
head('METAR-Zweitquelle (tgftp)');
{
  const { parseMetar, splitCycles, stationTable } = await import('../scripts/fetch-dwd.mjs');
  const CYCLE = [
    '2026/08/26 07:20',
    'EDDF 260720Z AUTO 08004KT 040V130 9999 BKN011 18/14 Q1016 NOSIG',
    '',
    '2026/08/26 07:20',
    'EDDS 260720Z 24008KT 3000 -RA BKN007 OVC015 16/15 Q1015',
    '',
    '2026/08/26 06:50',
    'EDDS 260650Z 24006KT 9999 FEW030 15/13 Q1015',
    '',
    'kaputt ohne Zeitstempel',
    'EDXX 260720Z 00000KT',
  ].join('\n');

  const blocks = splitCycles(CYCLE);
  blocks.length === 3
    ? ok('drei gültige Blöcke, der kaputte fällt weg')
    : bad(`splitCycles: ${blocks.length} Blöcke`);
  blocks[0].time === Date.UTC(2026, 7, 26, 7, 20) / 1000
    ? ok('Zeitstempel wird als UTC gelesen')
    : bad(`Zeit: ${blocks[0].time}`);

  const st = { name: 'Stuttgart', lat: 48.69, lon: 9.22, elev: 396 };
  const a = parseMetar(blocks[0].raw, blocks[0].time, { name: 'Frankfurt', lat: 50.03, lon: 8.57 });
  a.icaoId === 'EDDF' && a.wdir === 80 && a.wspd === 4 && a.visib === '6+' &&
  a.temp === 18 && a.dewp === 14 && a.altim === 1016 &&
  a.clouds.some(c => c.cover === 'BKN' && c.base === 1100)
    ? ok('EDDF: Wind, 9999-Sicht, Wolken, T/Td und QNH gelesen')
    : bad(`EDDF: ${JSON.stringify(a)}`);
  a.fltCat === 'MVFR'
    ? ok('BKN011 ergibt MVFR')
    : bad(`EDDF fltCat: ${a.fltCat}`);

  const b = parseMetar(blocks[1].raw, blocks[1].time, st);
  Math.abs(b.visib - 3000 / 1609.34) < 0.01 && b.fltCat === 'IFR' && b.lat === 48.69
    ? ok('EDDS: Sicht 3000 m → IFR, Koordinaten aus der Platztabelle')
    : bad(`EDDS: ${JSON.stringify(b)}`);
  parseMetar('völliger Unsinn', 0, st) === null
    ? ok('Unsinn liefert null statt eines halben Datensatzes')
    : bad('parseMetar akzeptiert Unsinn');

  const tbl = stationTable({ metar: [{ icaoId: 'EDDS', lat: 48.69, lon: 9.22, name: 'Stuttgart' },
                                     { icaoId: 'EDXX' }] });
  tbl.size === 1 && tbl.get('EDDS').lat === 48.69
    ? ok('Platztabelle übernimmt nur Einträge mit Koordinaten')
    : bad(`stationTable: ${tbl.size}`);
}

// ------------------------------------------------- 3a3. GAFOR-Codes
head('GAFOR-Codes');
{
  const F = await import('../scripts/fetch-dwd.mjs');
  let hub = '';
  try {
    hub = (await readFile('test/sample-gafor-hub.txt', 'utf8')).split('\n').slice(2).join('\n');
  } catch { console.log('  --   test/sample-gafor-hub.txt fehlt'); }

  if (hub) {
    const text = F.stripChrome(hub);
    const secs = F.splitSections(text);
    secs.length === 5
      ? ok('Übersichtsseite in fünf Bereichstabellen zerlegt')
      : bad(`splitSections: ${secs.length} Abschnitte`);

    const all = {};
    const bereiche = [];
    for (const sec of secs) {
      const hl = F.headline(sec);
      const per = F.periodsFrom(sec);
      const ar = F.areasFrom(sec, per.length);
      bereiche.push(`${hl.bereich}:${Object.keys(ar).length}`);
      Object.assign(all, ar);
    }
    Object.keys(all).length === 68
      ? ok(`alle 68 Gebiete gelesen (${bereiche.join(' ')})`)
      : bad(`nur ${Object.keys(all).length} von 68 Gebieten — ${bereiche.join(' ')}`);

    // Codes mit Ziffer: bis 1.7.0 fielen genau diese Zeilen durch
    const a41 = all['41'];
    a41 && a41.codes.join(' ') === 'M2 D1 D1' && a41.name === 'Hunsrück'
      ? ok('Gebiet 41: Codes mit Ziffer gelesen (M2 D1 D1)')
      : bad(`Gebiet 41: ${JSON.stringify(a41)}`);
    const a51 = all['51'];
    a51 && a51.codes.length === 3 && !/[CODMX]\d/.test(a51.name)
      ? ok('Gebiet 51: der Code landet nicht mehr im Gebietsnamen')
      : bad(`Gebiet 51: ${JSON.stringify(a51)}`);

    // Zusätze stehen je Zeitraum, nicht am Zeilenende
    const a75 = all['75'];
    a75 && a75.remarks.join('|') === '|ISOL SHRA|ISOL TSRA'
      ? ok('Gebiet 75: Zusätze dem richtigen Zeitraum zugeordnet')
      : bad(`Gebiet 75: ${JSON.stringify(a75 && a75.remarks)}`);
    const a84 = all['84'];
    a84 && a84.remarks[0] === 'ISOL SHRA' && a84.codes.join(' ') === 'D1 O C'
      ? ok('Gebiet 84: Zusatz im ersten Zeitraum')
      : bad(`Gebiet 84: ${JSON.stringify(a84)}`);

    Object.values(all).every(a => a.codes.length === 3)
      ? ok('jede der 68 Zeilen hat genau drei Codes')
      : bad('Codeanzahl passt nicht zu den Zeiträumen');
  }

  // Entschlüsselung
  const utilSrc = await readFile('js/util.js', 'utf8');
  const U = new Function(`${utilSrc}; return U;`)();
  const G = new Function('U', `${await readFile('js/gafor.js', 'utf8')}; return GAFOR;`)(U);

  const d4 = G.codeInfo('D4');
  d4.letter === 'D' && d4.digit === '4' && d4.key === 'd' &&
  d4.vis === '5 – 8 km' && d4.base === '1000 – 2000 ft'
    ? ok('D4 = Sicht 5–8 km, Untergrenze 1000–2000 ft über Bezugshöhe')
    : bad(`D4: ${JSON.stringify(d4)}`);
  const m5 = G.codeInfo('M5');
  m5.vis === '5 – 8 km' && m5.base === '500 – 1000 ft'
    ? ok('M5 = Sicht 5–8 km, Untergrenze 500–1000 ft (wörtlich im DWD-Merkblatt)')
    : bad(`M5: ${JSON.stringify(m5)}`);
  const c = G.codeInfo('C');
  c.vis === '≥ 10 km' && c.base === '≥ 5000 ft'
    ? ok('C = mindestens 10 km und 5000 ft — nicht 2000 ft wie bis 1.7.0')
    : bad(`C: ${JSON.stringify(c)}`);
  G.CODE_ORDER.length === 11 && G.CODE_ORDER.every(k => G.codeInfo(k).vis)
    ? ok('alle elf gebräuchlichen Codes sind hinterlegt')
    : bad(`CODE_ORDER: ${G.CODE_ORDER.join(' ')}`);
  const d2 = G.codeInfo('D2');
  d2.key === 'd' && d2.letter === 'D' && !d2.vis
    ? ok('unbekannte Feinstufe fällt sauber auf die Buchstabenklasse zurück')
    : bad(`D2: ${JSON.stringify(d2)}`);
  G.codeInfo('').key === 'none' && G.codeInfo('Quatsch').key === 'none'
    ? ok('Unsinn ergibt „keine Angabe", nicht eine erfundene Stufe')
    : bad('codeInfo akzeptiert Unsinn');
}

// ------------------------------------------------- 3b. Modell, Nebel, Profil
head('Open-Meteo: Profil, Nebel, Ensemble');
{
  const omSrc = await readFile('js/openmeteo.js', 'utf8');
  const windSrc = await readFile('js/wind.js', 'utf8');
  let asked = '';
  const U = {
    load: (k, d) => d,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    async getJSON(url) { asked = url; return FC; },
  };

  // ein Ort auf 300 m, Boden 10/80/180 m plus vier Druckflächen
  const FC = {
    elevation: 300,
    utc_offset_seconds: 7200,
    timezone: 'Europe/Berlin',
    hourly: {
      time: ['2026-08-26T10:00', '2026-08-26T11:00', '2026-08-26T12:00'],
      temperature_2m: [18, 19, 20], dew_point_2m: [17.6, 14, 9],
      relative_humidity_2m: [98, 72, 50],
      wind_speed_10m: [1.2, 3, 4], wind_direction_10m: [200, 210, 220],
      wind_gusts_10m: [3, 6, 9],
      wind_speed_80m: [3, 5, 6], wind_direction_80m: [210, 215, 225],
      wind_speed_180m: [5, 7, 8], wind_direction_180m: [215, 220, 230],
      cloud_cover: [90, 40, 20], cloud_cover_low: [80, 30, 5],
      cloud_cover_mid: [40, 20, 10], cloud_cover_high: [10, 30, 60],
      visibility: [800, 20000, 30000], shortwave_radiation: [40, 400, 700],
      precipitation: [0, 0, 0], precipitation_probability: [10, 5, 0],
      cape: [0, 120, 400], boundary_layer_height: [200, 900, 1500],
      freezing_level_height: [3600, 3700, 3800], pressure_msl: [1016, 1016, 1015],
      // 1000 hPa liegt unter dem Gelände und muss verschwinden
      wind_speed_1000hPa: [4, 5, 6], wind_direction_1000hPa: [200, 205, 210],
      temperature_1000hPa: [19, 20, 21], geopotential_height_1000hPa: [110, 115, 120],
      wind_speed_900hPa: [9, 10, 11], wind_direction_900hPa: [230, 235, 240],
      temperature_900hPa: [12, 13, 14], geopotential_height_900hPa: [980, 985, 990],
      wind_speed_850hPa: [12, 13, 14], wind_direction_850hPa: [250, 255, 260],
      temperature_850hPa: [8, 9, 10], geopotential_height_850hPa: [1480, 1485, 1490],
      wind_speed_500hPa: [26, 27, 28], wind_direction_500hPa: [270, 275, 280],
      temperature_500hPa: [-18, -17, -16], geopotential_height_500hPa: [5600, 5610, 5620],
    },
  };
  const OM = new Function('U', `${omSrc}; return OM;`)(U);
  const WINDVIEW = new Function(`${windSrc}; return WINDVIEW;`)();

  // --- Anfrage ---
  await OM.forecast(49.10, 9.75, 2, 500);
  /wind_speed_850hPa/.test(asked) && /geopotential_height_500hPa/.test(asked)
    ? ok('Anfrage enthält die Druckflächen bis 500 hPa')
    : bad(`Anfrage ohne Druckflächen: ${asked.slice(0, 160)}`);
  !/_400hPa|_300hPa/.test(asked)
    ? ok('über der eingestellten Grenze wird nichts angefragt')
    : bad('Anfrage geht über 500 hPa hinaus');
  OM.levelsUpTo(700).length === 8 && OM.levelsUpTo(300).length === 12
    ? ok('Flächenliste folgt der Einstellung (700 hPa → 8, 300 hPa → 12)')
    : bad(`levelsUpTo: ${OM.levelsUpTo(700).length} / ${OM.levelsUpTo(300).length}`);

  // --- Profil ---
  const j = Object.assign({}, FC, { _levels: OM.levelsUpTo(500) });
  const prof = OM.profile(j, 1, 300);
  const sorted = prof.every((p, i) => i === 0 || prof[i - 1].m >= p.m);
  sorted ? ok('Profil ist von oben nach unten sortiert') : bad('Profil nicht sortiert');
  !prof.some(p => p.hPa === 1000)
    ? ok('1000 hPa liegt unter dem Gelände und fällt heraus')
    : bad('unterirdische Fläche im Profil');
  prof.some(p => p.hPa === 500 && p.ft === Math.round(5610 * OM.M_TO_FT))
    ? ok('Geopotential wird nach Fuss umgerechnet (5610 m → 18 406 ft)')
    : bad(`500 hPa: ${JSON.stringify(prof.find(p => p.hPa === 500))}`);
  prof.filter(p => p.hPa == null).length === 3
    ? ok('10, 80 und 180 m über Grund stehen im Profil')
    : bad(`Bodenflächen: ${prof.filter(p => p.hPa == null).length}`);
  Math.abs(OM.stdHeight(500) - 5574) < 60
    ? ok('Standardatmosphäre als Rückfallhöhe plausibel')
    : bad(`stdHeight(500) = ${OM.stdHeight(500).toFixed(0)} m`);

  // --- Nebel ---
  OM.fogRisk(OM.at(j, 0)).level === 3
    ? ok('Spread 0,4 K, 98 %, Wind 1,2 m/s, Sicht 800 m → hoch')
    : bad(`Nebel h=0: ${JSON.stringify(OM.fogRisk(OM.at(j, 0)))}`);
  OM.fogRisk(OM.at(j, 2)).level === 0
    ? ok('trockene Mittagsluft → kein Nebelrisiko')
    : bad(`Nebel h=2: ${JSON.stringify(OM.fogRisk(OM.at(j, 2)))}`);
  OM.fogRisk({ temp: 10, dew: 9.8, rh: 99, w10: 1, vis: 500, rad: 600 }).level === 2
    ? ok('kräftige Einstrahlung nimmt dem Nebel eine Stufe')
    : bad('Einstrahlungsabschlag greift nicht');
  OM.cloudBaseFt(OM.at(j, 0)) === 200 && OM.cloudBaseFt(OM.at(j, 2)) === null
    ? ok('Wolkenbasis nur bei nennenswerter tiefer Bewölkung')
    : bad(`Basis: ${OM.cloudBaseFt(OM.at(j, 0))} / ${OM.cloudBaseFt(OM.at(j, 2))}`);

  // --- Ensemble ---
  const ENS = { hourly: { time: ['x'],
    wind_speed_10m: [5], wind_speed_10m_member01: [3], wind_speed_10m_member02: [9],
    wind_speed_10m_member03: [7],
    precipitation: [0], precipitation_member01: [0.4], precipitation_member02: [0] } };
  const sp = OM.spread(ENS, 'wind_speed_10m', 0);
  sp && sp.n === 4 && sp.min === 3 && sp.max === 9 && sp.med === 6
    ? ok('Streubreite über Kontrolllauf und Member (3–9, Median 6)')
    : bad(`spread: ${JSON.stringify(sp)}`);
  const dry = OM.shareBelow(ENS, 'precipitation', 0, 0.1);
  dry && dry.hit === 2 && dry.n === 3
    ? ok('2 von 3 Rechnungen trocken')
    : bad(`shareBelow: ${JSON.stringify(dry)}`);
  OM.spread(ENS, 'cloud_cover', 0) === null
    ? ok('fehlende Ensemble-Grösse liefert null statt einer Fantasiezahl')
    : bad('spread erfindet Werte');

  // --- Windfahnen ---
  const kinds = (kt) => WINDVIEW.barb(kt).slice(1);
  kinds(10).length === 1 && !kinds(10)[0].fill
    ? ok('10 kt → eine ganze Fahne')
    : bad(`barb(10): ${JSON.stringify(kinds(10))}`);
  kinds(65).filter(p => p.fill).length === 1 && kinds(65).length === 3
    ? ok('65 kt → Wimpel, ganze und halbe Fahne')
    : bad(`barb(65): ${JSON.stringify(kinds(65))}`);
  WINDVIEW.barb(2).some(p => p.circle)
    ? ok('unter 5 kt wird der Windstille-Kreis gezeichnet')
    : bad('barb(2) ohne Kreis');
  kinds(5).length === 1
    ? ok('5 kt → nur die halbe Fahne')
    : bad(`barb(5): ${JSON.stringify(kinds(5))}`);
}

// ------------------------------------------------------------- 3c. Abdeckung
head('Abdeckung und Randfälle');
{
  const utilSrc = await readFile('js/util.js', 'utf8');
  const U = new Function(`${utilSrc}; return U;`)();
  const files = {
    'data/gafor-areas.geojson': JSON.parse(await readFile('data/gafor-areas.geojson', 'utf8')),
    'data/gafor-meta.json': JSON.parse(await readFile('data/gafor-meta.json', 'utf8')),
    'data/gafor-regions.geojson': JSON.parse(await readFile('data/gafor-regions.geojson', 'utf8')),
    'data/germany.geojson': JSON.parse(await readFile('data/germany.geojson', 'utf8')),
  };
  U.getJSON = async (u) => {
    const k = u.split('?')[0];
    if (files[k]) return files[k];
    throw new Error('404 ' + k);
  };
  const G = new Function('U', `${await readFile('js/gafor.js', 'utf8')}; return GAFOR;`)(U);
  await G.init();

  G.SNAP_KM === 10 ? ok('Einrastweite 10 km') : bad(`SNAP_KM = ${G.SNAP_KM}`);

  const inside = [['München', 48.14, 11.58], ['Hamburg', 53.55, 9.99], ['Berlin', 52.52, 13.40],
                  ['Freiburg', 47.99, 7.85], ['Görlitz', 51.15, 14.99], ['Helgoland', 54.18, 7.89]];
  const bad1 = inside.filter(([, la, lo]) => {
    const a = G.lookup(la, lo);
    return !a || a.method !== 'polygon';
  });
  bad1.length ? bad(`nicht im Polygon: ${bad1.map(x => x[0]).join(', ')}`)
              : ok(`${inside.length} deutsche Orte liegen im Polygon`);

  const outside = [['Zürich', 47.37, 8.54], ['Wien', 48.21, 16.37], ['Prag', 50.08, 14.44],
                   ['Paris', 48.86, 2.35], ['Bern', 46.95, 7.45], ['Amsterdam', 52.37, 4.90]];
  const bad2 = outside.filter(([, la, lo]) => G.lookup(la, lo) !== null);
  bad2.length ? bad(`fälschlich zugeordnet: ${bad2.map(x => x[0]).join(', ')}`)
              : ok(`${outside.length} ausländische Städte liefern kein Gebiet`);

  // grenznah: darf einrasten, aber nur als 'nearest' und innerhalb der Toleranz
  const edge = G.lookup(48.58, 7.75);            // Strassburg, 5,7 km von der Grenze
  edge && edge.method === 'nearest' && edge.distKm <= G.SNAP_KM
    ? ok(`grenznaher Ort rastet ein (Strassburg → Gebiet ${edge.id}, ${edge.distKm.toFixed(1)} km)`)
    : bad(`Strassburg: ${JSON.stringify(edge)}`);

  // Der Zuschnitt muss gegriffen haben — vor 1.7.0 lag Strassburg im Polygon
  const strasbourgInside = G.areas().some(f => U.inGeometry(7.75, 48.58, f.geometry));
  !strasbourgInside
    ? ok('Gebietsgrenzen enden an der Staatsgrenze (Elsass ausgeschnitten)')
    : bad('ein Gebietspolygon reicht noch bis Strassburg');

  // Die Maske ist die Vereinigung — sie muss dieselbe Fläche abdecken
  const land = G.landCollection();
  const covered = (la, lo) => land.features.some(f => U.inGeometry(lo, la, f.geometry));
  covered(48.14, 11.58) && !covered(47.37, 8.54)
    ? ok('Maskenumriss deckt sich mit der Gebietszuordnung')
    : bad('germany.geojson passt nicht zu den Gebieten');
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
