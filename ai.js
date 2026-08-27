/* GaforCast — Kurzanalyse durch Claude.
 *
 * ------------------------------------------------------------------ Warum so
 * Die App ist eine statische Seite auf GitHub Pages. Es gibt keinen Server,
 * auf dem ein API-Schlüssel liegen könnte, und in den Quelltext darf er nicht:
 * der ist öffentlich, und wer ihn liest, fährt auf fremde Rechnung.
 *
 * Deshalb bringt der Nutzer seinen **eigenen Schlüssel** mit. Er steht in den
 * Einstellungen, liegt im `localStorage` genau dieses Geräts und wird nur an
 * `api.anthropic.com` geschickt — nie an das Repo, nie in einen geteilten
 * Link, nie in das Seitenbild. Dasselbe Verfahren wie beim optionalen
 * Open-Meteo-Schlüssel, den die App schon kennt.
 *
 * Der Aufruf geht direkt aus dem Browser; dafür braucht es den Kopf
 * `anthropic-dangerous-direct-browser-access`, mit dem Anthropic CORS für
 * genau diesen Fall freigibt.
 *
 * ------------------------------------------------------------- Was geschickt
 * Nicht die Rohdaten, sondern ein kurzer Lagebericht: Ort und Gebiet, die
 * GAFOR-Stufen, das Stundenraster des Modells in Dreierschritten, das
 * Höhenprofil an drei Zeitpunkten (für die Scherung), die METAR/TAF im
 * Umkreis (das ist der 100-km-Radius für Schauer und Gewitter), die
 * Dämmerungszeiten und die von der App gerechneten Startfenster.
 *
 * Der **DWD-Fliesstext** geht nur mit, wenn das in den Einstellungen
 * ausdrücklich eingeschaltet ist — die Luftsportberichte dürfen nach den
 * Nutzungsbedingungen des DWD nicht weitergegeben oder weiterverarbeitet
 * werden, und ein Abruf bei einem Dritten ist beides. Ohne ihn fällt die
 * Analyse der Grosswetterlage dünner aus; das ist die ehrlichere Vorgabe.
 *
 * ------------------------------------------------------------------- Antwort
 * Verlangt wird striktes JSON mit Abschnitten und Zeilen. Zeilen statt Prosa,
 * weil sich die Grenze von 24 Zeilen so hart einhalten lässt, ohne Markdown zu
 * parsen.
 */
