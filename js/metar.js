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

  // ---------- readable summary ----------
  const COVER = { SKC: 'wolkenlos', CLR: 'wolkenlos', NCD: 'wolkenlos', NSC: 'keine sig. Wolken',
                  CAVOK: 'CAVOK', FEW: 'FEW', SCT: 'SCT', BKN: 'BKN', OVC: 'OVC', OVX: 'OVX' };

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

  function cloudText(m) {
    const cl = m.clouds || [];
    if (!cl.length) return '—';
    return cl.map(l => l.base == null ? (COVER[l.cover] || l.cover)
                                      : `${l.cover} ${l.base} ft`).join(', ');
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

  /** GAFOR-style classification of an observation — a cross-check, not a forecast. */
  function classify(m) {
    const v = visKm(m);
    const c = ceiling(m);
    if (!v) return null;
    const vis = v.km, cig = c == null ? 99999 : c;      // no ceiling reported = unlimited
    if (vis >= 10 && cig >= 2000) return 'C';
    if (vis >= 8  && cig >= 1500) return 'O';
    if (vis >= 5  && cig >= 1000) return 'D';
    if (vis >= 5  && cig >= 500)  return 'M';
    return 'X';
  }

  /** NOAA flight category → Farbklasse der Badge. */
  const CAT_CLASS = { VFR: 'c', MVFR: 'o', IFR: 'm', LIFR: 'x' };

  return { near, refresh, taf, station, reload, ceiling, cloudText, visKm, classify,
           COVER, CAT_CLASS, lastSource, box, pick };
})();
