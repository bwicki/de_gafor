/* Headless-Durchlauf mit gemockten Netzantworten.
 *   node test/browser.mjs [--shot pfad.png]
 * Prüft, dass die vier Karten tatsächlich rendern, und legt auf Wunsch
 * Bildschirmfotos ab.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.geojson': 'application/json',
               '.png': 'image/png', '.svg': 'image/svg+xml',
               '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------------------------------------------------------------- Mockdaten
const H = 80;                                    // Stunden im Testlauf
const now = new Date();
now.setMinutes(0, 0, 0);
const times = Array.from({ length: H }, (_, i) =>
  new Date(now.getTime() + i * 3600e3).toISOString().slice(0, 16));
const wave = (i, a, b, ph) => a + (b - a) * (0.5 + 0.5 * Math.sin((i + ph) / 4));
const ser = (f) => times.map((_, i) => +f(i).toFixed(2));

const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];
const STD = { 1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950,
              700: 3010, 600: 4200, 500: 5570, 400: 7180, 300: 9160 };

/* Stunde 2 bis 5 ist im Testlauf eine Nebellage — deterministisch, damit die
 * Nebelzeile im sichtbaren Fenster garantiert etwas zu zeigen hat. */
const fog = (i) => i >= 2 && i <= 5;

function forecastJSON(url) {
  const temp = (i) => wave(i, 9, 24, 0);
  const hourly = {
    time: times,
    temperature_2m: ser(temp),
    dew_point_2m: ser(i => temp(i) - (fog(i) ? 0.3 : 6)),
    relative_humidity_2m: ser(i => (fog(i) ? 99 : 66)),
    precipitation: ser(i => (i % 11 === 0 ? 0.6 : 0)),
    precipitation_probability: ser(i => Math.round(wave(i, 5, 60, 2))),
    cloud_cover: ser(i => Math.round(wave(i, 90, 20, 1))),
    cloud_cover_low: ser(i => Math.round(wave(i, 85, 5, 0))),
    cloud_cover_mid: ser(i => Math.round(wave(i, 15, 55, 3))),
    cloud_cover_high: ser(i => Math.round(wave(i, 5, 80, 6))),
    visibility: ser(i => (fog(i) ? 600 : 25000)),
    shortwave_radiation: ser(i => (fog(i) ? 15 : Math.max(0, wave(i, -100, 720, 0)))),
    wind_speed_10m: ser(i => (fog(i) ? 0.9 : wave(i, 1.0, 6.5, 1))),
    wind_direction_10m: ser(i => (190 + i * 3) % 360),
    wind_gusts_10m: ser(i => wave(i, 2.5, 12, 1)),
    wind_speed_80m: ser(i => wave(i, 3, 9, 1)),
    wind_direction_80m: ser(i => (200 + i * 3) % 360),
    wind_speed_180m: ser(i => wave(i, 4, 11, 1)),
    wind_direction_180m: ser(i => (210 + i * 3) % 360),
    cape: ser(i => Math.round(wave(i, 0, 600, 2))),
    boundary_layer_height: ser(i => Math.round(wave(i, 120, 1700, 1))),
    freezing_level_height: ser(i => Math.round(wave(i, 3200, 4100, 1))),
    pressure_msl: ser(i => +wave(i, 1012, 1019, 3).toFixed(1)),
  };
  for (const p of LEVELS) {
    if (!url.includes(`wind_speed_${p}hPa`)) continue;
    const k = LEVELS.indexOf(p);
    hourly[`wind_speed_${p}hPa`] = ser(i => wave(i, 4 + k * 2.6, 9 + k * 3.4, 1));
    hourly[`wind_direction_${p}hPa`] = ser(i => (200 + k * 9 + i * 2) % 360);
    hourly[`temperature_${p}hPa`] = ser(() => 20 - k * 3.6);
    hourly[`geopotential_height_${p}hPa`] = ser(() => STD[p]);
    // eine feuchte Schicht zwischen 900 und 800 hPa, damit die Schattierung greift
    hourly[`relative_humidity_${p}hPa`] = ser(() => (p <= 900 && p >= 800 ? 96 : 55));
  }
  return {
    latitude: 49.1, longitude: 9.75, elevation: 340,
    timezone: 'Europe/Berlin', timezone_abbreviation: 'CEST', utc_offset_seconds: 7200,
    hourly,
    daily: { time: [times[0].slice(0, 10)], sunrise: [times[0].slice(0, 10) + 'T06:22'],
             sunset: [times[0].slice(0, 10) + 'T20:31'] },
  };
}

function ensembleJSON() {
  const hourly = { time: times };
  for (const k of ['wind_speed_10m', 'wind_gusts_10m', 'precipitation', 'cloud_cover', 'temperature_2m']) {
    for (let m = 0; m <= 19; m++) {
      const key = m === 0 ? k : `${k}_member${String(m).padStart(2, '0')}`;
      const j = (m - 9.5) / 9.5;
      hourly[key] = ser(i =>
        k === 'precipitation' ? Math.max(0, wave(i, -0.4, 0.9, 2) + j * 0.4)
        : k === 'cloud_cover' ? Math.min(100, Math.max(0, wave(i, 88, 22, 1) + j * 22))
        : k === 'temperature_2m' ? wave(i, 9, 24, 0) + j * 1.8
        : k === 'wind_gusts_10m' ? Math.max(0, wave(i, 2.5, 12, 1) + j * 3.2)
        : Math.max(0, wave(i, 1.0, 6.5, 1) + j * 1.6));
    }
  }
  return { latitude: 49.1, longitude: 9.75, timezone: 'Europe/Berlin',
           timezone_abbreviation: 'CEST', utc_offset_seconds: 7200, hourly };
}

/* Kachelattrappe: heller Raster-Hintergrund, damit die Abgrauung sichtbar wird. */
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADG0lEQVR4nO3dsW3CYBhF0d8RNSjUiCb7r+Hejbs0iBoEEzBEhBx0zxng2c2VXPmb1mUeULUbY5zOP+97wPNx2x+O9u3/w/3r5ffrTdPwEQRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKRN6zLvD99bvwZs4Pm478YYn/t/d/v2/zZ+9wlEmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDT3AehyH8B+et99AOoEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkuQ9Al/sA9tP77gNQJwDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIM19ALrcB7Cf3ncfgDoBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBp7gPQ5T6A/fS++wDUCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASHMfgC73Aeyn990HoE4ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECa+wB0uQ9gP73vPgB1AiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkDaty7z1O8BmXhpC7OSA82vRAAAAAElFTkSuQmCC', 'base64');

