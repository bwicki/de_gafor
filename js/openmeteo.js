/* GaforCast — point forecast from Open-Meteo (same source and free tier as
 * StueveCast). It is the fallback when a DWD text product is missing, and the
 * hour-by-hour detail the area bulletins do not give.
 */
const OM = (() => {
  'use strict';

  const HOURLY = [
    'temperature_2m', 'dew_point_2m', 'relative_humidity_2m',
    'precipitation', 'cloud_cover', 'cloud_cover_low', 'visibility',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'wind_speed_80m', 'wind_direction_80m',
    'wind_speed_180m', 'wind_direction_180m',
    'cape', 'boundary_layer_height', 'freezing_level_height',
    'pressure_msl',
  ];

  function base() {
    const key = U.load('omKey', '');
    return key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  }
  function keyParam() {
    const key = U.load('omKey', '');
    return key ? `&apikey=${encodeURIComponent(key)}` : '';
  }

  /** Hourly forecast for the point, in the point's own time zone. */
  async function forecast(lat, lon, days) {
    const url = `${base()}/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=${HOURLY.join(',')}` +
      `&daily=sunrise,sunset` +
      `&wind_speed_unit=ms&timezone=auto&forecast_days=${days || 2}${keyParam()}`;
    const j = await U.getJSON(url);
    if (j.error) throw new Error(j.reason || 'Open-Meteo error');
    return j;
  }

  /** Index of the hour nearest to now within the returned series. */
  function nowIndex(j) {
    const t = j.hourly && j.hourly.time;
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
      precip: g('precipitation'),
      cloud: g('cloud_cover'), cloudLow: g('cloud_cover_low'),
      vis: g('visibility'),                       // metres
      w10: g('wind_speed_10m'), d10: g('wind_direction_10m'), gust: g('wind_gusts_10m'),
      w80: g('wind_speed_80m'), d80: g('wind_direction_80m'),
      w180: g('wind_speed_180m'), d180: g('wind_direction_180m'),
      cape: g('cape'), pbl: g('boundary_layer_height'), fzl: g('freezing_level_height'),
      qnh: g('pressure_msl'),
    };
  }

  /**
   * Rough GAFOR-style class from model visibility and low cloud.
   * Marked as a model estimate everywhere it is shown — it is not the DWD code.
   */
  function classify(rec, elevM) {
    if (rec.vis == null) return null;
    const visKm = rec.vis / 1000;
    // crude ceiling: base of a broken low cloud deck from the LCL, in ft AGL
    let cig = 99999;
    if (rec.cloudLow != null && rec.cloudLow >= 50 && rec.temp != null && rec.dew != null) {
      cig = Math.max(100, (rec.temp - rec.dew) * 400);
    }
    if (visKm >= 10 && cig >= 2000) return 'C';
    if (visKm >= 8  && cig >= 1500) return 'O';
    if (visKm >= 5  && cig >= 1000) return 'D';
    if (visKm >= 5  && cig >= 500)  return 'M';
    return 'X';
  }

  return { forecast, nowIndex, at, classify, HOURLY };
})();
