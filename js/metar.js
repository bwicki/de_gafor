/* GaforCast — METAR und TAF.
 *
 * Reihenfolge seit 1.7.0 umgedreht: **zuerst die eigene Kopie**, dann optional
 * die NOAA. Der Grund ist Erfahrung — der Direktabruf bei aviationweather.gov
 * scheitert im Browser je nach Netz, Firewall oder CORS-Laune, und dann stand
 * die Karte leer da. `data/dwd/metar.json` kommt dagegen von derselben Domain
 * wie die App selbst: kein CORS, keine Fremdsperre, kein Netzsegment dazwischen.
 * Der Workflow füllt die Datei dreimal pro Stunde; METAR wird halbstündlich
 * ausgegeben, die Kopie ist also nie nennenswert alt.
 *
 * Die NOAA läuft nur noch als Auffrischung nebenher: gelingt sie, wird die
 * Anzeige still auf die Live-Daten gehoben; scheitert sie, merkt der Nutzer
 * nichts, weil längst etwas dasteht.
 */
const METAR = (() => {
  'use strict';

  const BASE = 'https://aviationweather.gov/api/data';
  const LIVE_TIMEOUT_MS = 7000;      // länger warten lohnt nicht, die Kopie steht schon

  /* ---------------------------------------------------------- Bundesländer
   * Die NOAA schreibt hinter den Platznamen nur „DE". Das sagt nichts, was
   * man in Deutschland nicht ohnehin wüsste; das Bundesland dagegen ordnet
   * den Platz sofort ein. Eine feste Tabelle ist hier ehrlicher als eine
   * Herleitung aus den Koordinaten: sie ist offline richtig oder gar nicht.
   * Unbekannte Kennungen liefern bewusst nichts — lieber kein Kürzel als ein
   * falsches. Ergänzungen gehören hierher, nach Kennung sortiert.
   */
  const LAND = {
    // Schleswig-Holstein
    EDHE: 'SH', EDHK: 'SH', EDHL: 'SH', EDXF: 'SH', EDXH: 'SH', EDXW: 'SH', EDXY: 'SH',
    ETNH: 'SH', ETNS: 'SH',
    // Hamburg / Bremen
    EDDH: 'HH', EDHI: 'HH', EDDW: 'HB', EDWB: 'HB',
    // Niedersachsen
    EDDV: 'NI', EDVE: 'NI', EDVM: 'NI', EDWE: 'NI', EDWG: 'NI', EDWI: 'NI', EDWJ: 'NI',
    EDWL: 'NI', EDWR: 'NI', ETHB: 'NI', ETHC: 'NI', ETHS: 'NI', ETMN: 'NI', ETND: 'NI',
    ETNT: 'NI', ETNW: 'NI',
    // Mecklenburg-Vorpommern
    EDAH: 'MV', EDBH: 'MV', EDCG: 'MV', EDCP: 'MV', ETNL: 'MV',
    // Brandenburg
    EDAY: 'BB', EDAZ: 'BB', EDCD: 'BB', EDDB: 'BB', EDUS: 'BB', ETSH: 'BB',
    // Sachsen-Anhalt / Sachsen / Thüringen
    EDBC: 'ST', EDBM: 'ST',
    EDAB: 'SN', EDDC: 'SN', EDDP: 'SN',
    EDAC: 'TH', EDDE: 'TH', EDGE: 'TH',
    // Nordrhein-Westfalen
    EDDG: 'NW', EDDK: 'NW', EDDL: 'NW', EDGS: 'NW', EDKA: 'NW', EDKB: 'NW', EDLE: 'NW',
    EDLN: 'NW', EDLP: 'NW', EDLS: 'NW', EDLV: 'NW', EDLW: 'NW', ETNG: 'NW', ETNN: 'NW',
    // Hessen
    EDDF: 'HE', EDFE: 'HE', EDVK: 'HE', ETID: 'HE', ETOU: 'HE',
    // Rheinland-Pfalz / Saarland
    EDFH: 'RP', EDFZ: 'RP', EDRT: 'RP', EDRY: 'RP', EDRZ: 'RP',
    ETAD: 'RP', ETAR: 'RP', ETSB: 'RP',
    EDDR: 'SL',
    // Baden-Württemberg
    EDDS: 'BW', EDFM: 'BW', EDNY: 'BW', EDSB: 'BW', EDTD: 'BW', EDTF: 'BW', EDTG: 'BW',
    EDTL: 'BW', EDTM: 'BW', EDTY: 'BW', ETHL: 'BW', ETHN: 'BW',
    // Bayern
    EDDM: 'BY', EDDN: 'BY', EDJA: 'BY', EDMA: 'BY', EDME: 'BY', EDMO: 'BY', EDMS: 'BY',
    EDQD: 'BY', EDQM: 'BY', ETEB: 'BY', ETIC: 'BY', ETIH: 'BY', ETSI: 'BY', ETSL: 'BY',
    ETSN: 'BY',
  };

  /** Bundeslandkürzel zu einer ICAO-Kennung, oder '' wenn nicht hinterlegt. */
  const landOf = (icao) => LAND[String(icao || '').toUpperCase().trim()] || '';

  /** Degrees of latitude / longitude for a radius in km at this latitude. */
  function box(lat, lon, km) {
    const dLat = km / 111.2;
    const dLon = km / (111.2 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
  }

  // ---------------------------------------------------------------- Quellen
  let repoP = null;
  let source = { kind: 'none', at: null };
  const lastSource = () => source;

  /** Die Kopie im eigenen Repo. Wird je Zehnminutenfenster einmal geholt. */
  function repoData(force) {
    if (force) repoP = null;
    if (!repoP) {
      const bucket = Math.floor(Date.now() / 600000);
      repoP = U.getJSON(`data/dwd/metar.json?t=${bucket}`).catch(() => null);
    }
    return repoP;
  }
  /** Nach „Aktualisieren" die Kopie neu ziehen. */
  const reload = () => { repoP = null; return repoData(); };

  async function getLive(url) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), LIVE_TIMEOUT_MS) : 0;
    try {
      return await U.getJSON(url, ctl ? { signal: ctl.signal } : undefined);
    } finally { clearTimeout(t); }
  }

  const liveMetar = (lat, lon, km) => {
    const b = box(lat, lon, km || 100);
    // bbox ist latMin,lonMin,latMax,lonMax; hours=3 liefert auch ältere Meldungen,
    // aus denen je Platz die neueste gewählt wird
    return getLive(`${BASE}/metar?bbox=${b.map(v => v.toFixed(3)).join(',')}&format=json&hours=3`);
  };

  function pick(list, lat, lon, km, limit) {
    const best = new Map();
    for (const m of (Array.isArray(list) ? list : [])) {
      if (!m.icaoId || m.lat == null) continue;
      const prev = best.get(m.icaoId);
      if (!prev || (m.obsTime || 0) > (prev.obsTime || 0)) best.set(m.icaoId, m);
    }
    // die Box ist ein Rechteck, gefragt ist ein Kreis
    return [...best.values()]
      .map(m => ({ ...m, distKm: U.distKm(lat, lon, m.lat, m.lon) }))
      .filter(m => m.distKm <= (km || 100))
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, limit || 8);
  }

  /**
   * Neueste Meldung jedes Platzes im Umkreis, nächster zuerst.
   * Nimmt die Repo-Kopie, wenn es sie gibt; sonst wird direkt bei der NOAA
   * gefragt und ein Fehlschlag durchgereicht, damit die Karte ihn zeigt.
   */
  async function near(lat, lon, km, limit) {
    const repo = await repoData();
    if (repo && Array.isArray(repo.metar) && repo.metar.length) {
      source = { kind: 'repo', at: repo.generated || null, via: repo.via || 'awc' };
      return pick(repo.metar, lat, lon, km, limit);
    }
    const list = await liveMetar(lat, lon, km);
    source = { kind: 'live', at: null };
    return pick(list, lat, lon, km, limit);
  }

  /**
   * Stille Auffrischung aus dem Netz. Liefert `null`, wenn der Direktabruf
   * nicht geht — der Aufrufer behält dann einfach, was er hat.
   */
  async function refresh(lat, lon, km, limit) {
    if (source.kind === 'live') return null;          // steht schon live
    try {
      const list = await liveMetar(lat, lon, km);
      if (!Array.isArray(list) || !list.length) return null;
      const out = pick(list, lat, lon, km, limit);
      if (!out.length) return null;
      source = { kind: 'live', at: null };
      return out;
    } catch { return null; }
  }

  const byIcao = (list, ids) => {
    const out = {};
    for (const t of (Array.isArray(list) ? list : [])) {
      if (!t.icaoId || (ids && ids.indexOf(t.icaoId) < 0)) continue;
      const prev = out[t.icaoId];
      // mostRecent==1 ist die gültige Ausgabe, sonst die mit der neuesten Ausgabezeit
      if (!prev || t.mostRecent === 1 ||
          (prev.mostRecent !== 1 && (t.issueTime || '') > (prev.issueTime || ''))) {
        out[t.icaoId] = t;
      }
    }
    return out;
  };

  /** TAFs zu einer Liste von ICAO-Kennungen — dieselbe Reihenfolge wie beim METAR. */
  async function taf(ids) {
    if (!ids || !ids.length) return {};
    const repo = await repoData();
    if (source.kind !== 'live' && repo && Array.isArray(repo.taf) && repo.taf.length) {
      return byIcao(repo.taf, ids);
    }
    try {
      return byIcao(await getLive(`${BASE}/taf?ids=${ids.join(',')}&format=json`), ids);
    } catch {
      return repo && repo.taf ? byIcao(repo.taf, ids) : {};
    }
  }

  /** Platzsuche für die Eingabe einer ICAO-Kennung — auch aus der Kopie. */
  async function station(id) {
    const code = String(id || '').toUpperCase();
    const repo = await repoData();
    const hit = repo && Array.isArray(repo.metar) ? repo.metar.find(m => m.icaoId === code) : null;
    if (hit && hit.lat != null) {
      return { icaoId: hit.icaoId, name: hit.name || '', lat: hit.lat, lon: hit.lon, elev: hit.elev };
    }
    const list = await getLive(`${BASE}/stationinfo?ids=${encodeURIComponent(code)}&format=json`);
    const s = Array.isArray(list) ? list[0] : null;
    if (!s || s.lat == null) return null;
    return { icaoId: s.icaoId || code, name: s.site || s.name || '', lat: s.lat, lon: s.lon, elev: s.elev };
  }

  /* ------------------------------------------------------------- Klartext
   * Nur so viel, wie in zwei Zeilen passt. Der Rohtext steht ohnehin darunter
   * und bleibt massgebend — das hier ist eine Lesehilfe, keine Auswertung.
   */
  const COVER = { SKC: 'wolkenlos', CLR: 'wolkenlos', NCD: 'wolkenlos', NSC: 'keine sig. Wolken',
                  CAVOK: 'CAVOK', FEW: 'FEW', SCT: 'SCT', BKN: 'BKN', OVC: 'OVC', OVX: 'OVX' };

  /** Bedeckungsgrad in Achteln, wie ihn die Abkürzung meint. */
  const OKTA = { FEW: '1–2/8', SCT: '3–4/8', BKN: '5–7/8', OVC: '8/8', OVX: 'unbestimmt' };

  const WX_INT = { '-': 'leicht', '+': 'stark', VC: 'in der Nähe' };
  const WX_DESC = { MI: 'flach', BC: 'Schwaden', PR: 'teilweise', DR: 'Fegen', BL: 'Treiben',
                    SH: 'Schauer', TS: 'Gewitter', FZ: 'gefrierend' };
  const WX_PHEN = { DZ: 'Niesel', RA: 'Regen', SN: 'Schnee', SG: 'Schneegriesel', IC: 'Eisnadeln',
                    PL: 'Eiskorn', GR: 'Hagel', GS: 'Graupel', UP: 'unbekannter Niederschlag',
                    BR: 'Dunst', FG: 'Nebel', FU: 'Rauch', VA: 'Vulkanasche', DU: 'Staub',
                    SA: 'Sand', HZ: 'trockener Dunst', PY: 'Sprühnebel',
                    PO: 'Staubwirbel', SQ: 'Bö', FC: 'Trombe', SS: 'Sandsturm', DS: 'Staubsturm' };
  /** Wendungen, die zusammengesetzt sonst unbeholfen klängen. */
  const WX_PAIR = { SHRA: 'Regenschauer', SHSN: 'Schneeschauer', SHGR: 'Hagelschauer',
                    SHGS: 'Graupelschauer', TSRA: 'Gewitter mit Regen', TSGR: 'Gewitter mit Hagel',
                    TSSN: 'Gewitter mit Schnee', FZRA: 'gefrierender Regen',
                    FZDZ: 'gefrierender Niesel', FZFG: 'gefrierender Nebel',
                    BLSN: 'Schneetreiben', DRSN: 'Schneefegen', MIFG: 'flacher Nebel' };

  /** "-SHRA" → "Regenschauer, leicht". Unbekanntes bleibt, wie es ist. */
  function wxText(code) {
    let t = String(code || '').toUpperCase();
    if (!t || t === 'NSW') return t === 'NSW' ? 'keine signifikante Witterung' : '';
    let pre = '';
    if (t[0] === '-' || t[0] === '+') { pre = WX_INT[t[0]]; t = t.slice(1); }
    if (t.startsWith('VC')) { pre = WX_INT.VC; t = t.slice(2); }
    const parts = [];
    let rest = t;
    while (rest.length >= 2) {
      const two = rest.slice(0, 2);
      if (WX_PAIR[rest.slice(0, 4)]) { parts.push(WX_PAIR[rest.slice(0, 4)]); rest = rest.slice(4); continue; }
      if (WX_DESC[two]) { parts.push(WX_DESC[two]); rest = rest.slice(2); continue; }
      if (WX_PHEN[two]) { parts.push(WX_PHEN[two]); rest = rest.slice(2); continue; }
      break;
    }
    if (!parts.length) return code;
    const body = parts.join(' ');
    return pre ? `${body}, ${pre}` : body;
  }

  /** "BKN012" → "5–7/8 ab 1200 ft". */
  function layerText(l) {
    if (!l) return '';
    const o = OKTA[l.cover];
    if (!o) return COVER[l.cover] || l.cover;
    return l.base == null ? o : `${o} ab ${l.base} ft`;
  }

  /**
   * TAF-Rohtext → Kopf und Änderungsgruppen.
   * { icaoId, from, to, groups: [{kind, prob, from, to, wind, vis, wx[], clouds[]}] }
   * `from`/`to` sind {day, hour}; TAF nennt keinen Monat.
   */
  function parseTaf(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const id = (t.match(/\b([A-Z]{4})\s+\d{6}Z\b/) || [])[1] || null;
    const val = t.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    const out = {
      icaoId: id,
      from: val ? { day: +val[1], hour: +val[2] } : null,
      to: val ? { day: +val[3], hour: +val[4] } : null,
      groups: [],
    };

    // an den Wechselmarken zerlegen; alles davor ist die Grundlage
    const marks = /\b(FM\d{6}|TEMPO|BECMG|PROB\d{2}|INTER)\b/g;
    const cuts = [];
    let m;
    while ((m = marks.exec(t))) cuts.push({ at: m.index, tok: m[1] });
    const startBase = val ? val.index + val[0].length : 0;
    const pieces = [];
    pieces.push({ kind: 'BASE', text: t.slice(startBase, cuts.length ? cuts[0].at : t.length) });
    for (let i = 0; i < cuts.length; i++) {
      const end = i + 1 < cuts.length ? cuts[i + 1].at : t.length;
      pieces.push({ kind: cuts[i].tok, text: t.slice(cuts[i].at, end) });
    }

    // PROB30 TEMPO … gehört zusammen
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (/^PROB\d{2}$/.test(p.kind) && pieces[i + 1] &&
          (pieces[i + 1].kind === 'TEMPO' || pieces[i + 1].kind === 'INTER')) {
        pieces[i + 1].prob = +p.kind.slice(4);
        pieces[i + 1].text = p.text + ' ' + pieces[i + 1].text;
        pieces.splice(i, 1); i--;
      }
    }

    for (const p of pieces) {
      const g = parseGroup(p.text);
      g.kind = /^FM/.test(p.kind) ? 'FM' : p.kind;
      if (p.prob) g.prob = p.prob;
      if (g.kind === 'FM') {
        const f = p.text.match(/^FM(\d{2})(\d{2})(\d{2})/);
        if (f) g.from = { day: +f[1], hour: +f[2], min: +f[3] };
      } else if (g.kind !== 'BASE') {
        const w = p.text.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
        if (w) { g.from = { day: +w[1], hour: +w[2] }; g.to = { day: +w[3], hour: +w[4] }; }
      }
      if (g.wind || g.vis || g.wx.length || g.clouds.length) out.groups.push(g);
    }
    return out;
  }

  /** Wind, Sicht, Witterung und Wolken aus einem TAF-Abschnitt. */
  function parseGroup(text) {
    const g = { wind: null, vis: null, wx: [], clouds: [], cavok: false };
    const w = text.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/);
    if (w) {
      const f = w[4] === 'MPS' ? 1.943844 : 1;
      g.wind = { dir: w[1] === 'VRB' ? null : +w[1], spd: Math.round(+w[2] * f),
                 gust: w[3] ? Math.round(+w[3] * f) : null };
    }
    if (/\bCAVOK\b/.test(text)) { g.cavok = true; g.vis = { m: 9999, plus: true }; }
    else {
      const v = text.match(/\s(\d{4})\s/) || text.match(/\s(\d{4})$/);
      if (v) g.vis = { m: +v[1], plus: +v[1] >= 9999 };
    }
    for (const x of text.matchAll(/\s(?:(VC)|([+-]))?((?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\b/g)) {
      g.wx.push(`${x[1] || ''}${x[2] || ''}${x[3]}`);
    }
    if (/\bNSW\b/.test(text)) g.wx.push('NSW');
    for (const c of text.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g)) {
      g.clouds.push({ cover: c[1], base: +c[2] * 100, type: c[3] || null });
    }
    if (/\b(NSC|SKC|CLR|NCD)\b/.test(text)) {
      g.clouds.push({ cover: (text.match(/\b(NSC|SKC|CLR|NCD)\b/) || [])[1], base: null });
    }
    if (/\bVV(\d{3})\b/.test(text)) {
      g.clouds.push({ cover: 'OVX', base: +(/\bVV(\d{3})\b/.exec(text)[1]) * 100 });
    }
    return g;
  }

  /** Lowest BKN/OVC layer in ft AGL — the ceiling. */
  function ceiling(m) {
    let c = null;
    for (const l of (m.clouds || [])) {
      if ((l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'OVX') && l.base != null) {
        c = c == null ? l.base : Math.min(c, l.base);
      }
    }
    return c;
  }

  /**
   * Sicht in km. Die NOAA rechnet in Landmeilen und meldet "10+" für alles
   * darüber — daraus würden 16 km. In Europa steht im METAR aber 9999, und das
   * heisst nach ICAO schlicht "10 km oder mehr". Steht 9999 im Rohtext, wird
   * deshalb bei 10 km gedeckelt.
   */
  function visKm(m) {
    if (m.visib == null) return null;
    const raw = m.rawOb || '';
    const icao9999 = /\s(9999|CAVOK)(\s|$)/.test(raw);
    if (typeof m.visib === 'string') {
      const plus = m.visib.includes('+');
      const v = parseFloat(m.visib);
      if (!isFinite(v)) return null;
      return icao9999 && plus ? { km: 10, plus: true, icao: true } : { km: v * 1.609, plus };
    }
    return { km: m.visib * 1.609, plus: false };
  }

  return { near, refresh, taf, station, reload, ceiling, visKm,
           wxText, layerText, parseTaf, parseGroup, COVER, OKTA, lastSource,
           landOf, LAND };
})();