// ---------------------------------------------------------------- Lauf
const shotArg = process.argv.indexOf('--shot');
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 430, height: 3200 }, deviceScaleFactor: 2,
  colorScheme: process.argv.includes('--dark') ? 'dark' : 'light',
});
const errors = [];
const seen = [];
page.on('request', r => seen.push(r.url()));
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  // Nicht gemockte Fremdadressen (Nominatim & Co.) liefern hier absichtlich 404
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
    errors.push('console: ' + m.text());
  }
});

/* Ein kleiner DWD-Index, damit die GAFOR-Kacheln etwas zu zeigen haben. */
const utcH = new Date().getUTCHours();
const per = (o) => `${String((utcH + o + 24) % 24).padStart(2, '0')}-${String((utcH + o + 2 + 24) % 24).padStart(2, '0')}`;
const DWD_INDEX = {
  generated: new Date().toISOString(),
  gafor: {
    EDZM: {
      title: 'GAFOR Bereich LBZ München', bereich: 'München',
      issued: new Date(Date.now() - 40 * 60e3).toISOString(),
      source: 'https://www.dwd.de/', text: 'Testbulletin',
      /* Der erste Zeitraum liegt bewusst in der Vergangenheit: nur so fällt auf,
         wenn Kopfzeile oder Zeitband den ersten statt den laufenden zeigen. */
      periods: [per(-2), per(0), per(2), per(4)],
      // jedes Gebiet bekommt dieselbe Reihe, damit der Test nicht davon abhängt,
      // in welchem Gebiet der Startpunkt gerade liegt
      areas: Object.fromEntries((JSON.parse(await readFile('data/gafor-meta.json', 'utf8')).areas || [])
        .map(a => [String(a.id), ['C', 'O', 'D4', 'M8']])),
      details: Object.fromEntries((JSON.parse(await readFile('data/gafor-meta.json', 'utf8')).areas || [])
        .map(a => [String(a.id), { codes: ['C', 'O', 'D4', 'M8'], name: a.name,
                                   remarks: ['', 'ISOL SHRA', '', 'ISOL TSRA'] }])),
    },
  },
  overview: {
    EDZM: {
      bulletin: 'FBEU40 EDZM', bereich: 'Süd', office: 'EDZM',
      source: 'https://www.dwd.de/',
      validFrom: new Date(Date.now() - 3 * 3600e3).toISOString(),
      validTo: new Date(Date.now() + 18 * 3600e3).toISOString(),
      areas: (JSON.parse(await readFile('data/gafor-meta.json', 'utf8')).areas || [])
        .map(a => String(a.id)),
      text: (await readFile('test/sample-overview.txt', 'utf8')).split('\n').slice(2).join('\n')
        .replace(/^[\s\S]*?Wetterlage/, 'Wetterlage'),
    },
  },
  balloon: {}, errors: [],
};
const METAR_REPO = {
  generated: new Date(Date.now() - 11 * 60e3).toISOString(), via: 'awc',
  metar: JSON.parse(await readFile('test/sample-metar.json', 'utf8')),
  taf: JSON.parse(await readFile('test/sample-taf.json', 'utf8')),
};

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.includes('data/dwd/metar.json')) return route.fulfill({ json: METAR_REPO });
  if (url.includes('data/dwd/index.json')) return route.fulfill({ json: DWD_INDEX });
  if (url.startsWith(base)) return route.continue();
  if (url.includes('ensemble-api.open-meteo.com'))
    return route.fulfill({ json: ensembleJSON() });
  if (url.includes('api.open-meteo.com/v1/forecast'))
    return route.fulfill({ json: forecastJSON(url) });
  if (url.includes('api.open-meteo.com/v1/elevation'))
    return route.fulfill({ json: { elevation: [340] } });
  if (url.includes('aviationweather.gov'))
    return route.fulfill({ json: JSON.parse(await readFile(
      url.includes('/taf') ? 'test/sample-taf.json' : 'test/sample-metar.json', 'utf8')) });
  if (url.includes('nominatim.openstreetmap.org/reverse')) {
    const u = new URL(url);
    const la = (+u.searchParams.get('lat')).toFixed(2);
    return route.fulfill({ json: { address: { village: `Testdorf ${la}`, state: 'Baden-Württemberg' } } });
  }
  if (url.includes('geocoding-api.open-meteo.com'))
    return route.fulfill({ json: { results: [{ name: 'Gladbeck', admin1: 'Nordrhein-Westfalen',
      country: 'Deutschland', latitude: 51.5711, longitude: 6.9859, elevation: 63 }] } });
  if (url.includes('tile.openstreetmap.org'))
    return route.fulfill({ status: 200, contentType: 'image/png', body: TILE });
  return route.fulfill({ status: 404, body: '' });
});

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };

await page.goto(base + '#49.1000,9.7500,9', { waitUntil: 'domcontentloaded' });

console.log('\nBrowser');
// Zugangssperre
await page.waitForSelector('#gate:not([hidden])', { timeout: 8000 }).catch(() => {});
(await page.locator('#gate').count()) === 1 && await page.locator('#gate').isVisible()
  ? ok('Zugangssperre erscheint beim ersten Laden') : bad('keine Zugangssperre');
await page.locator('#gatePw').fill('9999');
await page.locator('#gateForm button[type=submit]').click();
await page.waitForTimeout(150);
await page.locator('#gateErr').isVisible()
  ? ok('falsches Kennwort wird abgewiesen') : bad('falsches Kennwort kommt durch');
await page.locator('#gatePw').fill('1234');
await page.locator('#gateForm button[type=submit]').click();
await page.waitForTimeout(200);
(await page.locator('#gate').count()) === 0
  ? ok('richtiges Kennwort öffnet die App') : bad('Sperre bleibt trotz richtigem Kennwort');

