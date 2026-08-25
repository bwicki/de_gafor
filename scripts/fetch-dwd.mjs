#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * GaforCast — DWD fetcher.
 *
 * Runs in GitHub Actions, not in the browser: dwd.de sends no CORS headers, so
 * the app cannot read those pages itself. This script fetches the free DWD
 * "Luftsportberichte" (GAFOR / Flugwetterübersicht and the balloon area
 * forecasts), turns them into text, tries to pull the per-area GAFOR codes out
 * of them and writes:
 *
 *   data/dwd/index.json      what the app reads
 *   data/dwd/raw/<key>.txt   the plain text of every bulletin, committed too,
 *                            so the parser can be improved against real data
 *
 * Design rule: never fail the build. Anything that goes wrong lands in
 * index.json → errors[] and the app shows the bulletin text unparsed.
 * --------------------------------------------------------------------------- */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT_DIR = 'data/dwd';
const UA = 'GaforCast/1.0 (+https://github.com/) static site data fetcher';
const TIMEOUT_MS = 25000;

const HUB = {
  gafor:   'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/fbeu40_node.html',
  balloon: 'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/gebietsvorhersagen_ballonsport/node_uebersicht.html',
};

// Fallbacks if link discovery on the hub pages finds nothing.
const FALLBACK_GAFOR = [
  'fbeu40_edzb', 'fbeu40_edze', 'fbeu40_edzf', 'fbeu40_edzh', 'fbeu40_edzl',
  'fbeu40_edzm', 'fbeu40_edzs', 'fbeu40_edzo',
].map(s => `https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/${s}_node.html`);

const errors = [];
const note = (product, url, message) => { errors.push({ product, url, message }); console.warn(`! ${product} ${url} — ${message}`); };

// ---------------------------------------------------------------- fetching
async function get(url) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'de' },
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

/** Prefer <pre> blocks — DWD wraps the bulletin in them; else the main content. */
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

function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return decode(m[1]).replace(/\s*[-|]\s*(Deutscher Wetterdienst|DWD).*$/i, '').trim();
}

/** Absolute links on a hub page that look like bulletin sub-pages. */
function discover(html, base, pattern) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"#?]+)"/gi)) {
    let href = decode(m[1]);
    if (!pattern.test(href)) continue;
    try { out.add(new URL(href, base).href); } catch { /* skip */ }
  }
  return [...out];
}

// ---------------------------------------------------------------- parsing
/**
 * Issue time. DWD bulletins carry a DDHHMM group ("GAFOR 251600" or
 * "ausgegeben am 25.08.2026 um 16:00 UTC"). Returns an ISO string or null.
 */
function issuedFrom(text, now = new Date()) {
  let m = text.match(/(\d{2})\.(\d{2})\.(\d{4})\D{1,12}(\d{2})[:.](\d{2})\s*UTC/i);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5])).toISOString();

  m = text.match(/\b(?:GAFOR|FBEU\d{2}|ausgegeben)\D{0,24}?(\d{2})(\d{2})(\d{2})\s*(?:UTC|Z)?\b/i);
  if (m) {
    const [, dd, hh, mm] = m.map(Number);
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dd, hh, mm));
    if (d - now > 3 * 86400e3) d.setUTCMonth(d.getUTCMonth() - 1);   // ran into last month
    return d.toISOString();
  }
  return null;
}

/** Period headers such as "06-09 09-12 12-15" or "0600 0900 1200". */
function periodsFrom(text) {
  let m = text.match(/((?:\b\d{2}\s*-\s*\d{2}\b[\s|]{0,4}){3,})/);
  if (m) return m[1].trim().split(/[\s|]+/).map(s => s.replace(/\s+/g, ''));
  m = text.match(/((?:\b\d{4}\b[\s|]{1,4}){3,})/);
  if (m) {
    const raw = m[1].trim().split(/\s+/);
    return raw.map((v, i) => i < raw.length - 1 ? `${v.slice(0, 2)}-${raw[i + 1].slice(0, 2)}` : null)
              .filter(Boolean);
  }
  return [];
}

/**
 * Per-area codes. Accepts the common shapes:
 *   "45  C C O D"      "45: CCOD"      "45 46 47  CCOD"
 * Only C/O/D/M/X count as codes, so prose lines are ignored.
 */
