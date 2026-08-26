/* GaforCast — Stüve-Diagramm mit Windprofil daneben.
 *
 * Warum Stüve: die Höhenachse ist p^0.286 skaliert. Damit werden Trockenadiabaten
 * zu **Geraden** — man sieht auf einen Blick, wie weit ein Paket trocken
 * aufsteigen kann und wo die Temperaturkurve die Adiabate schneidet. Für die
 * Ballonfahrt ist genau das die interessante Frage: Inversionen, Mischungsschicht,
 * feuchte Schichten.
 *
 * Aufbau:
 *   links   Stüve  — Isothermen senkrecht, Isobaren waagrecht, Trockenadiabaten
 *                    als Geraden, dazu Temperatur- und Taupunktkurve
 *   rechts  Wind   — dieselbe Höhenachse, waagrecht die Geschwindigkeit, mit
 *                    Windfahnen aus js/wind.js
 *
 * Die Schattierung markiert feuchte Schichten: ab 85 % relativer Feuchte
 * beginnt sie und wird bis 100 % kräftiger. Zwischen den Druckflächen wird
 * linear überblendet, deshalb ein Farbverlauf statt einzelner Balken.
 *
 * Was hier **nicht** drin ist: Feuchtadiabaten und Mischungsverhältnislinien.
 * Beide brauchen Iteration und würden das Bild bei dieser Grösse zustellen.
 */
