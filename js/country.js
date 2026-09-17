/* GaforCast — Landespakete.
 *
 * Bis 1.20.0 stand Deutschland im Code: die Startkoordinate, die vier
 * Geometriedateien, der Satz „covers only Germany", die Quellenzeile, der
 * DWD-Vorbehalt. Ab 1.21.0 steht davon nichts mehr in einer .js-Datei. Ein
 * Land ist eine Beschreibungsdatei (data/countries/<cc>/meta.json) und — wenn
 * es amtliche Berichte hat — ein Bezugsmodul, das sie in das Zwischenformat
 * unten übersetzt.
 *
 * ---------------------------------------------------------------------------
 * ZWISCHENFORMAT
 *
 * Jedes Bezugsmodul liefert Berichte in derselben Form. Die Karten sehen nie
 * einen DWD-, Austro-Control- oder meteoam-Text, sondern immer nur dies:
 *
 *   Bericht = {
 *     kind      'area' | 'balloon' | 'overview'
 *     id        Schlüssel innerhalb des Landes ('EDZF', '45', 'FXOS43')
 *     title     Überschrift, wie sie in der Kartenkopfzeile stehen soll
 *     lang      Sprache des Rohtexts — 'de' | 'en' | 'it' | 'pl' | …
 *     issued    ISO-Zeitpunkt der Ausgabe
 *     validFrom, validTo   ISO, soweit der Bericht es hergibt
 *     areas     ['45','46'] — welche Gebiete dieser Bericht abdeckt
 *     periods   ['06-09','09-12'] — nur bei kind 'area'
 *     codes     ['C','O','D1'] — je Zeitraum, nur bei kind 'area'
 *     scale     'gafor-odmx' | null
 *     text      Rohtext, ungekürzt und unverändert
 *     source    { name, url }
 *   }
 *
 * Ein Bezugsmodul ist ein Objekt mit dieser Oberfläche (alles darf null
 * liefern, wenn das Land es nicht kennt):
 *
 *   load(force)      → lädt den Bestand des Landes
 *   generated()      → ISO-Zeitpunkt des letzten Abrufs
 *   errors()         → [ {product, url, message} ]
 *   gaforFor(area)   → Bericht kind 'area'
 *   overviewFor(area)→ Bericht kind 'overview'
 *   balloonFor(area) → Bericht kind 'balloon'
 *   loadBalloon(id)  → der ausführliche Ballonbericht, nachgeladen
 *   balloonAreas()   → Gebiete, für die es einen Ballonbericht gibt
 *   raw()            → der rohe Bestand, nur für „Über / Datenquellen"
 *
 * js/dwd.js ist das erste solche Modul und meldet sich unten selbst an.
 * ---------------------------------------------------------------------------
 */