// Nach zwei Stunden Untätigkeit wird wieder gefragt
{
  const stamp = await page.evaluate(() => +(localStorage.getItem('gaforcast.unlockedAt') || 0));
  stamp > 0 ? ok('Zeitpunkt der Anmeldung wird vermerkt') : bad('kein Anmeldezeitpunkt');
  // Uhr zwei Stunden zurückdrehen und neu laden
  await page.evaluate(() => localStorage.setItem('gaforcast.unlockedAt',
    String(Date.now() - 2.5 * 3600e3)));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  (await page.locator('#gate').count()) === 1
    ? ok('nach zwei Stunden Pause fragt die App wieder nach dem Kennwort')
    : bad('Sperre greift nach zwei Stunden Pause nicht');
  await page.fill('#gatePw', '1234');
  await page.locator('#gateForm button[type=submit]').click();
  await page.waitForTimeout(250);
  (await page.locator('#gate').count()) === 0
    ? ok('nach erneuter Eingabe ist die App wieder offen') : bad('Sperre bleibt hängen');
}

await page.waitForFunction(() => {
  const n = document.querySelector('#windBody .wp-table');
  return n && n.querySelectorAll('tbody tr').length > 3;
}, null, { timeout: 20000 }).catch(() => {});

// Höhenwind
const rows = await page.locator('#windBody .wp-table tbody tr').count();
rows >= 8 ? ok(`Höhenwind: ${rows} Zeilen`) : bad(`Höhenwind: nur ${rows} Zeilen`);
const barbs = await page.locator('#windBody .sv-svg .sv-barb').count();
barbs >= 8 ? ok(`Windfahnen gezeichnet: ${barbs}`) : bad(`nur ${barbs} Windfahnen`);
{
  const sv = page.locator('#windBody .sv-svg');
  (await sv.count()) === 1 ? ok('Stüve-Diagramm gezeichnet') : bad('kein Stüve-Diagramm');
  (await sv.locator('.sv-curve.temp').count()) === 1 &&
  (await sv.locator('.sv-curve.dew').count()) === 1
    ? ok('Temperatur- und Taupunktkurve vorhanden')
    : bad('T- oder Td-Kurve fehlt');
  (await sv.locator('.sv-adiabat line').count()) >= 3
    ? ok(`${await sv.locator('.sv-adiabat line').count()} Trockenadiabaten`)
    : bad('keine Trockenadiabaten');
  (await sv.locator('.sv-humid-band').count()) === 1
    ? ok('Schattierung der feuchten Schichten liegt auf') : bad('keine Feuchteschattierung');
  const stops = await sv.locator('linearGradient stop').evaluateAll(
    ns => ns.map(n => +n.getAttribute('stop-opacity')));
  stops.length >= 5 && Math.max(...stops) > 0.3 && Math.min(...stops) === 0
    ? ok(`Feuchteverlauf mit ${stops.length} Stufen, stärkste ${Math.max(...stops)}`)
    : bad(`Feuchteverlauf: ${stops.join(', ')}`);
  (await sv.locator('.sv-frame').count()) === 2
    ? ok('zwei Felder: Stüve links, Wind rechts') : bad('Felderaufteilung stimmt nicht');
}
(await page.locator('#windBody .wp-mrow.fzl').count()) >= 1
  ? ok('Nullgradgrenze im Profil markiert') : bad('Nullgradgrenze fehlt');
(await page.locator('#windBody .wp-mrow.pbl').count()) >= 1
  ? ok('Grenzschicht im Profil markiert') : bad('Grenzschicht fehlt');
{
  const models = await page.locator('#windBody .chips.models .chip').count();
  models === 8 ? ok('acht Modelle zur Wahl') : bad(`Modell-Chips: ${models}`);
  (await page.locator('#windBody .chips.models .chip.on').innerText()) === 'Auto'
    ? ok('„Auto" ist vorgewählt') : bad('kein Modell vorgewählt');

  // Reihenfolge der Modellpillen: aufsteigend nach Vorhersagehorizont
  const horizons = await page.locator('#windBody .chips.models .chip').evaluateAll(
    ns => ns.map(n => +(/\+(\d+)\s*h/.exec(n.title || '') || [0, -1])[1]));
  horizons.every((h, i) => i === 0 || h >= horizons[i - 1])
    ? ok(`Modelle aufsteigend nach Horizont (${horizons.join(' ≤ ')})`)
    : bad(`Modellreihenfolge: ${horizons.join(', ')}`);
  horizons[0] === 48
    ? ok('kürzestes Modell (ICON-D2, 48 h) steht vorn') : bad(`erster Horizont: ${horizons[0]}`);

  // Zeitwahl als Schieber statt als Pillenreihe
  (await page.locator('#windBody .chips:not(.models) .chip').count()) === 0
    ? ok('keine Stunden-Pillen mehr') : bad('Stunden-Pillen sind noch da');
  const slider = page.locator('#windBody .hour-slider input[type=range]');
  (await slider.count()) === 1 ? ok('Zeitschieber vorhanden') : bad('kein Zeitschieber');
  (await slider.getAttribute('step')) === '1'
    ? ok('Schieber rastet in Ein-Stunden-Schritten') : bad('falsche Schrittweite');
  // „Auto" reicht weiter als jedes Einzelmodell — hier bis ans Ende der Daten
  const maxAuto = +(await slider.getAttribute('max'));
  maxAuto > 48 && maxAuto <= H - 1
    ? ok(`Schieber reicht bei „Auto" bis +${maxAuto} h (Ende der Daten)`)
    : bad(`Schiebermaximum bei „Auto": ${maxAuto}`);
  const hsl = await page.locator('#windBody .hs-label').innerText();
  /^(Mo|Di|Mi|Do|Fr|Sa|So) \d{1,2}\. \w+ · \d\d:\d\d/.test(hsl)
    ? ok(`Schieber nennt Wochentag und Datum: „${hsl}"`) : bad(`Schieberbeschriftung: ${hsl}`);
  /jetzt/.test(hsl) ? ok('bei Position 0 steht „jetzt"') : bad('kein „jetzt" am Anfang');
  // die Marke sitzt unter dem Griff, nicht in einer festen Zeile
  {
    const tr = await page.locator('#windBody .hs-track').boundingBox();
    const lb = await page.locator('#windBody .hs-label').boundingBox();
    tr && lb && lb.x < tr.x + tr.width * 0.35
      ? ok('Marke steht am linken Ende, wo der Griff steht')
      : bad(`Marke bei x=${lb && Math.round(lb.x)}, Spur ab ${tr && Math.round(tr.x)}`);
  }
  // Tabelle links, Grafik rechts
  const split = page.locator('#windBody .wp-split');
  (await split.locator('.wp-col-table').count()) === 1 &&
  (await split.locator('.wp-col-chart').count()) === 1
    ? ok('Tabelle und Grafik stehen in einem gemeinsamen Block')
    : bad('Höhenwind ist nicht zweispaltig aufgebaut');
  (await split.locator('.sv-svg .sv-grid.minor line').count()) > 4
    ? ok('Zwischenlinien in der Grafik') : bad('keine Zwischenlinien');
}