const AI = (() => {
  'use strict';

  const URL = 'https://api.anthropic.com/v1/messages';
  const VERSION = '2023-06-01';
  const MAX_LINES = 24;

  /* Die Antwort kommt nicht als Fliesstext, sondern über ein erzwungenes
     Werkzeug: `tool_choice` bindet das Modell an dieses Schema, und die API
     liefert den Inhalt fertig geparst im Block `tool_use`. Damit entfällt der
     ganze Ratebetrieb — Vorrede, Code-Zäune, ein abgeschnittenes JSON. */
  const TOOL = {
    name: 'lagebericht',
    description: 'Gibt die fertige Kurzanalyse in drei Abschnitten zurück.',
    input_schema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          description: 'Genau drei Abschnitte in der vorgegebenen Reihenfolge.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Titel des Abschnitts.' },
              lines: { type: 'array', items: { type: 'string' },
                       description: 'Je ein vollständiger Satz, höchstens 110 Zeichen.' },
            },
            required: ['title', 'lines'],
          },
        },
      },
      required: ['sections'],
    },
  };

  /* Auswahl bewusst klein gehalten: das Schnelle und das Gute. */
  const MODELS = [
    { key: 'claude-sonnet-5', name: 'Sonnet 5', note: 'ausgewogen, ca. 1,5 Rp. je Analyse' },
    { key: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', note: 'schnell und günstig, ca. 0,7 Rp.' },
  ];
  const modelName = (k) => (MODELS.find(m => m.key === k) || MODELS[0]).name;

  const key = () => String(U.load('aiKey', '') || '').trim();
  const available = () => key().length > 10;

  // ----------------------------------------------------------------- Auftrag
  const SYSTEM = [
    'Du bist Flugwetterberater für Heissluftballonfahrt in Deutschland.',
    'Du bekommst einen Lagebericht aus Modell- und Beobachtungsdaten und schreibst daraus',
    'eine knappe Einschätzung auf Deutsch (Schweizer Rechtschreibung, «ss» statt «ß»).',
    '',
    'Regeln:',
    '- Gib deine Antwort ausschliesslich über das Werkzeug `lagebericht` ab, ohne Vorrede',
    '  und ohne Markdown in den Zeilen.',
    '- Genau drei Abschnitte in dieser Reihenfolge und mit diesen Titeln:',
    '  "Grosswetterlage", "Ballonspezifische Gefahren", "Startfenster im Vergleich".',
    '- Zusammen höchstens 24 Zeilen. Jede Zeile ein vollständiger Satz, höchstens 110 Zeichen.',
    '- Im zweiten Abschnitt: Bodenwind, Böen, Windscherung zwischen Boden und 300–2000 ft,',
    '  Schauer und Gewitter im Umkreis von 100 km — jeweils mit ihrer Entwicklung über den',
    '  Vorhersagezeitraum. Nenne Zahlen und Zeiten, keine Allgemeinplätze.',
    '- Im dritten Abschnitt: prüfe die von der App gerechneten Startfenster gegen die Daten.',
    '  Sag ausdrücklich, wo du zustimmst und wo du sie für zu optimistisch oder zu streng',
    '  hältst, und warum.',
    '- Was die Daten nicht hergeben, sagst du als Lücke; erfinde nichts.',
    '- Keine Empfehlung zu starten oder nicht zu starten. Du lieferst die Einschätzung,',
    '  entschieden wird vor Ort.',
  ].join('\n');

  /** m/s in die angezeigte Einheit, gerundet. */
  const w = (v, unit) => (v == null ? '—' : `${Math.round(v * U.MS_TO[unit])}`);

  /**
   * Der Lagebericht. `ctx` kommt aus app.js und enthält alles, was die App
   * ohnehin schon geladen hat — es wird nichts zusätzlich abgerufen.
   */
  function brief(ctx) {
    const L = [];
    const u = U.unitLabel[ctx.unit];
    L.push(`ORT: ${ctx.place || '—'} (${ctx.lat.toFixed(3)}, ${ctx.lon.toFixed(3)}), ` +
           `Gelände ${ctx.elev == null ? '—' : Math.round(ctx.elev)} m`);
    if (ctx.area) {
      L.push(`GAFOR-GEBIET: ${ctx.area.id} ${ctx.area.name || ''}, Bereich ` +
             `${ctx.area.regionName || ctx.area.region || '—'}, Bezugshöhe ` +
             `${ctx.area.refAltFt == null ? '—' : ctx.area.refAltFt + ' ft MSL'}`);
    }
    L.push(`JETZT: ${ctx.now} ${ctx.tz}`);
    L.push(`DÄMMERUNG (bürgerlich, für diesen Punkt): ${ctx.twilight}`);
    L.push(`MODELL: ${ctx.model}, Horizont +${ctx.reach} h`);
    L.push(`WINDEINHEIT DER ANZEIGE: ${u}`);

    if (ctx.gafor) {
      L.push('', 'GAFOR-STUFEN (amtlich, DWD):');
      L.push(ctx.gafor);
    }
    if (ctx.overview) {
      L.push('', 'FLUGWETTERÜBERSICHT DWD (Auszug):');
      L.push(ctx.overview);
    }

    L.push('', `STUNDENRASTER (alle 3 h; Wind und Böe in ${u}, CAPE J/kg, Ns mm/h, Sicht km, ` +
           'Wolken tief/mittel/hoch in %, Bewertung der App):');
    L.push('Zeit | Wind | Böe | Ri | CAPE | Ns | Sicht | Wolken | App');
    for (const r of ctx.rows) {
      L.push([r.t, w(r.w10, ctx.unit), w(r.gust, ctx.unit), U.pad(Math.round(r.d10 || 0)) + '°',
              r.cape == null ? '—' : Math.round(r.cape),
              r.precip == null ? '—' : r.precip.toFixed(1),
              r.vis == null ? '—' : (r.vis / 1000).toFixed(0),
              `${Math.round(r.cloudLow || 0)}/${Math.round(r.cloudMid || 0)}/${Math.round(r.cloudHigh || 0)}`,
              r.fly].join(' | '));
    }

    if (ctx.profiles.length) {
      L.push('', `HÖHENPROFIL (für die Scherung; Wind in ${u} je Höhe AMSL):`);
      for (const p of ctx.profiles) {
        L.push(`${p.t}: ` + p.levels.map(l =>
          `${l.ft} ft ${U.pad(Math.round(l.dir || 0))}°/${w(l.spd, ctx.unit)}`).join(' · '));
      }
    }

    if (ctx.metars.length) {
      L.push('', 'BEOBACHTUNGEN IM UMKREIS (METAR, Entfernung und Peilung vom Ort):');
      for (const m of ctx.metars) L.push(`${m.d} km ${m.b}° — ${m.raw}`);
    }
    if (ctx.tafs.length) {
      L.push('', 'PLATZVORHERSAGEN (TAF):');
      for (const t of ctx.tafs) L.push(t);
    }

    L.push('', 'STARTFENSTER, DIE DIE APP AUS DEN MODELLWERTEN RECHNET:');
    L.push(ctx.windows.length ? ctx.windows.join('\n') : 'keines im Vorhersagezeitraum');
    L.push('', 'SCHWELLEN DER APP (grenzwertig / nein):');
    L.push(ctx.limits);

    return L.join('\n');
  }

  // ------------------------------------------------------------------ Abruf
  /**
   * Ruft die Analyse ab. Wirft mit einer lesbaren Meldung, wenn etwas fehlt.
   * Rückgabe: { sections: [{title, lines[]}], model, at }
   */
  async function analyse(text, opts) {
    const k = key();
    if (!k) throw new Error('Kein Schlüssel hinterlegt.');
    const model = (opts && opts.model) || MODELS[0].key;

    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': k,
        'anthropic-version': VERSION,
        // gibt CORS für den Aufruf aus dem Browser frei
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      /* Kein `temperature`: die neueren Modelle lehnen den Parameter ab
         („`temperature` is deprecated for this model") und brechen den Abruf
         mit 400 ab. Die Strenge kommt ohnehin aus dem Auftrag, nicht aus einer
         Zahl.
         `max_tokens` grosszügig: 24 Zeilen brauchen keine 4000, aber ein zu
         knappes Budget schneidet die Antwort mitten im Satz ab, und das sah
         bisher aus wie „liess sich nicht lesen". */
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!res.ok) {
      let why = `${res.status} ${res.statusText}`;
      try {
        const e = await res.json();
        if (e && e.error && e.error.message) why = e.error.message;
      } catch { /* dann eben der Statuscode */ }
      if (res.status === 401) why = 'Der Schlüssel wird abgelehnt (401).';
      if (res.status === 429) why = 'Zu viele Anfragen oder Guthaben erschöpft (429).';
      throw new Error(why);
    }

    const j = await res.json();
    const blocks = Array.isArray(j.content) ? j.content : [];

    /* Der übliche Weg: der Werkzeugaufruf, den `tool_choice` erzwungen hat. */
    const call = blocks.find(c => c.type === 'tool_use' && c.name === TOOL.name);
    let parsed = call ? shape(call.input && call.input.sections) : [];

    /* Der Rückfall, falls ein Modell die Werkzeuge einmal nicht bedient: dann
       eben JSON aus dem Fliesstext. Kostet nichts und rettet den Abruf. */
    const txt = blocks.filter(c => c.type === 'text').map(c => c.text).join('');
    if (!parsed.length) parsed = parse(txt);

    if (!parsed.length) throw new Error(why(j, txt));
    return { sections: clamp(parsed), model, at: new Date().toISOString(),
             usage: j.usage || null };
  }

  /**
   * Warum nichts herauskam — so genau, dass man es beheben kann. „Die Antwort
   * liess sich nicht lesen" allein hat niemandem geholfen.
   */
  function why(j, txt) {
    if (j.stop_reason === 'max_tokens') {
      return 'Die Antwort wurde abgeschnitten (max_tokens) und blieb unvollständig.';
    }
    if (j.stop_reason === 'refusal') return 'Das Modell hat die Antwort verweigert.';
    const head = String(txt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return head
      ? `Unerwartete Antwort: „${head}…"`
      : `Die Antwort enthielt keine Abschnitte (stop_reason: ${j.stop_reason || 'unbekannt'}).`;
  }

  /** Abschnitte säubern — aus dem Werkzeug wie aus dem Fliesstext. */
  function shape(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map(x => ({ title: String((x && x.title) || '').trim(),
                   lines: (Array.isArray(x && x.lines) ? x.lines : [])
                     .map(l => String(l).trim()).filter(Boolean) }))
      .filter(x => x.title && x.lines.length);
  }

  /** JSON aus der Antwort holen — auch wenn doch ein Code-Zaun drumherum steht. */
  function parse(txt) {
    let s = String(txt || '').trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
    if (fence) s = fence[1].trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) return [];
    try {
      return shape(JSON.parse(s.slice(a, b + 1)).sections);
    } catch { return []; }
  }

  /** Auf 24 Zeilen kürzen — die Grenze ist die Grenze, auch wenn das Modell schwatzt. */
  function clamp(sections) {
    let left = MAX_LINES;
    const out = [];
    for (const s of sections) {
      if (left <= 0) break;
      const lines = s.lines.slice(0, left);
      left -= lines.length;
      out.push({ title: s.title, lines });
    }
    return out;
  }

  return { available, analyse, brief, parse, clamp, MODELS, modelName, MAX_LINES };
})();
