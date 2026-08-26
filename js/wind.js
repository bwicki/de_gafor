/* GaforCast — the upper wind profile as an SVG sounding.
 *
 * Two conventions meet here and both are labelled in the UI:
 *   • the barbs are drawn the aviation way — the shaft points INTO the wind,
 *     i.e. towards where the air comes from, and the feathers give the speed
 *     in knots (half 5, full 10, pennant 50).
 *   • the arrows in the table below the chart point the way a balloon DRIFTS.
 *
 * The chart is a speed profile as well: the x position of every barb is the
 * wind speed, so the shape of the connecting line is the shear.
 */
const WINDVIEW = (() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, txt) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* Kompakt gehalten: die Grafik steht auf dem Desktop rechts neben der
     Tabelle und darf ihr keinen Platz wegnehmen. */
  const W = 236, PAD_L = 34, PAD_R = 26, PAD_T = 16, PAD_B = 34;

  /** Barb path fragments in local coordinates, shaft pointing up. */
  function barb(kt) {
    const L = 20, step = 3.4;
    const out = [];
    if (kt == null || !isFinite(kt)) return out;
    let k = Math.round(kt / 5) * 5;
    if (k < 5) return [{ circle: true }];        // Windstille: nur der Kreis, kein Schaft
    out.push({ d: `M0,0 L0,${-L}`, fill: false });
    let y = -L;
    let drew = false;
    while (k >= 50) { out.push({ d: `M0,${y} L-10,${y + 2.5} L0,${y + 5} Z`, fill: true }); y += 5.8; k -= 50; drew = true; }
    while (k >= 10) { out.push({ d: `M0,${y} L-10,${y - 3.4}`, fill: false }); y += step; k -= 10; drew = true; }
    if (k >= 5) {
      if (!drew) y += step;                       // a lone half barb sits in from the tip
      out.push({ d: `M0,${y} L-5.5,${y - 1.9}`, fill: false });
    }
    return out;
  }

  const MS_TO_KT = 1.943844;

  /**
   * Build the chart.
   * levels: [{ft, spd (m/s), dir, hPa, label}] top down
   * opts:   {unit, unitFactor, fzlFt, pblFt, groundFt}
   */
  function chart(levels, opts) {
    const o = opts || {};
    const pts = levels.filter(l => l.spd != null && isFinite(l.ft));
    if (pts.length < 2) return null;

    const conv = o.unitFactor || MS_TO_KT;
    const topFt = Math.ceil(Math.max(...pts.map(p => p.ft)) / 1000) * 1000;
    const botFt = Math.floor(Math.min(o.groundFt != null ? o.groundFt : pts[pts.length - 1].ft,
                                      ...pts.map(p => p.ft)) / 500) * 500;
    const maxV = Math.max(10, Math.ceil(Math.max(...pts.map(p => p.spd * conv)) / 10) * 10);

    // Die Fahnen ragen bis zu 30 px über ihren Punkt hinaus — deshalb oben und
    // unten etwas Luft, sonst schneidet der Rahmen sie ab.
    const H = 310;
    const padFt = ((topFt - botFt) || 1000) * 0.12;
    const lo = botFt - padFt, hi = topFt + padFt;
    const x = (v) => PAD_L + (v / maxV) * (W - PAD_L - PAD_R);
    const y = (ft) => PAD_T + (1 - (ft - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

    const svg = mk('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'wp-svg', role: 'img',
      'aria-label': 'Höhenwindprofil',
    });

    // ---- grid -------------------------------------------------------------
    // Zwischenlinien in beiden Achsen: fein, damit sich Werte ablesen lassen,
    // ohne dass das Raster die Fahnen erschlägt.
    const minor = mk('g', { class: 'wp-grid minor' });
    const grid = mk('g', { class: 'wp-grid' });
    const vStep = maxV > 60 ? 20 : 10;
    for (let v = 0; v <= maxV; v += vStep / 2) {
      const g = (v % vStep === 0) ? grid : minor;
      g.appendChild(mk('line', { x1: x(v), y1: PAD_T, x2: x(v), y2: H - PAD_B }));
      if (v % vStep === 0) {
        svg.appendChild(mk('text', { x: x(v), y: H - PAD_B + 11, class: 'wp-ax', 'text-anchor': 'middle' },
          String(v)));
      }
    }
    const span = topFt - botFt;
    const stepFt = span > 14000 ? 4000 : span > 7000 ? 2000 : 1000;
    for (let ft = Math.ceil(botFt / (stepFt / 2)) * (stepFt / 2); ft <= topFt; ft += stepFt / 2) {
      const major = Math.abs(ft % stepFt) < 1;
      (major ? grid : minor).appendChild(
        mk('line', { x1: PAD_L, y1: y(ft), x2: W - PAD_R, y2: y(ft) }));
      if (major) {
        svg.appendChild(mk('text', { x: PAD_L - 4, y: y(ft) + 3, class: 'wp-ax', 'text-anchor': 'end' },
          ft >= 1000 ? `${(ft / 1000).toFixed(0)}k` : String(ft)));
      }
    }
    svg.appendChild(minor);
    svg.appendChild(grid);
    svg.appendChild(mk('text', { x: W - PAD_R, y: H - PAD_B + 22, class: 'wp-ax', 'text-anchor': 'end' },
      o.unit || 'kt'));
    svg.appendChild(mk('text', { x: 2, y: PAD_T - 4, class: 'wp-ax' }, o.altUnit || 'ft'));

    // ---- markers ----------------------------------------------------------
    const marker = (ft, label, cls) => {
      if (ft == null || ft < botFt || ft > topFt) return;
      svg.appendChild(mk('line', { x1: PAD_L, y1: y(ft), x2: W - PAD_R, y2: y(ft), class: 'wp-mark ' + cls }));
      svg.appendChild(mk('text', { x: W - PAD_R - 2, y: y(ft) - 4, class: 'wp-mlab ' + cls, 'text-anchor': 'end' }, label));
    };
    marker(o.pblFt, 'Grenzschicht', 'pbl');
    marker(o.fzlFt, '0 °C', 'fzl');
    // die Beschriftungen sind bewusst kurz — die Grafik ist schmal

    // ---- profile line -----------------------------------------------------
    const line = pts.map(p => `${x(p.spd * conv).toFixed(1)},${y(p.ft).toFixed(1)}`).join(' ');
    svg.appendChild(mk('polyline', { points: line, class: 'wp-line' }));

    // ---- barbs ------------------------------------------------------------
    for (const p of pts) {
      const g = mk('g', {
        transform: `translate(${x(p.spd * conv).toFixed(1)},${y(p.ft).toFixed(1)}) rotate(${p.dir == null ? 0 : p.dir})`,
        class: 'wp-barb',
      });
      for (const part of barb(p.spd * MS_TO_KT)) {
        if (part.circle) { g.appendChild(mk('circle', { r: 3.2, cx: 0, cy: 0, class: 'wp-calm' })); continue; }
        g.appendChild(mk('path', { d: part.d, class: part.fill ? 'wp-fill' : '' }));
      }
      svg.appendChild(g);
      svg.appendChild(mk('circle', { cx: x(p.spd * conv), cy: y(p.ft), r: 1.8, class: 'wp-dot' }));
    }

    return svg;
  }

  return { chart, barb, MS_TO_KT };
})();