// ---- auf dem Desktop nebeneinander ----
await page.setViewportSize({ width: 1280, height: 2400 });
await page.waitForTimeout(300);
{
  const split = page.locator('#windBody .wp-split');
  const tBox = await split.locator('.wp-col-table').boundingBox();
  const gBox = await split.locator('.wp-col-chart').boundingBox();
  tBox && gBox && gBox.x >= tBox.x + tBox.width - 2
    ? ok('Desktop: die Grafik steht rechts neben der Tabelle')
    : bad(`Anordnung: Tabelle x=${tBox && Math.round(tBox.x)} b=${tBox && Math.round(tBox.width)}, Grafik x=${gBox && Math.round(gBox.x)}`);
  // die Grafik soll ihren Kasten ausfüllen, nicht darin verloren gehen
  const sBox = await split.locator('.wp-col-chart svg').boundingBox();
  sBox && gBox && sBox.width >= gBox.width * 0.8
    ? ok(`Grafik füllt ihren Platz (${Math.round(sBox.width)} von ${Math.round(gBox.width)} px)`)
    : bad(`Grafik zu schmal: ${sBox && Math.round(sBox.width)} von ${gBox && Math.round(gBox.width)} px`);
  sBox && tBox && Math.abs(sBox.height - tBox.height) <= Math.max(60, tBox.height * 0.25)
    ? ok(`Grafik so hoch wie die Tabelle (${Math.round(sBox.height)} zu ${Math.round(tBox.height)} px)`)
    : bad(`Höhen: Grafik ${sBox && Math.round(sBox.height)}, Tabelle ${tBox && Math.round(tBox.height)}`);

  const cols = page.locator('#gaforBody .report-cols .report-col');
  if (await cols.count() === 2) {
    const a = await cols.nth(0).boundingBox(), b2 = await cols.nth(1).boundingBox();
    b2.x > a.x + 10
      ? ok('Flugwetterübersicht steht in zwei Spalten nebeneinander')
      : bad('Übersichtsspalten stehen untereinander');
    Math.abs(a.height - b2.height) / Math.max(a.height, b2.height) < 0.45
      ? ok(`Spalten etwa gleich hoch (${Math.round(a.height)} / ${Math.round(b2.height)} px)`)
      : bad(`Spaltenhöhen: ${Math.round(a.height)} / ${Math.round(b2.height)} px`);
    // geht es nicht auf, ist die linke die längere
    a.height >= b2.height - 1
      ? ok('die linke Spalte ist die längere')
      : bad(`links ${Math.round(a.height)} px, rechts ${Math.round(b2.height)} px`);
    (await page.locator('#gaforBody .report-h').count()) >= 2
      ? ok('Abschnittstitel sind eigene, fette Überschriften')
      : bad('keine Abschnittstitel');
  } else {
    console.log('  --   keine Flugwetterübersicht im Testindex, Spaltenprüfung entfällt');
  }

  // Kopfbereich: Karte rechts, vier Kästchen links, gleich hoch
  {
    const grid = await page.locator('.top-grid').boundingBox();
    const left = await page.locator('.top-grid > .top-left').boundingBox();
    const map = await page.locator('.top-grid > .map-block > .map-wrap').boundingBox();
    map && left && map.x >= left.x + left.width - 2
      ? ok('die Karte steht rechts neben den Kästchen') : bad('Karte steht nicht rechts');
    const share = map && grid ? map.width / grid.width : 0;
    share > 0.55 && share < 0.65
      ? ok(`Karte nimmt ${Math.round(share * 100)} % der Breite`)
      : bad(`Kartenbreite: ${Math.round(share * 100)} %`);
    // rechts bündig mit den Karten darunter (beide haben 14 px Seitenrand)
    const card = await page.locator('#cardGafor').boundingBox();
    map && card && Math.abs((map.x + map.width) - (card.x + card.width)) <= 2
      ? ok('Karte schliesst rechts bündig mit den Karten darunter ab')
      : bad(`rechte Kanten: Karte ${map && Math.round(map.x + map.width)}, Bericht ${card && Math.round(card.x + card.width)}`);
    map && left && Math.abs(map.height - left.height) <= 4
      ? ok(`Kästchen und Karte gleich hoch (${Math.round(left.height)} zu ${Math.round(map.height)} px)`)
      : bad(`Höhen: Kästchen ${left && Math.round(left.height)}, Karte ${map && Math.round(map.height)}`);

    // Die Bereichslegende liegt in der Karte, unten links
  {
    const lg = await page.locator('#regionLegend').boundingBox();
    const mp = await page.locator('.top-grid > .map-block > .map-wrap').boundingBox();
    lg && mp && lg.x >= mp.x && lg.x < mp.x + mp.width * 0.5 &&
    lg.y + lg.height <= mp.y + mp.height + 1 && lg.y > mp.y + mp.height * 0.6
      ? ok('Bereichslegende sitzt unten links in der Karte')
      : bad(`Legende bei ${lg && Math.round(lg.x)},${Math.round(lg && lg.y)} — Karte ${mp && Math.round(mp.x)},${mp && Math.round(mp.y)} ${mp && Math.round(mp.width)}×${mp && Math.round(mp.height)}`);
  }

  // Reihenfolge in der linken Spalte
    const ys = [];
    for (const sel of ['.top-left .search-block', '.top-left .place-bar',
                       '.top-left .area-head', '.top-left #tileBox']) {
      const b = await page.locator(sel).boundingBox();
      ys.push(b ? Math.round(b.y) : -1);
    }
    ys.every((y, i) => y > 0 && (i === 0 || y > ys[i - 1]))
      ? ok(`links untereinander: Suche, Ort, Gebiet, Stufen (y = ${ys.join(', ')})`)
      : bad(`Reihenfolge links: ${ys.join(', ')}`);
  }

  // Knöpfe links vom Logo
  const tools = await page.locator('.header-tools').boundingBox();
  const logo = await page.locator('.header-logo').boundingBox();
  tools && logo && tools.x + tools.width <= logo.x + 2
    ? ok('Funktionsknöpfe stehen links vom Logo')
    : bad(`Kopfzeile: Knöpfe x=${tools && Math.round(tools.x)}, Logo x=${logo && Math.round(logo.x)}`);
  (await page.locator('.header-tools .btn').count()) === 4
    ? ok('vier Knöpfe: Aktualisieren, Drucken, Teilen, Menü')
    : bad(`Knöpfe: ${await page.locator('.header-tools .btn').count()}`);
}
await page.setViewportSize({ width: 430, height: 3200 });
await page.waitForTimeout(250);

