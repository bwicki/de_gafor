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
    rhStart: U.load('rhStart', 85),        // rF-Schwelle, ab der schattiert wird
    lastFetchLat: null, lastFetchLon: null,
    om: null, ens: null, metars: null, tafs: null,
    hour: 0,                                  // gewählte Stunde, gilt für alle Karten
    model2: U.load('model2', ''),             // zweites Modell zum Vergleich im Profil
    om2: null,
    autoRefresh: U.load('autoRefresh', 1),
    fly: U.load('fly', null),                 // Startfenster-Schwellen, null = Vorgaben
    aiModel: U.load('aiModel', AI.MODELS[0].key),
    aiDwd: U.load('aiDwd', 0),                // DWD-Text an die KI mitschicken
    ai: null,                                 // letzte Analyse {sections, at, model, key}
    aiBusy: false,
    lastLoad: { model: 0, metar: 0, dwd: 0 },
    guest: null,                              // Gastzugang aus einem geteilten Link
    model: U.load('model', ''),               // '' = Auto-Mix, sonst ein Open-Meteo-Modell
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

    /* Zuerst der Link: er kann einen Gastzettel tragen, und den muss die
       Sperre kennen, bevor sie sich meldet. */
    const start = startPosition();
    state.lat = start.lat; state.lon = start.lon;

    initGate();
    U.$('appVersion').textContent = APP.version;

    /* Getrennt abgesichert: geht die Karte nicht auf, sollen wenigstens Menü
       und Knöpfe verdrahtet sein — und umgekehrt. */
    try {
      MAPVIEW.init('map', { center: [state.lat, state.lon], zoom: start.zoom, onMove: onMapMove });
    } catch (e) { console.error('Karte konnte nicht starten:', e); }
    try { wireUI(); wireTimeBar(); } catch (e) { console.error('Bedienung nicht vollständig verdrahtet:', e); }
    // erst jetzt: der Gastmodus greift in Karte und Bedienung ein
    if (state.guest) applyGuestMode();
    renderPlace();
    footer();

    await GAFOR.init();
    MAPVIEW.setMaskTheme(document.documentElement.dataset.theme !== 'light');
    MAPVIEW.setMask(GAFOR.landCollection() || GAFOR.collection());
    MAPVIEW.setLand(GAFOR.landCollection());
    MAPVIEW.setRegions(GAFOR.regionCollection());
    MAPVIEW.setAreas(GAFOR.collection());
    renderLegend();
    paintFavourites();
    if (!GAFOR.count()) {
      U.$('mapHint').textContent = 'Gebietsgrenzen fehlen — data/gafor-areas.geojson ist leer';
    }
    resolveArea();
    if (!state.place) namePlace(state.lat, state.lon);

    try { await DWD.load(); state.lastLoad.dwd = Date.now(); }
    catch (e) { console.warn('DWD index not available:', e.message); }
    renderReports();
    loadPointData(true);
    startAutoRefresh();

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
    const [coords, ...rest] = h.split(';');
    const tok = (rest.find(r => r.startsWith('g=')) || '').slice(2);
    const guest = tok ? readGuest(tok) : null;
    if (guest) {
      state.guest = guest;
      return { lat: guest.lat, lon: guest.lon, zoom: guest.zoom };
    }
    const m = coords.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+))?$/);
    if (m) return { lat: +m[1], lon: +m[2], zoom: m[3] ? +m[3] : 9 };
    return { ...HOME };
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
    U.$('flyReset').onclick = () => { state.fly = null; showFlyFields(); };
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
      rt = setTimeout(() => {
        if (!state.om) return;
        paintProfile();
        const hs = U.$('windBody').querySelector('.hour-slider');
        if (hs && hs._place) hs._place();          // Marke folgt der neuen Breite
        if (state.om) markTime();
        // die Spaltenaufteilung hängt an der Breite und muss mit
        for (const w of document.querySelectorAll('.report-cols')) {
          if (w._balance) w._balance();
        }
      }, 220);
    });
  }

  /* --------------------------------------------------------- Gastzugang
   * Ein geteilter Link soll sich beim Empfänger ohne Kennwort öffnen — aber
   * nur für **diesen einen Ort** und nur für eine halbe Stunde. Im Fragment
   * steht dafür ein Zettel mit Ort, Zoom und Ablaufzeit plus einer kurzen
   * Prüfsumme, die die Nutzlast an das Kennwort bindet.
   *
   * Das ist **keine Kryptographie**, und es soll auch keine sein: die Seite
   * ist statisch, ihr Quelltext öffentlich, das Kennwort steht darin. Wer den
   * Quelltext liest, kann sich einen Zettel selbst ausstellen. Der Zettel
   * verhindert, was praktisch passiert: dass ein weitergeleiteter Link Wochen
   * später noch aufgeht oder dass jemand damit durch ganz Deutschland fährt.
   * Ein echter Schutz bräuchte einen Server mit Sitzungen — GitHub Pages kann
   * das nicht.
   */
  const GUEST_MS = 30 * 60 * 1000;
  let guestTimer = 0;

  /** Kurzer, nicht kryptographischer Fingerabdruck (FNV-1a, hex). */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  const b64u = (s) => btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => decodeURIComponent(escape(
    atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

  function guestToken(lat, lon, zoom) {
    const body = [lat.toFixed(4), lon.toFixed(4), zoom, Date.now() + GUEST_MS].join('~');
    return b64u(`${body}~${fnv(body + GATE_PW)}`);
  }

  /** Zettel prüfen. Gibt {lat, lon, zoom, exp} oder null. */
  function readGuest(tok) {
    try {
      const raw = unb64u(String(tok || ''));
      const i = raw.lastIndexOf('~');
      if (i < 0) return null;
      const body = raw.slice(0, i);
      if (fnv(body + GATE_PW) !== raw.slice(i + 1)) return null;
      const [lat, lon, zoom, exp] = body.split('~');
      if (!(+exp > Date.now())) return null;
      if (!isFinite(+lat) || !isFinite(+lon)) return null;
      return { lat: +lat, lon: +lon, zoom: +zoom || 10, exp: +exp };
    } catch { return null; }
  }

  /** Gastmodus: Ort fest, Wetter frei. */
  function applyGuestMode() {
    const g = state.guest;
    if (!g) return;
    document.body.classList.add('guest');

    /* Ortswahl stilllegen und sagen, warum. Die Suchzeile wird ausgeblendet,
       nicht entfernt: an `#searchResults` hängt ein Klickhorcher, der sonst
       ins Leere greift. */
    const sb = U.$('searchBlock');
    const row = sb.querySelector('.search-row');
    if (row) row.style.display = 'none';
    const note2 = U.el('div', 'guest-note');
    note2.innerHTML = '<span class="ic">🔒</span><span><strong>Fester Ort.</strong> ' +
      'Dieser Link zeigt das Wetter für genau diesen Punkt. Modell, Vergleich und ' +
      'Zeitpunkt lassen sich frei wählen, der Ort nicht.</span>' +
      `<span class="rest" id="guestRest"></span>`;
    sb.appendChild(note2);

    const map = MAPVIEW.get();
    if (map && map.dragging) map.dragging.disable();
    U.$('mapHint').textContent = 'Ort ist durch den Link festgelegt';
    for (const id of ['gpsBtn', 'favBtn', 'savePlaceBtn', 'mLockBtn']) {
      const n = U.$(id); if (n) n.remove();
    }
    const si = U.$('searchInput'); if (si) si.disabled = true;

    const tick = () => {
      const left = Math.max(0, g.exp - Date.now());
      const el = U.$('guestRest');
      if (el) {
        const m = Math.ceil(left / 60000);
        el.textContent = left ? `noch ${m} min` : 'abgelaufen';
      }
      if (left <= 0) guestExpired();
    };
    tick();
    guestTimer = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  function guestExpired() {
    clearInterval(guestTimer);
    try { sessionStorage.setItem('gaforcast.guestGone', '1'); } catch { /* egal */ }
    location.hash = '';
    location.reload();
  }

  // ------------------------------------------------------------------ Sperre
  /* Nach zwei Stunden ohne Benutzung wird wieder gefragt. Gemessen wird die
     letzte Berührung, nicht die Anmeldung: wer die App den ganzen Tag offen
     hat und benutzt, wird nicht herausgeworfen; wer sie liegen lässt, schon.
     Der Zeitstempel liegt im localStorage, die Sperre greift also auch, wenn
     das Fenster zwischendurch geschlossen war. */
  const GATE_IDLE_MS = 2 * 60 * 60 * 1000;
  let idleTimer = 0;

  const touchGate = () => {
    if (U.load('unlocked', 0) !== 1) return;
    U.save('unlockedAt', Date.now());
    clearTimeout(idleTimer);
    idleTimer = setTimeout(lockAgain, GATE_IDLE_MS);
  };

  /** Ist die Anmeldung abgelaufen? Fehlt der Zeitstempel, gilt sie als alt. */
  const gateExpired = () =>
    Date.now() - (+U.load('unlockedAt', 0) || 0) > GATE_IDLE_MS;

  function initGate() {
    const g = U.$('gate');
    if (!g) return;

    /* Gastzettel im Link: aufmachen, aber **nichts** dauerhaft freischalten —
       der Empfänger soll nicht für immer entsperrt sein. */
    if (state.guest) { g.remove(); return; }   // applyGuestMode() läuft nach MAPVIEW.init

    let gone = false;
    try { gone = sessionStorage.getItem('gaforcast.guestGone') === '1';
          sessionStorage.removeItem('gaforcast.guestGone'); } catch { /* egal */ }
    if (gone) U.$('gateHint').hidden = false;

    if (U.load('unlocked', 0) === 1 && !gateExpired()) {
      g.remove();
      armIdle();
      return;
    }
    U.save('unlocked', 0);
    g.hidden = false;
    U.$('gateForm').onsubmit = (e) => {
      e.preventDefault();
      if (U.$('gatePw').value.trim() === GATE_PW) {
        U.save('unlocked', 1);
        touchGate();
        armIdle();
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

  /** Uhr für die Untätigkeit starten und auf jede Berührung zurücksetzen. */
  function armIdle() {
    touchGate();
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, touchGate, { passive: true });
    }
    /* Aus dem Hintergrund zurück: die Uhr lief währenddessen weiter, ein
       Timer im schlafenden Tab aber nicht zuverlässig — deshalb hier prüfen. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { if (gateExpired()) lockAgain(); else touchGate(); }
    });
  }

  function lockAgain() {
    U.save('unlocked', 0);
    U.save('unlockedAt', 0);
    location.reload();
  }

  // ------------------------------------------------------------------ reload
  /** Macht eine Altersanzeige zum Nachlade-Knopf für genau ihre Karte. */
  function cardReload(id, fn) {
    const n = U.$(id);
    if (!n) return;
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
    try { await DWD.load(true); state.lastLoad.dwd = Date.now(); }
    catch { /* die Karten zeigen es selbst */ }
    renderReports();
    b.classList.remove('spinning');
  }

  /** Alles neu: DWD-Index, Ballonbericht, METAR/TAF, Modell, Ensemble. */
  async function reloadAll() {
    const b = U.$('reloadBtn');
    if (b.classList.contains('spinning')) return;
    b.classList.add('spinning');
    METAR.reload();                       // die Repo-Kopie neu ziehen, nicht die alte nehmen
    try { await DWD.load(true); state.lastLoad.dwd = Date.now(); }
    catch { /* die Karten zeigen es selbst */ }
    renderReports();
    try { await loadPointData(true); } catch { /* dito */ }
    b.classList.remove('spinning');
    b.classList.add('ok');
    setTimeout(() => b.classList.remove('ok'), 1400);
  }

  /* ------------------------------------------------- automatisches Nachladen
   * Solange der Tab sichtbar ist, holt die App still nach: METAR alle zehn
   * Minuten (sie werden halbstündlich ausgegeben), den DWD-Index alle zwanzig
   * (der Workflow läuft dreimal pro Stunde), das Modell alle dreissig.
   *
   * Im Hintergrund läuft nichts — ein schlafender Tab würde weder zuverlässig
   * ticken noch nützt es jemandem. Beim Zurückkommen wird einmal geprüft und
   * das Überfällige nachgeholt. Abschaltbar in den Einstellungen.
   */
  const AUTO = { metar: 10 * 60e3, dwd: 20 * 60e3, model: 30 * 60e3 };
  let autoTimer = 0;
  let autoWired = false;

  function startAutoRefresh() {
    clearInterval(autoTimer);
    if (!state.autoRefresh) return;
    autoTimer = setInterval(autoTick, 60e3);
    if (!autoWired) {                     // sonst hinge nach jedem Einstellen ein Horcher mehr
      autoWired = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) autoTick(); });
    }
  }

  async function autoTick() {
    if (!state.autoRefresh || document.hidden) return;
    const now = Date.now();
    const due = (k) => now - (state.lastLoad[k] || 0) > AUTO[k];

    if (due('dwd')) {
      state.lastLoad.dwd = now;                 // vor dem Abruf setzen: kein Doppellauf
      try { await DWD.load(true); renderReports(); } catch { /* still */ }
    }
    if (due('metar')) {
      state.lastLoad.metar = now;
      METAR.reload();
      try { await loadPointData(true, ['metar']); } catch { /* still */ }
    }
    if (due('model')) {
      state.lastLoad.model = now;
      try { await loadPointData(true, ['model', 'ens']); } catch { /* still */ }
    }
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

  /* Der geteilte Link trägt einen Gastzettel: der Empfänger kommt ohne
     Kennwort hinein, aber nur für diesen Ort und nur eine halbe Stunde. */
  const shareUrl = () => {
    const z = MAPVIEW.get() ? MAPVIEW.get().getZoom() : 9;
    return `${location.origin}${location.pathname}` +
      `#${state.lat.toFixed(4)},${state.lon.toFixed(4)},${z}` +
      `;g=${guestToken(state.lat, state.lon, z)}`;
  };

  function copyLink() {
    const url = shareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => flash('Link kopiert — 30 min ohne Kennwort'),
        () => fallbackCopy(url));
    } else fallbackCopy(url);
  }

  function fallbackCopy(text) {
    const ta = U.el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flash('Link kopiert — 30 min ohne Kennwort'); }
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
    if (state.guest) return;                 // im Gastmodus ist der Ort fest
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
    if (changed) renderReports(); else renderAreaHead();
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

    const cur = currentPeriod(DWD.gaforFor(a));
    if (cur) {
      const badge = U.el('span', `badge ${cur.ci.key}`, cur.ci.code);
      badge.title = cur.ci.desc;
      st.appendChild(badge);
      st.appendChild(U.el('div', 't', cur.ci.word || ''));
    }
  }

  /**
   * Der Zeitraum, in dem wir gerade sind — sonst der erste des Bulletins.
   * Kopfzeile und Zeitband fragen dieselbe Stelle, sonst zeigte der Kopf noch
   * den Vormittag, während im Band längst der Nachmittag hervorgehoben war.
   */
  function currentPeriod(b) {
    if (!b || !b.codes || !b.codes.length) return null;
    const hUtc = selectedUtcHour();
    let i = (b.periods || []).findIndex(p => inPeriod(p, hUtc));
    const hit = i >= 0;
    if (!hit) i = 0;
    return { i, now: hit,
             ci: GAFOR.codeInfo(b.codes[i] || ''),
             remark: (b.detail && b.detail.remarks && b.detail.remarks[i]) || '' };
  }

  /**
   * Die gewählte Stunde als UTC-Dezimalstunde. Der Zeitschieber steuert auch
   * das GAFOR-Band: steht er auf „jetzt", ist es die aktuelle Stunde, sonst
   * die gewählte. Ohne Modelldaten bleibt es bei der Uhr.
   */
  function selectedUtcHour() {
    const j = state.om;
    if (j && j.hourly) {
      const off = (j.utc_offset_seconds || 0) * 1000;
      const ms = Date.parse(j.hourly.time[tIndex(j)] + ':00Z') - off;
      const d = new Date(ms);
      return d.getUTCHours() + d.getUTCMinutes() / 60;
    }
    const n = new Date();
    return n.getUTCHours() + n.getUTCMinutes() / 60;
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
    const tiles = U.clear(U.$('tileBody'));
    const age = U.$('gaforAge');
    const tAge = U.$('tileAge');
    age.textContent = ''; age.className = 'age';
    tAge.textContent = ''; tAge.className = 'age';
    const a = state.area;
    const b = a ? DWD.gaforFor(a) : null;

    if (!DWD.raw()) {
      const msg = 'Die Berichtsdatei <strong>data/dwd/index.json</strong> fehlt oder ist leer. ' +
        'Sie wird vom Workflow <em>DWD-Berichte holen</em> erzeugt — im Actions-Tab einmal starten. ' +
        'Wird das ZIP über ein bestehendes Repo gelegt, darf diese Datei nicht mit überschrieben werden.';
      body.appendChild(note(msg));
      tiles.appendChild(note('Keine Berichtsdatei.'));
      return;
    }
    if (!a) {
      body.appendChild(note(`<strong>${OUTSIDE}</strong>`));
      tiles.appendChild(note(OUTSIDE));
      return;
    }
    if (!b) {
      const ov = DWD.overviewFor(a);
      tAge.textContent = ov && ov.bereich ? `Bereich ${ov.bereich}` : '';
      tiles.appendChild(note(`Für Gebiet ${a.id} liegt derzeit keine GAFOR-Codetabelle vor` +
        (ov ? ' — die Flugwetterübersicht des Bereichs steht unten.' : '.')));
      if (ov) renderOverview(body, age, ov);
      return;
    }

    const span = (b.periods && b.periods.length)
      ? `${b.periods[0].slice(0, 2)}–${b.periods[b.periods.length - 1].slice(3)} UTC` : '';
    tAge.textContent = [b.bereich, span, b.issued ? U.ago(b.issued) : ''].filter(Boolean).join(' · ');
    tAge.className = U.ageClass(b.issued, 300, 600);

    const st = staleness(b);
    if (st) tiles.appendChild(staleWarning(st));

    if (b.detail && b.detail.remark) {
      const r = U.el('div', 'note');
      r.style.margin = '9px 13px 0';
      r.innerHTML = `Zusatz für Gebiet ${a.id}: <strong>${b.detail.remark}</strong>`;
      tiles.appendChild(r);
    }

    if (b.codes && b.codes.length && b.periods && b.periods.length) {
      tiles.appendChild(gaforBar(a, b));
      tiles.appendChild(codeLegend());
    }

    // der Fliesstext des Bereichs, zu dem dieses Gebiet gehört
    const ov = DWD.overviewFor(a);
    if (ov) renderOverview(body, age, ov);
    else if (b.source) body.appendChild(sourceLine(b.title || 'DWD', b.source));
  }

  /**
   * Die GAFOR-Stufen als durchgehendes Zeitband: ein Abschnitt je Zeitraum, in
   * der Farbe seiner Stufe, der laufende kräftiger und amber unterstrichen.
   * Sicht, Untergrenze und ein etwaiger Zusatz stehen in der Fusszeile — für
   * den Abschnitt, auf den man tippt, sonst für den laufenden. So braucht die
   * ganze Reihe rund ein Viertel der Höhe der früheren Kacheln und wächst auch
   * bei sechs Zeiträumen nicht in die zweite Zeile.
   */
  function gaforBar(a, b) {
    const wrap = U.el('div', 'gbar-wrap');
    const bar = U.el('div', 'gafor-bar');
    const foot = U.el('div', 'gbar-foot');
    const segs = [];

    const show = (i) => {
      const ci = GAFOR.codeInfo(b.codes[i] || '');
      const rem = (b.detail && b.detail.remarks && b.detail.remarks[i]) || '';
      const sel = inPeriod(b.periods[i], selectedUtcHour());
      U.clear(foot);
      const left = U.el('div', 'gf-l');
      left.innerHTML = `${sel && state.hour === 0 ? 'jetzt' : b.periods[i].replace('-', '–') + ' UTC'} ` +
        `<strong class="k ${ci.key}">${ci.word || ci.letter || '—'}</strong>` +
        (ci.vis ? ` · ${ci.vis} · ${ci.base}` : '') +
        (rem ? ` · <span class="k ${ci.key}">${rem}</span>` : '');
      foot.appendChild(left);
      const right = U.el('div', 'gf-r');
      right.textContent = a.refAltFt != null
        ? `Bezugshöhe ${a.refAltFt} ft MSL` : 'Zeiten in UTC';
      foot.appendChild(right);
      segs.forEach((s2, k) => s2.classList.toggle('sel', k === i));
    };

    const cur = currentPeriod(b);
    const start = cur ? cur.i : 0;
    for (let i = 0; i < b.periods.length; i++) {
      const p = b.periods[i];
      const ci = GAFOR.codeInfo(b.codes[i] || '');
      const isNow = i === start && (!cur || cur.now);
      const seg = U.el('button', `gseg ${ci.key}${isNow ? ' now' : ''}`);
      const rem = (b.detail && b.detail.remarks && b.detail.remarks[i]) || '';
      if (rem) seg.appendChild(U.el('span', 'gflag'));
      const code = U.el('span', 'gcd');
      code.appendChild(U.el('span', 'l', ci.letter));
      if (ci.digit) code.appendChild(U.el('span', 'g', ci.digit));
      seg.appendChild(code);
      seg.appendChild(U.el('span', 'ghr', p.replace('-', '–')));
      seg.title = [ci.desc, rem].filter(Boolean).join(' · ');
      seg.onclick = () => show(i);
      segs.push(seg);
      bar.appendChild(seg);
    }
    wrap.appendChild(bar);

    /* Unter jedem Abschnitt seine Stufendefinition — Sicht und Untergrenze.
       Sie war bis 1.14.0 nur in der Fusszeile des angetippten Abschnitts zu
       sehen; für den Vergleich zweier Zeiträume musste man hin- und
       herklicken. */
    const defs = U.el('div', 'gdef-row');
    for (let i = 0; i < b.periods.length; i++) {
      const ci = GAFOR.codeInfo(b.codes[i] || '');
      const d = U.el('div', `gdef ${ci.key}`);
      if (ci.vis) {
        d.appendChild(U.el('span', 'v', ci.vis));
        d.appendChild(U.el('span', 'b', ci.base));
      } else {
        d.appendChild(U.el('span', 'v', '—'));
      }
      d.title = ci.desc || '';
      defs.appendChild(d);
    }
    wrap.appendChild(defs);

    wrap.appendChild(foot);
    show(start);
    return wrap;
  }

  /* ------------------------------------------------------- Alter der Daten
   * Ein GAFOR-Bulletin gilt für einen festen Zeitraum. Läuft dieser ab, steht
   * die Codereihe zwar noch da, sagt aber nichts mehr — und genau das ist der
   * gefährliche Fall, weil die Kacheln unverändert aussehen. Die Warnung muss
   * deshalb dorthin, wo man hinschaut, nicht in die kleine Altersanzeige.
   */
  const STALE_MIN = 3 * 60;              // ab drei Stunden ohne Aktualisierung

  /**
   * Ende der Gültigkeit in Millisekunden. Das Bulletin nennt es nicht direkt;
   * es steckt im letzten Zeitraum („15-17") und in der Ausgabezeit. Läuft die
   * Reihe über Mitternacht, gehört das Ende auf den Folgetag.
   */
  function validUntil(b) {
    if (!b || !b.issued || !b.periods || !b.periods.length) return null;
    const last = /(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(b.periods[b.periods.length - 1]);
    const first = /^(\d{1,2})/.exec(b.periods[0]);
    if (!last || !first) return null;
    const iss = new Date(b.issued);
    if (isNaN(iss)) return null;
    const end = Date.UTC(iss.getUTCFullYear(), iss.getUTCMonth(), iss.getUTCDate(), +last[2], 0, 0);
    // über Mitternacht: das Ende liegt am Folgetag
    return +last[2] <= +first[1] ? end + 86400000 : end;
  }

  /** Warum die Daten fragwürdig sind, oder null wenn alles frisch ist. */
  function staleness(b) {
    if (!b) return null;
    const now = Date.now();
    const end = validUntil(b);
    if (end != null && now > end) {
      return { hard: true,
               txt: `Gültig war dieses Bulletin nur bis ${U.fmtUTC(new Date(end))} — ` +
                    `das ist ${U.ago(new Date(end).toISOString())} her. Die Stufen unten ` +
                    'sagen für jetzt nichts mehr aus.' };
    }
    if (b.issued) {
      const age = (now - Date.parse(b.issued)) / 60000;
      if (isFinite(age) && age > STALE_MIN) {
        return { hard: age > 2 * STALE_MIN,
                 txt: `Ausgegeben ${U.ago(b.issued)} — der Workflow holt normalerweise ` +
                      'dreimal pro Stunde. Läuft er noch?' };
      }
    }
    return null;
  }

  /* Der Knopf im Warnhinweis lädt neu — und muss das auch sagen. Ohne
     Rückmeldung sah es aus, als täte er nichts: der DWD hat oft schlicht
     nichts Neues, die Seite bleibt also gleich. Also drei Zustände: „lädt…",
     danach entweder frische Daten (der Hinweis verschwindet von selbst) oder
     die ausdrückliche Meldung, dass der Stand unverändert ist. */
  let staleBusy = false;
  let staleNote = '';

  function staleWarning(st) {
    const d = U.el('div', 'stale' + (st.hard ? ' hard' : ''));
    const txt = U.el('span');
    txt.innerHTML = st.txt + (staleNote ? ` <em class="sn">${staleNote}</em>` : '');
    d.appendChild(U.el('span', 'ic', '!'));
    d.appendChild(txt);
    const b = U.el('button', 'btn small', staleBusy ? 'lädt…' : 'neu laden');
    b.disabled = staleBusy;
    b.onclick = reloadStale;
    d.appendChild(b);
    return d;
  }

  /** Neu laden aus dem Warnhinweis heraus, mit sichtbarem Zustand. */
  async function reloadStale() {
    if (staleBusy) return;
    staleBusy = true; staleNote = '';
    renderGafor();                       // Knopf zeigt sofort „lädt…"
    flash('Berichte werden geladen …');
    const before = DWD.generated();
    try { await reloadAll(); } catch { /* die Karten zeigen es selbst */ }
    staleBusy = false;
    const after = DWD.generated();
    if (after && after !== before) {
      staleNote = '';
      flash('Neue Berichte geladen');
    } else {
      staleNote = `Um ${U.fmtLocalTime(new Date())} neu geholt — der DWD-Stand ist unverändert.`;
      flash('Stand unverändert');
    }
    renderReports();
  }

  /** Flugwetterübersicht eines Bereichs in die eigene Karte. */
  function renderOverview(body, age, ov) {
    age.textContent = [
      ov.bereich ? `Bereich ${ov.bereich}` : '',
      ov.validFrom && ov.validTo
        ? `gültig ${U.fmtUTC(new Date(ov.validFrom))} – ${U.fmtUTC(new Date(ov.validTo))}` : '',
    ].filter(Boolean).join(' · ');
    age.className = 'age';
    if (ov.bulletin) {
      const meta = U.el('div', 'note');
      meta.style.marginBottom = '8px';
      meta.innerHTML = `<strong>${ov.bulletin}</strong>`;
      body.appendChild(meta);
    }
    renderReport(body, ov.text);
    body.appendChild(sourceLine('DWD Flugwetterübersicht', ov.source));
  }

  /* -------------------------------------------------------- Berichtstext
   * Die Flugwetterübersicht ist ein langer Fliesstext mit Abschnitten wie
   * „Wetterlage und -entwicklung:", „Wettergeschehen:", „Wind:". Als eine
   * Spalte ist das auf dem Desktop eine Bleiwüste — deshalb wird der Text in
   * seine Abschnitte zerlegt und auf zwei Spalten verteilt; geht es nicht auf,
   * bekommt die linke den längeren Teil (siehe renderReport).
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
    return blocks
      .map(b => ({ title: b.title, parts: splitParts(b.body.join('\n')) }))
      .filter(b => b.title || b.parts.length);
  }

  /**
   * Einen Abschnitt in Fliesstext- und Tabellenstücke zerlegen.
   *
   * Bis 1.13.0 galt ein ganzer Abschnitt als Tabelle, sobald **irgendwo** darin
   * ein „|" vorkam — und damit stand „Inversionen" samt seinem Prosaabsatz in
   * der Schreibmaschinenschrift, nur weil weiter unten die Dämmerungszeiten
   * folgen. Getrennt wird deshalb absatzweise (an Leerzeilen): ein Absatz ist
   * eine Tabelle, wenn er „|" enthält oder wenn seine Zeilen mit mehrfachen
   * Leerzeichen ausgerichtet sind. Nur die bekommen die feste Breite, alles
   * andere läuft in der Grundschrift des Berichts.
   */
  function splitParts(raw) {
    const out = [];
    for (const para of String(raw || '').split(/\n\s*\n/)) {
      const text = para.replace(/^\n+|\n+$/g, '');
      if (!text.trim()) continue;
      const lines = text.split('\n').filter(l => l.trim());
      const aligned = lines.filter(l => /\S {2,}\S/.test(l)).length;
      const tabular = /\|/.test(text) || (lines.length > 1 && aligned >= lines.length / 2);
      if (tabular) {
        const tbl = parseTable(text);
        out.push(tbl ? { table: tbl } : { tabular: true, text });
        continue;
      }
      /* Der DWD-Text ist auf etwa 68 Zeichen hart umbrochen, und die Umbrüche
         sitzen mitten im Satz — ein Artefakt der HTML-Umwandlung. In einer
         schmalen Spalte gäbe das lauter halbleere Zeilen, deshalb wird
         Fliesstext wieder zusammengefügt. */
      out.push({ tabular: false,
                 text: text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() });
    }
    return out;
  }

  /* ---------------------------------------------------------- Berichtstabellen
   * Höhenwind und Dämmerungszeiten kommen als ASCII-Tabellen mit „|" — in
   * fester Breite gesetzt standen die Striche zwar da, aber die Zahlen darunter
   * verrutschten, sobald ein Ortsname länger war. Deshalb werden sie in eine
   * **echte Tabelle** überführt; die Spalten richten sich dann von selbst aus.
   *
   * Zwei Regeln machen das allgemein genug für beide Formen:
   *
   *  1. **Spalte teilen.** Steht in allen Datenzellen einer Spalte ein Paar,
   *     getrennt durch zwei oder mehr Leerzeichen („010/05KT  20C",
   *     „Gießen  18.24"), wird die Spalte in zwei geteilt; die Kopfzelle
   *     bekommt colspan 2.
   *  2. **Kurze Zeile spannen.** Hat eine Zeile weniger Zellen als die Tabelle
   *     breit ist und geht die Breite glatt auf, wird gleichmässig gespannt —
   *     so steht „heute | morgen" über je zwei Zeitspalten.
   *
   * Zeilen ohne „|" nach der letzten Tabellenzeile sind Fussnoten
   * („BDA/BDE = Anfang/Ende Bürgerliche Dämmerung") und bleiben Text.
   */
  function parseTable(text) {
    const all = text.split('\n').filter(l => l.trim());
    const lastPipe = all.map(l => l.includes('|')).lastIndexOf(true);
    if (lastPipe < 0) return null;
    const foot = all.slice(lastPipe + 1);
    const body = all.slice(0, lastPipe + 1).filter(l => l.includes('|'));
    if (body.length < 2) return null;

    let rows = body.map(l => {
      const cells = l.split('|').map(c => c.trim());
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      return cells;
    }).filter(r => r.length);
    if (rows.length < 2) return null;

    const width0 = Math.max(...rows.map(r => r.length));

    // --- 1. Spalten teilen, wo jede Datenzelle ein Paar enthält ---
    const full = rows.slice(1).filter(r => r.length === width0);
    const split = [];
    for (let c = 0; c < width0; c++) {
      const head = rows[0][c] || '';
      const ok = full.length >= 1 && full.every(r => /\S {2,}\S/.test(r[c] || '')) &&
                 !/\S {2,}\S/.test(head);
      split.push(ok);
    }
    if (split.some(Boolean)) {
      rows = rows.map((r, ri) => {
        if (r.length !== width0) return r.map(t => ({ t }));   // kurze Zeilen später spannen
        const out2 = [];
        for (let c = 0; c < width0; c++) {
          if (!split[c]) { out2.push({ t: r[c] }); continue; }
          if (ri === 0) { out2.push({ t: r[c], span: 2 }); continue; }
          const m = /^(.*\S) {2,}(\S.*)$/.exec(r[c]);
          if (m) { out2.push({ t: m[1] }); out2.push({ t: m[2] }); }
          else { out2.push({ t: r[c], span: 2 }); }
        }
        return out2;
      });
    } else {
      rows = rows.map(r => r.map(t => ({ t })));
    }

    // --- 2. kurze Zeilen gleichmässig spannen ---
    const cols = Math.max(...rows.map(r => r.reduce((a, c) => a + (c.span || 1), 0)));
    rows = rows.map(r => {
      const n = r.reduce((a, c) => a + (c.span || 1), 0);
      if (n >= cols) return r;
      if ((cols - 1) % r.length === 0) {                    // eine Namensspalte davor frei lassen
        const span = (cols - 1) / r.length;
        return [{ t: '' }].concat(r.map(c => ({ t: c.t, span })));
      }
      if (cols % r.length === 0) {
        const span = cols / r.length;
        return r.map(c => ({ t: c.t, span }));
      }
      return r.concat(Array.from({ length: cols - n }, () => ({ t: '' })));
    });

    return { head: rows[0], body: rows.slice(1), foot };
  }

  /** Grobes Gewicht einer Tabelle für die erste Spaltenschätzung. */
  const tableWeight = (t) => (t.body.length + 1) * 70 + t.foot.length * 40;

  /** Eine geparste Berichtstabelle als <table>. */
  function reportTable(tbl) {
    const wrap = U.el('div', 'report-tbl fc-scroll');
    const t = U.el('table', 'rt');
    const mkRow = (cells, tag) => {
      const tr = U.el('tr');
      for (const c of cells) {
        const td = U.el(tag, /^[\d.,+-]/.test(c.t) ? 'num' : '', c.t);
        if (c.span > 1) td.colSpan = c.span;
        tr.appendChild(td);
      }
      return tr;
    };
    const thead = U.el('thead'); thead.appendChild(mkRow(tbl.head, 'th')); t.appendChild(thead);
    const tb = U.el('tbody');
    for (const r of tbl.body) tb.appendChild(mkRow(r, 'td'));
    t.appendChild(tb);
    wrap.appendChild(t);
    for (const f of tbl.foot) wrap.appendChild(U.el('div', 'rt-foot', f.trim()));
    return wrap;
  }

  /** "54 - 58, 63, 64" → ['54','55',…]. Leere Liste, wenn nichts zu holen ist. */
  function expandAreaList(spec) {
    const ids = [];
    for (const part of String(spec || '').split(',')) {
      const r = part.trim().match(/^(\d{2})\s*(?:bis|-|–)\s*(\d{2})$/i);
      if (r) { for (let i = +r[1]; i <= +r[2]; i++) ids.push(String(i).padStart(2, '0')); continue; }
      const one = part.trim().match(/^(\d{2})$/);
      if (one) ids.push(one[1]);
    }
    return [...new Set(ids)];
  }

  /**
   * Gilt dieser Abschnitt für das gewählte Gebiet?
   *
   * Der Höhenwind steht je Bereich in zwei oder drei Tabellen, jede mit einer
   * Überschrift wie „GAFOR-Gebiete 54 - 58, 63, 64". Zwei davon gehen den
   * Nutzer nichts an. Lässt sich die Liste nicht lesen oder ist kein Gebiet
   * bestimmt, bleibt der Abschnitt stehen — lieber zu viel als das Falsche weg.
   */
  function blockForArea(b) {
    const a = state.area;
    if (!a) return true;
    const m = /GAFOR[- ]Gebiete?\s+(.+)$/i.exec(String(b.title || ''));
    if (!m) return true;
    const ids = expandAreaList(m[1]);
    return !ids.length || ids.includes(String(a.id));
  }

  /**
   * Abschnitte auf das gewählte Gebiet eindampfen. Fallen dabei alle
   * Untertabellen einer Überschrift weg („Höhenwind und -temperatur" ohne die
   * Gebietstabellen darunter), bliebe eine leere Überschrift stehen — dort
   * kommt stattdessen ein Satz hin, der sagt, warum nichts da ist.
   */
  function forThisArea(blocks) {
    const keep = blocks.filter(blockForArea);
    const a = state.area;
    return keep.map((b, i) => {
      if (b.parts.length || !b.title) return b;
      const next = keep[i + 1];
      const dropped = blocks.some(x => x !== b && /GAFOR[- ]Gebiete?/i.test(x.title || '') &&
                                       !keep.includes(x));
      if (!dropped) return b;
      if (next && /GAFOR[- ]Gebiete?/i.test(next.title || '')) return b;
      return { title: b.title, parts: [{ tabular: false,
        text: `Für Gebiet ${a ? a.id : '—'} steht in diesem Bulletin keine eigene Tabelle; ` +
              'die übrigen des Bereichs gelten für andere Gebiete.' }] };
    });
  }

  /**
   * Zwei Spalten mit einer festen Regel: geht der Text nicht gleichmässig auf,
   * bekommt die **linke** Spalte den längeren Teil.
   *
   * Der Schnitt wird nicht geschätzt, sondern gemessen. Eine Schätzung über
   * die Zeichenzahl lag regelmässig daneben — Überschriften haben Abstände,
   * Fliesstext bricht unterschiedlich um, und eine Tabelle wiegt pro Zeichen
   * ein Vielfaches. Gesucht wird deshalb der **kleinste** Schnitt, bei dem die
   * linke Spalte in Pixeln mindestens so hoch ist wie die rechte: links wächst
   * mit jedem Abschnitt, rechts schrumpft, der erste Treffer ist also zugleich
   * der ausgewogenste.
   */
  function renderReport(parent, text) {
    const blocks = forThisArea(reportBlocks(text));
    if (blocks.length < 2) {
      parent.appendChild(Object.assign(U.el('pre', 'report'), { textContent: text }));
      return;
    }

    // je Abschnitt seine Knoten, einmal gebaut und beim Umsortieren umgehängt
    const groups = blocks.map(b => {
      const g = [];
      if (b.title) g.push(U.el('h4', 'report-h', b.title));
      for (const part of b.parts) {
        if (part.table) g.push(reportTable(part.table));
        else if (part.tabular) g.push(Object.assign(U.el('pre', 'report'), { textContent: part.text }));
        else g.push(U.el('p', 'report-p', part.text));
      }
      return g;
    });

    const wrap = U.el('div', 'report-cols');
    const colL = U.el('div', 'report-col');
    const colR = U.el('div', 'report-col');
    wrap.appendChild(colL); wrap.appendChild(colR);

    const split = (k) => {
      colL.replaceChildren(...groups.slice(0, k).flat());
      colR.replaceChildren(...groups.slice(k).flat());
    };

    /* Startaufteilung nach Zeichenzahl — nur, damit nichts flackert, bevor
       gemessen werden kann. Die Feineinstellung macht balanceReport(). */
    const len = blocks.map(b => b.title.length + 2 +
      b.parts.reduce((a, p) => a + (p.table ? tableWeight(p.table) : p.text.length), 0));
    const total = len.reduce((a, v) => a + v, 0);
    let run = 0, k0 = blocks.length - 1;
    for (let i = 0; i < blocks.length - 1; i++) {
      run += len[i];
      if (run >= total - run) { k0 = i + 1; break; }
    }
    split(k0);
    parent.appendChild(wrap);

    wrap._balance = () => balanceReport(wrap, colL, colR, groups.length, split);
    requestAnimationFrame(wrap._balance);
  }

  /** Schnitt so lange verschieben, bis die linke Spalte die höhere ist. */
  function balanceReport(wrap, colL, colR, n, split) {
    if (!wrap.isConnected || n < 2) return;
    // einspaltig (Handy, Druck) gibt es nichts auszugleichen
    if (getComputedStyle(wrap).gridTemplateColumns.split(/\s+/).length < 2) return;
    let chosen = n - 1;
    for (let k = 1; k < n; k++) {
      split(k);
      if (colL.offsetHeight >= colR.offsetHeight) { chosen = k; break; }
    }
    split(chosen);
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
        state.lastLoad.metar = Date.now();
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
      jobs.push(OM.forecast(lat, lon, OM.FETCH_DAYS, state.profileTop, state.model).then(j => {
        if (lat !== state.lat || lon !== state.lon) return;
        state.om = j;
        state.lastLoad.model = Date.now();
        renderTimeBar();
        renderModel();
        renderWind();
        renderFly();
        state.ai = null;              // andere Daten, andere Lage
        renderAi();
      }).catch(e => {
        state.om = null;
        const msg = 'Open-Meteo nicht erreichbar: ' + e.message;
        U.clear(U.$('modelBody')).appendChild(wrapNote(msg));
        U.clear(U.$('windBody')).appendChild(wrapNote(msg));
        U.clear(U.$('flyBody')).appendChild(wrapNote(msg));
        state.ai = null; renderAi();
        U.$('timeBar').hidden = true;
        U.$('modelAge').textContent = ''; U.$('windAge').textContent = '';
      }));

      /* Zweites Modell zum Vergleich — nur wenn eines gewählt ist. Es füllt
         allein die gestrichelten Kurven im Stüve; scheitert es, fehlt eben der
         Vergleich, die Karte steht trotzdem. */
      if (state.model2 && state.model2 !== state.model) {
        jobs.push(OM.forecast(lat, lon, OM.FETCH_DAYS, state.profileTop, state.model2)
          .then(j2 => {
            if (lat !== state.lat || lon !== state.lon) return;
            state.om2 = j2;
            paintProfile();
          }).catch(() => { state.om2 = null; }));
      } else {
        state.om2 = null;
      }
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

  // ------------------------------------------------------------ Startfenster
  /**
   * Eine Ampel je Stunde: fahrbar, grenzwertig, nein — und der Grund dazu.
   *
   * Das ist die Frage, mit der man die App öffnet, und sie steht deshalb ganz
   * oben. Gerechnet wird ausschliesslich aus dem Punktmodell (Open-Meteo) und
   * der bürgerlichen Dämmerung für genau diesen Ort; es ist **keine** Aussage
   * des DWD und ersetzt die Beratung nicht. Die Schwellen stehen in
   * `OM.flyRating`.
   */
  const FLY_CLS = { 2: 'ok', 1: 'limit', 0: 'no' };

  /** Bewertung der Stunde `i`, mit Tageslicht für genau diesen Ort. */
  function flyAt(j, i) {
    const rec = OM.at(j, i);
    const off = (j.utc_offset_seconds || 0) * 1000;
    const ms = Date.parse(j.hourly.time[i] + ':00Z') - off;
    return OM.flyRating(rec, SUN.isDaylight(state.lat, state.lon, ms), state.fly);
  }

  function renderFly() {
    const body = U.clear(U.$('flyBody'));
    const j = state.om;
    if (!j || !j.hourly) return;
    const sel = tIndex(j);
    const i0 = OM.nowIndex(j);
    const reach = reachHours();
    const last = Math.min(i0 + reach, j.hourly.time.length - 1);

    U.$('flyAge').textContent = `${OM.modelName(j._model)} · eigene Bewertung, keine DWD-Aussage`;
    U.$('flyAge').className = 'age';

    // --- der gewählte Zeitpunkt gross ---
    const r = flyAt(j, sel);
    const head = U.el('div', `fly-head ${FLY_CLS[r.level]}`);
    const badge = U.el('div', 'fly-badge', r.txt);
    head.appendChild(badge);
    const txt = U.el('div', 'fly-txt');
    txt.appendChild(U.el('div', 'fly-when',
      `${stampOf(j.hourly.time[sel], j.timezone_abbreviation)}` +
      (sel === i0 ? ' · jetzt' : '')));
    txt.appendChild(U.el('div', 'fly-why',
      r.why.length ? r.why.join(' · ') : 'Wind, Böen, Niederschlag, Gewitter, Sicht und Dämmerung sprechen nicht dagegen'));
    head.appendChild(txt);
    body.appendChild(head);

    // --- Streifen über den ganzen Vorhersagezeitraum ---
    /* Eigene Tagesbeschriftung: der Streifen beginnt bei „jetzt" und endet am
       Modellhorizont, hat also eine andere Skala als der Zeitschieber oben. */
    const days = U.el('div', 'fly-days');
    for (let i = i0; i <= last; i++) {
      const hh = j.hourly.time[i].slice(11, 13);
      if (i > i0 && hh !== '00') continue;
      const lab = U.el('span', 'fly-day');
      const d = new Date(j.hourly.time[i].slice(0, 10) + 'T12:00:00Z');
      lab.textContent = `${d.toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '')} ${d.getUTCDate()}.`;
      lab.style.left = `${((i - i0) / Math.max(1, last - i0)) * 100}%`;
      days.appendChild(lab);
    }
    body.appendChild(days);

    const strip = U.el('div', 'fly-strip');
    for (let i = i0; i <= last; i++) {
      const f = flyAt(j, i);
      const cell = U.el('button', `fly-cell ${FLY_CLS[f.level]}${i === sel ? ' sel' : ''}`);
      cell.style.flex = '1 1 0';
      const hh = j.hourly.time[i].slice(11, 13);
      if (hh === '00') cell.classList.add('day');
      cell.title = `${stampOf(j.hourly.time[i], j.timezone_abbreviation)} — ${f.txt}` +
                   (f.why.length ? `: ${f.why.join(', ')}` : '');
      cell.onclick = () => { state.hour = i - i0; U.$('timeSlider').value = String(state.hour); repaintForHour(); };
      strip.appendChild(cell);
    }
    body.appendChild(strip);

    /* --- die fahrbaren Fenster, zeitlich unter dem Streifen ---
       Sie standen bis 1.14.0 als drei Kästchen untereinander; damit musste man
       aus einer Uhrzeit erst zurückrechnen, wo im Streifen das Fenster liegt.
       Als Balken direkt darunter liegen sie da, wo sie hingehören. */
    const wins = flyWindows(j, i0, last);
    const lane = U.el('div', 'fly-lane');
    const span = Math.max(1, last - i0);
    for (const w of wins) {
      const bar = U.el('button', 'fly-bar');
      bar.style.left = `${((w.from - i0) / span) * 100}%`;
      bar.style.width = `${Math.max(0.8, ((w.to - w.from + 1) / span) * 100)}%`;
      const h = w.to - w.from + 1;
      /* Der Balken ist so breit wie das Fenster lang — bei einer Stunde also
         ein Strich. Was nicht hineinpasst, wird weggelassen statt abgeschnitten;
         vollständig steht alles im Tooltip. */
      const pct = ((w.to - w.from + 1) / span) * 100;
      if (pct >= 9) {
        bar.innerHTML = `<span class="h">${j.hourly.time[w.from].slice(11, 16)}–` +
          `${j.hourly.time[w.to].slice(11, 16)}</span><span class="n">${h} h</span>`;
      } else if (pct >= 3.5) {
        bar.appendChild(U.el('span', 'n', `${h} h`));
      }
      bar.title = `${stampOf(j.hourly.time[w.from], j.timezone_abbreviation)} bis ` +
        `${j.hourly.time[w.to].slice(11, 16)} — ${h} Stunde${h === 1 ? '' : 'n'} fahrbar`;
      bar.onclick = () => { state.hour = w.from - i0; U.$('timeSlider').value = String(state.hour); repaintForHour(); };
      lane.appendChild(bar);
    }
    if (!wins.length) {
      lane.appendChild(U.el('div', 'fly-none',
        `Bis +${reach} h keine durchgehend fahrbare Stunde.`));
    }
    body.appendChild(lane);

    body.appendChild(explainNote(
      'Eigene Einschätzung aus dem Punktmodell, <strong>keine DWD-Aussage</strong>. ' +
      '<em>fahrbar</em> heisst: Bodenwind bis 4 m/s, Böen bis 6 m/s, kein Niederschlag, ' +
      'CAPE unter 300 J/kg, Sicht über 1,5 km, Wolkenbasis über 1000 ft AGL und innerhalb ' +
      'der bürgerlichen Dämmerung. <em>grenzwertig</em> bis 6 bzw. 8 m/s. Massgebend ist ' +
      'immer die amtliche Beratung und die Einschätzung vor Ort.'));
    body.appendChild(sourceLine('Open-Meteo', 'https://open-meteo.com'));
  }

  /** Zusammenhängende Läufe mit Bewertung „fahrbar", mindestens eine Stunde. */
  function flyWindows(j, from, to) {
    const out = [];
    let start = -1;
    for (let i = from; i <= to; i++) {
      const good = flyAt(j, i).level === OM.FLY.GOOD;
      if (good && start < 0) start = i;
      if (!good && start >= 0) { out.push({ from: start, to: i - 1 }); start = -1; }
    }
    if (start >= 0) out.push({ from: start, to });
    return out;
  }

  // ------------------------------------------------------------ Kurzanalyse
  /**
   * Die Analyse durch Claude. Sie wird **nicht** von selbst angefordert: jeder
   * Abruf kostet, und die Lage ändert sich nicht im Minutentakt. Der Knopf
   * fordert an, das Ergebnis liegt bis zum nächsten Ortswechsel im Speicher.
   */
  function renderAi() {
    const body = U.clear(U.$('aiBody'));
    const age = U.$('aiAge');
    age.className = 'age';
    /* Ohne Analyse hat die Karte im Ausdruck nichts verloren — sie stünde
       sonst als leerer Kasten auf dem Blatt und kostet eine dritte Seite. */
    U.$('cardAi').classList.toggle('empty',
      !(state.ai && state.ai.sections && state.ai.sections.length));

    if (!AI.available()) {
      age.textContent = 'kein Schlüssel hinterlegt';
      body.appendChild(wrapNote(
        'Hier stünde eine <strong>Kurzanalyse durch Claude</strong>: Grosswetterlage, ' +
        'ballonspezifische Gefahren — Bodenwind, Böen, Scherung, Schauer und Gewitter im ' +
        'Umkreis von 100 km — und eine Gegenprobe zu den Startfenstern, die diese App aus ' +
        'den Modellwerten rechnet.<br><br>' +
        'Dafür braucht es einen <strong>eigenen Anthropic-Schlüssel</strong>. Die App ist ' +
        'eine statische Seite ohne Server; ein Schlüssel im Quelltext wäre öffentlich. ' +
        'Menü → Einstellungen → <em>Kurzanalyse durch Claude</em>.'));
      return;
    }
    if (!state.om) { age.textContent = ''; body.appendChild(wrapNote('Noch keine Modelldaten.')); return; }

    const bar = U.el('div', 'ai-bar');
    const btn = U.el('button', 'btn small' + (state.aiBusy ? '' : ' primary'),
      state.aiBusy ? 'Claude denkt …' : (state.ai ? 'neu anfordern' : 'Analyse anfordern'));
    btn.disabled = state.aiBusy;
    btn.onclick = askAi;
    bar.appendChild(btn);
    const hint = U.el('span', 'ai-hint');
    hint.textContent = state.aiBusy
      ? 'Der Lagebericht ist unterwegs; das dauert ein paar Sekunden.'
      : `${AI.modelName(state.aiModel)} · höchstens ${AI.MAX_LINES} Zeilen · ` +
        (state.aiDwd ? 'mit DWD-Text' : 'ohne DWD-Text');
    bar.appendChild(hint);
    body.appendChild(bar);

    if (state.ai && state.ai.error) {
      body.appendChild(wrapNote(`Die Analyse ist nicht zustande gekommen: ` +
        `<strong>${state.ai.error}</strong>`));
    } else if (state.ai && state.ai.sections) {
      age.textContent = `${AI.modelName(state.ai.model)} · ${stampOf(
        new Date(state.ai.at).toISOString().slice(0, 16), '')} · ${U.ago(state.ai.at)}`;
      age.className = U.ageClass(state.ai.at, 90, 240);
      const box = U.el('div', 'ai-text');
      for (const sec of state.ai.sections) {
        box.appendChild(U.el('h4', 'ai-h', sec.title));
        const ul = U.el('ul', 'ai-lines');
        for (const l of sec.lines) ul.appendChild(U.el('li', '', l));
        box.appendChild(ul);
      }
      body.appendChild(box);
      body.appendChild(explainNote(
        'Erzeugt von <strong>Claude</strong> aus den Daten, die diese Seite ohnehin zeigt — ' +
        '<strong>keine DWD-Aussage und keine Beratung</strong>. Ein Sprachmodell kann sich ' +
        'irren, auch überzeugend. Massgebend bleiben das amtliche Bulletin und die ' +
        'Einschätzung vor Ort.'));
    } else if (!state.aiBusy) {
      body.appendChild(wrapNote(
        'Noch nicht angefordert. Der Knopf schickt einen Lagebericht aus den Werten dieser ' +
        'Seite an Claude und holt drei Abschnitte zurück: Grosswetterlage, ballonspezifische ' +
        'Gefahren und eine Gegenprobe zu den Startfenstern.'));
    }
  }

  async function askAi() {
    if (state.aiBusy) return;
    state.aiBusy = true; state.ai = null;
    renderAi();
    try {
      const out = await AI.analyse(aiBrief(), { model: state.aiModel });
      state.ai = out;
    } catch (e) {
      state.ai = { error: e.message || String(e) };
    }
    state.aiBusy = false;
    renderAi();
  }

  /** Alles, was die Seite ohnehin weiss, als kurzer Lagebericht. */
  function aiBrief() {
    const j = state.om;
    const i0 = OM.nowIndex(j);
    const reach = reachHours();
    const last = Math.min(i0 + reach, j.hourly.time.length - 1);
    const off = (j.utc_offset_seconds || 0) * 1000;

    // Stundenraster in Dreierschritten — feiner brächte nur Token
    const rows = [];
    for (let i = i0; i <= last; i += 3) {
      const r = OM.at(j, i);
      rows.push({ t: j.hourly.time[i].slice(5, 16).replace('T', ' '),
                  w10: r.w10, gust: r.gust, d10: r.d10, cape: r.cape,
                  precip: r.precip, vis: r.vis, cloudLow: r.cloudLow,
                  cloudMid: r.cloudMid, cloudHigh: r.cloudHigh,
                  fly: flyAt(j, i).txt });
    }

    /* Für die Scherung reichen drei Zeitpunkte und die untersten Flächen —
       darüber interessiert es den Ballon nicht mehr. */
    const ground = state.elev != null ? state.elev : (j.elevation || 0);
    const profiles = [];
    for (const off2 of [0, Math.round(reach / 3), Math.round((2 * reach) / 3)]) {
      const i = Math.min(i0 + off2, last);
      const lv = OM.profile(j, i, ground).filter(l => l.ft <= 7000).slice(-6);
      if (lv.length) profiles.push({ t: j.hourly.time[i].slice(5, 16).replace('T', ' '), levels: lv });
    }

    const b = state.area ? DWD.gaforFor(state.area) : null;
    const gafor = b && b.codes ? b.periods.map((p, k) => {
      const ci = GAFOR.codeInfo(b.codes[k] || '');
      const rem = (b.detail && b.detail.remarks && b.detail.remarks[k]) || '';
      return `${p} UTC: ${b.codes[k]} (${ci.word || '—'}, ${ci.vis || '—'}, ${ci.base || '—'})` +
             (rem ? ` — ${rem}` : '');
    }).join('\n') : '';

    const ov = state.area ? DWD.overviewFor(state.area) : null;
    const overview = (state.aiDwd && ov && ov.text) ? ov.text.slice(0, 4000) : '';

    const t = SUN.times(state.lat, state.lon, Date.now());
    const hh = (ms) => (ms == null ? '—' :
      new Date(ms + off).toISOString().slice(11, 16));
    const twilight = `Anfang ${hh(t.dawn)}, Sonnenaufgang ${hh(t.sunrise)}, ` +
      `Sonnenuntergang ${hh(t.sunset)}, Ende ${hh(t.dusk)} (${j.timezone_abbreviation || ''})`;

    const metars = (state.metars || []).slice(0, 8).map(m => ({
      d: m.distKm.toFixed(0), b: U.pad(Math.round(U.bearing(state.lat, state.lon, m.lat, m.lon))),
      raw: m.rawOb || '',
    })).filter(m => m.raw);
    const tafs = Object.values(state.tafs || {}).map(t2 => t2.rawTAF).filter(Boolean).slice(0, 5);

    const wins = flyWindows(j, i0, last).map(x =>
      `${j.hourly.time[x.from].slice(5, 16).replace('T', ' ')} bis ` +
      `${j.hourly.time[x.to].slice(11, 16)} (${x.to - x.from + 1} h)`);

    const L = OM.flyLimits(state.fly);
    const u = U.unitLabel[state.unit];
    const cw = (v) => Math.round(v * U.MS_TO[state.unit]);
    const limits = `Bodenwind ${cw(L.wind[0])}/${cw(L.wind[1])} ${u}, ` +
      `Böen ${cw(L.gust[0])}/${cw(L.gust[1])} ${u}, ` +
      `Böigkeit ${cw(L.gustSpread[0])}/${cw(L.gustSpread[1])} ${u}, ` +
      `CAPE ${L.cape[0]}/${L.cape[1]} J/kg, Niederschlag ab ${L.precip} mm/h, ` +
      `Sicht unter ${L.visKm} km, Wolkenbasis unter ${L.baseFt} ft AGL` +
      (L.needLight ? ', ausserhalb der bürgerlichen Dämmerung nein' : '');

    return AI.brief({
      place: state.place, lat: state.lat, lon: state.lon, elev: state.elev,
      area: state.area, unit: state.unit,
      now: stampOf(j.hourly.time[i0], ''), tz: j.timezone_abbreviation || '',
      twilight, model: OM.modelName(j._model), reach,
      gafor, overview, rows, profiles, metars, tafs, windows: wins, limits,
    });
  }

  function renderModel() {
    const body = U.clear(U.$('modelBody'));
    const j = state.om;
    if (!j) return;
    /* Die Karte zeigt die Stunde, die der gemeinsame Schieber gewählt hat —
       „jetzt" ist nur ihr Sonderfall (Schieber auf 0). */
    const i0 = tIndex(j);
    const now = OM.at(j, i0);
    /* Die Kopfzeile nennt den **absoluten** Zeitpunkt, für den die Zahlen
       gelten — „+6 h" allein taugt nicht, wenn man die Seite später wieder
       ansieht oder ausdruckt. */
    U.$('modelAge').textContent =
      `${OM.modelName(j._model)} · ${stampOf(j.hourly.time[i0], j.timezone_abbreviation)} · Open-Meteo`;
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
    /* Zwölf Stunden um die gewählte herum, drei davon rückwärts — so sieht man
       auch, woher die Lage kommt, ohne den Schieber zu bewegen. */
    const hours = [];
    const from = Math.max(0, Math.min(i0 - 3, j.hourly.time.length - 13));
    for (let i = from; i < Math.min(from + 13, j.hourly.time.length); i++) hours.push(i);
    // Bewölkung als Fläche: je dichter, desto kräftiger die Füllung
    const cloudCell = (v) => {
      if (v == null) return { h: '·' };
      const a = Math.round(v);
      return { h: a ? String(a) : '·', bg: a / 100 };
    };
    const FOG_CLS = ['', 'fog-1', 'fog-2', 'fog-3'];

    const rows = [
      ['Zeit', i => ({ h: j.hourly.time[i].slice(11, 16) })],
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
  /** Umrechnungsfaktor m/s → gewählte Windeinheit (Tabelle liegt in util.js). */
  const MS = (x) => x * U.MS_TO[state.unit];

  // ------------------------------------------------------------------ upper wind
  function renderWind() {
    const body = U.clear(U.$('windBody'));
    const j = state.om;
    if (!j) return;

    body.appendChild(modelChips());
    body.appendChild(compareChips());

    const holder = U.el('div', 'wp-holder');
    holder.id = 'windProfile';
    body.appendChild(holder);

    /* Die Erklärung zum Stüve stand hier bis 1.11.0. Sie ist in den README
       gewandert: wer das Diagramm einmal verstanden hat, liest sie nie wieder,
       und sie kostete jedes Mal ein Drittel der Kartenhöhe. */
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
    const idx = tIndex(j);
    const metres = state.altUnit === 'm';
    const ground = state.elev != null ? state.elev : (j.elevation || 0);
    const levels = OM.profile(j, idx, ground)
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
    const toAlt = (m) => (m == null ? null : (metres ? Math.round(m) : Math.round(m * OM.M_TO_FT)));
    const fzlA = toAlt(rec.fzl), pblA = rec.pbl == null ? null : toAlt(ground + rec.pbl);

    /* Tabelle links, Diagramm rechts — nebeneinander, sobald Platz da ist.
       Auf dem Handy stapelt der Umbruch sie automatisch. */
    const split = U.el('div', 'wp-split');

    const wrapT = U.el('div', 'wp-col-table fc-scroll');
    const t = U.el('table', 'wp-table');
    const th = U.el('tr');
    for (const h of [metres ? 'm AMSL' : 'ft AMSL', 'Fläche', 'Wind',
                     U.unitLabel[state.unit], '°C', 'TP', 'rF']) th.appendChild(U.el('th', '', h));
    const thead = U.el('thead'); thead.appendChild(th); t.appendChild(thead);
    const tb = U.el('tbody');

    const unitTxt = metres ? ' m' : ' ft';
    const entries = levels.map(l => ({ alt: l.ft, lvl: l }));
    if (fzlA != null) entries.push({ alt: fzlA, mark: '0°-Grenze ' + fzlA.toLocaleString('de-CH') + unitTxt, cls: 'fzl' });
    if (pblA != null) entries.push({ alt: pblA, mark: 'Grenzschicht bis ' + pblA.toLocaleString('de-CH') + unitTxt, cls: 'pbl' });
    entries.sort((a, b) => b.alt - a.alt || (a.mark ? -1 : 1));

    for (const e of entries) {
      if (e.mark) { tb.appendChild(markRow(e.mark, e.cls)); continue; }
      const l = e.lvl;
      const tr = U.el('tr');
      tr.appendChild(U.el('td', 'alt', l.ft.toLocaleString('de-CH')));
      tr.appendChild(U.el('td', 'lvl', l.hPa ? `${l.hPa} hPa` : l.label));
      const d = U.el('td', 'dir');
      d.innerHTML = `<span class="ar">${U.dirArrow(l.dir)}</span>${U.dirName(l.dir)}`;
      tr.appendChild(d);
      tr.appendChild(U.el('td', 'spd', U.wind(l.spd, state.unit)));
      tr.appendChild(U.el('td', 'tmp', l.temp == null ? '·' : String(Math.round(l.temp))));
      tr.appendChild(U.el('td', 'tmp', l.dew == null ? '·' : String(Math.round(l.dew))));
      const rh = U.el('td', 'rh', l.rh == null ? '·' : `${Math.round(l.rh)} %`);
      if (l.rh != null && l.rh > state.rhStart) {
        rh.style.background = `color-mix(in srgb, var(--sv-humid) ${Math.round(STUEVE.rhAlpha(l.rh, state.rhStart) * 130)}%, transparent)`;
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
      rhStart: state.rhStart,
      cmp: comparisonLevels(idx, metres),
      cmpName: state.model2 ? OM.modelName(state.model2) : '',
    });
  }

  /**
   * Höhenprofil des Vergleichsmodells zur selben Stunde. Gesucht wird über die
   * Uhrzeit, nicht über den Index: das zweite Modell kann eine andere
   * Startstunde haben.
   */
  function comparisonLevels(idx, metres) {
    const j = state.om, j2 = state.om2;
    if (!j || !j2 || !j2.hourly || !state.model2) return null;
    const want = j.hourly.time[idx];
    const i2 = j2.hourly.time.indexOf(want);
    if (i2 < 0) return null;
    const ground = state.elev != null ? state.elev : (j2.elevation || 0);
    return OM.profile(j2, i2, ground)
      .map(l => Object.assign({}, l, { ft: metres ? Math.round(l.m) : l.ft }));
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

  /** "Mi 26. Aug · 14:00 CEST" aus einem Open-Meteo-Zeitstempel. */
  function stampOf(iso, tzAbbr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const wd = d.toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '');
    const mo = d.toLocaleDateString('de-CH', { month: 'short' }).replace('.', '');
    return `${wd} ${+m[3]}. ${mo} · ${m[4]}:${m[5]}${tzAbbr ? ' ' + tzAbbr : ''}`;
  }

  /* ------------------------------------------------------- Zeitschieber
   * Ein Schieber für die ganze Seite: Startfenster, GAFOR-Band, Höhenwind und
   * Modellprognose zeigen alle die Stunde, die hier gewählt ist.
   *
   * Die Skala ist **fest** — sie reicht immer über die volle Spannweite der App
   * (OM.SPAN_H, sieben Tage), unabhängig vom gewählten Modell. Nur so bleiben
   * Tageseinteilung und Nachtschattierung an derselben Stelle, wenn man das
   * Modell wechselt. Was das gewählte Modell nicht mehr abdeckt, wird
   * abgegraut, und der Griff lässt sich nicht dorthin ziehen.
   */
  const HOUR_MS = 3600000;

  /** Reichweite in Stunden: Modellhorizont, begrenzt durch die Daten. */
  function reachHours() {
    const j = state.om;
    if (!j || !j.hourly) return 0;
    const i0 = OM.nowIndex(j);
    const data = Math.max(0, j.hourly.time.length - 1 - i0);
    return Math.min(data, OM.modelHours(j._model), OM.SPAN_H);
  }

  /** Ortszeit der Stunde +off als UTC-Millisekunden des Zeitstempels. */
  function hourAt(off) {
    const j = state.om;
    if (!j || !j.hourly) return null;
    const i = Math.min(OM.nowIndex(j) + off, j.hourly.time.length - 1);
    return j.hourly.time[i];
  }

  /** Index in der Reihe von state.om für die gewählte Stunde. */
  function tIndex(j) {
    const src = j || state.om;
    if (!src || !src.hourly) return 0;
    return Math.min(OM.nowIndex(src) + state.hour, src.hourly.time.length - 1);
  }

  function renderTimeBar() {
    const bar = U.$('timeBar');
    const j = state.om;
    if (!j || !j.hourly || j.hourly.time.length < 2) { bar.hidden = true; return; }
    bar.hidden = false;

    const span = OM.SPAN_H;
    const reach = reachHours();
    state.hour = U.clamp(state.hour, 0, Math.max(0, reach));

    const input = U.$('timeSlider');
    input.max = String(span);
    input.value = String(state.hour);

    paintNight(j, span);
    paintTicks(j, span);
    U.$('timeBeyond').style.left = `${(reach / span) * 100}%`;
    U.$('timeBeyond').title = `${OM.modelName(j._model)} rechnet nur bis +${reach} h`;
    paintDays(j, span);
    markTime();
  }

  /** Nachtschattierung als ein Farbverlauf mit harten Kanten. */
  function paintNight(j, span) {
    const el = U.$('timeNight');
    const off = (j.utc_offset_seconds || 0) * 1000;
    const t0 = Date.parse(j.hourly.time[OM.nowIndex(j)] + ':00Z') - off;
    const stops = [];
    let prev = null;
    for (let h = 0; h <= span; h++) {
      const light = SUN.isDaylight(state.lat, state.lon, t0 + h * HOUR_MS);
      if (light !== prev) {
        const pct = (h / span) * 100;
        if (prev !== null) stops.push(`${col(prev)} ${pct}%`);
        stops.push(`${col(light)} ${pct}%`);
        prev = light;
      }
    }
    stops.push(`${col(prev)} 100%`);
    el.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    function col(light) { return light ? 'var(--ts-day)' : 'var(--ts-night)'; }
  }

  /** Feine Striche alle zwei Stunden, kräftige alle sechs. */
  function paintTicks(j, span) {
    const el = U.clear(U.$('timeTicks'));
    for (let h = 0; h <= span; h += 2) {
      const t = U.el('span', 'ts-tick' + (h % 6 === 0 ? ' major' : ''));
      t.style.left = `${(h / span) * 100}%`;
      el.appendChild(t);
    }
  }

  /** Wochentage über dem Schieber, jeweils über der Mitte ihres Tages. */
  function paintDays(j, span) {
    const el = U.clear(U.$('timeDays'));
    const off = (j.utc_offset_seconds || 0) * 1000;
    const t0 = Date.parse(j.hourly.time[OM.nowIndex(j)] + ':00Z') - off;
    // Tagesgrenzen in Ortszeit finden
    let h = 0;
    while (h <= span) {
      const start = h;
      const day = new Date(t0 + h * HOUR_MS + off).toISOString().slice(0, 10);
      while (h <= span &&
             new Date(t0 + h * HOUR_MS + off).toISOString().slice(0, 10) === day) h++;
      const mid = (start + Math.min(h, span)) / 2;
      const lab = U.el('span', 'ts-day');
      const d = new Date(day + 'T12:00:00Z');
      lab.textContent = `${d.toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '')} ${d.getUTCDate()}.`;
      lab.style.left = `${(mid / span) * 100}%`;
      if (start > 0) {
        const sep = U.el('span', 'ts-daysep');
        sep.style.left = `${(start / span) * 100}%`;
        el.appendChild(sep);
      }
      el.appendChild(lab);
    }
  }

  /** Marke und Fusszeile auf die gewählte Stunde setzen. */
  function markTime() {
    const j = state.om;
    if (!j) return;
    const span = OM.SPAN_H;
    const input = U.$('timeSlider');
    const mark = U.$('timeMark');
    const w = input.clientWidth;
    const THUMB = 13;
    const frac = state.hour / Math.max(1, span);
    const x = THUMB / 2 + frac * (w - THUMB);
    mark.textContent = `${stampOf(hourAt(state.hour), j.timezone_abbreviation)} · ` +
      (state.hour === 0 ? 'jetzt' : `+${state.hour} h`);
    const half = (mark.offsetWidth || 140) / 2;
    mark.style.left = `${U.clamp(x, half, Math.max(half, w - half))}px`;

    const reach = reachHours();
    U.$('timeNote').textContent =
      `${OM.modelName(j._model)} bis +${reach} h · Skala ${span} h · Nacht grau hinterlegt`;
  }

  /** Alle Karten auf die gewählte Stunde nachziehen. */
  function repaintForHour() {
    markTime();
    paintProfile();
    renderModel();
    renderFly();
    renderAreaHead();          // die Stufenkachel folgt derselben Stunde
    renderGafor();
  }

  function wireTimeBar() {
    const input = U.$('timeSlider');
    let t = 0;
    input.oninput = () => {
      const reach = reachHours();
      let v = +input.value;
      if (v > reach) { v = reach; input.value = String(v); }   // nicht ins Abgegraute
      state.hour = v;
      markTime();
      clearTimeout(t);
      t = setTimeout(repaintForHour, 90);
    };
    U.$('timeNow').onclick = () => {
      state.hour = 0;
      U.$('timeSlider').value = '0';
      repaintForHour();
    };
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
        state.hour = Math.min(state.hour, OM.modelHours(m.key));
        loadPointData(true, ['model']);
      };
      row.appendChild(b);
    }
    return row;
  }

  /**
   * Zweites Modell zum Vergleich. Übereinstimmung zweier unabhängiger Modelle
   * ist das ehrlichste Vertrauensmass, das ohne Ensemble zu haben ist —
   * laufen die gestrichelten Kurven eng an den durchgezogenen, kann man sich
   * auf die Aussage stützen; laufen sie auseinander, eben nicht.
   */
  function compareChips() {
    const row = U.el('div', 'chips models cmp');
    row.appendChild(U.el('span', 'chips-label', 'Vergleich'));
    const opts = [{ key: '', name: 'aus' }].concat(OM.MODELS.filter(m => m.key));
    for (const m of opts) {
      const on = m.key === state.model2;
      const b = U.el('button', 'chip' + (on ? ' on' : ''), m.name);
      b.title = m.key ? `${m.note} · gestrichelt im Diagramm` : 'kein Vergleichsmodell';
      b.onclick = () => {
        if (m.key === state.model2) return;
        state.model2 = m.key; U.save('model2', m.key);
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
    U.$('setRh').value = String(state.rhStart);
    U.$('setAuto').value = state.autoRefresh ? '1' : '0';
    U.$('setAiKey').value = U.load('aiKey', '');
    const sel = U.clear(U.$('setAiModel'));
    for (const m of AI.MODELS) {
      const o = U.el('option', '', `${m.name} — ${m.note}`);
      o.value = m.key;
      sel.appendChild(o);
    }
    sel.value = state.aiModel;
    U.$('setAiDwd').value = state.aiDwd ? '1' : '0';
    showFlyFields();
    U.$('setOverlay').classList.remove('hidden');
  }
  const hideSettings = () => U.$('setOverlay').classList.add('hidden');

  /* Die Startfenster-Schwellen liegen intern in m/s (so liefert das Modell
     sie); im Dialog stehen sie in der gewählten Windeinheit. */
  const FLY_FIELDS = [
    ['flyWind1', 'wind', 0, true], ['flyWind2', 'wind', 1, true],
    ['flyGust1', 'gust', 0, true], ['flyGust2', 'gust', 1, true],
    ['flySpread1', 'gustSpread', 0, true], ['flySpread2', 'gustSpread', 1, true],
    ['flyCape1', 'cape', 0, false], ['flyCape2', 'cape', 1, false],
  ];
  const FLY_SINGLE = [['flyPrecip', 'precip'], ['flyVis', 'visKm'], ['flyBase', 'baseFt']];

  function showFlyFields() {
    const L = OM.flyLimits(state.fly);
    const f = U.MS_TO[state.unit];
    for (const [id, key, idx, isWind] of FLY_FIELDS) {
      U.$(id).value = isWind ? String(Math.round(L[key][idx] * f * 10) / 10) : String(L[key][idx]);
    }
    for (const [id, key] of FLY_SINGLE) U.$(id).value = String(L[key]);
    U.$('flyLight').value = L.needLight ? '1' : '0';
    // Einheit an die Beschriftungen
    const u = U.unitLabel[state.unit];
    for (const [id, label] of [['flyWind1', 'Bodenwind'], ['flyGust1', 'Böen'],
                               ['flySpread1', 'Böigkeit']]) {
      const lab = document.querySelector(`label[for="${id}"]`);
      if (lab) lab.textContent = `${label} ${u}`;
    }
  }

  function readFlyFields() {
    const L = OM.flyLimits(state.fly);
    const f = U.MS_TO[state.unit];
    const out = { wind: [...L.wind], gust: [...L.gust], gustSpread: [...L.gustSpread],
                  cape: [...L.cape] };
    for (const [id, key, idx, isWind] of FLY_FIELDS) {
      const v = parseFloat(U.$(id).value);
      if (!isFinite(v) || v < 0) continue;
      out[key][idx] = isWind ? v / f : v;
    }
    // „nein ab" darf nicht unter „grenzwertig ab" rutschen
    for (const k of ['wind', 'gust', 'gustSpread', 'cape']) {
      if (out[k][1] < out[k][0]) out[k][1] = out[k][0];
    }
    for (const [id, key] of FLY_SINGLE) {
      const v = parseFloat(U.$(id).value);
      if (isFinite(v) && v >= 0) out[key] = v;
    }
    out.needLight = U.$('flyLight').value === '1' ? 1 : 0;
    return out;
  }

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
    state.rhStart = STUEVE.rhStartOf(+U.$('setRh').value); U.save('rhStart', state.rhStart);
    state.fly = readFlyFields(); U.save('fly', state.fly);
    U.save('aiKey', U.$('setAiKey').value.trim());
    state.aiModel = U.$('setAiModel').value; U.save('aiModel', state.aiModel);
    state.aiDwd = U.$('setAiDwd').value === '1' ? 1 : 0; U.save('aiDwd', state.aiDwd);
    state.autoRefresh = U.$('setAuto').value === '1' ? 1 : 0;
    U.save('autoRefresh', state.autoRefresh);
    startAutoRefresh();
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
    if (!modelAgain) { renderModel(); renderWind(); renderFly(); }
    renderAi();
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
    paintFavourites();
    flash('Ort gespeichert');
  }

  /** Die gemerkten Orte als Nadeln auf die Karte legen. */
  function paintFavourites() {
    MAPVIEW.setFavourites(U.load('favs', []),
      (f) => goTo(f.lat, f.lon, f.name, PICK_ZOOM.place));
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
