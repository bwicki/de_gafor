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
let dwdIndex = DWD_INDEX;
/* Bremse für den Nachlade-Knopf: ohne sie ist die gemockte Antwort schneller
   da als der erste Blick des Tests, und die Prüfung auf „lädt…" wird zum
   Glücksspiel. */
let dwdDelayMs = 0;
const aiCalls = [];
let aiShape = 'tool';
let aiFail = false;

const METAR_REPO = {
  generated: new Date(Date.now() - 11 * 60e3).toISOString(), via: 'awc',
  metar: JSON.parse(await readFile('test/sample-metar.json', 'utf8')),
  taf: JSON.parse(await readFile('test/sample-taf.json', 'utf8')),
};

const routeAll = async (route) => {
  const url = route.request().url();
  if (url.includes('data/dwd/metar.json')) return route.fulfill({ json: METAR_REPO });
  if (url.includes('data/dwd/index.json')) {
    if (dwdDelayMs) await new Promise(r => setTimeout(r, dwdDelayMs));
    return route.fulfill({ json: dwdIndex });
  }
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
  if (url.includes('api.anthropic.com')) {
    aiCalls.push(JSON.parse(route.request().postData() || '{}'));
    if (aiFail) return route.fulfill({ status: 401, json: { error: { message: 'Der Schlüssel wird abgelehnt (401).' } } });
    const sections = [
      { title: 'Grosswetterlage', lines: ['Eine Warmfront zieht nordostwärts ab.',
        'Rückseitig folgt feuchte, teils labile Luft.'] },
      { title: 'Ballonspezifische Gefahren', lines: ['Bodenwind bleibt bis Mittag unter 4 kt.',
        'Ab 14 UTC Böen bis 18 kt, dazu Scherung zwischen Boden und 2000 ft.',
        'Im Umkreis von 100 km ab dem Nachmittag einzelne Schauer.'] },
      { title: 'Startfenster im Vergleich', lines: ['Das Morgenfenster ist plausibel.',
        'Das Abendfenster halte ich für zu optimistisch: die Böigkeit bleibt hoch.'] },
    ];
    /* aiShape steuert, was die Attrappe zurückgibt:
       'tool'  — der Regelfall, ein erzwungener Werkzeugaufruf
       'text'  — der Rückfall: JSON im Fliesstext
       'cut'   — abgeschnitten, wie bei erschöpftem max_tokens */
    if (aiShape === 'cut') {
      return route.fulfill({ json: { stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"sections":[{"title":"Grosswetter' }] } });
    }
    if (aiShape === 'text') {
      return route.fulfill({ json: { stop_reason: 'end_turn',
        content: [{ type: 'text', text: '```json\n' + JSON.stringify({ sections }) + '\n```' }] } });
    }
    return route.fulfill({ json: { usage: { input_tokens: 3200, output_tokens: 480 },
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'lagebericht', input: { sections } }] } });
  }
  if (url.includes('tile.openstreetmap.org'))
    return route.fulfill({ status: 200, contentType: 'image/png', body: TILE });
  return route.fulfill({ status: 404, body: '' });
};
await page.route('**/*', routeAll);

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
  const models = await page.locator('#windBody .chips.models:not(.cmp) .chip').count();
  models === 8 ? ok('acht Modelle zur Wahl') : bad(`Modell-Chips: ${models}`);
  (await page.locator('#windBody .chips.models:not(.cmp) .chip.on').innerText()) === 'Auto'
    ? ok('„Auto" ist vorgewählt') : bad('kein Modell vorgewählt');
  // Vergleichsmodell: aus plus die sieben benannten Modelle
  (await page.locator('#windBody .chips.cmp .chip').count()) === 8 &&
  (await page.locator('#windBody .chips.cmp .chip.on').innerText()) === 'aus'
    ? ok('Vergleichsmodell wählbar, ab Werk aus') : bad('Vergleichsreihe fehlt');

  // Reihenfolge der Modellpillen: aufsteigend nach Vorhersagehorizont
  const horizons = await page.locator('#windBody .chips.models:not(.cmp) .chip').evaluateAll(
    ns => ns.map(n => +(/\+(\d+)\s*h/.exec(n.title || '') || [0, -1])[1]));
  horizons.every((h, i) => i === 0 || h >= horizons[i - 1])
    ? ok(`Modelle aufsteigend nach Horizont (${horizons.join(' ≤ ')})`)
    : bad(`Modellreihenfolge: ${horizons.join(', ')}`);
  horizons[0] === 48
    ? ok('kürzestes Modell (ICON-D2, 48 h) steht vorn') : bad(`erster Horizont: ${horizons[0]}`);

  // Zeitwahl: ein gemeinsamer Schieber für die ganze Seite
  (await page.locator('#windBody .chips:not(.models) .chip').count()) === 0
    ? ok('keine Stunden-Pillen mehr') : bad('Stunden-Pillen sind noch da');
  (await page.locator('#windBody .hour-slider').count()) === 0
    ? ok('kein eigener Schieber mehr in der Höhenwindkarte')
    : bad('die Höhenwindkarte hat noch einen eigenen Schieber');
  const slider = page.locator('#timeSlider');
  (await slider.count()) === 1 && await page.locator('#timeBar').isVisible()
    ? ok('gemeinsamer Zeitschieber vorhanden') : bad('kein Zeitschieber');
  (await slider.getAttribute('step')) === '1'
    ? ok('Schieber rastet in Ein-Stunden-Schritten') : bad('falsche Schrittweite');
  // die Skala ist fest, unabhängig vom Modell
  +(await slider.getAttribute('max')) === 168
    ? ok('Skala reicht immer über 168 h') : bad(`Skala: ${await slider.getAttribute('max')}`);
  const hsl = await page.locator('#timeMark').innerText();
  /^(Mo|Di|Mi|Do|Fr|Sa|So) \d{1,2}\. \w+ · \d\d:\d\d/.test(hsl)
    ? ok(`Schieber nennt Wochentag und Datum: „${hsl}"`) : bad(`Schieberbeschriftung: ${hsl}`);
  /jetzt/.test(hsl) ? ok('bei Position 0 steht „jetzt"') : bad('kein „jetzt" am Anfang');
  (await page.locator('#timeDays .ts-day').count()) >= 3
    ? ok(`${await page.locator('#timeDays .ts-day').count()} Tagesbeschriftungen über dem Schieber`)
    : bad('keine Tagesbeschriftungen');
  (await page.locator('#timeTicks .ts-tick').count()) === 85
    ? ok('Striche alle zwei Stunden über 168 h')
    : bad(`Striche: ${await page.locator('#timeTicks .ts-tick').count()}`);
  /linear-gradient/.test(await page.locator('#timeNight').evaluate(n => n.style.background))
    ? ok('Nacht ist als Verlauf hinterlegt') : bad('keine Nachtschattierung');
  {
    // der Bereich jenseits des Modellhorizonts ist abgegraut
    const left = await page.locator('#timeBeyond').evaluate(n => n.style.left);
    const pct = parseFloat(left);
    pct > 0 && pct <= 100
      ? ok(`unerreichbarer Bereich beginnt bei ${Math.round(pct)} % der Skala`)
      : bad(`ts-beyond: ${left}`);
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
    /* Tabellen werden als echte Tabellen gesetzt, nicht als Textblock in
       fester Breite — sonst verrutschen die Zahlen unter unterschiedlich
       langen Ortsnamen. Ein <pre> darf gar nicht mehr vorkommen. */
    (await page.locator('#gaforBody pre.report').count()) === 0
      ? ok('keine ASCII-Tabellen mehr im Bericht') : bad('es steht noch ein <pre> im Bericht');
    const tbl = page.locator('#gaforBody table.rt');
    (await tbl.count()) >= 1
      ? ok(`${await tbl.count()} Berichtstabelle(n) als echte Tabelle gesetzt`)
      : bad('keine Berichtstabelle');
    // Kopfzelle mit colspan: „21 UTC" steht über Wind und Temperatur
    (await page.locator('#gaforBody table.rt th[colspan="2"]').count()) >= 1
      ? ok('Kopfzellen spannen über die geteilten Spalten') : bad('kein colspan im Tabellenkopf');
    // nur die Höhenwindtabelle des eigenen Gebiets bleibt stehen
    const heads = await page.locator('#gaforBody .report-h').allInnerTexts();
    const areas = heads.filter(h => /GAFOR-Gebiete/.test(h));
    const areaId = (await page.locator('#areaNum').innerText()).trim();
    areas.length <= 1
      ? ok(`${areas.length} Höhenwindtabelle für Gebiet ${areaId} statt aller drei` +
           (areas.length ? `: „${areas[0]}"` : ''))
      : bad(`Gebietstabellen: ${areas.join(' | ')}`);
    if (areas.length === 1) {
      const list = /GAFOR-Gebiete\s+(.+)$/.exec(areas[0])[1];
      const ids = list.split(',').flatMap(p2 => {
        const r = p2.trim().match(/^(\d{2})\s*[-–]\s*(\d{2})$/);
        if (!r) return [p2.trim()];
        const o = []; for (let i = +r[1]; i <= +r[2]; i++) o.push(String(i).padStart(2, '0'));
        return o;
      });
      ids.includes(areaId)
        ? ok(`Gebiet ${areaId} kommt in der stehengebliebenen Liste vor`)
        : bad(`Gebiet ${areaId} nicht in „${list}"`);
    }
    const inv = await page.locator('#gaforBody .report-p')
      .filter({ hasText: 'Inversion' }).count();
    inv >= 1
      ? ok('der Prosaabsatz von „Inversionen" steht in der Grundschrift')
      : bad('„Inversionen" steht immer noch in fester Breite');
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
  await page.locator('#timeSlider').evaluate((n, val) => {
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
/\+4 h/.test(await page.locator('#timeMark').innerText())
  ? ok('Beschriftung folgt dem Schieber') : bad('Beschriftung folgt dem Schieber nicht');
{
  // ans obere Ende: die Marke muss mitwandern
  const left0 = (await page.locator('#timeMark').boundingBox()).x;
  const max = +(await page.locator('#timeSlider').getAttribute('max'));
  await setSlider(max);
  const lb = await page.locator('#timeMark').boundingBox();
  const tr = await page.locator('#timeScale').boundingBox();
  lb.x > left0 + 40 && lb.x + lb.width <= tr.x + tr.width + 2
    ? ok('am Ende steht die Marke rechts und bleibt in der Spur')
    : bad(`Marke am Ende: x=${Math.round(lb.x)} (Start ${Math.round(left0)}), Spur bis ${Math.round(tr.x + tr.width)}`);
  const txt = await page.locator('#timeMark').innerText();
  /^(Mo|Di|Mi|Do|Fr|Sa|So) \d{1,2}\. \w+ · \d\d:\d\d/.test(txt) && /\+\d+ h$/.test(txt)
    ? ok(`spätester Zeitpunkt vollständig datiert: „${txt}"`) : bad(`Endbeschriftung: ${txt}`);
  // über die Daten hinaus lässt sich der Griff nicht ziehen
  +(await page.locator('#timeSlider').inputValue()) <= H - 1
    ? ok('der Griff bleibt innerhalb der vorhandenen Daten')
    : bad(`Griff auf ${await page.locator('#timeSlider').inputValue()}`);
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
  await page.locator('#windBody .chips.models:not(.cmp) .chip:text-is("ICON-D2")').click();
  await page.waitForTimeout(700);
  const pct = parseFloat(await page.locator('#timeBeyond').evaluate(n => n.style.left));
  Math.abs(pct - (48 / 168) * 100) < 1
    ? ok(`ICON-D2 graut alles ab +48 h ab (${Math.round(pct)} % der Skala)`)
    : bad(`Grenze bei ICON-D2: ${pct} %`);
  await setSlider(60);
  +(await page.locator('#timeSlider').inputValue()) === 48
    ? ok('der Griff rastet am Modellhorizont ein')
    : bad(`Griff bei ICON-D2: ${await page.locator('#timeSlider').inputValue()}`);
  (await page.locator('#windBody .chips.models:not(.cmp) .chip.on').innerText()) === 'ICON-D2'
    ? ok('Modellwechsel wird angezeigt') : bad('Modellwechsel ohne Wirkung');
  await page.locator('#windBody .chips.models:not(.cmp) .chip:text-is("Auto")').click();
  await page.waitForTimeout(700);
  await page.locator('#timeNow').click();          // zurück auf jetzt für die Folgeprüfungen
  await page.waitForTimeout(300);
}

// Startfenster
{
  const strip = page.locator('#flyBody .fly-strip .fly-cell');
  (await strip.count()) > 24
    ? ok(`Startfenster: ${await strip.count()} Stundenzellen`)
    : bad(`Startfenster-Zellen: ${await strip.count()}`);
  const cls = await strip.evaluateAll(ns => ns.map(n => n.className));
  cls.some(c => /\bok\b/.test(c)) && cls.some(c => /\bno\b/.test(c))
    ? ok('es gibt fahrbare und nicht fahrbare Stunden') : bad('alle Stunden gleich bewertet');
  (await page.locator('#flyBody .fly-cell.sel').count()) === 1
    ? ok('die gewählte Stunde ist im Streifen markiert') : bad('keine Markierung im Streifen');
  const head = await page.locator('#flyBody .fly-head').innerText();
  /(fahrbar|grenzwertig|nein)/.test(head) && /^(Mo|Di|Mi|Do|Fr|Sa|So)/m.test(head)
    ? ok(`Kopfzeile nennt Urteil und Zeitpunkt: „${head.replace(/\n/g, ' · ').slice(0, 70)}…"`)
    : bad(`Startfensterkopf: ${head}`);
  // nachts muss die Bewertung „nein" heissen — die Dämmerung ist die harte Grenze
  const night = await page.locator('#flyBody .fly-cell').evaluateAll(ns =>
    ns.map(n => ({ t: n.title, c: n.className }))
      .filter(x => /· (0[0-2]|2[2-3]):00/.test(x.t)));
  night.length === 0 || night.every(x => /\bno\b/.test(x.c))
    ? ok(`${night.length} Nachtstunden, alle als „nein" bewertet`)
    : bad(`Nachtstunden falsch bewertet: ${night.slice(0, 2).map(x => x.t).join(' | ')}`);
  // ein Klick in den Streifen bewegt den gemeinsamen Schieber
  const before = await page.locator('#timeSlider').inputValue();
  await page.locator('#flyBody .fly-cell').nth(6).click();
  await page.waitForTimeout(300);
  const after = await page.locator('#timeSlider').inputValue();
  after !== before && after === '6'
    ? ok('Klick in den Streifen setzt den Zeitschieber') : bad(`Schieber: ${before} → ${after}`);
  await page.locator('#timeNow').click();
  await page.waitForTimeout(300);
}

// Startfenster-Schwellen in den Einstellungen
{
  const lane = page.locator('#flyBody .fly-lane .fly-bar');
  const n0 = await lane.count();
  n0 >= 1 ? ok(`${n0} fahrbare Fenster als Balken unter dem Streifen`)
          : bad('keine Fensterbalken');
  {
    const b0 = await lane.first().boundingBox();
    const strip = await page.locator('#flyBody .fly-strip').boundingBox();
    const cells = await page.locator('#flyBody .fly-cell').count();
    const firstOk = await page.locator('#flyBody .fly-cell.ok').first().boundingBox();
    b0 && strip && firstOk && Math.abs(b0.x - firstOk.x) < strip.width / cells + 3
      ? ok('der erste Balken steht über der ersten fahrbaren Stunde')
      : bad(`Balken x=${b0 && Math.round(b0.x)}, erste grüne Zelle x=${firstOk && Math.round(firstOk.x)}`);
  }
  (await page.locator('#flyBody .fly-win').count()) === 0
    ? ok('keine Kästchenliste mehr') : bad('die alte Fensterliste steht noch da');

  const green = () => page.locator('#flyBody .fly-cell.ok').count();
  const g0 = await green();
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(150);
  (await page.locator('#flyWind1').inputValue()) !== ''
    ? ok(`Schwellen stehen im Dialog (Bodenwind grenzwertig ab ${await page.locator('#flyWind1').inputValue()})`)
    : bad('keine Startfensterschwellen im Dialog');
  await page.locator('#flyWind1').fill('0.5');
  await page.locator('#flyWind2').fill('1');
  await page.locator('#setOk').click();
  await page.waitForTimeout(600);
  const g1 = await green();
  g1 < g0
    ? ok(`strengere Windschwelle lässt ${g1} statt ${g0} fahrbare Stunden übrig`)
    : bad(`Schwelle wirkt nicht: ${g0} → ${g1}`);

  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#flyReset').click();
  await page.locator('#setOk').click();
  await page.waitForTimeout(600);
  (await green()) === g0
    ? ok('„Vorgaben zurücksetzen" stellt den alten Stand her') : bad('Zurücksetzen wirkt nicht');
}

// Definitionen unter dem GAFOR-Band
{
  const defs = page.locator('#tileBody .gdef');
  const segs = await page.locator('#tileBody .gseg').count();
  (await defs.count()) === segs
    ? ok(`je Abschnitt ein Kästchen mit der Stufendefinition (${segs})`)
    : bad(`Definitionen: ${await defs.count()} zu ${segs} Abschnitten`);
  const txt = await defs.first().innerText();
  /km/.test(txt) && /ft/.test(txt)
    ? ok(`Definition nennt Sicht und Untergrenze: „${txt.replace(/\n/g, ' · ')}"`)
    : bad(`Definitionstext: ${txt}`);
  const s0 = await page.locator('#tileBody .gseg').first().boundingBox();
  const d0 = await defs.first().boundingBox();
  s0 && d0 && Math.abs(s0.x - d0.x) < 3 && d0.y > s0.y
    ? ok('die Definition steht bündig unter ihrem Abschnitt')
    : bad('Definition ist nicht ausgerichtet');
}

// Vergleichsmodell im Stüve
{
  await page.locator('#windBody .chips.cmp .chip:text-is("ICON-D2")').click();
  await page.waitForTimeout(900);
  const cmp = await page.locator('#windBody .sv-svg .sv-cmp').count();
  cmp >= 2
    ? ok(`Vergleichsmodell gestrichelt eingezeichnet (${cmp} Kurven)`)
    : bad(`Vergleichskurven: ${cmp}`);
  /ICON-D2/.test(await page.locator('#windBody .sv-cmplab').textContent().catch(() => ''))
    ? ok('das Vergleichsmodell ist am Diagramm benannt') : bad('keine Beschriftung des Vergleichs');
  await page.locator('#windBody .chips.cmp .chip:text-is("aus")').click();
  await page.waitForTimeout(900);
  (await page.locator('#windBody .sv-svg .sv-cmp').count()) === 0
    ? ok('„aus" nimmt den Vergleich wieder weg') : bad('Vergleich lässt sich nicht abschalten');
}

// Merkorte als Nadeln auf der Karte
{
  await page.locator('#savePlaceBtn').click();
  await page.waitForTimeout(400);
  (await page.locator('.leaflet-pane path.fav-pin').count()) >= 1
    ? ok('gespeicherter Ort erscheint als Nadel auf der Karte')
    : bad('keine Nadel für den gespeicherten Ort');
}

// Warnhinweis bei abgelaufenem Bulletin
{
  (await page.locator('#tileBody .stale').count()) === 0
    ? ok('bei frischen Daten steht kein Warnhinweis') : bad('Warnhinweis ohne Anlass');

  /* Dasselbe Bulletin, aber von gestern ausgegeben: die Codereihe sieht
     unverändert aus — genau deshalb muss der Hinweis erscheinen. */
  const old = JSON.parse(JSON.stringify(DWD_INDEX));
  old.gafor.EDZM.issued = new Date(Date.now() - 26 * 3600e3).toISOString();
  dwdIndex = old;
  await page.locator('#reloadBtn').click();
  await page.waitForTimeout(1200);
  const st = page.locator('#tileBody .stale');
  (await st.count()) === 1
    ? ok(`abgelaufenes Bulletin wird gemeldet: „${(await st.innerText()).replace(/\n/g, ' ').slice(0, 80)}…"`)
    : bad('kein Warnhinweis bei abgelaufenem Bulletin');
  (await page.locator('#tileBody .stale.hard').count()) === 1
    ? ok('abgelaufen wird als harter Fall gekennzeichnet') : bad('Warnstufe fehlt');
  /* Der Knopf im Hinweis muss sagen, dass er etwas tut — und was dabei
     herauskam. Der DWD hat oft nichts Neues; ohne Rückmeldung sah es aus,
     als täte der Knopf nichts. */
  {
    const btn = page.locator('#tileBody .stale .btn');
    dwdDelayMs = 600;
    const p1 = btn.click();
    await page.waitForTimeout(150);
    const during = await btn.innerText().catch(() => '');
    /lädt/.test(during) ? ok(`der Knopf zeigt seinen Zustand („${during}")`)
                        : bad(`Knopfbeschriftung beim Laden: ${during}`);
    await p1.catch(() => {});
    await page.waitForTimeout(1600);
    const note = await page.locator('#tileBody .stale .sn').innerText().catch(() => '');
    /unverändert/.test(note)
      ? ok(`unveränderter Stand wird ausdrücklich gemeldet: „${note}"`)
      : bad(`keine Rückmeldung nach dem Laden: ${note}`);
    (await page.locator('#tileBody .stale .btn').innerText()) === 'neu laden'
      ? ok('danach ist der Knopf wieder bedienbar') : bad('Knopf bleibt im Ladezustand');
    dwdDelayMs = 0;
  }

  /* Zweiter Fall, und der wichtigere: nicht das Bulletin ist alt, sondern die
     Kopie im Repo steht still. „Neu laden" kann dann nichts ausrichten — die
     App darf dwd.de nicht selbst abrufen. Der Hinweis muss das sagen, statt
     dem DWD die Untätigkeit anzuhängen. */
  {
    const stuck = JSON.parse(JSON.stringify(DWD_INDEX));
    stuck.generated = new Date(Date.now() - 4 * 3600e3).toISOString();
    stuck.gafor.EDZM.issued = new Date(Date.now() - 26 * 3600e3).toISOString();
    dwdIndex = stuck;
    await page.locator('#reloadBtn').click();
    await page.waitForTimeout(1400);
    const html = await page.locator('#tileBody .stale').innerHTML().catch(() => '');
    /Kopie im Repo/.test(html) && /DWD-Berichte holen/.test(html)
      ? ok('stehengebliebene Kopie wird als Ursache benannt, nicht der DWD')
      : bad(`Hinweis nennt die Ursache nicht: ${html.replace(/<[^>]+>/g, ' ').slice(0, 90)}`);
    /\/actions/.test(html)
      ? ok('und verlinkt den Actions-Tab') : bad('kein Weg zum Actions-Tab');

    await page.locator('#tileBody .stale .btn').click();
    await page.waitForTimeout(1400);
    const note = await page.locator('#tileBody .stale .sn').innerText().catch(() => '');
    /Kopie im Repo ist dieselbe/.test(note) && !/DWD-Stand ist unverändert/.test(note)
      ? ok('nach dem Laden heisst es „Kopie unverändert", nicht „DWD unverändert"')
      : bad(`Rückmeldung bei stehender Kopie: ${note}`);
  }

  dwdIndex = DWD_INDEX;
  await page.locator('#reloadBtn').click();
  await page.waitForTimeout(1200);
  (await page.locator('#tileBody .stale').count()) === 0
    ? ok('mit frischen Daten verschwindet der Hinweis wieder') : bad('Hinweis bleibt hängen');
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

// ---- Kurzanalyse durch Claude ----------------------------------------------
// Zurück auf den Vorgabeort: die Beispiel-METAR liegen alle im Süden, und der
// Lagebericht soll den Umkreis wirklich enthalten.
await page.goto(base + '?ki=1#49.1000,9.7500,9', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
(await page.locator('#metarBody .metar-row').count()) >= 2
  ? ok('für die Kurzanalyse liegen METAR im Umkreis vor')
  : bad('keine METAR im Umkreis — der Lagebericht wäre unvollständig');
{
  // ohne Schlüssel: die Karte erklärt sich und ruft nichts ab
  (await page.locator('#aiBody').innerText()).includes('eigenen Anthropic-Schlüssel')
    ? ok('ohne Schlüssel erklärt die Kurzanalyse, was ihr fehlt')
    : bad(`Kurzanalyse ohne Schlüssel: ${(await page.locator('#aiBody').innerText()).slice(0, 60)}`);
  aiCalls.length === 0 ? ok('und ruft nichts ab') : bad('es wurde ohne Schlüssel abgerufen');
  await page.locator('#cardAi').evaluate(n => n.classList.contains('empty'))
    ? ok('die leere Karte ist als leer gekennzeichnet (fällt im Druck weg)')
    : bad('leere Karte nicht gekennzeichnet');
  await page.locator('#aiBtn').isHidden()
    ? ok('ohne Schlüssel steht kein Knopf da, der nichts täte')
    : bad('der Knopf steht da, obwohl kein Schlüssel hinterlegt ist');

  // Der Knopf gehört in die Kopfzeile, rechts vom Titel
  await page.locator('#cardAi .card-head #aiBtn').count() === 1
    ? ok('der Knopf sitzt in der Kopfzeile der Karte')
    : bad('der Knopf steht nicht in der Kopfzeile');
  /* textContent, nicht innerText: die Kopfzeile setzt den Titel per CSS in
     Grossbuchstaben, und innerText liefert das Gerenderte. */
  (await page.locator('#cardAi .section-title').textContent()).trim() === 'KI-Kurzanalyse'
    ? ok('die Karte heisst KI-Kurzanalyse')
    : bad(`Titel: ${await page.locator('#cardAi .section-title').textContent()}`);

  // Schlüssel eintragen
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#setAiKey').fill('sk-ant-testschluessel-0000000000');
  await page.locator('#setOk').click();
  await page.waitForTimeout(400);
  (await page.locator('#aiBtn').innerText()).includes('Analyse anfordern')
    ? ok('mit Schlüssel steht der Knopf da') : bad('kein Knopf nach dem Eintragen');

  // anfordern
  await page.locator('#aiBtn').click();
  await page.waitForTimeout(1200);
  aiCalls.length === 1 ? ok('genau ein Abruf') : bad(`Abrufe: ${aiCalls.length}`);
  {
    const c = aiCalls[0];
    c.model === 'claude-sonnet-5' ? ok(`Modell ${c.model}`) : bad(`Modell: ${c.model}`);
    /* `temperature` lehnen die neueren Modelle mit 400 ab — der Parameter darf
       nicht mitgehen, sonst kommt nie eine Analyse zurück. */
    !('temperature' in c) ? ok('kein abgelehnter temperature-Parameter im Abruf')
                          : bad(`temperature: ${c.temperature} geht mit`);
    /* Die Antwort kommt über ein erzwungenes Werkzeug, nicht als Fliesstext:
       nur so kann sie nicht mehr „unlesbar" zurückkommen. */
    c.tools && c.tools[0] && c.tools[0].name === 'lagebericht' &&
    c.tool_choice && c.tool_choice.type === 'tool' && c.tool_choice.name === 'lagebericht'
      ? ok('die Antwort wird über das Werkzeug lagebericht erzwungen')
      : bad(`tool_choice: ${JSON.stringify(c.tool_choice)}`);
    c.max_tokens >= 4000 ? ok(`max_tokens ${c.max_tokens} — Platz für 24 Zeilen`)
                         : bad(`max_tokens zu knapp: ${c.max_tokens}`);
    const txt = c.messages[0].content;
    {
      const want = ['STUNDENRASTER', 'HÖHENPROFIL', 'STARTFENSTER',
                    'BEOBACHTUNGEN IM UMKREIS', 'DÄMMERUNG'];
      const miss = want.filter(k => !txt.includes(k));
      miss.length === 0
        ? ok('der Lagebericht enthält Raster, Profil, Umkreis, Dämmerung und Startfenster')
        : bad(`im Lagebericht fehlt: ${miss.join(', ')}`);
    }
    !/FLUGWETTERÜBERSICHT/.test(txt)
      ? ok('der DWD-Fliesstext geht ab Werk NICHT mit')
      : bad('der DWD-Text wird ungefragt verschickt');
    /Grosswetterlage/.test(c.system) && /24 Zeilen/.test(c.system)
      ? ok('der Auftrag nennt die drei Abschnitte und die Zeilengrenze')
      : bad('der Auftrag ist unvollständig');
  }
  {
    const heads = await page.locator('#aiBody .ai-h').allInnerTexts();
    heads.length === 3 && heads[0] === 'Grosswetterlage'
      ? ok(`drei Abschnitte: ${heads.join(' · ')}`) : bad(`Abschnitte: ${heads.join(' | ')}`);
    const lines = await page.locator('#aiBody .ai-lines li').count();
    lines > 0 && lines <= 24 ? ok(`${lines} Zeilen, höchstens 24`) : bad(`Zeilen: ${lines}`);
    /Startfenster/.test(heads[2]) ? ok('der dritte Abschnitt prüft die Startfenster')
                                  : bad('kein Startfenster-Abschnitt');
    !(await page.locator('#cardAi').evaluate(n => n.classList.contains('empty')))
      ? ok('mit Inhalt zählt die Karte nicht mehr als leer') : bad('Karte gilt noch als leer');
    /Sonnet 5/.test(await page.locator('#aiAge').innerText())
      ? ok('die Kopfzeile nennt Modell und Zeitpunkt') : bad('Kopfzeile der Analyse leer');
  }

  // Sitz im Raster: rechte Spalte, direkt unter der Modellprognose
  {
    await page.setViewportSize({ width: 1280, height: 2600 });
    await page.waitForTimeout(400);
    const mo = await page.locator('#cardModel').boundingBox();
    const ai = await page.locator('#cardAi').boundingBox();
    const me = await page.locator('#cardMetar').boundingBox();
    Math.abs(ai.x - mo.x) < 2 && ai.x > me.x
      ? ok('die Kurzanalyse steht in der rechten Spalte, bündig zur Modellprognose')
      : bad(`x: METAR ${Math.round(me.x)}, Modell ${Math.round(mo.x)}, KI ${Math.round(ai.x)}`);
    const gap = ai.y - (mo.y + mo.height);
    gap >= 0 && gap < 24
      ? ok(`und direkt darunter (${Math.round(gap)} px Abstand)`)
      : bad(`Abstand zur Modellprognose: ${Math.round(gap)} px`);
    Math.abs(ai.width - mo.width) < 2
      ? ok('beide Karten sind gleich breit') : bad('die Breiten weichen ab');
    const head = await page.locator('#cardAi .card-head').boundingBox();
    const btn = await page.locator('#aiBtn').boundingBox();
    const ttl = await page.locator('#cardAi .section-title').boundingBox();
    btn.x > ttl.x + ttl.width && btn.x + btn.width <= head.x + head.width + 1
      ? ok('der Knopf steht rechts vom Titel, innerhalb der Kopfzeile')
      : bad(`Knopf bei x=${Math.round(btn.x)}, Kopfzeile bis ${Math.round(head.x + head.width)}`);
    await page.setViewportSize({ width: 430, height: 3200 });
    await page.waitForTimeout(300);
  }

  // DWD-Text zuschalten
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#setAiDwd').selectOption('1');
  await page.locator('#setOk').click();
  await page.waitForTimeout(400);
  await page.locator('#aiBtn').click();
  await page.waitForTimeout(1200);
  /FLUGWETTERÜBERSICHT/.test(aiCalls[aiCalls.length - 1].messages[0].content)
    ? ok('eingeschaltet geht der DWD-Text mit') : bad('der Schalter wirkt nicht');

  /* Rückfall: liefert ein Modell doch Fliesstext statt eines Werkzeugaufrufs,
     wird das JSON daraus geholt — samt Code-Zaun. */
  aiShape = 'text';
  await page.locator('#aiBtn').click();
  await page.waitForTimeout(1400);
  (await page.locator('#aiBody .ai-h').count()) === 3
    ? ok('JSON im Fliesstext wird als Rückfall trotzdem gelesen')
    : bad(`Rückfall auf Fliesstext scheitert: ${(await page.locator('#aiBody').innerText()).slice(0, 80)}`);

  /* Abgeschnittene Antwort: die Meldung muss die Ursache nennen, nicht bloss
     „liess sich nicht lesen" — daran ist niemand weitergekommen. */
  aiShape = 'cut';
  await page.locator('#aiBtn').click();
  await page.waitForTimeout(1400);
  /abgeschnitten|max_tokens/.test(await page.locator('#aiBody').innerText())
    ? ok('eine abgeschnittene Antwort wird als solche gemeldet')
    : bad(`Meldung bei Abbruch: ${(await page.locator('#aiBody').innerText()).slice(0, 90)}`);
  aiShape = 'tool';

  // Fehler werden gezeigt, nicht verschluckt
  aiFail = true;
  await page.locator('#aiBtn').click();
  await page.waitForTimeout(1200);
  /401/.test(await page.locator('#aiBody').innerText())
    ? ok('ein abgelehnter Schlüssel wird im Klartext gemeldet')
    : bad(`Fehlermeldung: ${(await page.locator('#aiBody').innerText()).slice(0, 80)}`);
  aiFail = false;

  // Schlüssel wieder entfernen, damit die Folgeprüfungen sauber laufen
  await page.locator('#menuBtn').click();
  await page.locator('#mSettingsBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#setAiKey').fill('');
  await page.locator('#setAiDwd').selectOption('0');
  await page.locator('#setOk').click();
  await page.waitForTimeout(400);
}

// ---- Gastzugang über einen geteilten Link ----------------------------------
{
  // Link im laufenden Fenster erzeugen
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'],
                                        { origin: base.replace(/\/$/, '') });
  await page.locator('#shareBtn').click();
  await page.locator('#shareLinkBtn').click();
  await page.waitForTimeout(300);
  const link = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  /#[\d.]+,[\d.]+,\d+;g=/.test(link)
    ? ok(`geteilter Link trägt einen Gastzettel: …${link.slice(-24)}`)
    : bad(`Linkform: ${link}`);

  // frischer Kontext: niemand hat hier je ein Kennwort eingegeben
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 2200 } });
  const gp = await ctx.newPage();
  const gerr = [];
  gp.on('pageerror', e => gerr.push(String(e)));
  await gp.route('**/*', routeAll);

  /* Achtung: ein blosser Fragmentwechsel lädt das Dokument nicht neu — jede
     Prüfung braucht deshalb eine eigene Adresse. */
  // ohne Zettel: die Sperre steht
  await gp.goto(base + '?a=1#49.1000,9.7500,9', { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(400);
  (await gp.locator('#gate').count()) === 1
    ? ok('ohne Zettel fragt die App den Fremden nach dem Kennwort')
    : bad('die Sperre fehlt im fremden Browser');

  // mit Zettel: offen, aber ortsfest
  const guestUrl = link.replace(/^[^#]*/, base + '?b=1');
  await gp.goto(guestUrl, { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(1500);
  (await gp.locator('#gate').count()) === 0
    ? ok('mit Zettel öffnet sich die Seite ohne Kennwort')
    : bad(`Gastzettel öffnet nicht (${guestUrl.slice(guestUrl.indexOf('#'))}) — Fehler: ${gerr.slice(0,2)} — hash: ${await gp.evaluate(() => location.hash)}`);
  (await gp.locator('#searchBlock .guest-note').count()) === 1
    ? ok('an der Ortswahl steht, dass der Ort festliegt') : bad('kein Hinweis an der Ortswahl');
  /noch \d+ min/.test(await gp.locator('#guestRest').innerText())
    ? ok(`die Restzeit steht dabei (${await gp.locator('#guestRest').innerText()})`)
    : bad('keine Restzeit');
  !(await gp.locator('#searchInput').isVisible()) &&
  (await gp.locator('#gpsBtn').count()) === 0 &&
  (await gp.locator('#savePlaceBtn').count()) === 0 &&
  (await gp.locator('#mLockBtn').count()) === 0
    ? ok('Suche, Standort, Merken und „Sperren" sind weg')
    : bad('die Ortswahl ist noch bedienbar');
  await gp.evaluate(() => MAPVIEW.get().dragging.enabled()) === false
    ? ok('die Karte lässt sich nicht mehr verschieben') : bad('die Karte ist noch beweglich');

  // Wetter darf er bedienen
  (await gp.locator('#timeSlider').count()) === 1 &&
  (await gp.locator('#windBody .chips.models:not(.cmp) .chip').count()) === 8
    ? ok('Zeitschieber und Modellwahl stehen dem Gast offen') : bad('Gast kann kein Wetter wählen');
  await gp.locator('#windBody .chips.models:not(.cmp) .chip:text-is("ICON-D2")').click();
  await gp.waitForTimeout(900);
  (await gp.locator('#windBody .chips.models:not(.cmp) .chip.on').innerText()) === 'ICON-D2'
    ? ok('der Gast kann das Modell wechseln') : bad('Modellwechsel geht nicht');
  await gp.evaluate(() => {
    const s2 = document.getElementById('timeSlider');
    s2.value = '5'; s2.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await gp.waitForTimeout(400);
  /\+5 h/.test(await gp.locator('#timeMark').innerText())
    ? ok('der Gast kann den Zeitpunkt verschieben') : bad('Zeitschieber reagiert nicht');
  // …aber der Ort bleibt, wo er ist
  const before2 = await gp.locator('#placeCoords').innerText();
  await gp.evaluate(() => MAPVIEW.get().panBy([200, 120], { animate: false }));
  await gp.waitForTimeout(700);
  (await gp.locator('#placeCoords').innerText()) === before2
    ? ok('auch ein verschobener Kartenausschnitt ändert den Ort nicht')
    : bad('der Ort ist verrutscht');

  // abgelaufener Zettel
  const stale = link.replace(/^[^#]*/, base).replace(/;g=.*$/, '') + ';g=' + await gp.evaluate(() => {
    // denselben Zettel mit Ablauf in der Vergangenheit bauen
    const f = (str) => { let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return h.toString(16).padStart(8, '0'); };
    const body = ['49.1000', '9.7500', 9, Date.now() - 1000].join('~');
    const raw = `${body}~${f(body + '1234')}`;
    return btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  await gp.goto(stale.replace(base, base + '?c=1'), { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(500);
  (await gp.locator('#gate').count()) === 1
    ? ok('ein abgelaufener Zettel öffnet nichts mehr') : bad('abgelaufener Zettel öffnet trotzdem');

  // verfälschter Zettel
  await gp.goto(link.replace(/^[^#]*/, base + '?d=1').replace(/;g=.{6}/, ';g=XXXXXX'),
                { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(500);
  (await gp.locator('#gate').count()) === 1
    ? ok('ein verfälschter Zettel öffnet nichts') : bad('verfälschter Zettel öffnet');

  gerr.length ? bad(`JS-Fehler im Gastfenster: ${gerr.slice(0, 2).join(' | ')}`)
              : ok('keine JS-Fehler im Gastfenster');
  await ctx.close();
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
  await page.locator('#timeBar').screenshot({ path: path.replace('.png', '-time.png') });
  await page.locator('#cardFly').screenshot({ path: path.replace('.png', '-fly.png') });
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
