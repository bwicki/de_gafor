/* GaforCast — point forecast from Open-Meteo (same source and free tier as
 * StueveCast). It is the fallback when a DWD text product is missing, the
 * hour-by-hour detail the area bulletins do not give, and — since 1.6.0 — the
 * upper wind profile, the layered cloud cover, a fog estimate and the ICON-D2
 * ensemble spread.
 *
 * Everything derived here (fog risk, cloud base, GAFOR-style class) is a model
 * estimate. It is labelled as such wherever it is shown; it is never a DWD
 * statement.
 */
const OM = (() => {
  'use strict';

  const HOURLY = [
    'temperature_2m', 'dew_point_2m', 'relative_humidity_2m',
    'precipitation', 'precipitation_probability',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'visibility', 'shortwave_radiation',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'wind_speed_80m', 'wind_direction_80m',
    'wind_speed_180m', 'wind_direction_180m',
    'cape', 'boundary_layer_height', 'freezing_level_height',
    'pressure_msl',
  ];

  /* Pressure levels Open-Meteo serves, ground up. The profile is cut at the
   * level the user picked in the settings — every level costs four variables
   * in the query string. */
  const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];
  /* Feuchte kommt seit 1.10.0 mit: das Stüve-Diagramm braucht den Taupunkt und
   * die Schattierung der feuchten Schichten. */
  const LEVEL_VARS = ['wind_speed', 'wind_direction', 'temperature',
                      'geopotential_height', 'relative_humidity'];

  const M_TO_FT = 3.280839895;

  function levelsUpTo(topHpa) {
    return LEVELS.filter(p => p >= (topHpa || 500));
  }

  function base() {
    const key = U.load('omKey', '');
    return key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  }
  function ensembleBase() {
    const key = U.load('omKey', '');
    return key ? 'https://customer-ensemble-api.open-meteo.com' : 'https://ensemble-api.open-meteo.com';
  }
  function keyParam() {
    const key = U.load('omKey', '');
    return key ? `&apikey=${encodeURIComponent(key)}` : '';
  }

  /* ------------------------------------------------------------------ Modelle
   * Nur Modelle, die Druckflächen liefern — sonst bliebe das Höhenprofil leer.
   * `hours` ist der Vorhersagehorizont; die Auswahl über dem Höhenwind blendet
   * aus, was die gewählte Stunde nicht mehr abdeckt.
   */
  /* Aufsteigend nach Vorhersagehorizont sortiert — die Knöpfe stehen in
     derselben Reihenfolge, das kürzeste und feinste Modell zuerst. „Auto" ist
     der nahtlose Mix und reicht deshalb am weitesten. */
  const MODELS = [
    { key: 'icon_d2',           name: 'ICON-D2',     note: 'DWD, 2 km',     hours: 48 },
    { key: 'meteofrance_arpege_europe', name: 'ARPEGE', note: 'Météo-France, 11 km', hours: 96 },
    { key: 'icon_eu',           name: 'ICON-EU',     note: 'DWD, 7 km',     hours: 120 },
    { key: 'ecmwf_ifs025',      name: 'ECMWF IFS',   note: 'ECMWF, 25 km',  hours: 144 },
    { key: 'ukmo_global_deterministic_10km', name: 'UKMO', note: 'Met Office, 10 km', hours: 168 },
    { key: 'icon_global',       name: 'ICON global', note: 'DWD, 11 km',    hours: 180 },
    { key: 'gfs_global',        name: 'GFS',         note: 'NOAA, 13 km',   hours: 384 },
    { key: '',                  name: 'Auto',        note: 'nahtloser Mix', hours: 384 },
  ];
  /* Wie weit der gemeinsame Zeitschieber überhaupt reicht. GFS rechnet 16
     Tage, aber ein Höhenprofil auf zwei Wochen hinaus ist Zahlenmystik, und
     die Druckflächen für 16 Tage wären ein Vielfaches an Daten. Sieben Tage
     decken jede Fahrtplanung ab; darauf werden alle Modelle gedeckelt. */
  const SPAN_H = 168;
  const FETCH_DAYS = 8;              // ein Tag Reserve, damit +168 h auch drin ist

  /** Horizont eines Modells in Stunden, auf die Spannweite der App gedeckelt. */
  const modelHours = (key) =>
    Math.min(SPAN_H, (MODELS.find(m => m.key === (key || '')) || MODELS[MODELS.length - 1]).hours);
  /** Modelle, die eine Vorhersage für +hours noch abdecken. */
  const modelName = (key) => (MODELS.find(m => m.key === (key || '')) || MODELS[0]).name;

  /** Hourly forecast for the point, in the point's own time zone. */
  async function forecast(lat, lon, days, topHpa, model) {
    const levels = levelsUpTo(topHpa);
    const lvl = [];
    for (const p of levels) for (const v of LEVEL_VARS) lvl.push(`${v}_${p}hPa`);
    const url = `${base()}/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=${HOURLY.concat(lvl).join(',')}` +
      `&daily=sunrise,sunset` +
      (model ? `&models=${encodeURIComponent(model)}` : '') +
      `&wind_speed_unit=ms&timezone=auto&forecast_days=${days || 3}${keyParam()}`;
    const j = await U.getJSON(url);
    if (j.error) throw new Error(j.reason || 'Open-Meteo error');
    j._levels = levels;
    j._model = model || '';
    return j;
  }

  /** Index of the hour nearest to now within the returned series. */
  function nowIndex(j) {
    const t = j && j.hourly && j.hourly.time;
    if (!t || !t.length) return 0;
    const now = Date.now() + (j.utc_offset_seconds || 0) * 1000;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < t.length; i++) {
      // the series is local wall time; compare it as if it were UTC
      const d = Math.abs(Date.parse(t[i] + ':00Z') - now);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** One hour as a flat record. */
  function at(j, i) {
    const h = j.hourly;
    const g = (k) => (h[k] ? h[k][i] : null);
    return {
      time: h.time[i],
      temp: g('temperature_2m'), dew: g('dew_point_2m'), rh: g('relative_humidity_2m'),
      precip: g('precipitation'), pop: g('precipitation_probability'),
      cloud: g('cloud_cover'), cloudLow: g('cloud_cover_low'),
      cloudMid: g('cloud_cover_mid'), cloudHigh: g('cloud_cover_high'),
      vis: g('visibility'),                       // metres
      rad: g('shortwave_radiation'),              // W/m²
      w10: g('wind_speed_10m'), d10: g('wind_direction_10m'), gust: g('wind_gusts_10m'),
      w80: g('wind_speed_80m'), d80: g('wind_direction_80m'),
      w180: g('wind_speed_180m'), d180: g('wind_direction_180m'),
      cape: g('cape'), pbl: g('boundary_layer_height'), fzl: g('freezing_level_height'),
      qnh: g('pressure_msl'),
    };
  }

  // ------------------------------------------------------------ upper wind
  /**
   * Wind profile for one hour, ground up.
   * Returns [{label, hPa, m, ft, spd (m/s), dir, temp}] sorted top down, so it
   * reads like a sounding. Levels below the surface are dropped, levels the
   * model did not deliver are skipped rather than shown as gaps.
   */
  function profile(j, i, elevM) {
    if (!j || !j.hourly) return [];
    const h = j.hourly;
    const ground = (elevM != null ? elevM : (j.elevation != null ? j.elevation : 0));
    const out = [];

    // the near-surface levels the model gives directly, in m above ground
    for (const [agl, ws, wd] of [[10, 'wind_speed_10m', 'wind_direction_10m'],
                                 [80, 'wind_speed_80m', 'wind_direction_80m'],
                                 [180, 'wind_speed_180m', 'wind_direction_180m']]) {
      const s = h[ws] ? h[ws][i] : null, d = h[wd] ? h[wd][i] : null;
      if (s == null) continue;
      const m = ground + agl;
      out.push({ label: `${agl} m GND`, hPa: null, m, ft: Math.round(m * M_TO_FT),
                 spd: s, dir: d,
                 temp: agl === 10 && h.temperature_2m ? h.temperature_2m[i] : null,
                 rh: agl === 10 && h.relative_humidity_2m ? h.relative_humidity_2m[i] : null,
                 dew: agl === 10 && h.dew_point_2m ? h.dew_point_2m[i] : null });
    }

    for (const p of (j._levels || LEVELS)) {
      const s = h[`wind_speed_${p}hPa`] ? h[`wind_speed_${p}hPa`][i] : null;
      if (s == null) continue;
      const gh = h[`geopotential_height_${p}hPa`] ? h[`geopotential_height_${p}hPa`][i] : null;
      const m = gh != null ? gh : stdHeight(p);
      if (m <= ground + 200) continue;            // below or inside the surface layer
      const tp = h[`temperature_${p}hPa`] ? h[`temperature_${p}hPa`][i] : null;
      const rh = h[`relative_humidity_${p}hPa`] ? h[`relative_humidity_${p}hPa`][i] : null;
      out.push({
        label: `${p} hPa`, hPa: p, m, ft: Math.round(m * M_TO_FT), spd: s,
        dir: h[`wind_direction_${p}hPa`] ? h[`wind_direction_${p}hPa`][i] : null,
        temp: tp, rh, dew: dewPoint(tp, rh),
      });
    }

    out.sort((a, b) => b.m - a.m);
    return out;
  }

  /**
   * Taupunkt aus Temperatur und relativer Feuchte, Magnus-Formel
   * (Alduchov & Eskridge). Open-Meteo liefert auf den Druckflächen nur die
   * Feuchte, nicht den Taupunkt.
   */
  function dewPoint(tC, rh) {
    if (tC == null || rh == null || rh <= 0) return null;
    const b = 17.625, c = 243.04;
    const g = Math.log(Math.min(100, Math.max(1, rh)) / 100) + (b * tC) / (c + tC);
    return (c * g) / (b - g);
  }

  /** ICAO standard atmosphere height for a pressure, as a fallback in metres. */
  function stdHeight(hPa) {
    return 44330.77 * (1 - Math.pow(hPa / 1013.25, 0.1902632));
  }

  // ------------------------------------------------------------ derived
  /**
   * Fog risk 0…3 from spread, humidity, wind and model visibility.
   * Daylight with strong insolation takes one step off — radiation fog does not
   * usually survive it. Deliberately conservative: this is an indicator, not a
   * forecast.
   */
  function fogRisk(rec) {
    if (!rec || rec.temp == null || rec.dew == null) return { level: null, txt: '—' };
    const spread = rec.temp - rec.dew;
    const rh = rec.rh == null ? 100 - spread * 5 : rec.rh;
    const w = rec.w10 == null ? 0 : rec.w10;
    let lvl = 0;
    if (spread <= 0.6 && rh >= 97 && w < 2.0) lvl = 3;
    else if (spread <= 1.5 && rh >= 93 && w < 3.5) lvl = 2;
    else if (spread <= 2.5 && rh >= 88 && w < 5.0) lvl = 1;
    if (rec.vis != null) {
      if (rec.vis < 1000) lvl = 3;
      else if (rec.vis < 3000) lvl = Math.max(lvl, 2);
      else if (rec.vis < 5000) lvl = Math.max(lvl, 1);
    }
    if (lvl > 0 && rec.rad != null && rec.rad > 250) lvl -= 1;
    const TXT = ['kein', 'gering', 'mässig', 'hoch'];
    return { level: lvl, txt: TXT[lvl] };
  }

  /* ---------------------------------------------------------- Startfenster
   * Eine Ampel je Stunde für die Frage „kann ich starten?". Bewusst streng und
   * bewusst einfach: sie ersetzt keine Beratung, sondern sagt, welche Stunden
   * man überhaupt anschauen muss.
   *
   * Die Schwellen sind die üblichen Werte für den Heissluftballon und in den
   * Einstellungen änderbar (FLY_DEFAULTS):
   *   Bodenwind   bis 4 m/s gut, bis 6 m/s grenzwertig, darüber nein
   *   Böen        bis 6 m/s gut, bis 8 m/s grenzwertig, darüber nein
   *   Böigkeit    Böe minus Wind über 4 m/s ist grenzwertig, über 6 m/s nein
   *   Niederschlag ab 0,1 mm/h nein
   *   CAPE        ab 300 J/kg grenzwertig, ab 800 nein (Gewitterneigung)
   *   Sicht/Nebel unter 1,5 km nein, Nebelrisiko „mässig" grenzwertig
   *   Wolkenbasis unter 1000 ft AGL grenzwertig
   *   Dämmerung   ausserhalb bürgerlicher Dämmerung nein
   *
   * `light` ist true, wenn die Stunde zwischen Anfang und Ende der
   * bürgerlichen Dämmerung liegt (js/sun.js rechnet das für den Punkt).
   */
  const FLY = { GOOD: 2, LIMIT: 1, NO: 0 };
  const FLY_TXT = { 2: 'fahrbar', 1: 'grenzwertig', 0: 'nein' };

  /** Vorgaben. Alle Windgrössen in m/s, so wie das Modell sie liefert. */
  const FLY_DEFAULTS = {
    wind: [4, 6],          // grenzwertig ab, nein ab
    gust: [6, 8],
    gustSpread: [4, 6],    // Böe minus Mittelwind
    cape: [300, 800],      // J/kg
    precip: 0.1,           // mm/h — darüber nein
    visKm: 1.5,            // darunter nein
    baseFt: 1000,          // darunter grenzwertig
    needLight: 1,          // ausserhalb der bürgerlichen Dämmerung nein
  };
  const flyLimits = (o) => Object.assign({}, FLY_DEFAULTS, o || {});

  function flyRating(rec, light, limits) {
    if (!rec) return { level: null, txt: '—', why: [] };
    const L = flyLimits(limits);
    const why = [];
    let lvl = FLY.GOOD;
    const down = (to, reason) => { if (to < lvl) lvl = to; why.push(reason); };

    if (L.needLight && light === false) down(FLY.NO, 'ausserhalb der bürgerlichen Dämmerung');

    const w = rec.w10, g = rec.gust;
    if (w != null) {
      if (w > L.wind[1]) down(FLY.NO, `Bodenwind ${w.toFixed(1)} m/s`);
      else if (w > L.wind[0]) down(FLY.LIMIT, `Bodenwind ${w.toFixed(1)} m/s`);
    }
    if (g != null) {
      if (g > L.gust[1]) down(FLY.NO, `Böen ${g.toFixed(1)} m/s`);
      else if (g > L.gust[0]) down(FLY.LIMIT, `Böen ${g.toFixed(1)} m/s`);
    }
    if (w != null && g != null) {
      const d = g - w;
      if (d > L.gustSpread[1]) down(FLY.NO, `sehr böig (+${d.toFixed(1)} m/s)`);
      else if (d > L.gustSpread[0]) down(FLY.LIMIT, `böig (+${d.toFixed(1)} m/s)`);
    }
    if (rec.precip != null && rec.precip >= L.precip) {
      down(FLY.NO, `Niederschlag ${rec.precip.toFixed(1)} mm/h`);
    }
    if (rec.cape != null) {
      if (rec.cape >= L.cape[1]) down(FLY.NO, `CAPE ${Math.round(rec.cape)} J/kg`);
      else if (rec.cape >= L.cape[0]) down(FLY.LIMIT, `CAPE ${Math.round(rec.cape)} J/kg`);
    }
    if (rec.vis != null && rec.vis < L.visKm * 1000) down(FLY.NO, `Sicht ${(rec.vis / 1000).toFixed(1)} km`);
    else if (fogRisk(rec).level >= 2) down(FLY.LIMIT, 'Nebelrisiko');
    const base = cloudBaseFt(rec);
    if (base != null && base < L.baseFt) down(FLY.LIMIT, `Wolkenbasis ${base} ft AGL`);

    return { level: lvl, txt: FLY_TXT[lvl], why };
  }

  /** Rough base of the lowest deck in ft AGL, from the LCL. null if no low cloud. */
  function cloudBaseFt(rec) {
    if (!rec || rec.cloudLow == null || rec.cloudLow < 25) return null;
    if (rec.temp == null || rec.dew == null) return null;
    return Math.max(100, Math.round((rec.temp - rec.dew) * 400 / 100) * 100);
  }

  // ------------------------------------------------------------ ensemble
  const ENS_HOURLY = ['wind_speed_10m', 'wind_gusts_10m', 'precipitation',
                      'cloud_cover', 'temperature_2m'];

  /** ICON-D2-EPS, 20 members. Separate host, so it is a second request. */
  async function ensemble(lat, lon, days) {
    const url = `${ensembleBase()}/v1/ensemble?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=${ENS_HOURLY.join(',')}&models=icon_d2` +
      `&wind_speed_unit=ms&timezone=auto&forecast_days=${days || 2}${keyParam()}`;
    const j = await U.getJSON(url);
    if (j.error) throw new Error(j.reason || 'Open-Meteo error');
    return j;
  }

  /** All member series for one variable: control plus `_memberNN`. */
  function members(j, key) {
    if (!j || !j.hourly) return [];
    const re = new RegExp(`^${key}(_member\\d+)?$`);
    return Object.keys(j.hourly).filter(k => re.test(k)).map(k => j.hourly[k]);
  }

  /** min / median / max across members at one hour. */
  function spread(j, key, i) {
    const vals = members(j, key).map(s => (s ? s[i] : null))
                                .filter(v => v != null && isFinite(v))
                                .sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return {
      n: vals.length,
      min: vals[0],
      max: vals[vals.length - 1],
      med: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2,
    };
  }

  /** Share of members below a threshold, e.g. "dry" = precipitation < 0.1 mm. */
  function shareBelow(j, key, i, limit) {
    const vals = members(j, key).map(s => (s ? s[i] : null)).filter(v => v != null);
    if (!vals.length) return null;
    return { hit: vals.filter(v => v < limit).length, n: vals.length };
  }

  return { forecast, nowIndex, at, profile, fogRisk, cloudBaseFt, dewPoint, flyRating, FLY, FLY_DEFAULTS, flyLimits,
           SPAN_H, FETCH_DAYS,
           MODELS, modelName, modelHours,
           ensemble, spread, shareBelow, levelsUpTo, stdHeight, M_TO_FT };
})();