const CTRY = (() => {
  'use strict';

  /* Ein Bezugsmodul, das nichts kann. Es steht überall dort, wo ein Land keine
     amtlichen Berichte frei abrufbar hat — Schweiz, Frankreich, Belgien. Die
     Karten fragen es ganz normal und bekommen überall null; sichtbar sind sie
     ohnehin nicht, weil die Fähigkeit fehlt. Kein einziges `if (land === …)`. */
  const NONE = {
    async load() { return null; },
    generated: () => null,
    errors: () => [],
    gaforFor: () => null,
    overviewFor: () => null,
    balloonFor: () => null,
    async loadBalloon() { return null; },
    balloonAreas: () => [],
    balloon: () => null,
    raw: () => null,
  };

  const providers = { none: NONE };
  /** Ein Bezugsmodul anmelden. Ruft jedes Modul am Ende seiner Datei selbst auf. */
  function provide(name, obj) { providers[name] = obj; return obj; }

  let index = null;       // data/countries/index.json
  let meta = null;        // das aktive Landespaket
  let ready = null;

  const FALLBACK_INDEX = {
    default: 'de', capabilities: {},
    countries: [{ code: 'de', name: 'Deutschland', state: 'live',
                  meta: 'data/countries/de/meta.json' }],
  };

  /* Wenn selbst die Beschreibungsdatei fehlt, läuft die App weiter — mit
     Deutschland und ohne Gebietsdaten. Eine leere Karte ist unangenehm, eine
     weisse Seite wäre schlimmer. */
  const FALLBACK_META = {
    code: 'de', name: 'Deutschland', nameEn: 'Germany', lang: 'de',
    home: { lat: 51.10, lon: 10.40, zoom: 6 },
    capabilities: { areas: true, areaCodes: true, areaReport: true,
                    overview: true, balloonReport: true },
    geometry: { kind: 'areas', areas: 'data/gafor-areas.geojson',
                meta: 'data/gafor-meta.json', regions: 'data/gafor-regions.geojson',
                land: 'data/germany.geojson' },
    reports: { provider: 'dwd' },
    models: {}, licence: {}, sources: [],
    outside: 'For the time being, this APP covers only Germany',
  };

  /** Welches Land ist gemeint? Link schlägt Einstellung schlägt Vorgabe. */
  function wanted() {
    const h = (location.hash || '').replace(/^#/, '');
    const tok = h.split(';').find(p => p.startsWith('c='));
    const fromLink = tok ? tok.slice(2).toLowerCase() : '';
    return fromLink || String(U.load('country', '') || '').toLowerCase() || '';
  }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      index = await U.getJSON('data/countries/index.json')
        .catch(e => { console.warn('Länderverzeichnis fehlt:', e.message); return FALLBACK_INDEX; });

      const live = liveList();
      const dflt = live.find(c => c.code === index.default) || live[0] || null;
      const pick = live.find(c => c.code === wanted()) || dflt;

      if (!pick) { meta = FALLBACK_META; return meta; }
      meta = await U.getJSON(pick.meta)
        .catch(e => { console.warn(`Landespaket ${pick.code} fehlt:`, e.message); return FALLBACK_META; });
      /* Das Paket ist die Wahrheit über sich selbst; der Verzeichniseintrag
         liefert nur nach, was dort fehlt. Er trägt denselben Namen, damit die
         Länderwahl ihn zeigen kann, ohne sieben Pakete zu laden — dass beide
         übereinstimmen, prüft test/run.mjs. */
      meta.name = meta.name || pick.name;
      meta.code = meta.code || pick.code;
      return meta;
    })();
    return ready;
  }

  const all = () => (index && index.countries) || [];
  const liveList = () => all().filter(c => c.state === 'live');
  const capWords = () => (index && index.capabilities) || {};

  const code = () => (meta && meta.code) || 'de';
  const name = () => (meta && meta.name) || 'Deutschland';
  const lang = () => (meta && meta.lang) || 'de';
  const current = () => meta;

  /** Kann dieses Land das? Unbekannte Namen sind immer nein — nie „vielleicht". */
  const has = (cap) => !!(meta && meta.capabilities && meta.capabilities[cap]);
  const caps = () => (meta && meta.capabilities) || {};

  const home = () => (meta && meta.home) || FALLBACK_META.home;
  const bbox = () => (meta && meta.bbox) || null;
  const zoomLabel = () => (meta && meta.zoomLabel) || `Ganz ${name()}`;
  const geometry = () => (meta && meta.geometry) || { kind: 'none' };
  const models = () => (meta && meta.models) || {};
  const licence = () => (meta && meta.licence) || {};
  const official = () => (meta && meta.official) || null;
  const sources = () => (meta && meta.sources) || [];
  const reportCfg = () => (meta && meta.reports) || {};
  const outside = () =>
    (meta && meta.outside) || `For the time being, this APP covers only ${(meta && meta.nameEn) || name()}`;

  /** Das Bezugsmodul des aktiven Landes — nie null, notfalls das leere. */
  function reports() {
    const key = reportCfg().provider;
    return (key && providers[key]) || NONE;
  }

  /** Land wechseln. Die App lädt neu: jede Karte, jede Geometrie hängt daran. */
  function select(cc) {
    const c = liveList().find(x => x.code === cc);
    if (!c || c.code === code()) return false;
    U.save('country', c.code);
    /* Ohne den Ausschnitt neu laden: die alten Koordinaten lägen im neuen Land
       fast sicher ausserhalb. replace() statt hash + reload — sonst bleibt ein
       Eintrag in der Verlaufsliste stehen, der zurück ins alte Land führt. */
    location.replace(location.pathname + location.search);
    return true;
  }

  return { init, provide, select,
           all, live: liveList, capWords,
           code, name, lang, current, has, caps,
           home, bbox, zoomLabel, geometry, models,
           licence, official, sources, reportCfg, reports, outside,
           NONE };
})();
