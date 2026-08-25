#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * GaforCast — DWD fetcher.
 *
 * Runs in GitHub Actions, not in the browser: dwd.de sends no CORS headers, so
 * the app cannot read those pages itself. This script fetches the free DWD
 * "Luftsportberichte" (GAFOR / Flugwetterübersicht and the balloon area
 * forecasts), parses them and writes:
 *
 *   data/dwd/index.json        what the app reads
 *   data/dwd/raw/<key>.txt     the plain text of every bulletin, committed too
 *   data/dwd/raw/_links.txt    every link found on the hub pages — this is how
 *                              the per-Bereich URLs get discovered
 *
 * The DWD table looks like this:
 *
 *   GAFOR Bereich LBZ Hamburg 25.08.2026
 *   Gebiet  Name  15-17 UTC  17-19 UTC  19-21 UTC
 *   00  Deutsche Bucht  C  C  C
 *   10  Weser-Leine-Bergland  C  C  O ISOL RA
 *
 * Design rule: never fail the build. Anything that goes wrong lands in
 * index.json → errors[] and the app shows the bulletin text unparsed.
 * --------------------------------------------------------------------------- */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT_DIR = 'data/dwd';
const UA = 'GaforCast/1.0 (static site data fetcher)';
const TIMEOUT_MS = 25000;

const BASE_GAFOR = 'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/';
const BASE_BALLOON = 'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/gebietsvorhersagen_ballonsport/';

const HUB = {
  gafor: BASE_GAFOR + 'fbeu40_node.html',
  balloon: BASE_BALLOON + 'node_uebersicht.html',
};

/* The five GAFOR-Bereiche have their own pages. The hub only ever shows one of
   them, and it links the others through the clickable map rather than plain
   links, so they are addressed directly. Unknown codes simply 404 and are
   reported once in errors[]. */
const GAFOR_PAGES = ['edzb', 'edze', 'edzf', 'edzh', 'edzm', 'edzl', 'edzs', 'edzo']
  .map(o => BASE_GAFOR + `fbeu40_${o}_node.html`);

const errors = [];
const note = (product, url, message) => {
  errors.push({ product, url, message });
  console.warn(`! ${product} ${url} — ${message}`);
};

// ---------------------------------------------------------------- fetching
async function get(url) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'de' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const head = buf.subarray(0, 2048).toString('latin1');
    const cs = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    return buf.toString(/iso-8859|latin/i.test(cs) ? 'latin1' : 'utf8');
  } finally { clearTimeout(to); }
}

// ---------------------------------------------------------------- html → text
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
              auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
              szlig: 'ß', deg: '°', ndash: '–', mdash: '—', shy: '' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&(\w+);/g, (m, n) => (n in ENT ? ENT[n] : m));
}

function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|pre|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}

/** Drop the navigation chrome that surrounds every dwd.de page. */
function stripChrome(text) {
  const lines = text.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^(Startseite|Breadcrumb|Fachnutzer|Luftfahrt|Flugwetterprodukte|Gebietsvorhersagen|GAFOR Deutschland|Servicemenü|Suche)\b/i.test(lines[i].trim())) {
      start = i + 1;
    }
  }
  const out = lines.slice(start);
  const stop = out.findIndex(l => /^(Diese Seite|Stand:|Zusatzinformationen|Nach oben|Impressum|Datenschutz)\b/i.test(l.trim()));
  return (stop > 0 ? out.slice(0, stop) : out).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function bulletinText(html) {
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map(m => htmlToText(m[1]));
  const body = pres.filter(t => t.length > 60).join('\n\n');
  if (body.length > 60) return body;
  for (const re of [
    /<div[^>]+class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ]) {
    const m = html.match(re);
    if (m) { const t = htmlToText(m[1]); if (t.length > 120) return t; }
  }
  return htmlToText(html);
}

function links(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/(?:href|src|data-url)="([^"#]+)"/gi)) {
    try { out.add(new URL(decode(m[1]), base).href); } catch { /* skip */ }
  }
  return [...out];
}

