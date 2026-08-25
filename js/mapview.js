/* GaforCast — the map: OSM tiles, the GAFOR area layer and the fixed crosshair. */
const MAPVIEW = (() => {
  'use strict';

  let map = null, areaLayer = null, labelLayer = null, marker = null;
  let onMove = () => {};
  let highlighted = null;
  let showAreas = true;

  const STYLE = {
    base:  { color: '#f0a63d', weight: 1, opacity: .55, fillColor: '#f0a63d', fillOpacity: .05 },
    hi:    { color: '#f0a63d', weight: 2.5, opacity: 1,  fillColor: '#f0a63d', fillOpacity: .22 },
  };

  /* One colour per GAFOR-Bereich, so the five regions read at a glance. */
  const REGION_COLOR = {
    Nord:  '#4fd0e7',
    Ost:   '#b98fd1',
    West:  '#3fbf7f',
    Mitte: '#f0a63d',
    Sued:  '#ff8b3d',
  };
  let colorMode = 'region';          // 'region' | 'plain'

  function styleFor(f, on) {
    const c = colorMode === 'region'
      ? (REGION_COLOR[f.properties.region] || '#f0a63d')
      : '#f0a63d';
    return on
      ? { color: c, weight: 2.6, opacity: 1, fillColor: c, fillOpacity: .3 }
      : { color: c, weight: 1, opacity: .6, fillColor: c, fillOpacity: .08 };
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
    }).addTo(map);

    areaLayer = L.geoJSON(null, {
      style: (f) => styleFor(f, false),
      onEachFeature: (f, lyr) => {
        lyr.on('click', () => { const c = lyr.getBounds().getCenter(); map.panTo(c); });
      },
    }).addTo(map);
    labelLayer = L.layerGroup().addTo(map);

    let t = 0;
    map.on('move', () => { clearTimeout(t); t = setTimeout(fire, 120); });
    map.on('moveend', fire);
    return map;
  }

  function fire() {
    if (!map) return;
    const c = map.getCenter();
    onMove(c.lat, c.lng);
  }

  /** Put the GAFOR polygons on the map. */
  function setAreas(fc) {
    if (!areaLayer) return;
    areaLayer.clearLayers();
    U.clear(labelLayer._container || document.createElement('div'));
    labelLayer.clearLayers();
    if (!fc || !fc.features || !fc.features.length) return;
    areaLayer.addData(fc);
    for (const f of fc.features) {
      const c = f.properties.center || U.centroid(f.geometry);
      if (!c) continue;
      labelLayer.addLayer(L.marker([c[0], c[1]], {
        interactive: false,
        icon: L.divIcon({ className: '', html: `<div class="gafor-label">${f.properties.id}</div>`,
                          iconSize: [26, 12], iconAnchor: [13, 6] }),
      }));
    }
    if (!showAreas) toggleAreas(false);
  }

  function highlight(id) {
    if (!areaLayer) return;
    highlighted = id == null ? null : String(id);
    areaLayer.eachLayer(l => {
      const on = highlighted != null && String(l.feature.properties.id) === highlighted;
      l.setStyle(styleFor(l.feature, on));
      if (on) l.bringToFront();
    });
  }

  /** Switch between one colour per Bereich and a single accent colour. */
  function setColorMode(m) {
    colorMode = m === 'region' ? 'region' : 'plain';
    highlight(highlighted);
    return colorMode;
  }
  const regionColor = (r) => REGION_COLOR[r] || '#f0a63d';

  function toggleAreas(on) {
    showAreas = on == null ? !showAreas : on;
    if (showAreas) { map.addLayer(areaLayer); map.addLayer(labelLayer); }
    else { map.removeLayer(areaLayer); map.removeLayer(labelLayer); }
    return showAreas;
  }

  function center(lat, lon, zoom) {
    if (!map) return;
    map.setView([lat, lon], zoom || map.getZoom(), { animate: true });
  }
  function germany() { if (map) map.fitBounds([[47.2, 5.8], [55.1, 15.1]]); }
  const get = () => map;

  return { init, setAreas, highlight, toggleAreas, setColorMode, regionColor,
           center, germany, get, fire };
})();
