/* GaforCast — Sonnenstand.
 *
 * Für die Ballonfahrt sind zwei Zeiten hart: der **Anfang der bürgerlichen
 * Dämmerung** am Morgen und ihr **Ende** am Abend. Dazwischen darf gefahren
 * werden, davor und danach nicht. Open-Meteo liefert nur Sonnenauf- und
 * -untergang, der DWD nennt die Dämmerung nur für einzelne Städte — also wird
 * sie hier für den gewählten Punkt gerechnet.
 *
 * Verfahren: die übliche „sunrise equation" (NOAA), auf Minuten genau. Das
 * reicht für den Zweck; auf die Sekunde genau wäre ohnehin Schein, weil die
 * Sichtbarkeit vom Gelände abhängt.
 */
const SUN = (() => {
  'use strict';

  const RAD = Math.PI / 180;
  const DAY = 86400000;
  const J2000 = 2451545;

  const toJulian = (ms) => ms / DAY - 0.5 + 2440588;
  const fromJulian = (j) => (j + 0.5 - 2440588) * DAY;

  /**
   * Sonnenzeiten des Kalendertags, in den `ms` fällt (UTC-Millisekunden).
   * Rückgabe in UTC-Millisekunden; `null`, wo die Sonne die Höhe an diesem Tag
   * nicht erreicht (Polartag, Polarnacht) — in Deutschland kommt das nicht vor,
   * aber die App darf daran nicht scheitern.
   *
   *   dawn    Anfang der bürgerlichen Dämmerung (Sonnenhöhe −6°)
   *   sunrise Sonnenaufgang (−0,833°, Refraktion und Sonnenrand)
   *   noon    Sonnenhöchststand
   *   sunset  Sonnenuntergang
   *   dusk    Ende der bürgerlichen Dämmerung
   */
  function times(lat, lon, ms) {
    const lw = -lon * RAD;
    const phi = lat * RAD;

    const n = Math.round(toJulian(ms) - J2000 - 0.0009 - lw / (2 * Math.PI));
    const jStar = J2000 + 0.0009 + lw / (2 * Math.PI) + n;      // mittlerer Mittag

    const M = (357.5291 + 0.98560028 * (jStar - J2000)) * RAD;  // mittlere Anomalie
    const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    const lam = M + C + Math.PI + 102.9372 * RAD;               // ekliptikale Länge
    const jNoon = jStar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lam);
    const dec = Math.asin(Math.sin(lam) * Math.sin(23.4397 * RAD));

    /** Stundenwinkel für eine Sonnenhöhe, oder null wenn unerreichbar. */
    const hourAngle = (altDeg) => {
      const c = (Math.sin(altDeg * RAD) - Math.sin(phi) * Math.sin(dec)) /
                (Math.cos(phi) * Math.cos(dec));
      return (c > 1 || c < -1) ? null : Math.acos(c);
    };
    const pair = (altDeg) => {
      const h = hourAngle(altDeg);
      if (h == null) return [null, null];
      const half = h / (2 * Math.PI);
      return [fromJulian(jNoon - half), fromJulian(jNoon + half)];
    };

    const [sunrise, sunset] = pair(-0.833);
    const [dawn, dusk] = pair(-6);
    return { dawn, sunrise, noon: fromJulian(jNoon), sunset, dusk };
  }

  /**
   * Steht die Sonne zu diesem Zeitpunkt über −6°, ist es also fahrbar hell?
   * Gerechnet wird über den Tag, in den der Zeitpunkt fällt, und zusätzlich
   * über den Vortag — sonst fiele die Stunde nach Mitternacht durch.
   */
  function isDaylight(lat, lon, ms) {
    for (const off of [0, -DAY]) {
      const t = times(lat, lon, ms + off);
      if (t.dawn == null || t.dusk == null) continue;
      if (ms >= t.dawn && ms <= t.dusk) return true;
    }
    return false;
  }

  return { times, isDaylight };
})();