// Stundenwechsel über den Schieber
const setSlider = async (v) => {
  await page.locator('#windBody .hour-slider input[type=range]').evaluate((n, val) => {
    n.value = String(val);
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(220);
};
const firstAlt = await page.locator('#windBody .wp-table tbody tr td.spd').first().innerText();
await setSlider(4);
const secondAlt = await page.locator('#windBody .wp-table tbody tr td.spd').first().innerText();
firstAlt !== secondAlt ? ok('Schieber ändert das Profil')
                       : bad(`Schieber ohne Wirkung (${firstAlt})`);
/\+4 h/.test(await page.locator('#windBody .hs-label').innerText())
  ? ok('Beschriftung folgt dem Schieber') : bad('Beschriftung folgt dem Schieber nicht');
{
  // ans obere Ende: die Marke muss mitwandern
  const left0 = (await page.locator('#windBody .hs-label').boundingBox()).x;
  const max = +(await page.locator('#windBody .hour-slider input[type=range]').getAttribute('max'));
  await setSlider(max);
  const lb = await page.locator('#windBody .hs-label').boundingBox();
  const tr = await page.locator('#windBody .hs-track').boundingBox();
  lb.x > left0 + 40 && lb.x + lb.width <= tr.x + tr.width + 2
    ? ok('am Ende steht die Marke rechts und bleibt in der Spur')
    : bad(`Marke am Ende: x=${Math.round(lb.x)} (Start ${Math.round(left0)}), Spur bis ${Math.round(tr.x + tr.width)}`);
  const txt = await page.locator('#windBody .hs-label').innerText();
  /^(Mo|Di|Mi|Do|Fr|Sa|So) \d{1,2}\. \w+ · \d\d:\d\d/.test(txt) && txt.includes(`+${max} h`)
    ? ok(`spätester Zeitpunkt vollständig datiert: „${txt}"`) : bad(`Endbeschriftung: ${txt}`);
  await setSlider(4);
}
// die Erklärung unter dem Stüve ist weg
(await page.locator('#windBody .explain').count()) === 0
  ? ok('keine Erklärung mehr unter dem Diagramm') : bad('Erklärung steht noch da');

// Schwelle der Feuchteschattierung in den Einstellungen
{
  const alpha = async () => +(await page.locator('#windBody .sv-svg linearGradient stop')
    .evaluateAll(ns => Math.max(...ns.map(n => +n.getAttribute('stop-opacity')))));
  const before = await alpha();
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(120);
  (await page.locator('#setRh').inputValue()) === '85'
    ? ok('Einstellung „Feuchteschattierung ab" steht auf 85 %') : bad('setRh fehlt oder falsch');
  await page.locator('#setRh').selectOption('95');
  await page.locator('#setOk').click();
  await page.waitForTimeout(400);
  const after = await alpha();
  after < before - 0.02
    ? ok(`höhere Schwelle schattiert schwächer (${before.toFixed(2)} → ${after.toFixed(2)})`)
    : bad(`Schattierung unverändert: ${before.toFixed(2)} → ${after.toFixed(2)}`);
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(120);
  await page.locator('#setRh').selectOption('85');
  await page.locator('#setOk').click();
  await page.waitForTimeout(400);
}

// Modellhorizont begrenzt den Schieber
{
  await page.locator('#windBody .chips.models .chip:text-is("ICON-D2")').click();
  await page.waitForTimeout(700);
  const max = +(await page.locator('#windBody .hour-slider input[type=range]').getAttribute('max'));
  max === 48
    ? ok('ICON-D2 kürzt den Schieber auf +48 h') : bad(`Schiebermaximum bei ICON-D2: ${max}`);
  (await page.locator('#windBody .chips.models .chip.on').innerText()) === 'ICON-D2'
    ? ok('Modellwechsel wird angezeigt') : bad('Modellwechsel ohne Wirkung');
  await page.locator('#windBody .chips.models .chip:text-is("Auto")').click();
  await page.waitForTimeout(700);
}

// Modellkarte
for (const [sel, name] of [['Wolken hoch', 'Wolken hoch'], ['Wolken mittel', 'Wolken mittel'],
                           ['Wolken tief', 'Wolken tief'], ['Nebelrisiko', 'Nebelrisiko'],
                           ['Basis ft AGL', 'Basis']]) {
  (await page.locator(`#modelBody .fc-table th:text-is("${sel}")`).count()) === 1
    ? ok(`Zeile „${name}" vorhanden`) : bad(`Zeile „${name}" fehlt`);
}
(await page.locator('#modelBody .fc-table td.fog-2, #modelBody .fc-table td.fog-3').count()) > 0
  ? ok('Nebelzellen sind farbig') : bad('keine farbige Nebelzelle');
(await page.locator('#modelBody .ens-row').count()) === 3
  ? ok('Ensemble: drei Streubalken') : bad('Ensemble-Streubalken fehlen');
/\d+ von 20/.test(await page.locator('#modelBody .ens-note').innerText().catch(() => ''))
  ? ok('Ensemble: Trockenanteil ausgewiesen') : bad('Trockenanteil fehlt');

// GAFOR-Zeitband und Legende
const tiles = await page.locator('#tileBody .gseg').count();
tiles === 4 ? ok(`GAFOR-Zeitband mit ${tiles} Abschnitten`) : bad(`GAFOR-Abschnitte: ${tiles}`);
(await page.locator('#tileBody .gseg.now').count()) === 1
  ? ok('laufender Zeitraum ist markiert') : bad('kein laufender Zeitraum markiert');
{
  // Kopfzeile und Zeitband müssen denselben Zeitraum meinen
  const badge = (await page.locator('#areaState .badge').innerText()).trim();
  const seg = (await page.locator('#tileBody .gseg.now .gcd').innerText()).replace(/\s+/g, '');
  badge === seg
    ? ok(`Gebietskopf und Zeitband zeigen dieselbe Stufe (${badge})`)
    : bad(`Kopf zeigt ${badge}, Band ${seg}`);
}
(await page.locator('#tileBody .gseg.c').count()) === 1 &&
(await page.locator('#tileBody .gseg.m').count()) === 1
  ? ok('Abschnitte tragen die Farbe ihrer Stufe') : bad('Stufenfarben fehlen');
(await page.locator('#tileBody .gseg .gcd .g').allInnerTexts()).join('') === '48'
  ? ok('die Ziffer des Codes wird mitgezeigt (D4, M8)')
  : bad(`Ziffern: ${(await page.locator('#tileBody .gseg .gcd .g').allInnerTexts()).join(',')}`);
(await page.locator('#tileBody .gseg .gflag').count()) === 2
  ? ok('Zusätze sind am Abschnitt markiert')
  : bad(`Zusatzmarken: ${await page.locator('#tileBody .gseg .gflag').count()}`);
{
  // das Band ist deutlich flacher als die alten Kacheln
  const h = (await page.locator('#tileBody .gafor-bar').boundingBox()).height;
  h < 70 ? ok(`Zeitband ist ${Math.round(h)} px hoch`) : bad(`Zeitband zu hoch: ${Math.round(h)} px`);
  // Fusszeile zeigt zunächst den laufenden Zeitraum
  const f0 = await page.locator('#tileBody .gbar-foot').innerText();
  /jetzt/.test(f0) && /Bezugshöhe/.test(f0)
    ? ok(`Fusszeile nennt jetzt und Bezugshöhe: „${f0.replace(/\n/g, ' · ')}"`)
    : bad(`Fusszeile: ${f0}`);
  // ein anderer Abschnitt: die Fusszeile folgt
  await page.locator('#tileBody .gseg').nth(3).click();
  await page.waitForTimeout(120);
  const f1 = await page.locator('#tileBody .gbar-foot').innerText();
  /Mike/.test(f1) && /ISOL TSRA/.test(f1)
    ? ok('Antippen zeigt Werte und Zusatz des Abschnitts')
    : bad(`nach Klick: ${f1}`);
  (await page.locator('#tileBody .gseg.sel').count()) === 1
    ? ok('der gewählte Abschnitt ist hervorgehoben') : bad('keine Auswahlmarke');
  await page.locator('#tileBody .gseg.now').click();
  await page.waitForTimeout(80);
}
const legend = page.locator('#tileBody details.code-legend');
(await legend.count()) === 1 ? ok('Legende ist vorhanden') : bad('Legende fehlt');
!(await legend.evaluate(n => n.open))
  ? ok('Legende startet zugeklappt') : bad('Legende ist aufgeklappt');
!(await legend.locator('.code-table').first().isVisible())
  ? ok('zugeklappt nimmt sie keinen Platz im Textfluss ein')
  : bad('Legendeninhalt ist sichtbar, obwohl zugeklappt');
await legend.locator('summary').click();
await page.waitForTimeout(120);
(await legend.locator('.code-table tbody tr').count()) === 11
  ? ok('aufgeklappt steht die vollständige Codetabelle da')
  : bad(`Legende: ${await legend.locator('.code-table tbody tr').count()} Zeilen`);

if (shotArg > 0) {
  const p = process.argv[shotArg + 1];
  await page.locator('#gaforBody').screenshot({ path: p.replace('.png', '-gafor.png') });
  await legend.locator('summary').click();      // wieder zu
  await page.locator('#cardMetar').screenshot({ path: p.replace('.png', '-metar.png') });
}

// METAR — die eigene Kopie trägt die Karte
(await page.locator('#metarBody .metar-row').count()) >= 2
  ? ok('METAR-Karte gefüllt') : bad('METAR-Karte leer');
{
  const names = await page.locator('#metarBody .metar-name').allInnerTexts();
  const ids = await page.locator('#metarBody .metar-id').allInnerTexts();
  names.length === ids.length && names.every((n, i) => n && n !== ids[i])
    ? ok(`Platznamen im Klartext: ${names.join(' | ')}`)
    : bad(`Platznamen: ${names.join(' | ')}`);
  names.some(n => n.includes('Flughafen'))
    ? ok('Abkürzung „Arpt" wird ausgeschrieben')
    : bad(`keine Abkürzung ausgeschrieben: ${names.join(' | ')}`);
  !names.some(n => /(^|·|,)\s*DE\s*$/i.test(n))
    ? ok('das Länderkürzel DE ist gestrichen') : bad(`DE steht noch da: ${names.join(' | ')}`);
  names.some(n => /·\s*[A-Z]{2}$/.test(n))
    ? ok('Bundesland steht als Kürzel dahinter') : bad(`kein Bundesland: ${names.join(' | ')}`);
}
{
  // Kennung, Ortsname und Distanz auf einer einzigen Zeile
  const top = page.locator('#metarBody .metar-row .metar-top').first();
  const box = await top.boundingBox();
  const id = await top.locator('.metar-id').boundingBox();
  const nm = await top.locator('.metar-name').boundingBox();
  const ds = await top.locator('.metar-dist').boundingBox();
  id && nm && ds && box && box.height <= id.height + 8
    ? ok(`METAR-Kopf ist einzeilig (${Math.round(box.height)} px)`)
    : bad(`METAR-Kopf ${box && Math.round(box.height)} px hoch`);
  id && nm && ds && id.x < nm.x && nm.x < ds.x
    ? ok('Reihenfolge: Kennung, Ortsname, Distanz')
    : bad('Reihenfolge im METAR-Kopf stimmt nicht');
  ds && box && ds.x + ds.width >= box.x + box.width - 2
    ? ok('Distanz steht am rechten Zeilenrand') : bad('Distanz klebt nicht rechts');
  const arrow = await top.locator('.metar-dist span').count();
  arrow === 1 ? ok('Richtungspfeil vor der Distanz') : bad('kein Richtungspfeil');
  /vom gewählten Ort/.test(await top.locator('.metar-dist').getAttribute('title') || '')
    ? ok('Pfeil trägt Peilung und Richtung als Hinweis') : bad('kein Hinweis am Pfeil');
}

(await page.locator('#metarBody pre.raw').count()) >= 2
  ? ok('Rohmeldungen werden angezeigt') : bad('keine Rohmeldungen');
{
  const rows = page.locator('#metarBody .metar-row');
  const first = rows.first();
  const mp = first.locator('.metar-plain:not(.taf) .pl');
  (await mp.count()) === 2
    ? ok('METAR-Klartext in genau zwei Zeilen') : bad(`METAR-Klartext: ${await mp.count()} Zeilen`);
  const t1 = await mp.first().innerText();
  /Wind .*·.*Sicht .*·.*Wolken|Wind .*·.*Sicht/.test(t1)
    ? ok(`erste Zeile: „${t1}"`) : bad(`erste Zeile: ${t1}`);
  // je Zeile höchstens zwei — deshalb zeilenweise prüfen, nicht über die Karte
  const perRow = [];
  for (const r of await rows.all()) perRow.push(await r.locator('.metar-plain.taf .pl').count());
  perRow.every(n => n <= 2) && perRow.some(n => n === 2)
    ? ok(`TAF-Klartext je Platz höchstens zwei Zeilen (${perRow.join(', ')})`)
    : bad(`TAF-Klartextzeilen je Platz: ${perRow.join(', ')}`);
  const tp = rows.first().locator('.metar-plain.taf .pl');
  /Vorhersage \d+\. \d\d bis \d+\. \d\d UTC/.test(await tp.first().innerText())
    ? ok(`TAF-Gültigkeit übersetzt: „${(await tp.first().innerText()).slice(0, 60)}…"`)
    : bad(`TAF-Zeile: ${await tp.first().innerText()}`);
  const all = (await page.locator('#metarBody .metar-plain .pl').allInnerTexts()).join(' | ');
  /Regenschauer|Dunst|zeitweise/.test(all)
    ? ok('Witterungskürzel werden übersetzt (Regenschauer, Dunst, zeitweise)')
    : bad('keine übersetzten Witterungskürzel');
  !/VRB°/.test(all) ? ok('umlaufender Wind heisst „umlaufend", nicht „VRB°"') : bad('VRB° steht noch da');
}
{
  const mIdx = seen.findIndex(u => u.includes('data/dwd/metar.json'));
  const aIdx = seen.findIndex(u => u.includes('aviationweather.gov'));
  mIdx >= 0 && (aIdx < 0 || mIdx < aIdx)
    ? ok('die eigene Kopie wird vor der NOAA gefragt')
    : bad(`Reihenfolge falsch: Kopie ${mIdx}, NOAA ${aIdx}`);
}
/Kopie vor \d+ min|live von der NOAA/.test(await page.locator('#metarAge').innerText())
  ? ok(`METAR-Herkunft ausgewiesen: „${await page.locator('#metarAge').innerText()}"`)
  : bad(`METAR-Herkunft: ${await page.locator('#metarAge').innerText()}`);

// Maske ausserhalb der Gebiete
(await page.locator('.leaflet-gafor-mask-pane path').count()) >= 1
  ? ok('Maskenebene liegt auf der Karte') : bad('Maskenebene fehlt');

// Aktualisieren
await page.locator('#reloadBtn').click();
await page.waitForTimeout(120);
const spun = await page.locator('#reloadBtn.spinning, #reloadBtn.ok').count();
spun >= 1 ? ok('Aktualisieren-Knopf zeigt seinen Zustand') : bad('Knopf ohne Rückmeldung');
await page.waitForTimeout(1200);
(await page.locator('#windBody .wp-table tbody tr').count()) >= 8
  ? ok('nach dem Aktualisieren stehen die Karten wieder') : bad('Karten nach Reload leer');

// Karten-Nachladen über die Altersanzeige
await page.locator('#metarAge').click();
await page.waitForTimeout(600);
(await page.locator('#metarBody .metar-row').count()) >= 2
  ? ok('Altersanzeige lädt ihre Karte nach') : bad('Nachladen über die Altersanzeige scheitert');

// Ort ausserhalb der Abdeckung
const OUTSIDE = 'For the time being, this APP covers only Germany';
await page.evaluate(() => { location.hash = '47.3700,8.5400,9'; location.reload(); });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
(await page.locator('#areaName').innerText()).includes(OUTSIDE)
  ? ok('ausserhalb Deutschlands kommt die englische Meldung')
  : bad(`Gebietskopf: „${await page.locator('#areaName').innerText()}"`);
(await page.locator('#gaforBody').innerText()).includes(OUTSIDE)
  ? ok('die Berichtskarten sagen dasselbe') : bad('GAFOR-Karte meldet etwas anderes');
(await page.locator('#areaNum').innerText()).trim() === '—'
  ? ok('keine Gebietsnummer erfunden') : bad('Gebietsnummer trotz Ausland');

// ---- Drucken: wirklich zwei Seiten? ----
await page.goto(base + '?print=1#49.1000,9.7500,9', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3200);
{
  for (const d of await page.locator('details').all()) await d.evaluate(n => { n.open = true; });
  const pdf = await page.pdf({ format: 'A4', printBackground: true,
                               margin: { top: '9mm', bottom: '9mm', left: '8mm', right: '8mm' } });
  if (shotArg > 0) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.argv[shotArg + 1].replace('.png', '-druck.pdf'), pdf);
  }
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pages === 2) ok('Druck ergibt genau zwei A4-Seiten');
  else {
    // Bei Abweichung gleich zeigen, welcher Block den Platz frisst
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.waitForTimeout(400);
    const parts = [];
    for (const sel of ['header.topbar', '.place-bar', '.area-head', '.map-block', '#cardGafor',
                       '#cardBalloon', '#cardWind', '#cardMetar', '#cardModel', 'footer']) {
      const bx = await page.locator(sel).boundingBox().catch(() => null);
      if (bx) parts.push(`${sel} ${Math.round(bx.height / 1055 * 100)}%`);
    }
    await page.emulateMedia({ media: 'screen' });
    bad(`Druck ergibt ${pages} Seiten — Anteile: ${parts.join(', ')}`);
  }
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(120);
  !(await page.locator('.search-block').isVisible()) && !(await page.locator('.header-tools').isVisible())
    ? ok('Bedienelemente sind im Druck ausgeblendet')
    : bad('Suche oder Knöpfe stehen im Ausdruck');
  const nTiles = await page.locator('#tileBody .gseg').count();
  nTiles > 0 && (await page.locator('#tileBody .gseg').first().isVisible())
    ? ok('das GAFOR-Zeitband steht im Ausdruck')
    : bad(`Zeitband im Ausdruck: ${nTiles} Abschnitte, sichtbar ${nTiles > 0 && await page.locator('#tileBody .gseg').first().isVisible()}`);
  await page.emulateMedia({ media: 'screen' });
}

