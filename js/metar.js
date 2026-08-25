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
    const url = `${BASE}/metar?bbox=${b.map(v => v.toFixed(3)).join(',')}&format=json&taf=false&hours=3`;
    const list = await U.getJSON(url);
    const best = new Map();
    for (const m of (Array.isArray(list) ? list : [])) {
      if (!m.icaoId || m.lat == null) continue;
      const prev = best.get(m.icaoId);
      if (!prev || (m.obsTime || 0) > (prev.obsTime || 0)) best.set(m.icaoId, m);
    }
    const out = [...best.values()].map(m => ({
      ...m, distKm: U.distKm(lat, lon, m.lat, m.lon),
    })).sort((a, b2) => a.distKm - b2.distKm);
    return out.slice(0, limit || 5);
  }

  /** Raw TAFs for a list of ICAO ids. */
  async function taf(ids) {
    if (!ids || !ids.length) return {};
    const list = await U.getJSON(`${BASE}/taf?ids=${ids.join(',')}&format=json`);
    const out = {};
    for (const t of (Array.isArray(list) ? list : [])) {
      if (t.icaoId && !out[t.icaoId]) out[t.icaoId] = t;
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

  /** Visibility in km as a number (AWC reports statute miles or "10+"). */
  function visKm(m) {
    if (m.visib == null) return null;
    if (typeof m.visib === 'string') {
      const plus = m.visib.includes('+');
      const v = parseFloat(m.visib);
      if (!isFinite(v)) return null;
      return { km: v * 1.609, plus };
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

  return { near, taf, station, ceiling, cloudText, visKm, classify, COVER };
})();
