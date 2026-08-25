/* GaforCast — application logic: place → GAFOR area → reports. */
(() => {
  'use strict';

  const APP_VERSION = '1.0.0';

  const state = {
    lat: 51.10, lon: 10.40,
    place: null,
    elev: null,
    area: null,
    unit: U.load('unit', 'kt'),
    lastFetchAt: 0,
    lastFetchLat: null, lastFetchLon: null,
    om: null, metars: null, tafs: null,
    busy: {},
  };

  // ------------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    applyTheme(U.load('theme', prefersDark() ? 'dark' : 'light'));
    U.$('mUnitsBtn').textContent = `Windeinheit: ${U.unitLabel[state.unit]}`;

    const start = startPosition();
    state.lat = start.lat; state.lon = start.lon;
    if (start.name) state.place = start.name;

    MAPVIEW.init('map', { center: [state.lat, state.lon], zoom: start.zoom || 8, onMove: onMapMove });
    wireUI();
    renderPlace();
    footer();

    await GAFOR.init();
    MAPVIEW.setAreas(GAFOR.collection());
    renderLegend();
    if (!GAFOR.count()) {
      U.$('mapHint').textContent = 'Gebietsgrenzen fehlen — data/gafor-areas.geojson ist leer';
    }
    resolveArea();

    try { await DWD.load(); } catch (e) { console.warn('DWD index not available:', e.message); }
    renderReports();
    loadPointData(true);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    if (!start.explicit && navigator.geolocation) {
      // no place in the URL and nothing saved: offer the current position quietly
      navigator.geolocation.getCurrentPosition(
        p => { if (Date.now() - state.lastFetchAt < 15000) return; goTo(p.coords.latitude, p.coords.longitude, null, 9); },
        () => {}, { timeout: 8000, maximumAge: 600000 });
    }
  }

  const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  function startPosition() {
    const h = (location.hash || '').replace(/^#/, '');
    const m = h.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+))?$/);
    if (m) return { lat: +m[1], lon: +m[2], zoom: m[3] ? +m[3] : 9, explicit: true };
    const last = U.load('lastPlace', null);
    if (last) return { lat: last.lat, lon: last.lon, name: last.name, zoom: 9, explicit: true };
    return { lat: 51.10, lon: 10.40, zoom: 6, explicit: false };
  }

  // ------------------------------------------------------------------ UI wiring
  function wireUI() {
    // menu
    const menu = U.$('menu');
    U.$('menuBtn').onclick = () => menu.classList.toggle('hidden');
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== U.$('menuBtn')) menu.classList.add('hidden');
    });
    U.$('mThemeBtn').onclick = () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      menu.classList.add('hidden');
    };
    U.$('mUnitsBtn').onclick = () => {
      const order = ['kt', 'km/h', 'm/s'], keys = ['kt', 'kmh', 'ms'];
      const i = (keys.indexOf(state.unit) + 1) % keys.length;
      state.unit = keys[i]; U.save('unit', state.unit);
      U.$('mUnitsBtn').textContent = `Windeinheit: ${U.unitLabel[state.unit]}`;
      renderMetar(); renderModel();
    };
    U.$('mReloadBtn').onclick = async () => {
      menu.classList.add('hidden');
      try { await DWD.load(true); } catch { /* shown in the cards */ }
      renderReports(); loadPointData(true);
    };
    U.$('mShareBtn').onclick = () => {
      const url = `${location.origin}${location.pathname}#${state.lat.toFixed(4)},${state.lon.toFixed(4)},9`;
      if (navigator.share) navigator.share({ title: 'GaforCast', url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url)
        .then(() => flash('Link kopiert'), () => {});
      menu.classList.add('hidden');
    };
    U.$('mAboutBtn').onclick = () => { menu.classList.add('hidden'); showAbout(); };

    // map buttons
    U.$('areasBtn').onclick = () => {
      const on = MAPVIEW.toggleAreas();
      U.$('areasBtn').style.color = on ? '' : 'var(--text-dim)';
    };
    U.$('zoomDeBtn').onclick = () => MAPVIEW.germany();
    U.$('gpsBtn').onclick = useGPS;

    // favourites
    U.$('savePlaceBtn').onclick = saveCurrent;
    U.$('favBtn').onclick = showFavourites;

    // search
    const input = U.$('searchInput');
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) { hideResults(); return; }
      t = setTimeout(() => doSearch(q), 280);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(t); doSearch(input.value.trim(), true); input.blur(); }
      if (e.key === 'Escape') hideResults();
    });
    document.addEventListener('click', (e) => {
      if (!U.$('searchResults').contains(e.target) && e.target !== input) hideResults();
    });
  }

  function flash(msg) {
    const h = U.$('mapHint');
    const old = h.textContent;
    h.textContent = msg;
    setTimeout(() => { h.textContent = old; }, 2200);
  }

  function applyTheme(th) {
    document.documentElement.dataset.theme = th;
    U.save('theme', th);
  }

  // ------------------------------------------------------------------ search
  async function doSearch(q, jumpFirst) {
    if (!q) return;
    const box = U.$('searchResults');
    U.clear(box).appendChild(U.el('div', 'row r2', 'suche…'));
    box.classList.remove('hidden');
    let res = [];
    try { res = await GEO.search(q); }
    catch (e) { U.clear(box).appendChild(U.el('div', 'row r2', 'Suche nicht erreichbar')); return; }
    if (!res.length) { U.clear(box).appendChild(U.el('div', 'row r2', 'nichts gefunden')); return; }
    if (jumpFirst) { hideResults(); pick(res[0]); return; }
    U.clear(box);
    for (const r of res) {
      const row = U.el('div', 'row');
      row.appendChild(U.el('div', 'r1', r.name));
      row.appendChild(U.el('div', 'r2', `${r.admin || ''}${r.admin ? ' · ' : ''}${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`));
      row.onclick = () => { hideResults(); pick(r); };
      box.appendChild(row);
    }
  }
  const hideResults = () => U.$('searchResults').classList.add('hidden');

  function pick(r) {
    U.$('searchInput').value = '';
    goTo(r.lat, r.lon, r.name, 10);
  }

  function useGPS() {
    if (!navigator.geolocation) { flash('Kein Standort verfügbar'); return; }
    const b = U.$('gpsBtn');
    b.innerHTML = '<span class="spin">◎</span>';
    navigator.geolocation.getCurrentPosition(
      p => { b.textContent = '◎'; goTo(p.coords.latitude, p.coords.longitude, 'Mein Standort', 11); },
      () => { b.textContent = '◎'; flash('Standort nicht ermittelbar'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ------------------------------------------------------------------ place & area
  function goTo(lat, lon, name, zoom) {
    state.lat = lat; state.lon = lon;
    state.place = name || null;
    MAPVIEW.center(lat, lon, zoom);
    renderPlace();
    resolveArea();
    if (!name) GEO.reverseSoon(lat, lon, n => { if (n) { state.place = n; renderPlace(); } });
    loadPointData(true);
    remember();
  }

  let moveTimer = 0;
  function onMapMove(lat, lon) {
    state.lat = lat; state.lon = lon;
    state.place = null;
    renderPlace();
    resolveArea();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      GEO.reverseSoon(lat, lon, n => { if (n) { state.place = n; renderPlace(); } });
      loadPointData(false);
      remember();
    }, 900);
  }

  function remember() {
    U.save('lastPlace', { lat: state.lat, lon: state.lon, name: state.place });
    history.replaceState(null, '', `#${state.lat.toFixed(4)},${state.lon.toFixed(4)},${MAPVIEW.get().getZoom()}`);
  }

  function renderPlace() {
    U.$('placeName').textContent = state.place || 'Kartenmitte';
    U.$('placeCoords').textContent = U.fmtCoord(state.lat, state.lon) +
      (state.elev != null ? `  ·  ${Math.round(state.elev)} m` : '');
  }

  function resolveArea() {
    const a = GAFOR.lookup(state.lat, state.lon);
    const changed = (a && a.id) !== (state.area && state.area.id);
    state.area = a;
    MAPVIEW.highlight(a ? a.id : null);
    markLegend(a ? a.region : null);
    renderAreaHead();
    if (changed) renderReports();
  }

  function renderAreaHead() {
    const a = state.area;
    const num = U.$('areaNum'), name = U.$('areaName'), sub = U.$('areaSub'), st = U.$('areaState');
    U.clear(st);
    if (!a) {
      num.textContent = '—';
      name.textContent = GAFOR.count() ? 'Ausserhalb der GAFOR-Gebiete' : 'Keine Gebietsdaten geladen';
      sub.textContent = GAFOR.count() ? 'Der Ort liegt nicht in Deutschland.'
                                      : 'data/gafor-areas.geojson enthält keine Polygone.';
      return;
    }
    num.textContent = a.id;
    name.textContent = a.name || `Gebiet ${a.id}`;
    const bits = [];
    if (a.regionName || a.region) bits.push(`Bereich ${a.regionName || a.region}`);
    if (a.refAltFt != null) bits.push(`Bezugshöhe ${a.refAltFt} ft`);
    if (a.officeName) bits.push(a.officeName);
    if (a.method === 'nearest') bits.push(`nächstes Gebietszentrum, ${a.distKm.toFixed(0)} km`);
    sub.textContent = bits.join(' · ');

    const b = DWD.gaforFor(a);
    const code = b && b.codes && b.codes.length ? b.codes[0] : null;
    if (code) {
      const ci = GAFOR.codeInfo(code);
      const badge = U.el('span', `badge ${ci.key}`, ci.letter);
      st.appendChild(badge);
      st.appendChild(U.el('div', 't', ci.word || ''));
    }
  }

  function renderLegend() {
    const box = U.clear(U.$('regionLegend'));
    const regs = GAFOR.regions();
    if (!regs.length) return;
    box.appendChild(U.el('span', '', 'GAFOR-Bereiche:'));
    for (const r of regs) {
      const s = U.el('span', 'reg');
      s.dataset.region = r.key;
      s.innerHTML = `<span class="sw" style="background:${MAPVIEW.regionColor(r.key)}"></span>` +
                    `${r.name} <span class="dim">${r.ids.length}</span>`;
      s.title = `${r.officeName || ''} — Gebiete ${r.ids[0]}–${r.ids[r.ids.length - 1]}`;
      box.appendChild(s);
    }
  }

  function markLegend(region) {
    for (const s of U.$('regionLegend').querySelectorAll('.reg')) {
      s.classList.toggle('on', s.dataset.region === region);
    }
  }

  // ------------------------------------------------------------------ reports
  function renderReports() { renderGafor(); renderBalloon(); }

  function renderGafor() {
    const body = U.clear(U.$('gaforBody'));
    const age = U.$('gaforAge');
    const a = state.area;
    const b = a ? DWD.gaforFor(a) : null;

    if (!DWD.raw()) {
      age.textContent = '';
      body.appendChild(note('Die Berichtsdatei <strong>data/dwd/index.json</strong> wurde noch nicht geladen. ' +
        'Sie wird vom GitHub-Workflow erzeugt — läuft der noch nicht, bleibt diese Karte leer.'));
      return;
    }
    if (!a) { age.textContent = ''; body.appendChild(note('Zuerst einen Ort in Deutschland wählen.')); return; }
    if (!b) {
      age.textContent = '';
      body.appendChild(note(`Für Gebiet ${a.id} liegt derzeit kein GAFOR-Bulletin vor.`));
      return;
    }

    age.textContent = b.issued ? `ausgegeben ${U.ago(b.issued)}` : '';
    age.className = U.ageClass(b.issued, 240, 480);

    if (b.codes && b.codes.length && b.periods && b.periods.length) {
      const wrap = U.el('div', 'fc-scroll');
      const t = U.el('table', 'gafor-grid');
      const thead = U.el('thead'), hr = U.el('tr');
      hr.appendChild(U.el('th', '', 'Zeitraum UTC'));
      for (const p of b.periods) hr.appendChild(U.el('th', '', p));
      thead.appendChild(hr); t.appendChild(thead);
      const tb = U.el('tbody'), row = U.el('tr');
      row.appendChild(U.el('td', 'rt', `Gebiet ${a.id}`));
      for (let i = 0; i < b.periods.length; i++) {
        const c = b.codes[i] || '';
        const ci = GAFOR.codeInfo(c);
        const td = U.el('td');
        const cell = U.el('span', `cell ${ci.key}`, ci.letter);
        cell.title = `${ci.word} — ${ci.desc}`;
        td.appendChild(cell);
        row.appendChild(td);
      }
      tb.appendChild(row); t.appendChild(tb);
      wrap.appendChild(t); body.appendChild(wrap);

      const legend = U.el('div', 'note');
      legend.style.marginTop = '10px';
      legend.innerHTML = Object.values(GAFOR.CODES)
        .map(c => `<span class="cell ${c.key}">${c.letter}</span> ${c.word} — ${c.desc}`)
        .join('<br>');
      body.appendChild(legend);
    }

    if (b.text) {
      const pre = U.el('pre', 'report');
      pre.style.marginTop = b.codes ? '12px' : '0';
      pre.textContent = b.text;
      body.appendChild(pre);
    }
    if (b.source) body.appendChild(sourceLine(b.title || 'DWD', b.source));
  }

  function renderBalloon() {
    const body = U.clear(U.$('balloonBody'));
    const age = U.$('balloonAge');
    const b = DWD.balloonFor(state.area);

    if (!DWD.raw()) { age.textContent = ''; body.appendChild(note('Noch nicht geladen.')); return; }
    if (!b) {
      age.textContent = '';
      const regions = DWD.balloonRegions();
      body.appendChild(note(regions.length
        ? 'Für dieses Gebiet ist kein Ballonwetterbericht zugeordnet. Verfügbare Regionen:'
        : 'Zurzeit ist kein Ballonwetterbericht abrufbar.'));
      if (regions.length) {
        const row = U.el('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;';
        for (const r of regions) {
          const c = U.el('button', 'chip', r);
          c.onclick = () => showBalloon(DWD.balloon(r));
          row.appendChild(c);
        }
        body.appendChild(row);
      }
      return;
    }
    showBalloon(b);
  }

  function showBalloon(b) {
    const body = U.clear(U.$('balloonBody'));
    const age = U.$('balloonAge');
    if (!b) return;
    age.textContent = b.issued ? `ausgegeben ${U.ago(b.issued)}` : '';
    age.className = U.ageClass(b.issued, 300, 720);
    if (b.title) {
      const h = U.el('div', 'section-title', b.title);
      h.style.marginBottom = '8px';
      body.appendChild(h);
    }
    body.appendChild(Object.assign(U.el('pre', 'report'), { textContent: b.text || '' }));
    if (b.source) body.appendChild(sourceLine('DWD Ballonsport', b.source));
  }

  // ------------------------------------------------------------------ point data
  async function loadPointData(force) {
    const moved = state.lastFetchLat == null ||
      U.distKm(state.lat, state.lon, state.lastFetchLat, state.lastFetchLon) > 3;
    if (!force && !moved) return;
    state.lastFetchLat = state.lat; state.lastFetchLon = state.lon;
    state.lastFetchAt = Date.now();
    const lat = state.lat, lon = state.lon;

    GEO.elevation(lat, lon).then(e => {
      if (lat === state.lat && lon === state.lon) { state.elev = e; renderPlace(); }
    }).catch(() => {});

    // METAR / TAF
    U.$('metarAge').textContent = 'lädt…';
    METAR.near(lat, lon, 90, 5).then(async list => {
      if (lat !== state.lat || lon !== state.lon) return;
      state.metars = list;
      try { state.tafs = await METAR.taf(list.map(m => m.icaoId)); } catch { state.tafs = {}; }
      renderMetar();
    }).catch(e => {
      state.metars = null;
      U.clear(U.$('metarBody')).appendChild(wrapNote('METAR nicht erreichbar: ' + e.message));
      U.$('metarAge').textContent = '';
    });

    // Model forecast
    U.$('modelAge').textContent = 'lädt…';
    OM.forecast(lat, lon, 2).then(j => {
      if (lat !== state.lat || lon !== state.lon) return;
      state.om = j;
      renderModel();
    }).catch(e => {
      state.om = null;
      U.clear(U.$('modelBody')).appendChild(wrapNote('Open-Meteo nicht erreichbar: ' + e.message));
      U.$('modelAge').textContent = '';
    });
  }

  function renderMetar() {
    const body = U.clear(U.$('metarBody'));
    const list = state.metars;
    if (!list) return;
    if (!list.length) {
      U.$('metarAge').textContent = '';
      body.appendChild(wrapNote('Im Umkreis von 90 km meldet kein Platz METAR.'));
      return;
    }
    const newest = list.reduce((a, m) => Math.max(a, m.obsTime || 0), 0);
    U.$('metarAge').textContent = newest ? U.ago(new Date(newest * 1000).toISOString()) : '';
    U.$('metarAge').className = U.ageClass(newest ? new Date(newest * 1000).toISOString() : null, 75, 180);

    for (const m of list) {
      const row = U.el('div', 'metar-row');
      const top = U.el('div', 'metar-top');
      top.appendChild(U.el('span', 'metar-id', m.icaoId));
      top.appendChild(U.el('span', 'metar-name', m.name || ''));
      top.appendChild(U.el('span', 'metar-dist', `${m.distKm.toFixed(0)} km`));
      row.appendChild(top);

      const v = METAR.visKm(m), cig = METAR.ceiling(m), cls = METAR.classify(m);
      const sum = U.el('div', 'metar-sum');
      const add = (k, val) => { const s = U.el('span'); s.innerHTML = `${k} <b>${val}</b>`; sum.appendChild(s); };
      add('Wind', m.wdir == null ? '—'
        : `${m.wdir === 0 && m.wspd === 0 ? 'CALM' : U.pad(m.wdir) + '°'} ${windTxt(m.wspd)}` +
          (m.wgst ? ` G${windTxt(m.wgst)}` : ''));
      add('Sicht', v ? `${v.plus ? '≥' : ''}${v.km.toFixed(v.km < 10 ? 1 : 0)} km` : '—');
      add('Basis', cig == null ? 'keine' : `${cig} ft`);
      add('T/Td', `${fmt(m.temp)}/${fmt(m.dewp)} °C`);
      add('QNH', m.altim ? `${Math.round(m.altim)}` : '—');
      row.appendChild(sum);

      if (cls) {
        const ci = GAFOR.codeInfo(cls);
        const b = U.el('div');
        b.style.marginBottom = '6px';
        const badge = U.el('span', `badge ${ci.key}`, `${ci.letter} · ${ci.word}`);
        badge.title = 'aus der Beobachtung abgeleitet, kein DWD-GAFOR-Code';
        b.appendChild(badge);
        row.appendChild(b);
      }

      if (m.rawOb) row.appendChild(Object.assign(U.el('pre', 'raw'), { textContent: m.rawOb }));
      const t = state.tafs && state.tafs[m.icaoId];
      if (t && t.rawTAF) {
        const p = Object.assign(U.el('pre', 'raw'), { textContent: t.rawTAF });
        p.style.marginTop = '6px';
        row.appendChild(p);
      }
      body.appendChild(row);
    }
  }

  const fmt = (v) => (v == null || !isFinite(v)) ? '—' : Math.round(v);
  function windTxt(kt) {
    if (kt == null) return '—';
    const ms = kt * 0.514444;
    return `${U.wind(ms, state.unit)} ${U.unitLabel[state.unit]}`;
  }

  function renderModel() {
    const body = U.clear(U.$('modelBody'));
    const j = state.om;
    if (!j) return;
    const i0 = OM.nowIndex(j);
    const now = OM.at(j, i0);
    U.$('modelAge').textContent = `${j.timezone_abbreviation || ''} · Open-Meteo`;
    U.$('modelAge').className = 'age';

    // headline stats
    const strip = U.el('div', 'stat-strip');
    const stat = (k, v, s) => {
      const d = U.el('div', 'stat');
      d.appendChild(U.el('div', 'k', k));
      const val = U.el('div', 'v');
      val.innerHTML = v + (s ? ` <small>${s}</small>` : '');
      d.appendChild(val);
      strip.appendChild(d);
    };
    stat('Wind 10 m', `${U.dirName(now.d10)} ${U.wind(now.w10, state.unit)}`, U.unitLabel[state.unit]);
    stat('Böen', U.wind(now.gust, state.unit), U.unitLabel[state.unit]);
    stat('Wind 180 m', `${U.dirName(now.d180)} ${U.wind(now.w180, state.unit)}`, U.unitLabel[state.unit]);
    stat('Sicht', now.vis == null ? '—' : (now.vis / 1000).toFixed(now.vis < 10000 ? 1 : 0), 'km');
    stat('Bewölkung', now.cloud == null ? '—' : Math.round(now.cloud), '%');
    stat('T / Td', `${fmt(now.temp)}/${fmt(now.dew)}`, '°C');
    stat('Grenzschicht', now.pbl == null ? '—' : Math.round(now.pbl), 'm');
    stat('QNH', now.qnh == null ? '—' : Math.round(now.qnh), 'hPa');
    body.appendChild(strip);

    // hourly strip
    const wrap = U.el('div', 'fc-scroll');
    const t = U.el('table', 'fc-table');
    const hours = [];
    for (let i = i0; i < Math.min(i0 + 13, j.hourly.time.length); i++) hours.push(i);
    const rows = [
      ['Zeit', i => `<span class="${i === i0 ? 'now' : 'hour'}">${j.hourly.time[i].slice(11, 16)}</span>`],
      [`Wind 10 m`, i => { const r = OM.at(j, i); return `${U.dirArrow(r.d10)} ${U.wind(r.w10, state.unit)}`; }],
      ['Böen', i => U.wind(OM.at(j, i).gust, state.unit)],
      ['Wind 180 m', i => { const r = OM.at(j, i); return `${U.dirArrow(r.d180)} ${U.wind(r.w180, state.unit)}`; }],
      ['Wolken %', i => fmt(OM.at(j, i).cloud)],
      ['Sicht km', i => { const v = OM.at(j, i).vis; return v == null ? '—' : (v / 1000).toFixed(0); }],
      ['Regen mm', i => { const p = OM.at(j, i).precip; return p ? p.toFixed(1) : '·'; }],
      ['T °C', i => fmt(OM.at(j, i).temp)],
    ];
    const tb = U.el('tbody');
    for (const [label, get] of rows) {
      const tr = U.el('tr');
      tr.appendChild(U.el('th', '', label));
      for (const i of hours) {
        const td = U.el('td');
        td.innerHTML = get(i);
        if (i === i0) td.style.color = 'var(--amber)';
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);

    if (j.daily && j.daily.sunrise) {
      const s = U.el('div', 'card-body');
      s.innerHTML = `<div class="note">Sonnenaufgang <strong>${j.daily.sunrise[0].slice(11, 16)}</strong> · ` +
        `Sonnenuntergang <strong>${j.daily.sunset[0].slice(11, 16)}</strong> (${j.timezone})</div>`;
      body.appendChild(s);
    }
  }

  // ------------------------------------------------------------------ favourites
  function saveCurrent() {
    const favs = U.load('favs', []);
    const name = state.place || U.fmtCoord(state.lat, state.lon);
    if (favs.some(f => Math.abs(f.lat - state.lat) < 1e-4 && Math.abs(f.lon - state.lon) < 1e-4)) {
      flash('Ort ist schon gespeichert'); return;
    }
    favs.unshift({ name, lat: state.lat, lon: state.lon });
    U.save('favs', favs.slice(0, 24));
    flash('Ort gespeichert');
  }

  function showFavourites() {
    const favs = U.load('favs', []);
    const box = U.$('searchResults');
    U.clear(box);
    if (!favs.length) box.appendChild(U.el('div', 'row r2', 'Noch keine Orte gespeichert'));
    for (const f of favs) {
      const row = U.el('div', 'row');
      row.appendChild(U.el('div', 'r1', f.name));
      row.appendChild(U.el('div', 'r2', U.fmtCoord(f.lat, f.lon)));
      row.onclick = () => { hideResults(); goTo(f.lat, f.lon, f.name, 10); };
      box.appendChild(row);
    }
    box.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ bits
  function note(html) {
    const d = U.el('div', 'note');
    d.innerHTML = html;
    return d;
  }
  function wrapNote(html) {
    const w = U.el('div', 'card-body');
    w.appendChild(note(html));
    return w;
  }
  function sourceLine(label, url) {
    const d = U.el('div', 'note');
    d.style.marginTop = '10px';
    d.innerHTML = `Quelle: <a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    return d;
  }

  function footer() {
    U.$('footerText').innerHTML =
      `GaforCast v${APP_VERSION} · GAFOR, Flugwetterübersicht und Ballonwetterbericht: ` +
      `<a href="https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/luftsportberichte_node.html" target="_blank" rel="noopener">DWD Luftsportberichte</a> · ` +
      `METAR/TAF: <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA AWC</a> · ` +
      `Modell: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> · ` +
      `Karte © OpenStreetMap<br>` +
      `<strong>Keine amtliche Flugwetterberatung.</strong> Für den Flug gilt allein die offizielle Beratung ` +
      `des DWD (flugwetter.de / pc_met).`;
  }

  function showAbout() {
    const g = DWD.generated();
    alert(
      `GaforCast v${APP_VERSION}\n\n` +
      `GAFOR-Gebiete geladen: ${GAFOR.count()}\n` +
      `Berichtsdatei erzeugt: ${g ? new Date(g).toLocaleString('de-DE') : 'nicht geladen'}\n\n` +
      `Quellen:\n· DWD Luftsportberichte (GAFOR, Flugwetterübersicht, Ballonsport)\n` +
      `· NOAA Aviation Weather Center (METAR/TAF)\n· Open-Meteo (Modellprognose)\n· OpenStreetMap (Karte)\n\n` +
      `Keine amtliche Flugwetterberatung.`);
  }
})();