// ---------------------------------------------------------------- parsing
/** "GAFOR Bereich LBZ Hamburg 25.08.2026" → title and Bereich. */
function headline(text) {
  const cands = [...text.matchAll(/^(GAFOR[^\n]*?(?:Bereich|Einstufung)[^\n]*)$/gim)].map(m => m[1].trim());
  if (!cands.length) return { title: '', bereich: '', date: null };
  // the page prints the heading twice; take the one that carries the date
  const line = cands.find(l => /\d{2}\.\d{2}\.\d{4}/.test(l)) || cands[0];
  const d = line.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const bereich = (line.match(/(?:Bereich|Einstufung)\s+(.+?)(?:\s+\d{2}\.\d{2}\.\d{4})?$/i) || [])[1] || '';
  return {
    title: line,
    bereich: bereich.trim(),
    date: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
  };
}

/** "Gebiet  Name  15-17 UTC  17-19 UTC  19-21 UTC" → ["15-17", "17-19", "19-21"] */
function periodsFrom(text) {
  const head = text.match(/^\s*Gebiet\b[^\n]*$/im);
  const line = head ? head[0] : text;
  const p = [...line.matchAll(/\b(\d{2})\s*-\s*(\d{2})\b/g)].map(m => `${m[1]}-${m[2]}`);
  if (p.length >= 2) return p;
  const q = [...text.matchAll(/\b(\d{2})\s*-\s*(\d{2})\s*UTC/gi)].map(m => `${m[1]}-${m[2]}`);
  return q.length >= 2 ? [...new Set(q)] : [];
}

const CODE = /^[CODMX]$/;

/**
 * One table row per area:
 *   "00  Deutsche Bucht  C  C  C"
 *   "10  Weser-Leine-Bergland  C  C  O ISOL RA"
 * Returns { "00": { codes: [...], name, remark } }.
 */
function areasFrom(text, nPeriods) {
  const areas = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(\d{2})\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const tokens = m[2].split(/\s+/);

    // the codes are the trailing run of single C/O/D/M/X letters, the name is
    // everything before the first of them
    let first = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (!CODE.test(tokens[i])) continue;
      let run = 0;
      for (let j = i; j < tokens.length && CODE.test(tokens[j]); j++) run++;
      if (run >= 2 || (nPeriods === 1 && run >= 1)) { first = i; break; }
    }
    if (first < 0) continue;

    const codes = [];
    let k = first;
    while (k < tokens.length && CODE.test(tokens[k]) && (!nPeriods || codes.length < nPeriods)) {
      codes.push(tokens[k]); k++;
    }
    if (codes.length < 1) continue;
    const name = tokens.slice(0, first).join(' ').trim();
    const remark = tokens.slice(k).join(' ').trim();
    if (!areas[id]) areas[id] = { codes, name, remark: remark || undefined };
  }
  return areas;
}

/** Issue time: the date from the headline plus the start of the first period. */
function issuedFrom(text, hl, periods) {
  const explicit = text.match(/(\d{2})\.(\d{2})\.(\d{4})\D{1,12}(\d{2})[:.](\d{2})\s*UTC/i);
  if (explicit) {
    const [, d, mo, y, h, mi] = explicit;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)).toISOString();
  }
  if (hl.date && periods.length) {
    const h = parseInt(periods[0].slice(0, 2), 10);
    const [y, mo, d] = hl.date.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, 0)).toISOString();
  }
  if (hl.date) return new Date(`${hl.date}T00:00:00Z`).toISOString();
  return null;
}

/**
 * Header der Flugwetterübersicht:
 *   FBEU40 EDZF 251800
 *   Flugwetterübersicht Bereich Mitte
 *   gültig vom 25.08.2026, 18.00 UTC bis 26.08.2026, 15.00 UTC
 *   Vorhersagebereich: GAFOR-Gebiete 41 bis 47, 50 bis 53, 61
 */
