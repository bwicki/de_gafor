/* GaforCast — METAR and TAF from the NOAA Aviation Weather Center data API.
 * Free, no key, sends CORS headers, so the browser can call it straight from
 * GitHub Pages. German stations are covered like any other ICAO station.
 */
const METAR = (() => {
  'use strict';

  const BASE = 'https://aviationweather.gov/api/data';

  /** Degrees of latitude / longitude for a radius in km at this latitude. */
  function box(lat, lon, km) {
    const dLat = km / 111.2;
    const dLon = km / (111.2 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
  }

  /** Most recent METAR of every station within `km`, nearest first. */
  async function near(lat, lon, km, limit) {
    const b = box(lat, lon, km || 90);
    // bbox ist latMin,lonMin,latMax,lonMax; hours=3 liefert auch ältere Meldungen,
    // aus denen unten je Platz die neueste gewählt wird
    const url = `${BASE}/metar?bbox=${b.map(v => v.toFixed(3)).join(',')}&format=json&hours=3`;
    const list = await U.getJSON(url);
    const best = new Map();
    for (const m of (Array.isArray(list) ? list : [])) {
      if (!m.icaoId || m.lat == null) continue;
      const prev = best.get(m.icaoId);
      if (!prev || (m.obsTime || 0) > (prev.obsTime || 0)) best.set(m.icaoId, m);
    }
    // die Box ist ein Rechteck, gefragt ist ein Kreis
    const out = [...best.values()]
      .map(m => ({ ...m, distKm: U.distKm(lat, lon, m.lat, m.lon) }))
      .filter(m => m.distKm <= (km || 100))
      .sort((a, b2) => a.distKm - b2.distKm);
    return out.slice(0, limit || 8);
  }

  /** Raw TAFs for a list of ICAO ids. */
  async function taf(ids) {
    if (!ids || !ids.length) return {};
    const list = await U.getJSON(`${BASE}/taf?ids=${ids.join(',')}&format=json`);
    const out = {};
    for (const t of (Array.isArray(list) ? list : [])) {
      if (!t.icaoId) continue;
      const prev = out[t.icaoId];
      // mostRecent==1 ist die gültige Ausgabe, sonst die mit der neuesten Ausgabezeit
      if (!prev || t.mostRecent === 1 ||
          (prev.mostRecent !== 1 && (t.issueTime || '') > (prev.issueTime || ''))) {
        out[t.icaoId] = t;
      }
    }
    return out;
  }

  /** Station lookup, used so an ICAO code can be typed into the search box. */
  async function station(id) {
    const list = await U.getJSON(`${BASE}/stationinfo?ids=${encodeURIComponent(id)}&format=json`);
    const s = Array.isArray(list) ? list[0] : null;
    if (!s || s.lat == null) return null;
    return { icaoId: s.icaoId || id, name: s.site || s.name || '', lat: s.lat, lon: s.lon, elev: s.elev };
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
    const icao9999 = /\s9999(\s|$)/.test(raw);
    if (typeof m.visib === 'string') {
      const plus = m.visib.includes('+');
      const v = parseFloat(m.visib);
      if (!isFinite(v)) return null;
      return icao9999 && plus ? { km: 10, plus: true, icao: true } : { km: v * 1.609, plus };
    }
    return { km: m.visib * 1.609, plus: false };
  }

  /** GAFOR-style classification of an observation — a cross-check, not a forecast. */
  function classify(m, elevM) {
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

  return { near, taf, station, ceiling, cloudText, visKm, classify, COVER, CAT_CLASS };
})();
