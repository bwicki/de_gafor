/* GaforCast — DWD text products.
 *
 * dwd.de sends no CORS headers, so a browser on github.io cannot read those
 * pages directly. A GitHub Action in this repo fetches them every 20 minutes,
 * parses them and commits data/dwd/index.json; the app then reads that file
 * from its own origin. Everything here is therefore a plain, cheap file read.
 *
 * Shape of data/dwd/index.json — see scripts/fetch-dwd.mjs:
 * {
 *   generated: "2026-08-25T18:40:00Z",
 *   gafor:   { "<office>": { title, issued, validFrom, validTo, source, text,
 *                            periods: ["06-09", ...],
 *                            areas:   { "45": ["C","C","O"], ... } } },
 *   balloon: { "<region>": { title, issued, source, text } },
 *   errors:  [ { product, url, message } ]
 * }
 */
const DWD = (() => {
  'use strict';

  let data = null;
  let loadedAt = 0;

  async function load(force) {
    if (data && !force && Date.now() - loadedAt < 60000) return data;
    data = await U.getJSON('data/dwd/index.json?t=' + Math.floor(Date.now() / 60000));
    loadedAt = Date.now();
    return data;
  }

  const generated = () => (data ? data.generated : null);
  const errors = () => (data && data.errors) || [];

  /** GAFOR bulletin covering an area — by its office, else by scanning. */
  function gaforFor(area) {
    if (!data || !data.gafor || !area) return null;
    const id = String(area.id);
    const direct = area.office && data.gafor[area.office];
    if (direct && direct.areas && direct.areas[id]) return { ...direct, codes: direct.areas[id] };
    for (const k of Object.keys(data.gafor)) {
      const b = data.gafor[k];
      if (b.areas && b.areas[id]) return { ...b, codes: b.areas[id] };
    }
    return direct ? { ...direct, codes: null } : null;
  }

  /** Balloon area forecast for an area — by its balloon region, else the first. */
  function balloonFor(area) {
    if (!data || !data.balloon) return null;
    const keys = Object.keys(data.balloon);
    if (!keys.length) return null;
    if (area && area.balloon && data.balloon[area.balloon]) return data.balloon[area.balloon];
    if (area && area.office && data.balloon[area.office]) return data.balloon[area.office];
    return null;
  }

  /** All balloon regions, for the manual picker in the report card. */
  const balloonRegions = () => (data && data.balloon ? Object.keys(data.balloon) : []);
  const balloon = (key) => (data && data.balloon ? data.balloon[key] : null);

  return { load, generated, errors, gaforFor, balloonFor, balloonRegions, balloon,
           raw: () => data };
})();
