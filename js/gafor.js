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

  /* ------------------------------------------------------------------ Codes
   * Ein GAFOR-Code besteht aus Buchstabe und — bei Delta und Mike — einer
   * Ziffer. Der Buchstabe ist die Einstufung, die Ziffer sagt, welche
   * Kombination aus Bodensicht und Wolkenuntergrenze dahintersteckt.
   *
   * Zwei Dinge, die dabei gern übersehen werden:
   *  • Die Untergrenze zählt **über der Bezugshöhe des Gebiets** (refAltFt),
   *    nicht über Grund und nicht über NN.
   *  • Sie zählt erst ab einem Bedeckungsgrad von 5/8, also BKN oder OVC.
   *
   * Die Matrix ist aus zwei Definitionen des DWD-Merkblatts (D1 und M5, dort
   * wörtlich) und zwei unabhängigen Wiedergaben der vollständigen Tabelle
   * rekonstruiert; D2, M1, M3 und M4 kommen darin nicht vor. Verbindlich ist
   * die GAFOR-Legende des DWD.
   */
  const CLASSES = {
    C: { key: 'c', word: 'Charlie', label: 'frei' },
    O: { key: 'o', word: 'Oscar', label: 'offen' },
    D: { key: 'd', word: 'Delta', label: 'schwierig' },
    M: { key: 'm', word: 'Mike', label: 'kritisch' },
    X: { key: 'x', word: 'X-Ray', label: 'geschlossen' },
  };

  /** Sicht × Untergrenze über Bezugshöhe, je Code. */
  const CODES = {
    C:  { vis: '≥ 10 km',     base: '≥ 5000 ft' },
    O:  { vis: '≥ 8 km',      base: '≥ 2000 ft' },
    D1: { vis: '≥ 8 km',      base: '1000 – 2000 ft' },
    D3: { vis: '5 – 8 km',    base: '≥ 2000 ft' },
    D4: { vis: '5 – 8 km',    base: '1000 – 2000 ft' },
    M2: { vis: '≥ 8 km',      base: '500 – 1000 ft' },
    M5: { vis: '5 – 8 km',    base: '500 – 1000 ft' },
    M6: { vis: '1,5 – 5 km',  base: '≥ 2000 ft' },
    M7: { vis: '1,5 – 5 km',  base: '1000 – 2000 ft' },
    M8: { vis: '1,5 – 5 km',  base: '500 – 1000 ft' },
    X:  { vis: '< 1,5 km',    base: 'oder < 500 ft' },
  };

  /** Reihenfolge von gut nach schlecht — für Legende und Sortierung. */
  const CODE_ORDER = ['C', 'O', 'D1', 'D3', 'D4', 'M2', 'M5', 'M6', 'M7', 'M8', 'X'];

  /**
   * "D4" → alles, was die Anzeige braucht. Unbekannte Ziffern (der DWD könnte
   * jederzeit D2 ausgeben) fallen sauber auf die Buchstabenklasse zurück.
   */
  function codeInfo(c) {
    const code = String(c || '').toUpperCase().trim();
    const m = code.match(/^([CODMX])(\d?)$/);
    if (!m) return { key: 'none', code: code || '—', letter: code || '—', digit: '',
                     word: '', label: 'keine Angabe', vis: '', base: '', desc: '' };
    const cls = CLASSES[m[1]];
    const g = CODES[code] || null;
    return {
      key: cls.key, code, letter: m[1], digit: m[2] || '',
      word: cls.word, label: cls.label,
      vis: g ? g.vis : '', base: g ? g.base : '',
      desc: g ? `Sicht ${g.vis}, Untergrenze ${g.base} über Bezugshöhe`
              : `${cls.word} — Feinstufe ${code} nicht hinterlegt`,
    };
  }

  let fc = null;            // the FeatureCollection, once loaded
  let regionFc = null;      // die fünf Bereichsumrisse (nur zur Darstellung)
  let landFc = null;        // Landesgrenze (nur zur Darstellung)
  let meta = null;          // data/gafor-meta.json
  let byIdMeta = new Map();
  let ready = null;         // the load promise

  async function init(geoUrl, metaUrl) {
    if (ready) return ready;
    ready = (async () => {
      const [g, m, reg, land] = await Promise.all([
        U.getJSON(geoUrl || 'data/gafor-areas.geojson')
          .catch(e => { console.warn('GAFOR-Geometrie fehlt:', e.message);
                        return { type: 'FeatureCollection', features: [] }; }),
        U.getJSON(metaUrl || 'data/gafor-meta.json')
          .catch(e => { console.warn('GAFOR-Metadaten fehlen:', e.message);
                        return { regions: {}, areas: [] }; }),
        U.getJSON('data/gafor-regions.geojson').catch(() => null),
        U.getJSON('data/germany.geojson').catch(() => null),
      ]);
      fc = g; meta = m; regionFc = reg; landFc = land;

      byIdMeta = new Map();
      for (const a of (meta.areas || [])) byIdMeta.set(String(a.id), a);

      // merge the metadata into the geometry so everything downstream sees one object
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
        if (c) p.center = c;                 // die Karte setzt darauf ihre Beschriftung
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
  const areas = () => (fc ? fc.features : []);
  const count = () => areas().length;

  /* Wie weit ausserhalb eines Polygons noch zugeordnet wird. Die Grenzen sind
   * aus der DFS-Karte digitalisiert und auf etwa ±2 km genau; 10 km fangen das
   * ab, ohne dass ein Ort im Nachbarland noch ein deutsches Gebiet bekommt. */
  const SNAP_KM = 10;

  /**
   * Which GAFOR area is a point in?
   * Returns {id, name, region, office, balloon, method, distKm} or null.
   *   method 'polygon' — the point is inside the area polygon
   *   method 'nearest' — no polygon matched, nearest area centre within SNAP_KM
   */
  /** Kürzeste Entfernung zu einem Stützpunkt der Aussenringe, in km. */
  function edgeDistKm(lat, lon, geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
                : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    let best = Infinity;
    for (const rings of polys) {
      for (const [x, y] of rings[0]) {
        // grobe Vorprüfung, spart den teuren Grosskreis für weit entfernte Punkte
        if (Math.abs(y - lat) > 1.2 || Math.abs(x - lon) > 1.8) continue;
        const d = U.distKm(lat, lon, y, x);
        if (d < best) best = d;
      }
    }
    return best;
  }

  function lookup(lat, lon) {
    for (const f of areas()) {
      if (f.geometry && U.inGeometry(lon, lat, f.geometry)) {
        return Object.assign({}, f.properties, { method: 'polygon', distKm: 0 });
      }
    }
    // Nichts getroffen. Gemessen wird zum nächsten Polygonrand, nicht zum
    // Gebietsmittelpunkt — sonst hinge die Toleranz an der Gebietsgrösse.
    let best = null, bestD = Infinity;
    for (const f of areas()) {
      if (!f.geometry) continue;
      const d = edgeDistKm(lat, lon, f.geometry);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best && bestD <= SNAP_KM) {
      return Object.assign({}, best.properties, { method: 'nearest', distKm: bestD });
    }
    return null;
  }

  return { init, lookup, areas, count, regions, CODE_ORDER, codeInfo, SNAP_KM,
           collection: () => fc, regionCollection: () => regionFc, landCollection: () => landFc };
})();
