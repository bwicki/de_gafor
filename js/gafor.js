/* GaforCast — GAFOR area geometry and the flight-condition code legend.
 *
 * The geometry lives in data/gafor-areas.geojson as a FeatureCollection whose
 * features carry:
 *   id       "45"            two-digit GAFOR area number
 *   name     "Sauerland"     area name as used by DWD
 *   region   "Mitte"         Nord | Mitte | Sued
 *   office   "EDZF"          issuing DWD office (used to pick the bulletin)
 *   balloon  "Mitte-West"    balloon-forecast region this area belongs to
 * Everything else in the app treats the geometry as swappable data, so a better
 * polygon set can be dropped in without touching code.
 */
const GAFOR = (() => {
  'use strict';

  /** Official GAFOR flight-condition codes. */
  const CODES = {
    C: { key: 'c', letter: 'C', word: 'Charlie', label: 'offen',
         desc: 'Sicht ≥ 10 km und Wolkenuntergrenze ≥ 2000 ft GND' },
    O: { key: 'o', letter: 'O', word: 'Oscar', label: 'offen, eingeschränkt',
         desc: 'Sicht ≥ 8 km und Wolkenuntergrenze ≥ 1500 ft GND' },
    D: { key: 'd', letter: 'D', word: 'Delta', label: 'schwierig',
         desc: 'Sicht ≥ 5 km und Wolkenuntergrenze ≥ 1000 ft GND' },
    M: { key: 'm', letter: 'M', word: 'Mike', label: 'marginal',
         desc: 'Sicht ≥ 5 km und Wolkenuntergrenze ≥ 500 ft GND' },
    X: { key: 'x', letter: 'X', word: 'X-ray', label: 'geschlossen',
         desc: 'schlechter als Mike' },
  };
  const codeInfo = (c) => CODES[(c || '').toUpperCase()] ||
    { key: 'none', letter: c || '—', word: '', label: 'keine Angabe', desc: '' };

  let fc = null;            // the FeatureCollection, once loaded
  let meta = null;          // data/gafor-meta.json
  let byIdMeta = new Map();
  let ready = null;         // the load promise
  let centroids = new Map();

  async function init(geoUrl, metaUrl) {
    if (ready) return ready;
    ready = (async () => {
      const [g, m] = await Promise.all([
        U.getJSON(geoUrl || 'data/gafor-areas.geojson')
          .catch(e => { console.warn('GAFOR-Geometrie fehlt:', e.message);
                        return { type: 'FeatureCollection', features: [] }; }),
        U.getJSON(metaUrl || 'data/gafor-meta.json')
          .catch(e => { console.warn('GAFOR-Metadaten fehlen:', e.message);
                        return { regions: {}, areas: [] }; }),
      ]);
      fc = g; meta = m;

      byIdMeta = new Map();
      for (const a of (meta.areas || [])) byIdMeta.set(String(a.id), a);

      // merge the metadata into the geometry so everything downstream sees one object
      centroids = new Map();
      for (const f of fc.features) {
        const p = f.properties || (f.properties = {});
        const id = String(p.id ?? '');
        const md = byIdMeta.get(id);
        if (md) {
          p.name = p.name || md.name;
          p.region = p.region || md.region;
          p.refAltFt = md.refAltFt;
          const reg = (meta.regions || {})[md.region];
          if (reg) { p.office = p.office || reg.office; p.officeName = reg.officeName; p.regionName = reg.name; }
        }
        const c = p.center ? [p.center[0], p.center[1]] : U.centroid(f.geometry);
        if (c) { centroids.set(id, c); p.center = c; }
      }
      return fc;
    })();
    return ready;
  }

  /** The five GAFOR areas-of-responsibility, with the areas belonging to each. */
  function regions() {
    const out = [];
    for (const [key, r] of Object.entries((meta && meta.regions) || {})) {
      out.push({ key, ...r, ids: (meta.areas || []).filter(a => a.region === key).map(a => a.id) });
    }
    return out;
  }
  const metaFor = (id) => byIdMeta.get(String(id)) || null;
  const allMeta = () => (meta && meta.areas) || [];

  const areas = () => (fc ? fc.features : []);
  const count = () => areas().length;
  const byId  = (id) => areas().find(f => String(f.properties.id) === String(id)) || null;

  /**
   * Which GAFOR area is a point in?
   * Returns {id, name, region, office, balloon, method, distKm} or null.
   *   method 'polygon' — the point is inside the area polygon
   *   method 'nearest' — no polygon matched, nearest area centre within 60 km
   */
  function lookup(lat, lon) {
    for (const f of areas()) {
      if (f.geometry && U.inGeometry(lon, lat, f.geometry)) {
        return Object.assign({}, f.properties, { method: 'polygon', distKm: 0 });
      }
    }
    let best = null, bestD = Infinity;
    for (const [id, c] of centroids) {
      const d = U.distKm(lat, lon, c[0], c[1]);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best != null && bestD <= 60) {
      const f = byId(best);
      return Object.assign({}, f.properties, { method: 'nearest', distKm: bestD });
    }
    return null;
  }

  /** Areas whose centre is within `km` of the point, nearest first. */
  function near(lat, lon, km) {
    const out = [];
    for (const [id, c] of centroids) {
      const d = U.distKm(lat, lon, c[0], c[1]);
      if (d <= (km || 120)) out.push({ id, distKm: d, props: byId(id).properties });
    }
    return out.sort((a, b) => a.distKm - b.distKm);
  }

  return { init, lookup, near, areas, count, byId, centroids: () => centroids,
           regions, metaFor, allMeta, CODES, codeInfo, collection: () => fc };
})();
