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
    const withArea = (b) => ({ ...b, codes: b.areas[id], detail: (b.details || {})[id] || null });
    const direct = area.office && data.gafor[area.office];
    if (direct && direct.areas && direct.areas[id]) return withArea(direct);
    for (const k of Object.keys(data.gafor)) {
      const b = data.gafor[k];
      if (b.areas && b.areas[id]) return withArea(b);
    }
    return direct ? { ...direct, codes: null, detail: null } : null;
  }

  /** Flugwetterübersicht (the prose bulletin) covering an area. */
  function overviewFor(area) {
    if (!data || !data.overview || !area) return null;
    const id = String(area.id);
    const direct = area.office && data.overview[area.office];
    if (direct && (!direct.areas || direct.areas.includes(id))) return direct;
    for (const k of Object.keys(data.overview)) {
      const o = data.overview[k];
      if (o.areas && o.areas.includes(id)) return o;
    }
    return null;
  }

  /** Balloon area forecast — the DWD issues one per GAFOR area. */
  function balloonFor(area) {
    if (!data || !data.balloon || !area) return null;
    return data.balloon[String(area.id)] || null;
  }

  /** Which areas have a balloon forecast at all (00 offshore has none). */
  const balloonAreas = () => (data && data.balloon ? Object.keys(data.balloon).sort() : []);
  const balloon = (id) => (data && data.balloon ? data.balloon[String(id)] : null);

  return { load, generated, errors, gaforFor, overviewFor, balloonFor,
           balloonAreas, balloon, raw: () => data };
})();