function overviewHeader(text) {
  const out = { bulletin: null, office: null, bereich: null,
                issued: null, validFrom: null, validTo: null, areas: [] };

  const b = text.match(/^\s*(FBEU\d{2})\s+([A-Z]{4})\s+(\d{2})(\d{2})(\d{2})\s*$/im);
  if (b) {
    out.bulletin = `${b[1]} ${b[2]} ${b[3]}${b[4]}${b[5]}`;
    out.office = b[2];
    out.issued = dayHourToISO(+b[3], +b[4], +b[5]);
  }
  const r = text.match(/Flugwetter(?:übersicht|uebersicht)\s+Bereich\s+(.+?)\s*$/im);
  if (r) out.bereich = r[1].trim();

  const v = text.match(/g[üu]ltig\s+vom\s+(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2})[.:](\d{2})\s*UTC\s*bis\s*(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2})[.:](\d{2})\s*UTC/i);
  if (v) {
    out.validFrom = new Date(Date.UTC(+v[3], +v[2] - 1, +v[1], +v[4], +v[5])).toISOString();
    out.validTo = new Date(Date.UTC(+v[8], +v[7] - 1, +v[6], +v[9], +v[10])).toISOString();
  }

  const a = text.match(/Vorhersagebereich:\s*GAFOR-Gebiete\s*([^\n]+)/i);
  if (a) out.areas = expandAreaList(a[1]);
  return out;
}

/** "00 bis 10" / "54 - 58, 62 - 64, 71 - 76" → ["00","01",…] */
function expandAreaList(spec) {
  const ids = [];
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d{2})\s*(?:bis|-|–)\s*(\d{2})$/i);
    if (m) {
      for (let i = +m[1]; i <= +m[2]; i++) ids.push(String(i).padStart(2, '0'));
      continue;
    }
    const one = part.trim().match(/^(\d{2})$/);
    if (one) ids.push(one[1]);
  }
  return [...new Set(ids)];
}

/** Everything after the header block — the header is shown as fields, not prose. */
function overviewBody(text) {
  const lines = text.split('\n');
  let i = lines.findIndex(l => /Vorhersagebereich:/i.test(l));
  if (i < 0) {
    i = lines.findIndex(l => /^g[üu]ltig\s+vom/i.test(l.trim()));
  }
  if (i < 0) return text.replace(/^\s*\d{1,4}\s*$/m, '').trim();
  return lines.slice(i + 1).join('\n').replace(/^\n+/, '').trim();
}

/** DDHHMM in the current month → ISO. */
function dayHourToISO(dd, hh, mi, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dd, hh, mi));
  if (d - now > 3 * 86400e3) d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString();
}

const officeFrom = (url) => (url.match(/fbeu\d{2}_([a-z]{4})_node/i) || [])[1]?.toUpperCase() || null;
const keyFrom = (url) => (url.split('/').pop() || url).replace(/_node\.html$|\.html$/i, '');

// ---------------------------------------------------------------- run
async function writeRaw(key, text) {
  const p = `${OUT_DIR}/raw/${key.replace(/[^a-z0-9._-]/gi, '_')}.txt`;
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, text, 'utf8');
}