function areasFrom(text) {
  const areas = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*((?:\d{2}\s*[,/+-]?\s*){1,6})[:\s]+((?:[CODMX]\s*){2,10})\s*$/i);
    if (!m) continue;
    const ids = m[1].match(/\d{2}/g) || [];
    const codes = (m[2].match(/[CODMX]/gi) || []).map(c => c.toUpperCase());
    if (!ids.length || codes.length < 2) continue;
    for (const id of ids) if (!areas[id]) areas[id] = codes;
  }
  return areas;
}

/** Office code from a DWD URL: .../fbeu40_edzf_node.html → EDZF */
function officeFrom(url) {
  const m = url.match(/fbeu\d{2}_([a-z]{4})_node/i);
  return m ? m[1].toUpperCase() : null;
}

/** Key for a balloon page: the last path segment without the boilerplate. */
function keyFrom(url) {
  const seg = (url.split('/').pop() || '').replace(/_node\.html$|\.html$/i, '');
  return seg || url;
}

// ---------------------------------------------------------------- run
async function collect(kind, hubUrl, linkPattern, fallback) {
  const out = {};
  let links = [];
  try {
    const hub = await get(hubUrl);
    links = discover(hub, hubUrl, linkPattern);
    // the hub page itself often carries the nationwide bulletin
    links.unshift(hubUrl);
  } catch (e) {
    note(kind, hubUrl, `Übersichtsseite nicht erreichbar: ${e.message}`);
    links = fallback || [];
  }
  if (links.length <= 1 && fallback) links = [...new Set([...links, ...fallback])];

  for (const url of links) {
    try {
      const html = await get(url);
      const text = bulletinText(html);
      if (text.length < 80) { note(kind, url, 'kein Berichtstext gefunden'); continue; }
      const title = pageTitle(html);
      const rec = {
        title, source: url,
        issued: issuedFrom(text) || new Date().toISOString(),
        fetched: new Date().toISOString(),
        text,
      };
      if (kind === 'gafor') {
        rec.periods = periodsFrom(text);
        rec.areas = areasFrom(text);
        const key = officeFrom(url) || keyFrom(url);
        out[key] = rec;
        console.log(`✓ gafor ${key}: ${Object.keys(rec.areas).length} Gebiete, ${rec.periods.length} Zeiträume`);
      } else {
        const key = keyFrom(url);
        out[key] = rec;
        console.log(`✓ ballon ${key}: ${text.length} Zeichen`);
      }
      await writeRaw(`${kind}-${(officeFrom(url) || keyFrom(url)).toLowerCase()}`, `${url}\n\n${text}\n`);
    } catch (e) {
      note(kind, url, e.message);
    }
  }
  return out;
}

async function writeRaw(key, text) {
  const p = `${OUT_DIR}/raw/${key.replace(/[^a-z0-9._-]/gi, '_')}.txt`;
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, text, 'utf8');
}

async function main() {
  const gafor = await collect('gafor', HUB.gafor, /fbeu\d{2}[a-z0-9_]*_node\.html$/i, FALLBACK_GAFOR);
  const balloon = await collect('balloon', HUB.balloon,
    /gebietsvorhersagen_ballonsport\/[a-z0-9_]+\.html$/i, null);

  const index = { generated: new Date().toISOString(), gafor, balloon, errors };

  // Keep the previous good payload if a run came back empty (DWD hiccup).
  if (!Object.keys(gafor).length && !Object.keys(balloon).length) {
    try {
      const prev = JSON.parse(await readFile(`${OUT_DIR}/index.json`, 'utf8'));
      if (prev && (Object.keys(prev.gafor || {}).length || Object.keys(prev.balloon || {}).length)) {
        index.gafor = prev.gafor; index.balloon = prev.balloon;
        index.stale = prev.generated;
        note('run', '', 'Kein Bericht abrufbar — vorheriger Stand beibehalten.');
        index.errors = errors;
      }
    } catch { /* no previous file */ }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/index.json`, JSON.stringify(index, null, 1), 'utf8');
  console.log(`\nGAFOR-Bulletins: ${Object.keys(index.gafor).length} · ` +
              `Ballonberichte: ${Object.keys(index.balloon).length} · Fehler: ${errors.length}`);
}

main().catch(e => {
  console.error('fetcher failed:', e);
  process.exit(0);       // never break the workflow
});
