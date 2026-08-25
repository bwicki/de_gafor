/* GaforCast — place search and reverse geocoding.
 * Free-text search goes to the Open-Meteo geocoder (same source as StueveCast);
 * coordinates typed directly are parsed locally; ICAO codes are resolved from
 * the METAR station list, so "EDLW" or "EDDS" work as search terms too.
 */
const GEO = (() => {
  'use strict';

  // ---------- coordinate parsing ----------
  // Accepts "51.23 7.45", "51,23 7,45", "N51 23.4 E007 12.0", "51°13'48\"N 7°27'E"
  function parseCoords(raw) {
    const s = (raw || '').trim();
    if (!s) return null;

    const dec = s.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
    if (dec) {
      const lat = parseFloat(dec[1].replace(',', '.'));
      const lon = parseFloat(dec[2].replace(',', '.'));
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, name: 'Koordinaten' };
    }

    const re = /([NSEWnsew])?\s*(\d{1,3})\s*[°º:\s]\s*(\d{1,2}(?:[.,]\d+)?)?\s*['′:\s]?\s*(\d{1,2}(?:[.,]\d+)?)?\s*["″]?\s*([NSEWnsew])?/g;
    const hits = [];
    let m;
    while ((m = re.exec(s)) && hits.length < 2) {
      if (!m[2]) continue;
      const hemi = (m[1] || m[5] || '').toUpperCase();
      const deg = parseFloat(m[2]);
      const min = m[3] ? parseFloat(m[3].replace(',', '.')) : 0;
      const sec = m[4] ? parseFloat(m[4].replace(',', '.')) : 0;
      let v = deg + min / 60 + sec / 3600;
      if (hemi === 'S' || hemi === 'W') v = -v;
      hits.push({ v, hemi });
    }
    if (hits.length === 2) {
      let a = hits[0], b = hits[1];
      if (a.hemi === 'E' || a.hemi === 'W' || b.hemi === 'N' || b.hemi === 'S') { const t = a; a = b; b = t; }
      if (Math.abs(a.v) <= 90 && Math.abs(b.v) <= 180) return { lat: a.v, lon: b.v, name: 'Koordinaten' };
    }
    return null;
  }

  // ---------- free-text search ----------
  async function search(query) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const coords = parseCoords(q);
    if (coords) return [{ ...coords, admin: U.fmtCoord(coords.lat, coords.lon), kind: 'coord' }];

    const out = [];

    // ICAO / airfield hit first — pilots type EDxx more often than town names.
    if (/^[A-Za-z]{4}$/.test(q)) {
      try {
        const st = await METAR.station(q.toUpperCase());
        if (st) out.push({ name: `${st.icaoId} — ${st.name || ''}`.trim(), admin: 'Flugplatz',
                           lat: st.lat, lon: st.lon, kind: 'icao' });
      } catch { /* ignore, fall through to the geocoder */ }
    }

    try {
      const j = await U.getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(q) + '&count=10&language=de&format=json');
      for (const r of (j.results || [])) {
        out.push({
          name: r.name,
          admin: [r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude, lon: r.longitude,
          elevation: r.elevation, kind: 'place',
          country: r.country_code,
        });
      }
    } catch (e) { if (!out.length) throw e; }

    // German hits to the top — this is a German GAFOR tool.
    out.sort((a, b) => (b.country === 'DE') - (a.country === 'DE'));
    return out;
  }

  // ---------- reverse ----------
  let revTimer = 0;
  async function reverse(lat, lon) {
    const j = await U.getJSON(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}` +
      `&zoom=12&format=jsonv2`, { headers: { 'Accept-Language': 'de' } });
    const a = j.address || {};
    const place = a.village || a.hamlet || a.town || a.city || a.municipality ||
                  a.locality || a.county || j.name || '';
    const region = a.state || a.region || a.country || '';
    return place ? (region ? `${place}, ${region}` : place)
                 : (j.display_name || '').split(',').slice(0, 2).join(',');
  }

  /** Debounced reverse geocode — the map fires a lot of move events. */
  function reverseSoon(lat, lon, cb) {
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      try { cb(await reverse(lat, lon)); } catch { cb(null); }
    }, 700);
  }

  /** Elevation for the point (one cheap Open-Meteo call). */
  async function elevation(lat, lon) {
    const j = await U.getJSON(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`);
    return Array.isArray(j.elevation) ? j.elevation[0] : null;
  }

  return { search, parseCoords, reverse, reverseSoon, elevation };
})();
