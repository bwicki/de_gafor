/* GaforCast — small helpers shared by every module. */
const U = (() => {
  'use strict';

  const $  = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  // ---------- numbers & geometry ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rad = (d) => d * Math.PI / 180;

  /** Great-circle distance in km. */
  function distKm(lat1, lon1, lat2, lon2) {
    const R = 6371.0088;
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Ray casting on a single ring, [ [lon,lat], ... ]. */
  function inRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /** GeoJSON Polygon / MultiPolygon containment. */
  function inGeometry(lon, lat, geom) {
    if (!geom) return false;
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
                : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const rings of polys) {
      if (!rings.length || !inRing(lon, lat, rings[0])) continue;
      let hole = false;
      for (let h = 1; h < rings.length; h++) if (inRing(lon, lat, rings[h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }

  /** Area centroid (mean of outer-ring vertices, good enough for labels). */
  function centroid(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
                : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    let sx = 0, sy = 0, n = 0;
    for (const rings of polys) for (const [x, y] of rings[0]) { sx += x; sy += y; n++; }
    return n ? [sy / n, sx / n] : null;         // [lat, lon]
  }

  // ---------- formatting ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmtCoord = (lat, lon) =>
    `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}  ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;

  function fmtLocal(d, withDate) {
    if (!(d instanceof Date) || isNaN(d)) return '—';
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return withDate ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${t}` : t;
  }
  const fmtUTC = (d) => `${pad(d.getUTCDate())}. ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

  /** "vor 12 min" / "vor 3 h 40 min". */
  function ago(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `vor ${h} h ${r} min` : `vor ${h} h`;
  }
  function ageClass(iso, staleMin, oldMin) {
    if (!iso) return 'age';
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m > oldMin) return 'age old';
    if (m > staleMin) return 'age stale';
    return 'age';
  }

  // ---------- wind units ----------
  const MS_TO = { kt: 1.943844, kmh: 3.6, ms: 1 };
  const unitLabel = { kt: 'kt', kmh: 'km/h', ms: 'm/s' };
  function wind(ms, unit) {
    if (ms == null || !isFinite(ms)) return '—';
    return `${Math.round(ms * MS_TO[unit || 'kt'])}`;
  }
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirName = (deg) => (deg == null || !isFinite(deg)) ? '—' : DIRS[Math.round(deg / 22.5) % 16];
  const dirArrow = (deg) => (deg == null || !isFinite(deg)) ? '' :
    `<span style="display:inline-block;transform:rotate(${(deg + 180) % 360}deg)">↑</span>`;

  // ---------- storage ----------
  function load(key, dflt) {
    try { const v = localStorage.getItem('gaforcast.' + key); return v == null ? dflt : JSON.parse(v); }
    catch { return dflt; }
  }
  function save(key, val) {
    try { localStorage.setItem('gaforcast.' + key, JSON.stringify(val)); } catch { /* private mode */ }
  }

  // ---------- fetch ----------
  async function getJSON(url, opts) {
    const r = await fetch(url, Object.assign({ cache: 'no-cache' }, opts || {}));
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }

  return { $, el, clear, clamp, distKm, inRing, inGeometry, centroid,
           fmtCoord, fmtLocal, fmtUTC, ago, ageClass, pad,
           wind, unitLabel, dirName, dirArrow, load, save, getJSON };
})();