// ---- Seitenbild ----
{
  /* Geprüft wird, was die App selbst tut: Bild erzeugen und den Download
     anstossen. Ob Playwright das Download-Ereignis meldet, hängt an der
     Fenstergrösse und ist nicht Sache der App — deshalb wird der Dateiname
     am angeklickten Link abgegriffen. */
  await page.evaluate(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__dl.push(this.download);
      return orig.apply(this, arguments);
    };
  });
  await page.locator('#shareBtn').click();
  await page.waitForTimeout(120);
  await page.locator('#sharePngBtn').click();
  await page.waitForFunction(() => window.__dl.length > 0 ||
    /fehlgeschlagen/.test(document.getElementById('mapHint').textContent),
    null, { timeout: 90000 }).catch(() => {});
  const names = await page.evaluate(() => window.__dl);
  names.length && /^gaforcast_.*\.png$/.test(names[0])
    ? ok(`Seitenbild erzeugt und zum Sichern angeboten (${names[0]})`)
    : bad(`kein Seitenbild — Hinweiszeile: „${await page.locator('#mapHint').innerText()}"`);
}

// ---- Ortszeile nennt immer einen Ort, nie „Kartenmitte" ----
{
  const name = await page.locator('#placeName').innerText();
  /Testdorf/.test(name)
    ? ok(`Ortszeile zeigt den nächstgelegenen Ort („${name}")`)
    : bad(`Ortszeile: ${name}`);
  !/Kartenmitte/.test(await page.locator('.place-bar').innerText())
    ? ok('das Wort „Kartenmitte" kommt nicht mehr vor') : bad('„Kartenmitte" steht noch da');
  /\d+\.\d{4}° N/.test(await page.locator('#placeCoords').innerText())
    ? ok('Koordinaten stehen darunter') : bad('keine Koordinaten');
  // Verschieben der Karte zieht den Namen nach
  await page.evaluate(() => MAPVIEW.get().panBy([250, 250], { animate: false }));
  await page.waitForTimeout(2200);
  const after = await page.locator('#placeName').innerText();
  /Testdorf/.test(after) && after !== name
    ? ok(`nach dem Verschieben ein neuer Ort („${after}")`)
    : bad(`nach dem Verschieben: ${after} (vorher ${name})`);
}

