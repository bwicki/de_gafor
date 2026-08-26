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
const BALLOON_MAX_AGE_H = Number(process.env.BALLOON_MAX_AGE_H || 4);

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

/**
 * Den eigentlichen Berichtsblock aus der Seite holen.
 *
 * Die DWD-Seiten betten ihn unterschiedlich ein: GAFOR und Flugwetterübersicht
 * in <pre>, die Ballonwetterberichte in einer Tabelle. Ausserdem gibt es je
 * Seite mehrere Blöcke mit class="content" — der erste ist oft nur ein
 * Einleitungssatz. Deshalb werden alle Kandidaten eingesammelt und der längste
 * gewinnt; ein <pre> zählt dabei anderthalbfach, weil es fast immer der Bericht
 * selbst ist.
 */
function bulletinText(html) {
  // <pre> ist bei GAFOR und Flugwetterübersicht immer der Bericht selbst und
  // schlägt alles andere — sonst gewinnt schon mal ein langes Navigationsmenü
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map(m => m[1]);
  if (pres.length) {
    const t = htmlToText(pres.join('\n\n'));
    if (t.length > 150) return t;
  }

  // sonst der längste Kandidat: die Ballonberichte stehen in einer Tabelle, und
  // der erste Block mit class="content" ist oft nur ein Einleitungssatz
  const cands = [];
  const push = (raw) => {
    const t = htmlToText(raw);
    if (t.length > 60) cands.push(t);
  };
  for (const m of html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)) push(m[0]);
  for (const m of html.matchAll(/<div[^>]+class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)) push(m[1]);
  for (const re of [/<main[^>]*>([\s\S]*?)<\/main>/i, /<article[^>]*>([\s\S]*?)<\/article>/i]) {
    const m = html.match(re);
    if (m) push(m[1]);
  }
  if (!cands.length) return htmlToText(html);
  cands.sort((a, b) => b.length - a.length);
  return cands[0];
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
 * The balloon forecast exists per GAFOR area. The picker is an image map, and
 * every <area> carries the target and the area's name:
 *
 *   <area shape="poly" coords="…"
 *         href="/DE/…/gebietsvorhersagen_ballonsport/node_45"
 *         alt="Rhein-Main-Gebiet und Wetterau (800 FT AMSL)">
 *
 * So the list of pages is read off the map instead of guessed, and it follows
 * along if the DWD ever renumbers something.
 */
function balloonTargets(html, base) {
  const out = [];
  for (const tag of html.matchAll(/<area\b[^>]*>/gi)) {
    const t = tag[0];
    const href = (t.match(/href="([^"]+)"/i) || [])[1];
    if (!href) continue;
    const m = href.match(/node_(\d{2})(?:\.html)?$/i);
    if (!m) continue;
    const alt = decode((t.match(/alt="([^"]*)"/i) || [])[1] || '');
    // "Weser-Leine-Bergland (1.400 FT AMSL)" — mit Tausenderpunkt
    const ft = alt.match(/\(([\d.  ]+)\s*FT/i);
    out.push({
      id: m[1],
      name: alt.replace(/\s*\([^)]*\)?\s*$/, '').trim(),   // eine Klammer ist unvollständig
      refAltFt: ft ? parseInt(ft[1].replace(/[^\d]/g, ''), 10) : null,
      url: new URL(href, base).href,
    });
  }
  const seen = new Set();
  return out.filter(a => !seen.has(a.id) && seen.add(a.id));
}

/* ---------------------------------------------------------------- Ballonbericht
 * Der Bericht ist keine Prosa, sondern drei Tabellen mit Farbcodierung:
 * astronomische Angaben, Bodenwerte/Wetter/Wind stündlich und Thermik. Er wird
 * deshalb als Struktur abgelegt, nicht als Text — die App zeichnet daraus wieder
 * eine Tabelle, mit denselben Farben.
 *
 * Geparst wird generisch (Überschriften und Tabellen in Reihenfolge), damit eine
 * zusätzliche Zeile beim DWD nicht gleich alles bricht.
 */
const HEX = { g: [[80, 160], [0.25, 1]], y: [[40, 75], [0.25, 1]], o: [[20, 40], [0.25, 1]],
              r: [[-20, 20], [0.25, 1]], b: [[190, 265], [0.15, 1]] };

/** Zellenfarbe auf eine Handvoll Klassen abbilden: g y o r b n. */
function colourClass(attrs) {
  const m = attrs.match(/(?:bgcolor=["']?|background(?:-color)?\s*:\s*)([^;"'\s]+)/i);
  if (!m) return null;
  let r, g, b;
  const v = m[1].trim();
  const hex = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const rgb = v.match(/rgba?\(([^)]+)\)/i) || attrs.match(/rgba?\(([^)]+)\)/i);
    if (!rgb) return null;
    [r, g, b] = rgb[1].split(',').slice(0, 3).map(x => parseFloat(x));
  }
  if (![r, g, b].every(Number.isFinite)) return null;

  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15 || l > 0.94) return null;                 // weiss/grau: keine Aussage
  let hue = 0;
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  if (mx === mn) hue = 0;
  else if (mx === rr) hue = 60 * (((gg - bb) / (mx - mn)) % 6);
  else if (mx === gg) hue = 60 * ((bb - rr) / (mx - mn) + 2);
  else hue = 60 * ((rr - gg) / (mx - mn) + 4);
  if (hue < 0) hue += 360;
  for (const [k, [[h0, h1], [s0]]] of Object.entries(HEX)) {
    const inHue = h0 < 0 ? (hue >= 360 + h0 || hue <= h1) : (hue >= h0 && hue <= h1);
    if (inHue && sat >= s0) return k;
  }
  return null;
}

