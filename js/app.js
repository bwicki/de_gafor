/* GaforCast — application logic: place → GAFOR area → reports. */
(() => {
  'use strict';


  const state = {
    lat: 51.10, lon: 10.40,
    place: null,
    placePrev: null,          // letzter bekannter Name, bis der neue eintrifft
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
    model: U.load('model', ''),               // '' = Auto-Mix, sonst ein Open-Meteo-Modell
    busy: {},
  };

  /* Zugangssperre. Ausdrücklich **kein** Sicherheitsmechanismus: die Seite ist
     statisch, jeder kann den Quelltext lesen, und dort steht das Kennwort.
     Der Zweck ist, die Seite aus dem Weg von Zufallsbesuchern zu halten —
     sie ist für die private Flugvorbereitung gedacht und die DWD-Produkte
     dürfen nicht weitergegeben werden. Wer wirklich aussperren will, braucht
     einen Server mit echter Anmeldung. */
  const GATE_PW = '1234';

  // ------------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    applyTheme(U.load('theme', prefersDark() ? 'dark' : 'light'));
    initGate();
    U.$('appVersion').textContent = APP.version;

    const start = startPosition();
    state.lat = start.lat; state.lon = start.lon;
    if (start.name) state.place = start.name;

    /* Getrennt abgesichert: geht die Karte nicht auf, sollen wenigstens Menü
       und Knöpfe verdrahtet sein — und umgekehrt. */
    try {
      MAPVIEW.init('map', { center: [state.lat, state.lon], zoom: start.zoom || 8, onMove: onMapMove });
    } catch (e) { console.error('Karte konnte nicht starten:', e); }
    try { wireUI(); } catch (e) { console.error('Bedienung nicht vollständig verdrahtet:', e); }
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
    if (!state.place) namePlace(state.lat, state.lon);

    try { await DWD.load(); } catch (e) { console.warn('DWD index not available:', e.message); }
    renderReports();
    loadPointData(true);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Kein automatischer Sprung auf den Standort mehr: die App öffnet bewusst
    // mit ganz Deutschland im Bild. Der Knopf ◎ holt den Standort auf Wunsch.
  }

  const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  /* Mitte Deutschlands, ungefähr bei Niederdorla. Zoom 6 zeigt das Land ganz —
     damit sieht man beim Öffnen die Gebiete und die abgegraute Umgebung, statt
     in einem Ausschnitt zu landen, in dem nichts davon vorkommt. */
  const HOME = { lat: 51.10, lon: 10.40, zoom: 6 };

  function startPosition() {
    const h = (location.hash || '').replace(/^#/, '');
    const m = h.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+))?$/);
    if (m) return { lat: +m[1], lon: +m[2], zoom: m[3] ? +m[3] : 9, explicit: true };
    return { ...HOME, explicit: false };
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
    U.$('mAboutBtn').onclick = () => { menu.classList.add('hidden'); showAbout(); };

    // Drucken und Teilen
    const shareMenu = U.$('shareMenu');
    U.$('printBtn').onclick = () => { menu.classList.add('hidden'); shareMenu.classList.add('hidden'); doPrint(); };
    U.$('shareBtn').onclick = (e) => {
      e.stopPropagation();
      menu.classList.add('hidden');
      shareMenu.classList.toggle('hidden');
    };
    document.addEventListener('click', (e) => {
      if (!shareMenu.contains(e.target) && e.target !== U.$('shareBtn')) shareMenu.classList.add('hidden');
    });
    U.$('sharePngBtn').onclick = () => { shareMenu.classList.add('hidden'); savePng(); };
    U.$('shareLinkBtn').onclick = () => { shareMenu.classList.add('hidden'); copyLink(); };

    U.$('mLockBtn').onclick = () => { menu.classList.add('hidden'); lockAgain(); };
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

    // Die Höhenwindgrafik richtet sich nach der Breite ihres Kastens
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      // nur Tabelle und Grafik neu — der Schieber behält Wert und Fokus
      rt = setTimeout(() => { if (state.om) paintProfile(); }, 220);
    });
  }

  // ------------------------------------------------------------------ Sperre
  function initGate() {
    const g = U.$('gate');
    if (!g) return;
    if (U.load('unlocked', 0) === 1) { g.remove(); return; }
    g.hidden = false;
    U.$('gateForm').onsubmit = (e) => {
      e.preventDefault();
      if (U.$('gatePw').value.trim() === GATE_PW) {
        U.save('unlocked', 1);
        g.remove();
        const map = MAPVIEW.get();
        if (map) setTimeout(() => map.invalidateSize(), 30);
      } else {
        U.$('gateErr').hidden = false;
        U.$('gatePw').value = '';
        U.$('gatePw').focus();
      }
    };
    setTimeout(() => U.$('gatePw').focus(), 60);
  }

  function lockAgain() {
    U.save('unlocked', 0);
    location.reload();
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

  // ------------------------------------------------------------- Drucken
  /**
   * Zwei A4-Seiten: Kopf, Ort, Gebiet und die GAFOR-Kacheln auf Seite 1, die
   * Berichte auf Seite 2. Das Meiste macht der Druckteil von css/app.css; hier
   * werden nur die aufklappbaren Blöcke geöffnet, damit nichts fehlt, und die
   * Karte muss vorher ihre Kacheln fertig geladen haben.
   */
  function doPrint() {
    const opened = [];
    for (const d of document.querySelectorAll('details')) {
      if (!d.open) { d.open = true; opened.push(d); }
    }
    const done = () => { for (const d of opened) d.open = false; };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => window.print(), 120);
  }

  // ------------------------------------------------------------- Teilen
  const placeSlug = () => (state.place || U.fmtCoord(state.lat, state.lon))
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ort';

  const shareUrl = () =>
    `${location.origin}${location.pathname}#${state.lat.toFixed(4)},${state.lon.toFixed(4)},` +
    `${MAPVIEW.get() ? MAPVIEW.get().getZoom() : 9}`;

  function copyLink() {
    const url = shareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => flash('Link kopiert'),
        () => fallbackCopy(url));
    } else fallbackCopy(url);
  }

  function fallbackCopy(text) {
    const ta = U.el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flash('Link kopiert'); }
    catch { flash('Kopieren nicht möglich'); }
    document.body.removeChild(ta);
  }

  /* Das Stylesheet mischt Farben mit color-mix(). Der Browser löst das in
   * getComputedStyle zu `color(srgb r g b / a)` auf — eine Schreibweise, die
   * html2canvas (Stand 1.4.1) nicht kennt und mit einer Ausnahme quittiert.
   * Deshalb werden im Klon alle so geschriebenen Farben vorher in rgba()
   * umgesetzt. Betrifft nur das Seitenbild, nicht die Seite selbst.
   */
  const SRGB_PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke',
    'text-decoration-color', 'column-rule-color'];

  function srgbToRgb(doc) {
    const win = doc.defaultView || window;
    const conv = (v) => {
      const m = /^color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?\s*\)$/i
        .exec(String(v || '').trim());
      if (!m) return null;
      const ch = [1, 2, 3].map(i => Math.round(U.clamp(parseFloat(m[i]), 0, 1) * 255));
      const a = m[4] == null ? 1 : U.clamp(parseFloat(m[4]), 0, 1);
      return a >= 1 ? `rgb(${ch.join(',')})` : `rgba(${ch.join(',')},${a})`;
    };
    for (const el of doc.querySelectorAll('*')) {
      let cs;
      try { cs = win.getComputedStyle(el); } catch { continue; }
      for (const p of SRGB_PROPS) {
        const nv = conv(cs.getPropertyValue(p));
        if (nv) el.style.setProperty(p, nv, 'important');
      }
    }
  }

  /** Bild der ganzen Seite. Braucht html2canvas — ohne das gibt es den Link. */
  async function savePng() {
    if (typeof html2canvas !== 'function') { flash('Bildfunktion nicht geladen'); copyLink(); return; }
    const b = U.$('shareBtn');
    b.classList.add('spinning');
    document.body.classList.add('shooting');
    try {
      const canvas = await html2canvas(document.querySelector('.app'), {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true, logging: false,
        ignoreElements: (el) => el.classList &&
          (el.classList.contains('menu') || el.classList.contains('map-btns') ||
           el.classList.contains('modal')),
        onclone: srgbToRgb,
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      // Blob statt data:-URL — ein Seitenbild wird schnell zweistellig in MB,
      // und als data:-URL scheitert der Download in manchen Browsern still
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('leeres Bild');
      const url = URL.createObjectURL(blob);
      const a = U.el('a');
      a.href = url;
      a.download = `gaforcast_${placeSlug()}_${stamp}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      flash('Bild gespeichert');
    } catch (e) {
      console.warn('PNG fehlgeschlagen:', e);
      flash('Bild fehlgeschlagen — Link stattdessen');
      copyLink();
    } finally {
      document.body.classList.remove('shooting');
      b.classList.remove('spinning');
    }
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

  /* Zoomstufen für einen Treffer: ein Flugplatz darf enger stehen als eine
     Stadt, Koordinaten sind punktgenau. */
  const PICK_ZOOM = { icao: 12, coord: 12, place: 11 };

  function pick(r) {
    U.$('searchInput').value = '';
    goTo(r.lat, r.lon, r.name, PICK_ZOOM[r.kind] || 11);
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
    if (!name) namePlace(lat, lon);
    loadPointData(true);
    remember();
  }

  let moveTimer = 0;
  /**
   * `self` ist true, solange die Karte auf unser eigenes Geheiss fährt — nach
   * einem Suchtreffer etwa. Dann darf der gefundene Ortsname nicht durch die
   * Zwischenpositionen der Animation gelöscht werden.
   */
  function onMapMove(lat, lon, self) {
    state.lat = lat; state.lon = lon;
    if (!self) {
      // der alte Name bleibt sichtbar, bis der neue da ist
      if (state.place) state.placePrev = state.place;
      state.place = GEO.reverseCached(lat, lon);
    }
    renderPlace();
    resolveArea();
    if (!state.place) namePlace(lat, lon);
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { loadPointData(false); remember(); }, 900);
  }

  /** Nächstgelegenen Ortsnamen holen und eintragen. */
  function namePlace(lat, lon) {
    GEO.reverseSoon(lat, lon, (n) => {
      if (!n) return;
      if (Math.abs(lat - state.lat) > 1e-4 || Math.abs(lon - state.lon) > 1e-4) return;
      state.place = n; state.placePrev = n;
      renderPlace();
      remember();
    });
  }

  function remember() {
    history.replaceState(null, '', `#${state.lat.toFixed(4)},${state.lon.toFixed(4)},${MAPVIEW.get().getZoom()}`);
  }

  /**
   * Die Ortszeile zeigt immer einen Namen — den zuletzt gefundenen, solange der
   * neue noch unterwegs ist. „Kartenmitte" stand früher da und sagte nichts.
   */
  function renderPlace() {
    const node = U.$('placeName');
    const name = state.place || state.placePrev;
    node.textContent = name || 'Ort wird gesucht …';
    node.classList.toggle('pending', !state.place && !!name);
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
      const badge = U.el('span', `badge ${ci.key}`, ci.code);
      badge.title = ci.desc;
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
        renderReport(body, ov.text);
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
        const code = U.el('div', 'gc');
        code.appendChild(U.el('span', 'l', ci.letter));
        if (ci.digit) code.appendChild(U.el('span', 'd', ci.digit));
        tile.appendChild(code);
        tile.appendChild(U.el('div', 'gw', ci.word || '—'));
        if (ci.vis) {
          tile.appendChild(U.el('div', 'gv', `${ci.vis} · ${ci.base}`));
        }
        const rem = (b.detail && b.detail.remarks && b.detail.remarks[i]) || '';
        if (rem) tile.appendChild(U.el('div', 'gr', rem));
        tile.title = ci.desc;
        tiles.appendChild(tile);
      }
      body.appendChild(tiles);
      const ref = a.refAltFt != null ? ` · Bezugshöhe Gebiet ${a.id}: ${a.refAltFt} ft MSL` : '';
      body.appendChild(U.el('div', 'gafor-unit',
        `Zeiten in UTC · laufender Zeitraum hervorgehoben${ref}`));
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
      renderReport(body, ov.text);
      body.appendChild(sourceLine('DWD Flugwetterübersicht', ov.source));
    } else if (b.source) {
      body.appendChild(sourceLine(b.title || 'DWD', b.source));
    }
  }

  /* -------------------------------------------------------- Berichtstext
   * Die Flugwetterübersicht ist ein langer Fliesstext mit Abschnitten wie
   * „Wetterlage und -entwicklung:", „Wettergeschehen:", „Wind:". Als eine
   * Spalte ist das auf dem Desktop eine Bleiwüste — deshalb wird der Text in
   * seine Abschnitte zerlegt und auf zwei etwa gleich hohe Spalten verteilt.
   */
  function reportBlocks(text) {
    const lines = String(text || '').split('\n');
    const blocks = [];
    let cur = { title: '', body: [] };
    const isHeading = (l) => {
      const t = l.trim();
      return t.length > 2 && t.length <= 64 && /:$/.test(t) && !/[.!?]/.test(t.slice(0, -1));
    };
    for (const l of lines) {
      if (isHeading(l)) {
        if (cur.title || cur.body.join('').trim()) blocks.push(cur);
        cur = { title: l.trim().replace(/:$/, ''), body: [] };
      } else {
        cur.body.push(l);
      }
    }
    if (cur.title || cur.body.join('').trim()) blocks.push(cur);
    return blocks.map(b => {
      const body = b.body.join('\n').replace(/^\n+|\n+$/g, '');
      /* Der DWD-Text ist auf etwa 68 Zeichen hart umbrochen, und die
         Leerzeilen sitzen mitten im Satz — ein Artefakt der HTML-Umwandlung.
         In einer schmalen Spalte gäbe das lauter halbleere Zeilen, deshalb
         wird Fliesstext wieder zusammengefügt. Tabellarische Abschnitte
         (Höhenwind, mit "|") bleiben, wie sie sind. */
      const tabular = /\|/.test(body);
      return { title: b.title, tabular,
               body: tabular ? body : body.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() };
    }).filter(b => b.title || b.body);
  }

  /** Zwei Spalten, an der Stelle geteilt, wo beide etwa gleich lang werden. */
  function renderReport(parent, text) {
    const blocks = reportBlocks(text);
    if (blocks.length < 2) {
      parent.appendChild(Object.assign(U.el('pre', 'report'), { textContent: text }));
      return;
    }
    const len = blocks.map(b => b.title.length + 2 + b.body.length);
    const total = len.reduce((a, v) => a + v, 0);
    let best = 1, bestDiff = Infinity, run = 0;
    for (let i = 0; i < blocks.length - 1; i++) {
      run += len[i];
      const diff = Math.abs(run - (total - run));
      if (diff < bestDiff) { bestDiff = diff; best = i + 1; }
    }
    const wrap = U.el('div', 'report-cols');
    for (const part of [blocks.slice(0, best), blocks.slice(best)]) {
      const col = U.el('div', 'report-col');
      for (const b of part) {
        if (b.title) col.appendChild(U.el('h4', 'report-h', b.title));
        if (!b.body) continue;
        col.appendChild(b.tabular
          ? Object.assign(U.el('pre', 'report'), { textContent: b.body })
          : U.el('p', 'report-p', b.body));
      }
      wrap.appendChild(col);
    }
    parent.appendChild(wrap);
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
    d.appendChild(Object.assign(U.el('summary'),
      { textContent: 'Was bedeuten C, O, D1 … M8 und X?' }));

    const wrap = U.el('div', 'fc-scroll');
    const t = U.el('table', 'code-table');
    const thead = U.el('thead'), hr = U.el('tr');
    for (const h of ['Code', '', 'Bodensicht', 'Untergrenze ü. Bezugshöhe'])
      hr.appendChild(U.el('th', '', h));
    thead.appendChild(hr); t.appendChild(thead);
    const tb = U.el('tbody');
    for (const code of GAFOR.CODE_ORDER) {
      const ci = GAFOR.codeInfo(code);
      const tr = U.el('tr');
      const c0 = U.el('td', 'c0');
      c0.appendChild(U.el('span', `cell ${ci.key}`, ci.code));
      tr.appendChild(c0);
      tr.appendChild(U.el('td', 'c1', `${ci.word} — ${ci.label}`));
      tr.appendChild(U.el('td', 'c2', ci.vis));
      tr.appendChild(U.el('td', 'c3', ci.base));
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); d.appendChild(wrap);

    d.appendChild(note(
      'Der Buchstabe ist die Einstufung, die Ziffer sagt, <em>welche</em> Kombination aus ' +
      'Sicht und Wolkenuntergrenze dahintersteckt. Die Untergrenze zählt <strong>über der ' +
      'Bezugshöhe des Gebiets</strong> — nicht über Grund und nicht über NN — und erst ab ' +
      '5/8 Bedeckung, also BKN oder OVC. Verbindlich ist die ' +
      '<a href="https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/luftsportberichte_node.html" ' +
      'target="_blank" rel="noopener">GAFOR-Legende des DWD</a>.'));
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
      jobs.push(OM.forecast(lat, lon, 3, state.profileTop, state.model).then(j => {
        if (lat !== state.lat || lon !== state.lon) return;
        state.om = j;
        if (state.windOffset >= j.hourly.time.length) state.windOffset = 0;
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
      /* Alles in einer Zeile: Kennung, Platzname, Richtung und Entfernung.
         Der Pfeil zeigt vom gewählten Ort zur Station, nicht die Windrichtung. */
      const row = U.el('div', 'metar-row');
      const top = U.el('div', 'metar-top');
      top.appendChild(U.el('span', 'metar-id', m.icaoId));
      top.appendChild(U.el('span', 'metar-name', stationName(m)));
      const brg = U.bearing(state.lat, state.lon, m.lat, m.lon);
      const dist = U.el('span', 'metar-dist');
      dist.innerHTML = `${U.bearingArrow(brg)} ${m.distKm.toFixed(0)} km`;
      dist.title = `${U.dirName(brg)} (${U.pad(Math.round(brg))}°) vom gewählten Ort`;
      top.appendChild(dist);
      row.appendChild(top);

      // Klartext in zwei Zeilen, darunter der Rohtext — der bleibt massgebend
      row.appendChild(plainLines(metarLines(m)));
      if (m.rawOb) row.appendChild(Object.assign(U.el('pre', 'raw'), { textContent: m.rawOb }));

      const t = state.showTaf && state.tafs && state.tafs[m.icaoId];
      if (t && t.rawTAF) {
        const tl = tafLines(t);
        if (tl.length) row.appendChild(plainLines(tl, 'taf'));
        row.appendChild(Object.assign(U.el('pre', 'raw taf'), { textContent: t.rawTAF }));
      }
      body.appendChild(row);
    }
  }

  /* ---------------------------------------------------- METAR/TAF im Klartext
   * Höchstens zwei Zeilen je Meldung. Alles, was nicht hineinpasst, steht im
   * Rohtext darunter — der ist und bleibt die Meldung, das hier ist Lesehilfe.
   */
  function plainLines(lines, cls) {
    const d = U.el('div', 'metar-plain' + (cls ? ' ' + cls : ''));
    for (const l of lines) if (l) d.appendChild(U.el('div', 'pl', l));
    return d;
  }

  const knots = (kt) => (kt == null ? '—'
    : `${U.wind(kt * 0.514444, state.unit)} ${U.unitLabel[state.unit]}`);

  function windPhrase(dir, spd, gust) {
    if (spd == null) return 'keine Angabe';
    if (!spd) return 'still';
    const d = dir == null ? 'umlaufend' : `${U.pad(dir)}°`;
    return `${d}, ${knots(spd)}` + (gust ? `, Böen ${knots(gust)}` : '');
  }

  function cloudPhrase(clouds, cavok) {
    if (cavok) return 'CAVOK — unter 5000 ft wolkenfrei';
    const cl = (clouds || []).filter(c => c && c.cover);
    if (!cl.length) return 'keine Wolken gemeldet';
    const named = cl.filter(c => METAR.OKTA[c.cover]);
    if (!named.length) return METAR.COVER[cl[0].cover] || cl[0].cover;
    const txt = named.slice(0, 3).map(c => METAR.layerText(c)).join('; ');
    return 'Wolken ' + txt + (named.length > 3 ? ' …' : '');
  }

  const CAT_TXT = { VFR: 'VFR', MVFR: 'MVFR — grenzwertig', IFR: 'IFR', LIFR: 'LIFR' };

  /** Beobachtung → zwei Zeilen. */
  function metarLines(m) {
    const g = METAR.parseGroup(' ' + (m.rawOb || '') + ' ');
    const v = METAR.visKm(m);
    const wx = g.wx.map(METAR.wxText).filter(Boolean);
    const one = [`Wind ${windPhrase(m.wdir === 'VRB' ? null : m.wdir, m.wspd, m.wgst)}`];
    one.push('Sicht ' + (v ? `${v.plus ? '≥' : ''}${v.km.toFixed(v.km < 10 ? 1 : 0)} km` : 'keine Angabe'));
    if (wx.length) one.push(wx.join(', '));
    one.push(cloudPhrase(m.clouds, g.cavok));

    const two = [`${fmt(m.temp)} °C, Taupunkt ${fmt(m.dewp)} °C`];
    if (m.altim) two.push(`QNH ${Math.round(m.altim)} hPa`);
    // Die Hauptuntergrenze steht schon in Zeile 1 bei den Wolken — nicht doppeln
    if (m.fltCat) two.push(CAT_TXT[m.fltCat] || m.fltCat);
    return [one.join(' · '), two.join(' · ')];
  }

  const dayHour = (t) => (t ? `${t.day}. ${U.pad(t.hour)}` : '?');

  /** Wind, Sicht, Witterung und Wolken einer TAF-Gruppe als kurze Stücke. */
  function groupBits(g) {
    const out = [];
    if (g.wind) out.push(`Wind ${windPhrase(g.wind.dir, g.wind.spd, g.wind.gust)}`);
    if (g.vis) out.push('Sicht ' + (g.vis.plus ? '≥10 km'
      : g.vis.m >= 1000 ? `${(g.vis.m / 1000).toFixed(g.vis.m % 1000 ? 1 : 0)} km` : `${g.vis.m} m`));
    const wx = g.wx.map(METAR.wxText).filter(Boolean);
    if (wx.length) out.push(wx.join(', '));
    if (g.clouds.length || g.cavok) out.push(cloudPhrase(g.clouds, g.cavok));
    return out;
  }

  const KIND_TXT = {
    FM: (g) => `ab ${dayHour(g.from)} UTC`,
    TEMPO: (g) => `zeitweise ${dayHour(g.from)}–${U.pad(g.to ? g.to.hour : 0)} UTC`,
    INTER: (g) => `zwischenzeitlich ${dayHour(g.from)}–${U.pad(g.to ? g.to.hour : 0)} UTC`,
    BECMG: (g) => `Übergang ${dayHour(g.from)}–${U.pad(g.to ? g.to.hour : 0)} UTC`,
  };

  /** Vorhersage → zwei Zeilen: Grundlage, dann die Änderungen. */
  function tafLines(t) {
    const p = METAR.parseTaf(t.rawTAF);
    if (!p) return [];
    const base = p.groups.find(g => g.kind === 'BASE');
    const one = [];
    if (p.from && p.to) one.push(`Vorhersage ${dayHour(p.from)} bis ${dayHour(p.to)} UTC`);
    if (base) one.push(...groupBits(base));

    const changes = p.groups.filter(g => g.kind !== 'BASE').map(g => {
      const head = (KIND_TXT[g.kind] ? KIND_TXT[g.kind](g) : g.kind) +
                   (g.prob ? ` (${g.prob} %)` : '');
      return `${head}: ${groupBits(g).join(', ')}`;
    });
    let two = changes.join(' · ');
    if (two.length > 210) two = two.slice(0, 208).replace(/[ ,·]+$/, '') + ' …';
    return [one.join(' · '), two];
  }

  /* Die NOAA schreibt "Stuttgart Arpt, BW, DE". Die Abkürzungen ausschreiben,
     den Rest so lassen — erfinden wäre schlechter als abkürzen. */
  const SITE_ABBR = [
    [/\bArpt\b/gi, 'Flughafen'], [/\bIntl\b/gi, 'International'],
    [/\bAB\b/g, 'Air Base'], [/\bAFB\b/g, 'Air Force Base'],
    [/\bAAF\b/g, 'Army Airfield'], [/\bNAS\b/g, 'Naval Air Station'],
    [/\bMil\b/gi, 'Militär'], [/\bAP\b/g, 'Flughafen'],
  ];
  function stationName(m) {
    let n = String(m.name || '').trim();
    if (!n) return m.icaoId;
    for (const [re, to] of SITE_ABBR) n = n.replace(re, to);
    /* "Stuttgart Arpt, DE" → "Stuttgart Flughafen · BW".
     * Das Länderkürzel steht zuletzt. „DE" sagt in einer Deutschlandkarte
     * nichts und weicht dem Bundesland; ist der Platz nicht hinterlegt,
     * entfällt es ersatzlos — ein falsches Kürzel wäre schlimmer als keines.
     * Ausländische Plätze behalten ihr Land. */
    const parts = n.split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 1 && /^DE$/i.test(parts[parts.length - 1])) {
      parts.pop();
      const land = METAR.landOf(m.icaoId);
      if (land && !parts.includes(land)) parts.push(land);
    }
    return parts.join(' · ');
  }

  const fmt = (v) => (v == null || !isFinite(v)) ? '—' : Math.round(v);

  function renderModel() {
    const body = U.clear(U.$('modelBody'));
    const j = state.om;
    if (!j) return;
    const i0 = OM.nowIndex(j);
    const now = OM.at(j, i0);
    U.$('modelAge').textContent = `${OM.modelName(j._model)} · ${j.timezone_abbreviation || ''} · Open-Meteo`;
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

    body.appendChild(explainNote(
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

    body.appendChild(modelChips());
    body.appendChild(hourSlider(j));

    const holder = U.el('div', 'wp-holder');
    holder.id = 'windProfile';
    body.appendChild(holder);

    body.appendChild(explainNote(
      'Links ein <strong>Stüve-Diagramm</strong>: senkrecht der Druck in p<sup>0,286</sup>, ' +
      'waagrecht die Temperatur — dadurch sind die feinen Schräglinien ' +
      '<strong>Trockenadiabaten</strong> und damit Geraden. Rot die Temperatur, blau der ' +
      'Taupunkt; wo beide zusammenlaufen, ist die Luft gesättigt. Die blaue Schattierung ' +
      'beginnt bei 85 % relativer Feuchte und wird bis 100 % kräftiger. ' +
      'Rechts dasselbe Höhenraster mit der Windgeschwindigkeit; die <strong>Windfahne</strong> ' +
      'zeigt wie in der Luftfahrtkarte in den Wind, die Federn geben Knoten (halb 5, ganz 10, ' +
      'Wimpel 50). Der <strong>Pfeil in der Tabelle</strong> zeigt dagegen die Richtung, in die ' +
      'es treibt. Feuchtadiabaten und Mischungsverhältnislinien sind nicht eingezeichnet.'));
    body.appendChild(sourceLine('Open-Meteo', 'https://open-meteo.com'));

    paintProfile();
  }

  /** Tabelle und Diagramm für die gewählte Stunde — ohne die Bedienelemente. */
  function paintProfile() {
    const holder = U.$('windProfile');
    const j = state.om;
    if (!holder || !j) return;
    U.clear(holder);

    const i0 = OM.nowIndex(j);
    const idx = Math.min(i0 + state.windOffset, j.hourly.time.length - 1);
    const metres = state.altUnit === 'm';
    const levels = OM.profile(j, idx, state.elev != null ? state.elev : j.elevation)
      .map(l => Object.assign({}, l, { ft: metres ? Math.round(l.m) : l.ft }));

    U.$('windAge').textContent =
      `${OM.modelName(j._model)} · bis ${state.profileTop} hPa · ` +
      `${j.hourly.time[idx].slice(11, 16)} ${j.timezone_abbreviation || ''}`;
    U.$('windAge').className = 'age';

    if (!levels.length) {
      holder.appendChild(wrapNote(
        `<strong>${OM.modelName(j._model)}</strong> liefert für diesen Ort und diese Stunde ` +
        'kein Höhenprofil. Ein anderes Modell oder „Auto" wählen.'));
      return;
    }

    const rec = OM.at(j, idx);
    const ground = state.elev != null ? state.elev : (j.elevation || 0);
    const toAlt = (m) => (m == null ? null : (metres ? Math.round(m) : Math.round(m * OM.M_TO_FT)));
    const fzlA = toAlt(rec.fzl), pblA = rec.pbl == null ? null : toAlt(ground + rec.pbl);

    /* Tabelle links, Diagramm rechts — nebeneinander, sobald Platz da ist.
       Auf dem Handy stapelt der Umbruch sie automatisch. */
    const split = U.el('div', 'wp-split');

    const wrapT = U.el('div', 'wp-col-table fc-scroll');
    const t = U.el('table', 'wp-table');
    const th = U.el('tr');
    for (const h of [metres ? 'm AMSL' : 'ft AMSL', 'Fläche', 'Drift',
                     U.unitLabel[state.unit], '°C', 'Td', 'rF']) th.appendChild(U.el('th', '', h));
    const thead = U.el('thead'); thead.appendChild(th); t.appendChild(thead);
    const tb = U.el('tbody');

    const unitTxt = metres ? ' m' : ' ft';
    const entries = levels.map(l => ({ alt: l.ft, lvl: l }));
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
      tr.appendChild(U.el('td', 'tmp', l.dew == null ? '·' : String(Math.round(l.dew))));
      const rh = U.el('td', 'rh', l.rh == null ? '·' : `${Math.round(l.rh)} %`);
      if (l.rh != null && l.rh > STUEVE.RH_START) {
        rh.style.background = `color-mix(in srgb, var(--sv-humid) ${Math.round(STUEVE.rhAlpha(l.rh) * 130)}%, transparent)`;
      }
      tr.appendChild(rh);
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrapT.appendChild(t);
    split.appendChild(wrapT);

    const wrapG = U.el('div', 'wp-col-chart');
    split.appendChild(wrapG);
    holder.appendChild(split);
    paintChart(wrapG, wrapT, levels, {
      unit: U.unitLabel[state.unit],
      unitFactor: MS(1),
      altUnit: metres ? 'm' : 'ft',
      groundFt: toAlt(ground),
      fzlFt: fzlA,
      pblFt: pblA,
    });
  }

  /**
   * Zeichnet das Diagramm erst, wenn die Spalte ihre Breite kennt — sonst
   * bliebe es auf der Notbreite stehen und ginge im Kasten verloren.
   */
  function paintChart(box, table, levels, opts) {
    const draw = () => {
      if (!box.isConnected) return;
      const w = Math.round(box.clientWidth || 260);
      if (w < 60) { requestAnimationFrame(draw); return; }   // Layout noch nicht fertig
      const side = window.innerWidth > 640 && w >= 200;
      const th = Math.round(table.getBoundingClientRect().height);
      const h = side ? U.clamp(th || 320, 280, 680) : 360;
      // Stüve mit Windfeld daneben; fehlt die Feuchte, bleibt das reine Windprofil
      const svg = STUEVE.chart(levels, { ...opts, w: U.clamp(w, 260, 760), h }) ||
                  WINDVIEW.chart(levels, { ...opts, w: U.clamp(w, 200, 680), h });
      U.clear(box);
      if (svg) box.appendChild(svg);
    };
    requestAnimationFrame(draw);
  }

  /**
   * Zeitwahl als Schieber in Ein-Stunden-Schritten. Sein oberes Ende ist der
   * Vorhersagehorizont des gewählten Modells — weiter als ICON-D2 rechnet,
   * lässt er sich mit ICON-D2 also gar nicht erst ziehen.
   */
  function hourSlider(j) {
    const i0 = OM.nowIndex(j);
    const maxData = Math.max(0, j.hourly.time.length - 1 - i0);
    const maxHours = Math.min(maxData, OM.modelHours(j._model));
    state.windOffset = U.clamp(state.windOffset, 0, maxHours);

    const box = U.el('div', 'hour-slider');
    const lab = U.el('div', 'hs-label');
    const input = Object.assign(U.el('input'), {
      type: 'range', min: '0', max: String(maxHours), step: '1',
      value: String(state.windOffset),
    });
    input.setAttribute('aria-label', 'Vorhersagezeitpunkt');

    const stamp = (off) => {
      const i = Math.min(i0 + off, j.hourly.time.length - 1);
      const t = j.hourly.time[i];
      return `${off === 0 ? 'jetzt' : '+' + off + ' h'} · ${t.slice(11, 16)} ` +
             `${j.timezone_abbreviation || ''}${off >= 24 ? ' · ' + t.slice(8, 10) + '.' : ''}`;
    };
    const setLabel = (off) => { lab.textContent = stamp(off); };
    setLabel(state.windOffset);

    let t = 0;
    input.oninput = () => {
      state.windOffset = +input.value;
      setLabel(state.windOffset);
      clearTimeout(t);
      t = setTimeout(paintProfile, 90);
    };

    const row = U.el('div', 'hs-row');
    row.appendChild(U.el('span', 'hs-cap', 'jetzt'));
    row.appendChild(input);
    row.appendChild(U.el('span', 'hs-cap', `+${maxHours} h`));
    box.appendChild(row);
    box.appendChild(lab);
    return box;
  }

  /**
   * Modellwahl, aufsteigend nach Vorhersagehorizont. Jedes Modell bleibt
   * wählbar; der Schieber verkürzt sich danach auf dessen Horizont.
   */
  function modelChips() {
    const row = U.el('div', 'chips models');
    row.appendChild(U.el('span', 'chips-label', 'Modell'));
    for (const m of OM.MODELS) {
      const b = U.el('button', 'chip' + (m.key === state.model ? ' on' : ''), m.name);
      b.title = `${m.note} · Vorhersage bis +${m.hours} h`;
      b.onclick = () => {
        if (m.key === state.model) return;
        state.model = m.key; U.save('model', m.key);
        // weiter als das neue Modell rechnet, geht nicht
        state.windOffset = Math.min(state.windOffset, m.hours);
        loadPointData(true, ['model']);
      };
      row.appendChild(b);
    }
    return row;
  }

  function markRow(txt, cls) {
    const tr = U.el('tr', 'wp-mrow ' + cls);
    const td = U.el('td', '', txt);
    td.colSpan = 7;
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
  /** Erklärender Text — im Ausdruck weggelassen, dort zählt der Platz. */
  function explainNote(html) {
    const w = wrapNote(html);
    w.classList.add('explain');
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
    const dCode = note(
      '<strong>GAFOR-Codes.</strong> Der Buchstabe ist die Einstufung, die Ziffer die ' +
      'Kombination aus Bodensicht und Wolkenuntergrenze. Die Untergrenze zählt über der ' +
      '<em>Bezugshöhe des Gebiets</em> und erst ab 5/8 Bedeckung. Die Tabelle steht in der ' +
      'GAFOR-Karte unter „Was bedeuten C, O, D1 … M8 und X?"; verbindlich ist die ' +
      'GAFOR-Legende des DWD.');
    dCode.style.marginTop = '8px';
    box.appendChild(dCode);
    const dLic = note(
      '<strong>Nur zur individuellen Flugvorbereitung.</strong> Die Flugwetterprodukte des ' +
      'DWD dürfen nicht weitergegeben oder weiterverarbeitet werden. Diese Installation ist ' +
      'privat; die Kennwortabfrage ist ein Hinweis darauf, kein Zugangsschutz.');
    dLic.style.marginTop = '8px';
    box.appendChild(dLic);
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