async function collectGafor() {
  const gafor = {};        // the code table, keyed by Bereich
  const overview = {};     // the prose Flugwetterübersicht, keyed by office
  const seen = new Set();

  let hubHtml = null;
  try {
    hubHtml = await get(HUB.gafor);
  } catch (e) {
    note('gafor', HUB.gafor, `Übersichtsseite nicht erreichbar: ${e.message}`);
  }
  if (hubHtml) {
    await writeRaw('_links-gafor', links(hubHtml, HUB.gafor).join('\n') + '\n');
    await writeRaw('_map-gafor', [...hubHtml.matchAll(/<area[^>]*>/gi)].map(m => m[0]).join('\n') + '\n');
  }

  const discovered = hubHtml
    ? links(hubHtml, HUB.gafor).filter(u => /fbeu\d{2}[a-z0-9_]*_node\.html$/i.test(u))
    : [];

  for (const url of [HUB.gafor, ...GAFOR_PAGES, ...discovered]) {
    if (seen.has(url)) continue;
    seen.add(url);
    let html;
    try { html = url === HUB.gafor && hubHtml ? hubHtml : await get(url); }
    catch (e) { note('gafor', url, e.message); continue; }

    const text = stripChrome(bulletinText(html));
    await writeRaw(`gafor-${(officeFrom(url) || keyFrom(url)).toLowerCase()}`, `${url}\n\n${text}\n`);

    // (a) the prose Flugwetterübersicht — one per Bereich, carries the
    //     authoritative list of areas it covers
    const oh = overviewHeader(text);
    if (oh.office && oh.areas.length) {
      overview[oh.office] = {
        bulletin: oh.bulletin, bereich: oh.bereich, office: oh.office,
        source: url, issued: oh.issued,
        validFrom: oh.validFrom, validTo: oh.validTo,
        areas: oh.areas, fetched: new Date().toISOString(),
        text: overviewBody(text), fullText: text,
      };
      console.log(`✓ übersicht ${oh.office} (${oh.bereich}): ${oh.areas.length} Gebiete, ` +
                  `gültig bis ${oh.validTo || '?'}`);
    }

    // (b) the GAFOR code table, wherever it shows up
    const hl = headline(text);
    const periods = periodsFrom(text);
    const areas = areasFrom(text, periods.length);
    if (Object.keys(areas).length) {
      const key = hl.bereich ? hl.bereich.replace(/\s+/g, '-') : (officeFrom(url) || keyFrom(url));
      if (!gafor[key]) {
        gafor[key] = {
          title: hl.title || 'GAFOR', bereich: hl.bereich || null, source: url,
          issued: issuedFrom(text, hl, periods), fetched: new Date().toISOString(),
          periods,
          areas: Object.fromEntries(Object.entries(areas).map(([id, a]) => [id, a.codes])),
          details: areas, text,
        };
        console.log(`✓ gafor ${key}: ${Object.keys(areas).length} Gebiete, ${periods.length} Zeiträume`);
      }
    } else if (!oh.office) {
      note('gafor', url, 'weder Gebietstabelle noch Übersichtskopf erkannt');
    }
  }
  return { gafor, overview };
}

/**
 * The balloon forecast exists per GAFOR area, and the site selects it through
 * the clickable map rather than a link. Probe a few plausible URL shapes for
 * one area and write down what answered — one run of this pins the pattern.
 */
async function probeBalloon(sampleArea = '45') {
  const cands = [
    `${BASE_BALLOON}${sampleArea}_node.html`,
    `${BASE_BALLOON}gebiet_${sampleArea}_node.html`,
    `${BASE_BALLOON}ballon_${sampleArea}_node.html`,
    `${BASE_BALLOON}bvhs_${sampleArea}_node.html`,
    `${BASE_BALLOON}node_${sampleArea}.html`,
    `${BASE_BALLOON}node_uebersicht.html?gebiet=${sampleArea}`,
    `${BASE_BALLOON}node_uebersicht.html?nn=${sampleArea}`,
    `${BASE_GAFOR}ballon_${sampleArea}_node.html`,
  ];
  const lines = [];
  for (const url of cands) {
    try {
      const text = stripChrome(bulletinText(await get(url)));
      const hit = /Ballon|Thermik|Bodenwind|Gebietsvorhersage/i.test(text) && text.length > 200;
      lines.push(`${hit ? 'TREFFER' : 'ok     '}  ${text.length.toString().padStart(6)}  ${url}`);
      if (hit) lines.push(text.split('\n').slice(0, 12).map(l => `        | ${l}`).join('\n'));
    } catch (e) {
      lines.push(`${e.message.padEnd(7)}  ${''.padStart(6)}  ${url}`);
    }
  }
  await writeRaw('_probe-balloon', `Sondierung für GAFOR-Gebiet ${sampleArea}\n\n` + lines.join('\n') + '\n');
  console.log(`Ballon-Sondierung geschrieben (${cands.length} Kandidaten)`);
}