function cellText(html) {
  return htmlToText(html).replace(/\s+/g, ' ').trim();
}

/** Eine HTML-Tabelle zu Zeilen aus {t, c, h}. */
function parseTable(tableHtml) {
  const rows = [];
  for (const tr of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const td of tr[1].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const cell = { t: cellText(td[3]) };
      const c = colourClass(td[2]);
      if (c) cell.c = c;
      if (td[1].toLowerCase() === 'th') cell.h = true;
      const span = td[2].match(/colspan=["']?(\d+)/i);
      if (span) cell.s = +span[1];
      cells.push(cell);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Überschriften und Tabellen in der Reihenfolge, in der sie auf der Seite
 * stehen — jede Tabelle bekommt die letzte Überschrift davor.
 */
function parseBalloonPage(html) {
  const out = { title: null, station: null, blocks: [] };

  const t = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (t) out.title = cellText(t[1]);

  const re = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>|<table\b[^>]*>[\s\S]*?<\/table>/gi;
  let heading = null;
  for (const m of html.matchAll(re)) {
    if (m[2] != null) { heading = cellText(m[2]); continue; }
    const rows = parseTable(m[0]);
    // Navigations- und Layouttabellen aussortieren
    const cells = rows.reduce((n, r) => n + r.length, 0);
    if (rows.length < 2 || cells < 4) continue;
    out.blocks.push({ heading, rows });
  }

  for (const b of out.blocks) {
    const h = b.heading || '';
    const m = h.match(/f[üu]r\s+(.+?)\s*\(\s*([\d.]+)\s*°\s*N\s+([\d.]+)\s*°\s*[OE]\s*[-–]\s*(\d+)\s*ft/i);
    if (m) {
      out.station = { name: m[1].trim(), lat: +m[2], lon: +m[3], elevFt: +m[4] };
      break;
    }
  }
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 67 pages is a lot to pull three times an hour for a product the DWD issues a
 * few times a day, so they are only refreshed when the stored copy has aged
 * past BALLOON_MAX_AGE_H. FORCE_BALLOON=1 overrides that.
 */
async function collectBalloon(previous) {
  const out = {};
  const force = process.env.FORCE_BALLOON === '1';
  const prev = (previous && previous.balloon) || {};
  const newest = Object.values(prev)
    .map(b => Date.parse(b.fetched || 0)).filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  const ageH = newest ? (Date.now() - newest) / 3600e3 : Infinity;

  if (!force && Object.keys(prev).length >= 60 && ageH < BALLOON_MAX_AGE_H) {
    console.log(`· Ballonberichte ${ageH.toFixed(1)} h alt (< ${BALLOON_MAX_AGE_H} h) — übernommen`);
    return prev;
  }

  let hubHtml = null;
  try { hubHtml = await get(HUB.balloon); }
  catch (e) { note('balloon', HUB.balloon, `Übersichtsseite nicht erreichbar: ${e.message}`); }
  if (!hubHtml) return prev;

  await writeRaw('_links-balloon', links(hubHtml, HUB.balloon).join('\n') + '\n');
  await writeRaw('_map-balloon', [...hubHtml.matchAll(/<area\b[^>]*>/gi)].map(m => m[0]).join('\n') + '\n');

  const targets = balloonTargets(hubHtml, HUB.balloon);
  if (!targets.length) {
    note('balloon', HUB.balloon, 'keine Gebiete in der Bildkarte gefunden — siehe raw/_map-balloon.txt');
    return prev;
  }
  console.log(`· ${targets.length} Ballon-Gebiete in der Bildkarte`);
  let dumped = false;

  for (const t of targets) {
    let html = null;
    for (const url of [t.url, `${t.url}.html`]) {
      try {
        const got = await get(url);
        if (!html || got.length > html.length) { html = got; t.used = url; }
        if (html && html.length > 4000) break;
      } catch { /* nächste Form probieren */ }
      await sleep(120);
    }
    if (!html) { note('balloon', t.url, `Gebiet ${t.id}: Seite nicht erreichbar`); continue; }

    if (!dumped) {                       // eine Seite roh mitschreiben, zum Nachsehen
      await writeRaw(`_page-balloon-${t.id}`, html.slice(0, 300000));
      dumped = true;
    }

    const page = parseBalloonPage(html);
    const text = stripChrome(bulletinText(html));
    const cells = page.blocks.reduce((n, b) => n + b.rows.reduce((k, r) => k + r.length, 0), 0);
    if (!page.blocks.length && text.length < 200) {
      note('balloon', t.used || t.url, `Gebiet ${t.id}: weder Tabellen noch Text gefunden`);
      continue;
    }

    // Der Bericht ist gross; je Gebiet eine eigene Datei, damit die App beim
    // Start nicht 67 davon laden muss.
    const file = `balloon/${t.id}.json`;
    const record = {
      id: t.id, name: t.name, refAltFt: t.refAltFt,
      source: t.used || t.url,
      title: page.title, station: page.station,
      fetched: new Date().toISOString(),
      blocks: page.blocks, text,
    };
    await mkdir(`${OUT_DIR}/balloon`, { recursive: true });
    await writeFile(`${OUT_DIR}/${file}`, JSON.stringify(record), 'utf8');

    out[t.id] = {
      id: t.id, name: t.name, refAltFt: t.refAltFt,
      source: record.source, title: page.title,
      station: page.station, fetched: record.fetched,
      blocks: page.blocks.length, cells, file: `${OUT_DIR}/${file}`,
    };
    await sleep(120);
  }

  const withTables = Object.values(out).filter(b => b.blocks > 0).length;
  console.log(`✓ ballon: ${Object.keys(out).length}/${targets.length} Gebiete, ` +
              `${withTables} mit Tabellen`);
  if (!withTables) note('balloon', HUB.balloon,
    'keine Tabellen erkannt — siehe raw/_page-balloon-*.txt');
  return Object.keys(out).length ? out : prev;
}

async function main() {
  let previous = null;
  try { previous = JSON.parse(await readFile(`${OUT_DIR}/index.json`, 'utf8')); } catch { /* erster Lauf */ }

  const { gafor, overview } = await collectGafor();
  const balloon = await collectBalloon(previous);
  const index = { generated: new Date().toISOString(), gafor, overview, balloon, errors };

  if (!Object.keys(gafor).length && !Object.keys(overview).length && !Object.keys(balloon).length) {
    try {
      const prev = previous;
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