// ---- Menüs öffnen sich auch bei gescrollter Seite ----
{
  await page.setViewportSize({ width: 430, height: 780 });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(250);
  const sy = await page.evaluate(() => Math.round(window.scrollY));
  sy > 300 ? ok(`Seite ist gescrollt (${sy} px)`) : bad(`Seite scrollt nicht (${sy} px) — Prüfung wertlos`);
  for (const [btn, menu] of [['#menuBtn', '#menu'], ['#shareBtn', '#shareMenu']]) {
    await page.locator(btn).click();
    await page.waitForTimeout(200);
    const box = await page.locator(menu).boundingBox();
    const vh = page.viewportSize().height;
    box && box.y >= -1 && box.y < vh && box.height > 20
      ? ok(`${menu} öffnet sich im Sichtfenster (y=${Math.round(box.y)})`)
      : bad(`${menu} liegt bei y=${box && Math.round(box.y)}, Fenster ist ${vh} hoch`);
    await page.locator(btn).click();
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 430, height: 3200 });
  await page.waitForTimeout(200);
}

// ---- Ortssuche zoomt hin und behält den Namen ----
await page.goto(base + '?such=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
{
  const before = await page.evaluate(() => MAPVIEW.get().getZoom());
  await page.locator('#searchInput').fill('Gladbeck');
  await page.waitForTimeout(700);
  (await page.locator('#searchResults .row').count()) >= 1
    ? ok('Ortssuche liefert einen Treffer') : bad('Suche liefert nichts');
  await page.locator('#searchResults .row').first().click();
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => MAPVIEW.get().getZoom());
  const c = await page.evaluate(() => { const p = MAPVIEW.get().getCenter(); return [p.lat, p.lng]; });
  after >= 11 && after > before
    ? ok(`Karte zoomt auf den Treffer (${before} → ${after})`)
    : bad(`Zoom nach Suche: ${before} → ${after}`);
  Math.abs(c[0] - 51.5711) < 0.01 && Math.abs(c[1] - 6.9859) < 0.01
    ? ok('Karte steht auf dem gefundenen Ort')
    : bad(`Kartenmitte: ${c.map(v => v.toFixed(4)).join(', ')}`);
  (await page.locator('#placeName').innerText()).includes('Gladbeck')
    ? ok('der gefundene Ortsname bleibt stehen')
    : bad(`Ortszeile: ${await page.locator('#placeName').innerText()}`);
}

