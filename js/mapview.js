/* GaforCast — the map: OSM tiles, three boundary layers and the fixed crosshair.
 *
 * Boundaries have to read on top of a busy basemap, so every line is drawn
 * twice: a light casing underneath and the coloured line on top. The three
 * levels are deliberately different in weight — Landesgrenze kräftig, Bereiche
 * darunter, Gebiete fein.
 */
const MAPVIEW = (() => {
  'use strict';

  let map = null;
  let areaLayer = null, regionLayer = null, regionCase = null;
  let landLayer = null, landCase = null, labelLayer = null;
  let maskLayer = null, maskFc = null, maskDark = false;
  let onMove = () => {};
  let highlighted = null;
  let level = 2;                    // 2 = alles, 1 = nur Bereiche, 0 = aus

  /* One colour per GAFOR-Bereich, so the five regions read at a glance. */
  const REGION_COLOR = {
    Nord:  '#2196c4',
    Ost:   '#8e5bb5',
    West:  '#1e9e63',
    Mitte: '#d4881a',
    Sued:  '#e0662a',
  };
  const regionColor = (r) => REGION_COLOR[r] || '#d4881a';

  const CASING = { color: '#ffffff', opacity: .75, fill: false, lineJoin: 'round' };
  const LAND = '#11161f';

  function areaStyle(f, on) {
    const c = regionColor(f.properties.region);
    return on
      ? { color: c, weight: 3.4, opacity: 1, fillColor: c, fillOpacity: .28, lineJoin: 'round' }
      : { color: c, weight: 1.3, opacity: .85, fillColor: c, fillOpacity: .05, lineJoin: 'round' };
  }

  function init(elId, opts) {
    onMove = (opts && opts.onMove) || onMove;
    map = L.map(elId, {
      center: (opts && opts.center) || [51.1, 10.4],
      zoom: (opts && opts.zoom) || 6,
      zoomControl: false,
      attributionControl: true,
      tap: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap',
      // ohne crossOrigin wäre die Leinwand beim Seitenbild (html2canvas) tainted
      crossOrigin: true,
    }).addTo(map);

    // eigene Ebenen, damit die Reihenfolge feststeht
    for (const [name, z] of [['gafor-mask', 405], ['gafor-areas', 410], ['gafor-land', 420],
                             ['gafor-regions', 430], ['gafor-labels', 450]]) {
      map.createPane(name).style.zIndex = z;
    }
    map.getPane('gafor-labels').style.pointerEvents = 'none';
    map.getPane('gafor-mask').style.pointerEvents = 'none';

    areaLayer = L.geoJSON(null, {
      pane: 'gafor-areas',
      style: (f) => areaStyle(f, false),
      onEachFeature: (f, lyr) => lyr.on('click', () => map.panTo(lyr.getBounds().getCenter())),
    }).addTo(map);

    landCase = L.geoJSON(null, { pane: 'gafor-land', interactive: false,
      style: { ...CASING, weight: 5, opacity: .8 } }).addTo(map);
    landLayer = L.geoJSON(null, { pane: 'gafor-land', interactive: false,
      style: { color: LAND, weight: 2.2, opacity: .95, fill: false, lineJoin: 'round' } }).addTo(map);

    regionCase = L.geoJSON(null, { pane: 'gafor-regions', interactive: false,
      style: { ...CASING, weight: 5.5 } }).addTo(map);
    regionLayer = L.geoJSON(null, { pane: 'gafor-regions', interactive: false,
      style: (f) => ({ color: regionColor(f.properties.region), weight: 3, opacity: .95,
                       fill: false, lineJoin: 'round' }) }).addTo(map);

    labelLayer = L.layerGroup([], { pane: 'gafor-labels' }).addTo(map);

    let t = 0;
    map.on('move', () => { clearTimeout(t); t = setTimeout(fire, 120); });
    map.on('moveend', fire);
    map.on('zoomend', applyLevel);
    return map;
  }

  function fire() {
    if (!map) return;
    const c = map.getCenter();
    onMove(c.lat, c.lng);
  }

  /** Die Gebietspolygone. */
  function setAreas(fc) {
    if (!areaLayer) return;
    areaLayer.clearLayers();
    labelLayer.clearLayers();
    if (!fc || !fc.features || !fc.features.length) return;
    areaLayer.addData(fc);
    for (const f of fc.features) {
      const c = f.properties.center || U.centroid(f.geometry);
      if (!c) continue;
      labelLayer.addLayer(L.marker([c[0], c[1]], {
        pane: 'gafor-labels', interactive: false,
        icon: L.divIcon({ className: '', html: `<div class="gafor-label">${f.properties.id}</div>`,
                          iconSize: [26, 14], iconAnchor: [13, 7] }),
      }));
    }
    applyLevel();
  }

  /** Bereichsumrisse und Landesgrenze. */
  function setRegions(fc) { if (regionLayer) { regionLayer.clearLayers(); regionCase.clearLayers();
    if (fc) { regionCase.addData(fc); regionLayer.addData(fc); } applyLevel(); } }
  function setLand(fc) { if (landLayer) { landLayer.clearLayers(); landCase.clearLayers();
    if (fc) { landCase.addData(fc); landLayer.addData(fc); } applyLevel(); } }

  /* ---------------------------------------------------------------- Maske
   * Alles ausserhalb der GAFOR-Gebiete wird abgedeckt: ein Rechteck über die
   * ganze Welt, in das die Umrisse als Löcher gestanzt werden. Leaflet zeichnet
   * Polygone mit fill-rule evenodd, deshalb genügt es, die Aussenringe als
   * weitere Ringe desselben Polygons anzuhängen.
   */
  const maskStyle = () => (maskDark
    ? { stroke: false, fillColor: '#05080c', fillOpacity: .74, className: 'gafor-mask' }
    : { stroke: false, fillColor: '#59636f', fillOpacity: .58, className: 'gafor-mask' });

  function setMask(fc) {
    maskFc = fc || null;
    drawMask();
  }

  /** Hell/dunkel umschalten — die Maske muss in beiden Fällen dämpfen. */
  function setMaskTheme(dark) {
    if (maskDark === !!dark) return;
    maskDark = !!dark;
    if (maskLayer) maskLayer.setStyle(maskStyle());
  }

  function drawMask() {
    if (!map) return;
    if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
    if (!maskFc || !maskFc.features || !maskFc.features.length) return;
    const rings = [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]];
    for (const f of maskFc.features) {
      if (!f.geometry) continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
                  : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      for (const p of polys) if (p[0] && p[0].length > 3) rings.push(p[0]);
    }
    if (rings.length < 2) return;
    maskLayer = L.geoJSON(
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } },
      { pane: 'gafor-mask', interactive: false, style: maskStyle() });
    applyLevel();
  }

  function highlight(id) {
    if (!areaLayer) return;
    highlighted = id == null ? null : String(id);
    areaLayer.eachLayer(l => {
      const on = highlighted != null && String(l.feature.properties.id) === highlighted;
      l.setStyle(areaStyle(l.feature, on));
      if (on) l.bringToFront();
    });
  }

  /** 2 = Gebiete + Bereiche + Land, 1 = nur Bereiche + Land, 0 = nichts. */
  function setLevel(v) {
    level = ((v == null ? level + 2 : v) % 3 + 3) % 3;
    applyLevel();
    return level;
  }
  const getLevel = () => level;

  function applyLevel() {
    if (!map) return;
    const showAreas = level >= 2;
    const showRest = level >= 1;
    const labels = level >= 2 && map.getZoom() >= 5;
    for (const [lyr, on] of [[areaLayer, showAreas], [labelLayer, labels],
                             [regionLayer, showRest], [regionCase, showRest],
                             [landLayer, showRest], [landCase, showRest],
                             [maskLayer, showRest]]) {
      if (!lyr) continue;
      if (on && !map.hasLayer(lyr)) map.addLayer(lyr);
      if (!on && map.hasLayer(lyr)) map.removeLayer(lyr);
    }
    if (showAreas) highlight(highlighted);
  }

  function center(lat, lon, zoom) {
    if (map) map.setView([lat, lon], zoom || map.getZoom(), { animate: true });
  }
  function germany() { if (map) map.fitBounds([[47.2, 5.8], [55.1, 15.1]], { padding: [8, 8] }); }
  const get = () => map;

  return { init, setAreas, setRegions, setLand, setMask, setMaskTheme,
           highlight, setLevel, getLevel, regionColor, center, germany, get, fire };
})();
