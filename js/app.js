/* GaforCast — application logic: place → GAFOR area → reports. */
(() => {
  'use strict';


  const state = {
    lat: 51.10, lon: 10.40,
    place: null,
    elev: null,
    area: null,
    unit: U.load('unit', 'kt'),
    metarRadiusKm: U.load('metarRadiusKm', 100),
    metarMax: U.load('metarMax', 8),
    showTaf: U.load('showTaf', 1),
    profileTop: U.load('profileTop', 500),   // hPa, oberste Fläche im Höhenprofil
    altUnit: U.load('altUnit', 'ft'),
    showEns: U.load('showEns', 1),
    lastFetchAt: 0,
    lastFetchLat: null, lastFetchLon: null,
    om: null, ens: null, metars: null, tafs: null,
    windOffset: 0,                            // gewählte Stunde relativ zu „jetzt"
    busy: {},
  };

  // ------------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    applyTheme(U.load('theme', prefersDark() ? 'dark' : 'light'));
    U.$('appVersion').textContent = APP.version;

    const start = startPosition();
    state.lat = start.lat; state.lon = start.lon;
    if (start.name) state.place = start.name;

    MAPVIEW.init('map', { center: [state.lat, state.lon], zoom: start.zoom || 8, onMove: onMapMove });
    wireUI();
    renderPlace();
    footer();

    await GAFOR.init();
    MAPVIEW.setMaskTheme(document.documentElement.dataset.theme !== 'light');
    MAPVIEW.setMask(GAFOR.landCollection() || GAFOR.collection());
    MAPVIEW.setLand(GAFOR.landCollection());
    MAPVIEW.setRegions(GAFOR.regionCollection());
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
    U.$('mSettingsBtn').onclick = () => { menu.classList.add('hidden'); showSettings(); };
    U.$('setClose').onclick = hideSettings;
    U.$('setOk').onclick = applySettings;
    U.$('setOverlay').onclick = (e) => { if (e.target === U.$('setOverlay')) hideSettings(); };
    U.$('mReloadBtn').onclick = () => { menu.classList.add('hidden'); reloadAll(); };
    U.$('reloadBtn').onclick = () => reloadAll();

    // jede Altersanzeige lädt ihre eigene Karte nach
    cardReload('gaforAge', () => reloadDwd());
    cardReload('balloonAge', () => reloadDwd());
    cardReload('metarAge', () => { METAR.reload(); loadPointData(true, ['metar']); });
    cardReload('modelAge', () => loadPointData(true, ['model', 'ens']));
    cardReload('windAge', () => loadPointData(true, ['model']));
    U.$('mShareBtn').onclick = () => {
      const url = `${location.origin}${location.pathname}#${state.lat.toFixed(4)},${state.lon.toFixed(4)},9`;
      if (navigator.share) navigator.share({ title: 'GaforCast', url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url)
        .then(() => flash('Link kopiert'), () => {});
      menu.classList.add('hidden');
    };
    U.$('mAboutBtn').onclick = () => { menu.classList.add('hidden'); showAbout(); };
    U.$('appVersion').onclick = showAbout;
    U.$('aboutClose').onclick = hideAbout;
    U.$('aboutOk').onclick = hideAbout;
    U.$('aboutOverlay').onclick = (e) => { if (e.target === U.$('aboutOverlay')) hideAbout(); };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hideAbout(); hideSettings(); }
    });
    U.$('aboutUpdate').onclick = updateApp;

    // map buttons
    U.$('areasBtn').onclick = () => {
      const lv = MAPVIEW.setLevel();
      U.$('areasBtn').style.color = lv === 0 ? 'var(--text-dim)' : '';
      U.$('areasBtn').textContent = lv === 2 ? '▦' : lv === 1 ? '◱' : '▢';
      flash(['Grenzen aus', 'nur Bereiche und Landesgrenze', 'Gebiete, Bereiche und Landesgrenze'][lv]);
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

  // ------------------------------------------------------------------ reload
  /** Macht eine Altersanzeige zum Nachlade-Knopf für genau ihre Karte. */
  function cardReload(id, fn) {
    const n = U.$(id);
    if (!n) return;
    n.classList.add('clickable');
    n.title = 'Diese Karte neu laden';
    n.setAttribute('role', 'button');
    n.setAttribute('tabindex', '0');
    const go = (e) => { e.preventDefault(); fn(); };
    n.onclick = go;
    n.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); };
  }

  async function reloadDwd() {
    const b = U.$('reloadBtn');
    b.classList.add('spinning');
    try { await DWD.load(true); } catch { /* die Karten zeigen es selbst */ }
    renderReports();
    b.classList.remove('spinning');
  }

  /** Alles neu: DWD-Index, Ballonbericht, METAR/TAF, Modell, Ensemble. */
  async function reloadAll() {
    const b = U.$('reloadBtn');
    if (b.classList.contains('spinning')) return;
    b.classList.add('spinning');
    METAR.reload();                       // die Repo-Kopie neu ziehen, nicht die alte nehmen
    try { await DWD.load(true); } catch { /* die Karten zeigen es selbst */ }
    renderReports();
    try { await loadPointData(true); } catch { /* dito */ }
    b.classList.remove('spinning');
    b.classList.add('ok');
    setTimeout(() => b.classList.remove('ok'), 1400);
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
    if (window.MAPVIEW && MAPVIEW.setMaskTheme) MAPVIEW.setMaskTheme(th !== 'light');
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

  /* Die Meldung für Orte ausserhalb der Abdeckung — bewusst wörtlich und an
     jeder Stelle dieselbe, damit klar ist, dass es keine Störung ist. */
  const OUTSIDE = 'For the time being, this APP covers only Germany';

  function resolveArea() {
    const a = GAFOR.lookup(state.lat, state.lon);
    const had = state.area;
    const changed = (a && a.id) !== (had && had.id);
    state.area = a;
    MAPVIEW.highlight(a ? a.id : null);
    markLegend(a ? a.region : null);
    renderAreaHead();
    if (changed) renderReports();
    if (!a && had && GAFOR.count()) flash(OUTSIDE);
  }

  function renderAreaHead() {
    const a = state.area;
    const num = U.$('areaNum'), name = U.$('areaName'), sub = U.$('areaSub'), st = U.$('areaState');
    U.clear(st);
    if (!a) {
      num.textContent = '—';
      if (!GAFOR.count()) {
        name.textContent = 'Keine Gebietsdaten geladen';
        sub.textContent = 'data/gafor-areas.geojson enthält keine Polygone.';
      } else {
        name.textContent = OUTSIDE;
        name.classList.add('outside');
        sub.textContent = 'Der gewählte Ort liegt ausserhalb der GAFOR-Gebiete.';
      }
      return;
    }
    name.classList.remove('outside');
    num.textContent = a.id;
    name.textContent = a.name || `Gebiet ${a.id}`;
    const bits = [];
    if (a.regionName || a.region) bits.push(`Bereich ${a.regionName || a.region}`);
    if (a.refAltFt != null) bits.push(`Bezugshöhe ${a.refAltFt} ft MSL`);
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
  function renderReports() { renderAreaHead(); renderGafor(); renderBalloon(); }

  function renderGafor() {
    const body = U.clear(U.$('gaforBody'));
    const age = U.$('gaforAge');
    const a = state.area;
    const b = a ? DWD.gaforFor(a) : null;

    if (!DWD.raw()) {
      age.textContent = '';
      body.appendChild(note('Die Berichtsdatei <strong>data/dwd/index.json</strong> fehlt oder ist leer. ' +
        'Sie wird vom Workflow <em>DWD-Berichte holen</em> erzeugt — im Actions-Tab einmal starten. ' +
        'Wird das ZIP über ein bestehendes Repo gelegt, darf diese Datei nicht mit überschrieben werden.'));
      return;
    }
    if (!a) { age.textContent = ''; body.appendChild(note(`<strong>${OUTSIDE}</strong>`)); return; }
    if (!b) {
      const ov = DWD.overviewFor(a);
      age.textContent = ov && ov.bereich ? `Bereich ${ov.bereich}` : '';
      body.appendChild(note(`Für Gebiet ${a.id} liegt derzeit keine GAFOR-Codetabelle vor` +
        (ov ? ' — die Flugwetterübersicht des Bereichs steht darunter.' : '.')));
      if (ov) {
        const meta = U.el('div', 'note');
        meta.style.margin = '12px 0 8px';
        meta.innerHTML = [
          ov.bulletin ? `<strong>${ov.bulletin}</strong>` : '',
          ov.validFrom && ov.validTo
            ? `gültig ${U.fmtUTC(new Date(ov.validFrom))} – ${U.fmtUTC(new Date(ov.validTo))}` : '',
        ].filter(Boolean).join(' · ');
        body.appendChild(meta);
        body.appendChild(Object.assign(U.el('pre', 'report'), { textContent: ov.text }));
        body.appendChild(sourceLine('DWD Flugwetterübersicht', ov.source));
      }
      return;
    }

    const span = (b.periods && b.periods.length)
      ? `${b.periods[0].slice(0, 2)}–${b.periods[b.periods.length - 1].slice(3)} UTC` : '';
    age.textContent = [b.bereich, span, b.issued ? U.ago(b.issued) : ''].filter(Boolean).join(' · ');
    age.className = U.ageClass(b.issued, 300, 600);

    if (b.detail && b.detail.remark) {
      const r = U.el('div', 'note');
      r.style.marginBottom = '10px';
      r.innerHTML = `Zusatz für Gebiet ${a.id}: <strong>${b.detail.remark}</strong>`;
      body.appendChild(r);
    }

    if (b.codes && b.codes.length && b.periods && b.periods.length) {
      const nowUtc = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
      const tiles = U.el('div', 'gafor-tiles');
      for (let i = 0; i < b.periods.length; i++) {
        const p = b.periods[i];
        const ci = GAFOR.codeInfo(b.codes[i] || '');
        const tile = U.el('div', `gtile ${ci.key}${inPeriod(p, nowUtc) ? ' now' : ''}`);
        tile.appendChild(U.el('div', 'gt', p.replace('-', '–')));
        tile.appendChild(U.el('div', 'gc', ci.letter));
        tile.appendChild(U.el('div', 'gw', ci.word || '—'));
        tile.title = ci.desc ? `${ci.word} — ${ci.desc}` : ci.label;
        tiles.appendChild(tile);
      }
      body.appendChild(tiles);
      body.appendChild(U.el('div', 'gafor-unit', 'Zeiten in UTC · laufender Zeitraum hervorgehoben'));
      body.appendChild(codeLegend());
    }

    // the prose Flugwetterübersicht for the Bereich this area belongs to
    const ov = DWD.overviewFor(a);
    if (ov) {
      const h = U.el('div', 'section-title');
      h.style.margin = '16px 0 6px';
      h.textContent = `Flugwetterübersicht Bereich ${ov.bereich || ''}`.trim();
      body.appendChild(h);
      const meta = U.el('div', 'note');
      meta.style.marginBottom = '8px';
      meta.innerHTML = [
        ov.bulletin ? `<strong>${ov.bulletin}</strong>` : '',
        ov.validFrom && ov.validTo
          ? `gültig ${U.fmtUTC(new Date(ov.validFrom))} – ${U.fmtUTC(new Date(ov.validTo))}` : '',
      ].filter(Boolean).join(' · ');
      body.appendChild(meta);
      body.appendChild(Object.assign(U.el('pre', 'report'), { textContent: ov.text }));
      body.appendChild(sourceLine('DWD Flugwetterübersicht', ov.source));
    } else if (b.source) {
      body.appendChild(sourceLine(b.title || 'DWD', b.source));
    }
  }

  /** Liegt die Uhrzeit (UTC, als Dezimalstunde) in einem Zeitraum "15-17"? */
  function inPeriod(p, hour) {
    const m = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(String(p || '').trim());
    if (!m) return false;
    const a = +m[1], b = +m[2];
    return a <= b ? (hour >= a && hour < b) : (hour >= a || hour < b);   // über Mitternacht
  }

  /** Die Stufenerklärung — zugeklappt, damit sie den Lesefluss nicht zerschneidet. */
  function codeLegend() {
    const d = U.el('details', 'code-legend');
    d.appendChild(Object.assign(U.el('summary'), { textContent: 'Was bedeuten C, O, D, M und X?' }));
    const list = U.el('dl', 'code-list');
    for (const c of Object.values(GAFOR.CODES)) {
      const dt = U.el('dt');
      dt.appendChild(U.el('span', `cell ${c.key}`, c.letter));
      dt.appendChild(U.el('span', 'w', c.word));
      list.appendChild(dt);
      const dd = U.el('dd');
      dd.innerHTML = `<em>${c.label}</em> — ${c.desc}`;
      list.appendChild(dd);
    }
    d.appendChild(list);
    return d;
  }

  function renderBalloon() {
    const body = U.clear(U.$('balloonBody'));
    const age = U.$('balloonAge');
    const a = state.area;
    const b = DWD.balloonFor(a);

    if (!DWD.raw()) { age.textContent = ''; body.appendChild(note('Noch nicht geladen.')); return; }
    if (!a) { age.textContent = ''; body.appendChild(note(`<strong>${OUTSIDE}</strong>`)); return; }

    if (!b) {
      age.textContent = '';
      const n = DWD.balloonAreas().length;
      body.appendChild(note(n
        ? `Für Gebiet ${a.id} liegt kein Ballonwetterbericht vor. ` +
          `<span class="dim">(${n} Gebiete abrufbar — über der offenen See gibt es keinen.)</span>`
        : 'Zurzeit ist kein Ballonwetterbericht abrufbar.'));
      return;
    }

    age.textContent = [`Gebiet ${b.id}`, b.fetched ? `geholt ${U.ago(b.fetched)}` : '']
      .filter(Boolean).join(' · ');
    age.className = U.ageClass(b.fetched, 360, 720);

    const head = U.el('div', 'note');
    head.style.marginBottom = '4px';
    head.innerHTML = `<strong>${b.name || a.name || ''}</strong>` +
      (b.refAltFt != null ? ` <span class="dim">· Bezugshöhe ${b.refAltFt} ft AMSL</span>` : '');
    body.appendChild(head);
    if (b.station) {
      const st = U.el('div', 'note');
      st.innerHTML = `Bezugsort <strong>${b.station.name}</strong> ` +
        `<span class="dim">${b.station.lat.toFixed(2)}°N ${b.station.lon.toFixed(2)}°O · ` +
        `${b.station.elevFt} ft</span>`;
      body.appendChild(st);
    }
    if (b.title) {
      const t = U.el('div', 'section-title', b.title);
      t.style.margin = '12px 0 2px';
      body.appendChild(t);
    }

    const slot = U.el('div');
    slot.appendChild(note('Bericht wird geladen…'));
    body.appendChild(slot);

    const wantId = String(b.id);
    DWD.loadBalloon(wantId).then(det => {
      if (!state.area || String(state.area.id) !== wantId) return;
      U.clear(slot);
      if (!det) { slot.appendChild(note('Der ausführliche Bericht ist nicht abrufbar.')); return; }
      if (det.blocks && det.blocks.length) {
        for (const blk of det.blocks) renderBalloonBlock(slot, blk, det.title);
      } else if (det.text) {
        slot.appendChild(Object.assign(U.el('pre', 'report'), { textContent: det.text }));
      }
      slot.appendChild(sourceLine('DWD Gebietsvorhersage Ballonsport', b.source));
    });
  }

  /** Eine Tabelle des Ballonberichts: erste Zeile Kopf, erste Spalte Bezeichnung. */
  function renderBalloonBlock(parent, blk, pageTitle) {
    if (blk.heading && blk.heading !== pageTitle) {
      const h = U.el('div', 'section-title', blk.heading);
      h.style.margin = '14px 0 6px';
      parent.appendChild(h);
    }
    const wrap = U.el('div', 'fc-scroll');
    const t = U.el('table', 'bw-table');
    const tb = U.el('tbody');
    blk.rows.forEach((row, ri) => {
      const tr = U.el('tr');
      row.forEach((cell, ci) => {
        const isHead = cell.h || ri === 0;
        const td = U.el(isHead ? 'th' : 'td');
        // Blau ist beim DWD die Farbe der Beschriftungszellen, keine Aussage —
        // ausgewertet werden nur grün/gelb/orange/rot
        if (!isHead && (ci === 0 || cell.c === 'b')) td.className = 'lbl';
        else if (cell.c && !isHead && 'gyor'.includes(cell.c)) td.className = `sw-${cell.c}`;
        if (cell.s > 1) td.colSpan = cell.s;
        td.textContent = cell.t || '';
        if (!cell.t && cell.c && 'gyor'.includes(cell.c)) td.classList.add('bar');
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); parent.appendChild(wrap);
  }

  // ------------------------------------------------------------------ point data
  /**
   * Punktdaten holen. `only` schränkt auf einzelne Karten ein
   * ('metar' | 'model' | 'ens'); ohne Angabe wird alles geholt.
   */
  async function loadPointData(force, only) {
    const moved = state.lastFetchLat == null ||
      U.distKm(state.lat, state.lon, state.lastFetchLat, state.lastFetchLon) > 3;
    if (!force && !moved) return;
    const want = (k) => !only || only.indexOf(k) >= 0;
    state.lastFetchLat = state.lat; state.lastFetchLon = state.lon;
    state.lastFetchAt = Date.now();
    const lat = state.lat, lon = state.lon;
    const jobs = [];

    GEO.elevation(lat, lon).then(e => {
      if (lat === state.lat && lon === state.lon) { state.elev = e; renderPlace(); }
    }).catch(() => {});

    // METAR / TAF — erst die eigene Kopie zeigen, dann still auffrischen
    if (want('metar')) {
      const r = state.metarRadiusKm, mx = state.metarMax;
      U.$('metarAge').textContent = 'lädt…';
      const withTaf = async (list) => {
        state.metars = list;
        state.tafs = {};
        if (state.showTaf && list.length) {
          try { state.tafs = await METAR.taf(list.map(m => m.icaoId)); } catch { /* ohne TAF */ }
        }
        renderMetar();
      };
      jobs.push((async () => {
        try {
          const list = await METAR.near(lat, lon, r, mx);
          if (lat !== state.lat || lon !== state.lon) return;
          await withTaf(list);
        } catch (e) {
          state.metars = null;
          U.clear(U.$('metarBody')).appendChild(wrapNote(
            'Weder die Kopie <strong>data/dwd/metar.json</strong> noch die NOAA sind erreichbar. ' +
            'Die Kopie legt der Workflow <em>DWD-Berichte holen</em> an — im Actions-Tab einmal ' +
            `starten. <span class="dim">(${e.message})</span>`));
          U.$('metarAge').textContent = '';
          return;
        }
        // Auffrischung: gelingt sie, wird still auf Live gehoben, sonst bleibt alles stehen
        const fresh = await METAR.refresh(lat, lon, r, mx);
        if (fresh && lat === state.lat && lon === state.lon) await withTaf(fresh);
      })());
    }

    // Modellprognose — liefert auch das Höhenprofil
    if (want('model')) {
      U.$('modelAge').textContent = 'lädt…';
      U.$('windAge').textContent = 'lädt…';
      jobs.push(OM.forecast(lat, lon, 2, state.profileTop).then(j => {
        if (lat !== state.lat || lon !== state.lon) return;
        state.om = j;
        state.windOffset = 0;
        renderModel();
        renderWind();
      }).catch(e => {
        state.om = null;
        U.clear(U.$('modelBody')).appendChild(wrapNote('Open-Meteo nicht erreichbar: ' + e.message));
        U.clear(U.$('windBody')).appendChild(wrapNote('Open-Meteo nicht erreichbar: ' + e.message));
        U.$('modelAge').textContent = ''; U.$('windAge').textContent = '';
      }));
    }

    // Ensemble — eigener Host, deshalb ein zweiter Abruf, abschaltbar
    if (want('ens')) {
      if (!state.showEns) { state.ens = null; }
      else {
        jobs.push(OM.ensemble(lat, lon, 2).then(j => {
          if (lat !== state.lat || lon !== state.lon) return;
          state.ens = j;
          if (state.om) renderModel();
        }).catch(() => { state.ens = null; }));
      }
    }

    await Promise.all(jobs);
  }

  function renderMetar() {
    const body = U.clear(U.$('metarBody'));
    const list = state.metars;
    if (!list) return;
    if (!list.length) {
      U.$('metarAge').textContent = `${state.metarRadiusKm} km`;
      body.appendChild(wrapNote(
        `Im Umkreis von ${state.metarRadiusKm} km meldet kein Platz METAR. ` +
        'Der Umkreis lässt sich im Menü unter <strong>Einstellungen</strong> vergrössern.'));
      return;
    }
    const newest = list.reduce((a, m) => Math.max(a, m.obsTime || 0), 0);
    const newestIso = newest ? new Date(newest * 1000).toISOString() : null;
    const src = METAR.lastSource();
    const bits = [`${list.length} Plätze ≤ ${state.metarRadiusKm} km`];
    if (newestIso) bits.push(U.ago(newestIso));
    bits.push(src.kind === 'live' ? 'live von der NOAA'
            : src.at ? `Kopie ${U.ago(src.at)}` : 'aus dem Repo');
    U.$('metarAge').textContent = bits.join(' · ');
    U.$('metarAge').className = U.ageClass(newestIso, 75, 180);

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
      add('Wolken', METAR.cloudText(m));
      add('T/Td', `${fmt(m.temp)}/${fmt(m.dewp)} °C`);
      add('QNH', m.altim ? `${Math.round(m.altim)}` : '—');
      row.appendChild(sum);

      const flags = U.el('div');
      flags.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;';
      if (cls) {
        const ci = GAFOR.codeInfo(cls);
        const badge = U.el('span', `badge ${ci.key}`, `${ci.letter} · ${ci.word}`);
        badge.title = 'aus der Beobachtung abgeleitet, kein DWD-GAFOR-Code';
        flags.appendChild(badge);
      }
      if (m.fltCat) {
        const f = U.el('span', `badge ${METAR.CAT_CLASS[m.fltCat] || 'none'}`, m.fltCat);
        f.title = 'Flight category laut NOAA';
        flags.appendChild(f);
      }
      if (flags.childNodes.length) row.appendChild(flags);

      if (m.rawOb) row.appendChild(Object.assign(U.el('pre', 'raw'), { textContent: m.rawOb }));
      const t = state.showTaf && state.tafs && state.tafs[m.icaoId];
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
    const fog = OM.fogRisk(now);
    const baseFt = OM.cloudBaseFt(now);
    stat('Wind 10 m', `${U.dirName(now.d10)} ${U.wind(now.w10, state.unit)}`, U.unitLabel[state.unit]);
    stat('Böen', U.wind(now.gust, state.unit), U.unitLabel[state.unit]);
    stat('Wind 180 m', `${U.dirName(now.d180)} ${U.wind(now.w180, state.unit)}`, U.unitLabel[state.unit]);
    stat('Sicht', now.vis == null ? '—' : (now.vis / 1000).toFixed(now.vis < 10000 ? 1 : 0), 'km');
    stat('Wolken h/m/t', `${fmt(now.cloudHigh)}/${fmt(now.cloudMid)}/${fmt(now.cloudLow)}`, '%');
    stat('Basis (est.)', baseFt == null ? 'frei' : String(baseFt), baseFt == null ? '' : 'ft AGL');
    stat('Nebelrisiko', `<span class="fog-t${fog.level == null ? 0 : fog.level}">${fog.txt}</span>`,
      fogWindow(j, i0));
    stat('T / Td', `${fmt(now.temp)}/${fmt(now.dew)}`, '°C');
    stat('Grenzschicht', now.pbl == null ? '—' : Math.round(now.pbl), 'm');
    stat('QNH', now.qnh == null ? '—' : Math.round(now.qnh), 'hPa');
    body.appendChild(strip);

    renderEnsemble(body, i0);

    // hourly strip
    const wrap = U.el('div', 'fc-scroll');
    const t = U.el('table', 'fc-table');
    const hours = [];
    for (let i = i0; i < Math.min(i0 + 13, j.hourly.time.length); i++) hours.push(i);
    // Bewölkung als Fläche: je dichter, desto kräftiger die Füllung
    const cloudCell = (v) => {
      if (v == null) return { h: '·' };
      const a = Math.round(v);
      return { h: a ? String(a) : '·', bg: a / 100 };
    };
    const FOG_CLS = ['', 'fog-1', 'fog-2', 'fog-3'];

    const rows = [
      ['Zeit', i => ({ h: `<span class="${i === i0 ? 'now' : 'hour'}">${j.hourly.time[i].slice(11, 16)}</span>` })],
      ['Wind 10 m', i => { const r = OM.at(j, i); return { h: `${U.dirArrow(r.d10)} ${U.wind(r.w10, state.unit)}` }; }],
      ['Böen', i => ({ h: U.wind(OM.at(j, i).gust, state.unit) })],
      ['Wind 180 m', i => { const r = OM.at(j, i); return { h: `${U.dirArrow(r.d180)} ${U.wind(r.w180, state.unit)}` }; }],
      ['Wolken hoch', i => cloudCell(OM.at(j, i).cloudHigh)],
      ['Wolken mittel', i => cloudCell(OM.at(j, i).cloudMid)],
      ['Wolken tief', i => cloudCell(OM.at(j, i).cloudLow)],
      ['Basis ft AGL', i => { const b = OM.cloudBaseFt(OM.at(j, i)); return { h: b == null ? '·' : String(b) }; }],
      ['Nebelrisiko', i => {
        const f = OM.fogRisk(OM.at(j, i));
        return { h: f.level ? f.txt : '·', cls: FOG_CLS[f.level || 0] };
      }],
      ['Sicht km', i => { const v = OM.at(j, i).vis; return { h: v == null ? '—' : (v / 1000).toFixed(0) }; }],
      ['Regen mm', i => { const p = OM.at(j, i).precip; return { h: p ? p.toFixed(1) : '·' }; }],
      ['Regen %', i => { const p = OM.at(j, i).pop; return { h: p == null ? '·' : String(Math.round(p)) }; }],
      ['T °C', i => ({ h: String(fmt(OM.at(j, i).temp)) })],
    ];
    const tb = U.el('tbody');
    for (const [label, get] of rows) {
      const tr = U.el('tr');
      tr.appendChild(U.el('th', '', label));
      for (const i of hours) {
        const c = get(i) || {};
        const td = U.el('td', c.cls || '');
        td.innerHTML = c.h == null ? '·' : c.h;
        if (c.bg != null && c.bg > 0) {
          td.style.background =
            `color-mix(in srgb, var(--cloud-fill) ${Math.round(c.bg * 62)}%, transparent)`;
        }
        if (i === i0 && !c.cls) td.style.color = 'var(--amber)';
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);

    body.appendChild(wrapNote(
      'Wolken in Prozent Bedeckung je Schicht · <strong>Basis</strong> und ' +
      '<strong>Nebelrisiko</strong> sind aus Temperatur, Taupunkt, Wind und Modellsicht ' +
      'abgeleitete Schätzwerte, keine DWD-Aussage.'));

    if (j.daily && j.daily.sunrise) {
      const s = U.el('div', 'card-body');
      s.innerHTML = `<div class="note">Sonnenaufgang <strong>${j.daily.sunrise[0].slice(11, 16)}</strong> · ` +
        `Sonnenuntergang <strong>${j.daily.sunset[0].slice(11, 16)}</strong> (${j.timezone})</div>`;
      body.appendChild(s);
    }
  }

  /** Nächstes Zeitfenster mit erhöhtem Nebelrisiko, als kurzer Zusatz. */
  function fogWindow(j, i0) {
    if (!j || !j.hourly) return '';
    const end = Math.min(i0 + 25, j.hourly.time.length);
    for (let i = i0; i < end; i++) {
      if (OM.fogRisk(OM.at(j, i)).level >= 2) {
        return i === i0 ? 'jetzt' : `ab ${j.hourly.time[i].slice(11, 16)}`;
      }
    }
    return '';
  }

  // ------------------------------------------------------------------ ensemble
  function renderEnsemble(body, i0) {
    if (!state.showEns) return;
    const e = state.ens;
    if (!e || !e.hourly) return;
    const ie = OM.nowIndex(e);
    const i = Math.min(Math.max(0, ie + (i0 - OM.nowIndex(state.om))), e.hourly.time.length - 1);

    const box = U.el('div', 'ens');
    const w = OM.spread(e, 'wind_speed_10m', i);
    const g = OM.spread(e, 'wind_gusts_10m', i);
    const c = OM.spread(e, 'cloud_cover', i);
    const dry = OM.shareBelow(e, 'precipitation', i, 0.1);
    if (!w && !g && !c) return;

    const n = (w || g || c).n;
    box.appendChild(U.el('div', 'ens-head',
      `Streubreite · ICON-D2-EPS · ${n} Rechnungen · ${e.hourly.time[i].slice(11, 16)}`));

    const wmax = Math.max(10, Math.ceil(Math.max(g ? g.max : 0, w ? w.max : 0) * MS(1) / 5) * 5);
    const row = (label, s, scale, fmtv, unit) => {
      if (!s) return;
      const r = U.el('div', 'ens-row');
      r.appendChild(U.el('span', 'ens-k', label));
      const bar = U.el('span', 'ens-bar');
      const lo = U.clamp(s.min / scale, 0, 1), hi = U.clamp(s.max / scale, 0, 1);
      const md = U.clamp(s.med / scale, 0, 1);
      const span = U.el('span', 'ens-span');
      span.style.left = (lo * 100).toFixed(1) + '%';
      span.style.width = Math.max(1.5, (hi - lo) * 100).toFixed(1) + '%';
      bar.appendChild(span);
      const med = U.el('span', 'ens-med');
      med.style.left = (md * 100).toFixed(1) + '%';
      bar.appendChild(med);
      r.appendChild(bar);
      const v = U.el('span', 'ens-v');
      v.innerHTML = `${fmtv(s.min)}–${fmtv(s.max)} <b>${fmtv(s.med)}</b> <small>${unit}</small>`;
      r.appendChild(v);
      box.appendChild(r);
    };
    const wv = (x) => U.wind(x, state.unit);
    row('Wind 10 m', w, wmax / MS(1), wv, U.unitLabel[state.unit]);
    row('Böen', g, wmax / MS(1), wv, U.unitLabel[state.unit]);
    row('Wolken', c, 100, (x) => String(Math.round(x)), '%');
    if (dry) {
      box.appendChild(U.el('div', 'ens-note',
        `${dry.hit} von ${dry.n} Rechnungen trocken`));
    }
    body.appendChild(box);
  }

  /** Faktor m/s → gewählte Einheit, für die Skalierung der Ensemble-Balken. */
  const MS = (x) => x * ({ kt: 1.943844, kmh: 3.6, ms: 1 })[state.unit];

  // ------------------------------------------------------------------ upper wind
  function renderWind() {
    const body = U.clear(U.$('windBody'));
    const j = state.om;
    if (!j) return;
    const i0 = OM.nowIndex(j);
    const idx = Math.min(i0 + state.windOffset, j.hourly.time.length - 1);
    const metres = state.altUnit === 'm';
    const levels = OM.profile(j, idx, state.elev != null ? state.elev : j.elevation)
      .map(l => Object.assign({}, l, { ft: metres ? Math.round(l.m) : l.ft }));

    U.$('windAge').textContent =
      `bis ${state.profileTop} hPa · ${j.hourly.time[idx].slice(11, 16)} ${j.timezone_abbreviation || ''}`;
    U.$('windAge').className = 'age';

    if (!levels.length) {
      body.appendChild(wrapNote('Für diesen Ort liefert das Modell kein Höhenprofil.'));
      return;
    }

    // ---- Stundenwahl ----
    const chips = U.el('div', 'chips');
    for (const off of [0, 1, 2, 3, 6, 9, 12]) {
      const i = i0 + off;
      if (i >= j.hourly.time.length) break;
      const b = U.el('button', 'chip' + (off === state.windOffset ? ' on' : ''),
        off === 0 ? 'jetzt' : j.hourly.time[i].slice(11, 16));
      b.onclick = () => { state.windOffset = off; renderWind(); };
      chips.appendChild(b);
    }
    body.appendChild(chips);

    // ---- Grafik ----
    const rec = OM.at(j, idx);
    const ground = state.elev != null ? state.elev : (j.elevation || 0);
    const toAlt = (m) => (m == null ? null : (metres ? Math.round(m) : Math.round(m * OM.M_TO_FT)));
    const svg = WINDVIEW.chart(levels, {
      unit: U.unitLabel[state.unit],
      unitFactor: MS(1),
      altUnit: metres ? 'm' : 'ft',
      groundFt: toAlt(ground),
      fzlFt: toAlt(rec.fzl),
      pblFt: rec.pbl == null ? null : toAlt(ground + rec.pbl),
    });
    if (svg) {
      const wrap = U.el('div', 'wp-wrap');
      wrap.appendChild(svg);
      body.appendChild(wrap);
      body.appendChild(wrapNote(
        'Die <strong>Windfahne</strong> zeigt wie in der Luftfahrtkarte in den Wind, ' +
        'die Federn geben die Stärke in Knoten (halb 5, ganz 10, Wimpel 50). ' +
        'Waagrecht steht die Geschwindigkeit, senkrecht die Höhe. ' +
        'Der <strong>Pfeil in der Tabelle</strong> zeigt dagegen die Richtung, in die es treibt.'));
    }

    // ---- Tabelle ----
    const wrap2 = U.el('div', 'fc-scroll');
    const t = U.el('table', 'wp-table');
    const th = U.el('tr');
    for (const h of [metres ? 'm AMSL' : 'ft AMSL', 'Fläche', 'Drift',
                     U.unitLabel[state.unit], '°C']) th.appendChild(U.el('th', '', h));
    const thead = U.el('thead'); thead.appendChild(th); t.appendChild(thead);
    const tb = U.el('tbody');

    // Flächen und Marker in eine gemeinsame, nach Höhe fallende Liste
    const unitTxt = metres ? ' m' : ' ft';
    const entries = levels.map(l => ({ alt: l.ft, lvl: l }));
    const fzlA = toAlt(rec.fzl), pblA = rec.pbl == null ? null : toAlt(ground + rec.pbl);
    if (fzlA != null) entries.push({ alt: fzlA, mark: 'Nullgradgrenze ' + fzlA.toLocaleString('de-CH') + unitTxt, cls: 'fzl' });
    if (pblA != null) entries.push({ alt: pblA, mark: 'Grenzschicht bis ' + pblA.toLocaleString('de-CH') + unitTxt, cls: 'pbl' });
    entries.sort((a, b) => b.alt - a.alt || (a.mark ? -1 : 1));

    for (const e of entries) {
      if (e.mark) { tb.appendChild(markRow(e.mark, e.cls)); continue; }
      const l = e.lvl;
      const tr = U.el('tr');
      tr.appendChild(U.el('td', 'alt', l.ft.toLocaleString('de-CH')));
      tr.appendChild(U.el('td', 'lvl', l.hPa ? `${l.hPa} hPa` : l.label));
      const d = U.el('td', 'dir');
      d.innerHTML = `${U.dirArrow(l.dir)} ${U.dirName(l.dir)}`;
      tr.appendChild(d);
      tr.appendChild(U.el('td', 'spd', U.wind(l.spd, state.unit)));
      tr.appendChild(U.el('td', 'tmp', l.temp == null ? '·' : String(Math.round(l.temp))));
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap2.appendChild(t); body.appendChild(wrap2);
    body.appendChild(sourceLine('Open-Meteo · ICON', 'https://open-meteo.com'));
  }

  function markRow(txt, cls) {
    const tr = U.el('tr', 'wp-mrow ' + cls);
    const td = U.el('td', '', txt);
    td.colSpan = 5;
    tr.appendChild(td);
    return tr;
  }

  // ------------------------------------------------------------------ settings
  function showSettings() {
    U.$('setRadius').value = String(state.metarRadiusKm);
    U.$('setMetarMax').value = String(state.metarMax);
    U.$('setUnit').value = state.unit;
    U.$('setTheme').value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    U.$('setTaf').value = state.showTaf ? '1' : '0';
    U.$('setTop').value = String(state.profileTop);
    U.$('setAlt').value = state.altUnit;
    U.$('setEns').value = state.showEns ? '1' : '0';
    U.$('setOverlay').classList.remove('hidden');
  }
  const hideSettings = () => U.$('setOverlay').classList.add('hidden');

  function applySettings() {
    const rad = +U.$('setRadius').value;
    const max = +U.$('setMetarMax').value;
    const taf = U.$('setTaf').value === '1';
    const top = +U.$('setTop').value;
    const ens = U.$('setEns').value === '1';
    const metarAgain = rad !== state.metarRadiusKm || max !== state.metarMax ||
                       (taf && !state.showTaf);
    const modelAgain = top !== state.profileTop;
    const ensAgain = ens && !state.showEns;

    state.metarRadiusKm = rad; U.save('metarRadiusKm', rad);
    state.metarMax = max;      U.save('metarMax', max);
    state.showTaf = taf ? 1 : 0; U.save('showTaf', state.showTaf);
    state.profileTop = top;    U.save('profileTop', top);
    state.altUnit = U.$('setAlt').value; U.save('altUnit', state.altUnit);
    state.showEns = ens ? 1 : 0; U.save('showEns', state.showEns);
    if (!ens) state.ens = null;
    state.unit = U.$('setUnit').value; U.save('unit', state.unit);
    applyTheme(U.$('setTheme').value);

    hideSettings();
    const only = [];
    if (metarAgain) only.push('metar');
    if (modelAgain) only.push('model');
    if (ensAgain) only.push('ens');
    if (only.length) loadPointData(true, only);
    if (!metarAgain) renderMetar();
    if (!modelAgain) { renderModel(); renderWind(); }
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
      `${APP.name} ${APP.version} · GAFOR, Flugwetterübersicht und Ballonwetterbericht: ` +
      `<a href="https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/luftsportberichte_node.html" target="_blank" rel="noopener">DWD Luftsportberichte</a> · ` +
      `METAR/TAF: <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA AWC</a> · ` +
      `Modell: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> · ` +
      `Karte © OpenStreetMap<br>` +
      `<strong>Keine amtliche Flugwetterberatung.</strong> Für den Flug gilt allein die offizielle Beratung ` +
      `des DWD (flugwetter.de / pc_met).`;
  }

  function showAbout() {
    const g = DWD.generated();
    const raw = DWD.raw() || {};
    const fc = GAFOR.collection() || {};
    const box = U.clear(U.$('aboutBody'));
    U.$('aboutTitle').textContent = `${APP.name} ${APP.version}`;

    const dl = U.el('dl', 'kv');
    const row = (k, v, warn) => {
      dl.appendChild(U.el('dt', '', k));
      const d = U.el('dd', warn ? 'warn' : '');
      d.innerHTML = v;
      dl.appendChild(d);
    };
    row('Version', `${APP.version} <span class="dim">vom ${APP.date}</span>`);
    row('Gebietsdaten', `${GAFOR.count()} Gebiete` +
      (fc.updated ? ` <span class="dim">· Stand ${fc.updated}</span>` : ''));
    const nG = Object.keys(raw.gafor || {}).length;
    const nO = Object.keys(raw.overview || {}).length;
    const nB = Object.keys(raw.balloon || {}).length;
    row('DWD-Berichte', g
      ? `${nG} Codetabelle(n), ${nO} Übersicht(en), ${nB} Ballonbericht(e)<br>` +
        `<span class="dim">geholt ${new Date(g).toLocaleString('de-DE')} (${U.ago(g)})</span>`
      : 'noch nicht geladen', !g);
    const errs = DWD.errors();
    if (errs.length) row('Abrufprobleme', `${errs.length} — siehe data/dwd/index.json`, true);
    row('Repository', `<a href="${APP.repo}" target="_blank" rel="noopener">bwicki/de_gafor</a>`);
    box.appendChild(dl);

    box.appendChild(note(
      '<strong>Datenquellen:</strong> DWD Luftsportberichte (GAFOR, Flugwetterübersicht, ' +
      'Ballonsport) · NOAA Aviation Weather Center (METAR/TAF) · Open-Meteo — ICON für ' +
      'Punktprognose und Höhenwind, ICON-D2-EPS für die Streubreite · ' +
      'OpenStreetMap (Karte und Ortsnamen).'));
    const d3 = note(
      '<strong>Abgeleitete Werte.</strong> <em>Wolkenbasis</em> ist das Kondensationsniveau ' +
      'aus Temperatur und Taupunkt (rund 400 ft je Grad Spread), gezeigt nur bei mindestens ' +
      '25 % tiefer Bewölkung. <em>Nebelrisiko</em> steigt mit kleinem Spread, hoher Feuchte ' +
      'und schwachem Wind: hoch bei Spread ≤ 0,6 K, Feuchte ≥ 97 % und Wind unter 2 m/s, ' +
      'mässig bei ≤ 1,5 K / ≥ 93 % / unter 3,5 m/s, gering bei ≤ 2,5 K / ≥ 88 % / unter 5 m/s; ' +
      'Modellsicht unter 1 km setzt es auf hoch, kräftige Einstrahlung nimmt eine Stufe weg. ' +
      'Beides sind Schätzungen aus dem Modell und keine DWD-Aussage.');
    d3.style.marginTop = '8px';
    box.appendChild(d3);
    const d2 = note('<strong>Keine amtliche Flugwetterberatung.</strong> Die Gebietsgrenzen sind ' +
      'aus der DFS-Karte digitalisiert und auf etwa ±2 km genau. Für den Flug gilt allein die ' +
      'offizielle Beratung des DWD.');
    d2.style.marginTop = '8px';
    box.appendChild(d2);

    U.$('aboutOverlay').classList.remove('hidden');
  }

  const hideAbout = () => U.$('aboutOverlay').classList.add('hidden');

  /** Service-Worker-Cache verwerfen und neu laden — für "hängt auf alter Version". */
  async function updateApp() {
    U.$('aboutUpdate').textContent = 'lädt…';
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch { /* egal, es folgt ohnehin ein harter Reload */ }
    location.reload();
  }

})();