errors.length ? bad(`JS-Fehler: ${errors.slice(0, 3).join(' | ')}`) : ok('keine JS-Fehler');

if (shotArg > 0) {
  const path = process.argv[shotArg + 1];
  // ein Blick auf die Desktop-Breite, dort steht das Höhenwind-Duo nebeneinander
  await page.setViewportSize({ width: 1280, height: 2600 });
  await page.waitForTimeout(500);
  await page.locator('#cardWind').screenshot({ path: path.replace('.png', '-wind-desktop.png') });
  await page.locator('#cardGafor').screenshot({ path: path.replace('.png', '-gafor-desktop.png') });
  await page.locator('.top-grid').screenshot({ path: path.replace('.png', '-top-desktop.png') });
  await page.setViewportSize({ width: 430, height: 3200 });
  await page.waitForTimeout(300);
  // ganz Deutschland, damit die Maske ausserhalb der Gebiete zu sehen ist
  await page.locator('#zoomDeBtn').click();
  await page.waitForTimeout(1200);
  await page.locator('.map-wrap').screenshot({ path: path.replace('.png', '-map.png') });
  await page.locator('#cardWind').screenshot({ path: path.replace('.png', '-wind.png') });
  await page.locator('#cardModel').screenshot({ path: path.replace('.png', '-model.png') });
  await page.screenshot({ path, fullPage: true });
  console.log(`  --   Bilder: ${path}`);
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen.` : '\nBrowser-Durchlauf in Ordnung.');
process.exit(fails ? 1 : 0);