async function collectBalloon() {
  const out = {};
  let hubHtml = null;
  const found = [];
  try {
    hubHtml = await get(HUB.balloon);
    found.push(...links(hubHtml, HUB.balloon)
      .filter(u => /gebietsvorhersagen_ballonsport\//i.test(u) && /\.html$/i.test(u)));
  } catch (e) {
    note('balloon', HUB.balloon, `Übersichtsseite nicht erreichbar: ${e.message}`);
  }

  const urls = [...new Set(found.filter(u => !/node_uebersicht\.html$/i.test(u)))];
  if (!urls.length) note('balloon', HUB.balloon,
    'keine Regionsseiten verlinkt (die Auswahl läuft über die anklickbare Karte) — siehe raw/_links.txt');

  for (const url of urls) {
    try {
      const text = stripChrome(bulletinText(await get(url)));
      if (text.length < 80) { note('balloon', url, 'kein Berichtstext gefunden'); continue; }
      const key = keyFrom(url);
      out[key] = {
        title: text.split('\n')[0].slice(0, 120),
        source: url,
        issued: issuedFrom(text, headline(text), []),
        fetched: new Date().toISOString(),
        text,
      };
      console.log(`✓ ballon ${key}: ${text.length} Zeichen`);
      await writeRaw(`balloon-${key.toLowerCase()}`, `${url}\n\n${text}\n`);
    } catch (e) { note('balloon', url, e.message); }
  }

  // always keep the hub itself, and dump every link so the region pages can be
  // found by looking at the committed file
  if (hubHtml) {
    await writeRaw('_links-balloon', links(hubHtml, HUB.balloon).join('\n') + '\n');
    // the region picker is an image map — dump it, that is where the URLs are
    const snippets = [
      ...[...hubHtml.matchAll(/<area[^>]*>/gi)].map(m => m[0]),
      ...[...hubHtml.matchAll(/<map[^>]*>/gi)].map(m => m[0]),
      ...[...hubHtml.matchAll(/[^\n"']*ballonsport[^\n"']*/gi)].map(m => m[0].trim()),
    ];
    await writeRaw('_map-balloon', [...new Set(snippets)].join('\n') + '\n');
  }
  return out;
}

async function main() {
  const { gafor, overview } = await collectGafor();
  const balloon = await collectBalloon();
  if (!Object.keys(balloon).length) await probeBalloon('45');
  const index = { generated: new Date().toISOString(), gafor, overview, balloon, errors };

  if (!Object.keys(gafor).length && !Object.keys(overview).length && !Object.keys(balloon).length) {
    try {
      const prev = JSON.parse(await readFile(`${OUT_DIR}/index.json`, 'utf8'));
      if (prev && (Object.keys(prev.gafor || {}).length || Object.keys(prev.balloon || {}).length)) {
        index.gafor = prev.gafor; index.overview = prev.overview || {}; index.balloon = prev.balloon;
        index.stale = prev.generated;
        note('run', '', 'Kein Bericht abrufbar — vorheriger Stand beibehalten.');
        index.errors = errors;
      }
    } catch { /* no previous file */ }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/index.json`, JSON.stringify(index, null, 1), 'utf8');
  console.log(`\nGAFOR-Tabellen: ${Object.keys(index.gafor).length} · ` +
              `Flugwetterübersichten: ${Object.keys(index.overview).length} · ` +
              `Ballonberichte: ${Object.keys(index.balloon).length} · Fehler: ${errors.length}`);
}

main().catch(e => {
  console.error('fetcher failed:', e);
  process.exit(0);
});