const STUEVE = (() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  const mk = (tag, attrs, txt) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (txt != null) n.textContent = txt;
    return n;
  };

  const KAPPA = 0.2857;                 // R/cp für trockene Luft
  const fp = (p) => Math.pow(p / 1000, KAPPA);
  const MS_TO_KT = 1.943844;

  const PAD_T = 14, PAD_B = 30, PAD_L = 40, PAD_R = 30, GAP = 24;

  /** Anteil der Breite, den das Stüve bekommt; der Rest ist Wind. */
  const SPLIT = 0.66;

  /* Schattierung feuchter Schichten: unter 85 % nichts, darüber linear bis
     zum vollen Wert bei 100 %. */
  const RH_START = 85, RH_MAX_ALPHA = 0.42;
  const rhAlpha = (rh) => (rh == null || rh <= RH_START ? 0
    : RH_MAX_ALPHA * Math.min(1, (rh - RH_START) / (100 - RH_START)));

  /**
   * levels: [{hPa, ft, m, spd (m/s), dir, temp (°C), dew (°C), rh (%)}] von oben nach unten
   * opts:   {w, h, unit, unitFactor, altUnit, fzlFt, pblFt, groundHpa}
   * Rückgabe: <svg> oder null, wenn zu wenig Daten da sind.
   */
  function chart(levels, opts) {
    const o = opts || {};
    const lv = levels.filter(l => l.hPa != null && l.temp != null);
    if (lv.length < 3) return null;
    /* Die bodennahen Flächen (10/80/180 m) haben keinen Druck, sind für die
       Ballonfahrt aber die wichtigsten — sie werden über ihre Höhe eingehängt. */
    const near = levels.filter(l => l.hPa == null && l.spd != null);

    const W = Math.max(300, Math.round(o.w || 520));
    const H = Math.max(240, Math.round(o.h || 340));
    const id = 'sv' + (++uid);

    const pTop = Math.min(...lv.map(l => l.hPa));
    const pBot = Math.max(...lv.map(l => l.hPa));
    const fTop = fp(pTop), fBot = fp(pBot);

    // Temperaturbereich: die Daten plus Luft, auf 10 °C gerundet
    const temps = lv.concat(near).flatMap(l => [l.temp, l.dew])
      .filter(v => v != null && isFinite(v));
    let tMin = Math.floor((Math.min(...temps) - 4) / 10) * 10;
    let tMax = Math.ceil((Math.max(...temps) + 4) / 10) * 10;
    if (tMax - tMin < 30) tMax = tMin + 30;

    const plotT = PAD_T, plotB = H - PAD_B, plotH = plotB - plotT;
    const sL = PAD_L, sR = PAD_L + (W - PAD_L - PAD_R - GAP) * SPLIT;
    const wL = sR + GAP, wR = W - PAD_R;

    /* Etwas Luft oben und unten: die Windfahnen ragen über ihren Punkt hinaus
       und würden sonst am Rahmen abgeschnitten. */
    const fPad = (fBot - fTop) * 0.06;
    const fLo = fTop - fPad, fHi = fBot + fPad;
    const y = (p) => plotT + ((fp(p) - fLo) / (fHi - fLo || 1)) * plotH;
    const yFt = (ft) => {                 // Höhe → Druck über die Stützstellen
      const s = [...lv].sort((a, b) => a.ft - b.ft);
      if (ft <= s[0].ft) return y(s[0].hPa);
      if (ft >= s[s.length - 1].ft) return y(s[s.length - 1].hPa);
      for (let i = 1; i < s.length; i++) {
        if (ft <= s[i].ft) {
          const t = (ft - s[i - 1].ft) / ((s[i].ft - s[i - 1].ft) || 1);
          return y(s[i - 1].hPa) + t * (y(s[i].hPa) - y(s[i - 1].hPa));
        }
      }
      return y(s[s.length - 1].hPa);
    };
    const xT = (t) => sL + ((t - tMin) / (tMax - tMin)) * (sR - sL);
    /** Senkrechte Lage einer Fläche: über den Druck, sonst über die Höhe. */
    const yOf = (l) => (l.hPa != null ? y(l.hPa) : yFt(l.ft));

    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sv-svg', role: 'img',
                            'aria-label': 'Stüve-Diagramm mit Windprofil' });

    // ---------------------------------------------------- Feuchteschattierung
    const defs = mk('defs');
    // Trockenadiabaten laufen weit über das Feld hinaus und müssen beschnitten werden
    const clip = mk('clipPath', { id: `${id}-clip` });
    clip.appendChild(mk('rect', { x: sL, y: plotT, width: sR - sL, height: plotH }));
    defs.appendChild(clip);
    const stops = [...lv].sort((a, b) => a.hPa - b.hPa);        // oben zuerst
    if (stops.some(l => rhAlpha(l.rh) > 0)) {
      const grad = mk('linearGradient', { id: `${id}-rh`, x1: 0, y1: 0, x2: 0, y2: 1 });
      for (const l of stops) {
        const off = ((y(l.hPa) - plotT) / (plotH || 1));
        grad.appendChild(mk('stop', {
          offset: `${(U.clamp(off, 0, 1) * 100).toFixed(2)}%`,
          'stop-color': 'var(--sv-humid)',
          'stop-opacity': rhAlpha(l.rh).toFixed(3),
        }));
      }
      defs.appendChild(grad);
    }
    svg.appendChild(defs);

    const grid = mk('g', { class: 'sv-grid' });
    const minor = mk('g', { class: 'sv-grid minor' });

    // ---------------------------------------------------- Stüve: Raster
    // Isothermen
    const tStep = (tMax - tMin) > 70 ? 20 : 10;
    for (let t = tMin; t <= tMax; t += tStep) {
      (t === 0 ? grid : minor).appendChild(
        mk('line', { x1: xT(t), y1: plotT, x2: xT(t), y2: plotB, class: t === 0 ? 'sv-zero' : '' }));
      svg.appendChild(mk('text', { x: xT(t), y: plotB + 12, class: 'sv-ax', 'text-anchor': 'middle' },
        String(t)));
    }
    // Trockenadiabaten — im Stüve Geraden
    const ad = mk('g', { class: 'sv-adiabat', 'clip-path': `url(#${id}-clip)` });
    for (let th = -60; th <= 160; th += 20) {
      const pts = [];
      for (const p of [pBot, pTop]) {
        const t = (th + 273.15) * fp(p) - 273.15;
        pts.push([xT(t), y(p)]);
      }
      // nur zeichnen, wenn die Gerade das Feld überhaupt streift
      if (pts.every(q => q[0] < sL - 2) || pts.every(q => q[0] > sR + 2)) continue;
      ad.appendChild(mk('line', { x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] }));
    }
    svg.appendChild(ad);

    // Isobaren, quer über beide Felder
    for (const l of stops) {
      grid.appendChild(mk('line', { x1: sL, y1: y(l.hPa), x2: wR, y2: y(l.hPa) }));
      svg.appendChild(mk('text', { x: sL - 5, y: y(l.hPa) + 3, class: 'sv-ax', 'text-anchor': 'end' },
        String(l.hPa)));
    }
    svg.insertBefore(minor, svg.firstChild.nextSibling);
    svg.insertBefore(grid, minor.nextSibling);

    // Schattierung über das Stüve-Feld legen
    if (defs.querySelector('linearGradient')) {
      svg.appendChild(mk('rect', { x: sL, y: plotT, width: sR - sL, height: plotH,
                                   fill: `url(#${id}-rh)`, class: 'sv-humid-band' }));
    }

    // Rahmen
    svg.appendChild(mk('rect', { x: sL, y: plotT, width: sR - sL, height: plotH, class: 'sv-frame' }));

    // ---------------------------------------------------- Kurven
    const curve = (key, cls, label) => {
      const pts = stops.concat(near.filter(l => l[key] != null))
        .filter(l => l[key] != null && isFinite(l[key]))
        .sort((a, b) => yOf(a) - yOf(b));
      if (pts.length < 2) return;
      svg.appendChild(mk('polyline', {
        points: pts.map(l => `${xT(U.clamp(l[key], tMin, tMax)).toFixed(1)},${yOf(l).toFixed(1)}`).join(' '),
        class: `sv-curve ${cls}`,
      }));
      for (const l of pts) {
        svg.appendChild(mk('circle', { cx: xT(U.clamp(l[key], tMin, tMax)), cy: yOf(l),
                                       r: 1.7, class: `sv-dot ${cls}` }));
      }
      // Beschriftung an den oberen Kurvenpunkt, dort ist immer Platz
      const top = pts[0];
      svg.appendChild(mk('text', {
        x: U.clamp(xT(U.clamp(top[key], tMin, tMax)) + 4, sL + 3, sR - 14),
        y: U.clamp(yOf(top) - 4, plotT + 9, plotB - 3),
        class: `sv-lab ${cls}`,
      }, label));
    };
    curve('dew', 'dew', 'Td');
    curve('temp', 'temp', 'T');

    // ---------------------------------------------------- Marken
    const mark = (ft, label, cls) => {
      if (ft == null) return;
      const yy = yFt(ft);
      if (yy < plotT - 1 || yy > plotB + 1) return;
      svg.appendChild(mk('line', { x1: sL, y1: yy, x2: wR, y2: yy, class: 'sv-mark ' + cls }));
      svg.appendChild(mk('text', { x: wR - 2, y: yy - 3, class: 'sv-mlab ' + cls,
                                   'text-anchor': 'end' }, label));
    };
    mark(o.pblFt, 'Grenzschicht', 'pbl');
    mark(o.fzlFt, '0 °C', 'fzl');

    // ---------------------------------------------------- Windfeld
    const conv = o.unitFactor || MS_TO_KT;
    const wind = lv.filter(l => l.spd != null).concat(near).sort((a, b) => yOf(a) - yOf(b));
    const maxV = Math.max(10, Math.ceil(Math.max(...wind.map(l => l.spd * conv)) / 10) * 10);
    // kleiner Einzug, damit die Fahnen der schwachen Bodenwinde nicht am
    // linken Rahmen kleben
    const wIn = 10;
    const xW = (v) => wL + wIn + (v / maxV) * (wR - wL - wIn);
    // Die "0" fiele mit der letzten Zahl der Temperaturachse zusammen
    const skipZero = true;
    const vStep = maxV > 60 ? 20 : 10;
    for (let v = 0; v <= maxV; v += vStep / 2) {
      (v % vStep === 0 ? grid : minor).appendChild(
        mk('line', { x1: xW(v), y1: plotT, x2: xW(v), y2: plotB }));
      if (v % vStep === 0 && !(skipZero && v === 0)) {
        svg.appendChild(mk('text', { x: xW(v), y: plotB + 12, class: 'sv-ax', 'text-anchor': 'middle' },
          String(v)));
      }
    }
    svg.appendChild(mk('rect', { x: wL, y: plotT, width: wR - wL, height: plotH, class: 'sv-frame' }));
    if (wind.length > 1) {
      svg.appendChild(mk('polyline', {
        points: wind.map(l => `${xW(l.spd * conv).toFixed(1)},${yOf(l).toFixed(1)}`).join(' '),
        class: 'sv-wind',
      }));
      for (const l of wind) {
        const g = mk('g', {
          transform: `translate(${xW(l.spd * conv).toFixed(1)},${yOf(l).toFixed(1)}) ` +
                     `rotate(${l.dir == null ? 0 : l.dir})`,
          class: 'sv-barb',
        });
        for (const part of WINDVIEW.barb(l.spd * MS_TO_KT)) {
          if (part.circle) { g.appendChild(mk('circle', { r: 3, cx: 0, cy: 0, class: 'sv-calm' })); continue; }
          g.appendChild(mk('path', { d: part.d, class: part.fill ? 'sv-fill' : '' }));
        }
        svg.appendChild(g);
      }
    }

    // ---------------------------------------------------- Achsenbeschriftung
    svg.appendChild(mk('text', { x: sL, y: plotB + 24, class: 'sv-ax' }, '°C'));
    svg.appendChild(mk('text', { x: wR, y: plotB + 24, class: 'sv-ax', 'text-anchor': 'end' },
      o.unit || 'kt'));
    svg.appendChild(mk('text', { x: 2, y: plotT - 4, class: 'sv-ax' }, 'hPa'));

    return svg;
  }

  return { chart, rhAlpha, fp, RH_START };
})();
