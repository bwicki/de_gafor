/* GaforCast — Symbolsatz „Stufenband", heller Grund.
 *
 * Vier Balken in den GAFOR-Stufenfarben (Charlie · Oscar · Delta · Mike) in
 * den kräftigen Werten des hellen Farbsatzes, auf hellem Grund mit feinem
 * Rand — ohne den Rand verschwände die Kachel auf einer weissen Tableiste.
 *
 * Die Jetzt-Marke aus dem Zeitband der App ist bewusst **nicht** dabei: unter
 * 32 px wird sie zum Fleck, und die vier Balken tragen allein.
 *
 *   node make.mjs        erzeugt alle Dateien in diesem Ordner
 */
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';

const GROUND = '#f2f4f7';                       // heller Grund
const RIM    = '#d7dce3';                       // Rand, damit die Kachel auf Weiss steht
const BARS   = ['#1d8a56', '#6d9418', '#b96f14', '#d1631a'];   // C · O · D · M

const W = 12, GAP = 4, H = 52;
const X0 = (100 - (4 * W + 3 * GAP)) / 2;       // = 20
const Y0 = (100 - H) / 2;                       // = 24

const bars = BARS.map((c, i) =>
  `  <rect x="${X0 + i * (W + GAP)}" y="${Y0}" width="${W}" height="${H}" rx="3.4" fill="${c}"/>`
).join('\n');

/**
 * rounded : Kachel mit runden Ecken, aussen durchsichtig (Favicon, PWA „any")
 * bleed   : randlos gefüllt, Inhalt verkleinert (maskable, Apple-Touch)
 */
function svg({ rounded = true, scale = 1 } = {}) {
  const open = scale === 1 ? '<g>'
    : `<g transform="translate(50,50) scale(${scale}) translate(-50,-50)">`;
  const ground = rounded
    ? `  <rect width="100" height="100" rx="22" fill="${GROUND}"/>\n` +
      `  <rect x=".75" y=".75" width="98.5" height="98.5" rx="21.4" fill="none" stroke="${RIM}" stroke-width="1.5"/>`
    : `  <rect width="100" height="100" fill="${GROUND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="GaforCast">
${ground}
${open}
${bars}
  </g>
</svg>`;
}

const MASTER = svg();
await writeFile('favicon.svg', MASTER + '\n');
await writeFile('_maskable.svg', svg({ rounded: false, scale: 0.8 }) + '\n');
await writeFile('_apple.svg', svg({ rounded: false, scale: 0.86 }) + '\n');

const b = await chromium.launch();
async function png(src, size, out, transparent) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0;background:${transparent ? 'transparent' : GROUND}}
    svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await p.screenshot({ path: out, omitBackground: !!transparent });
  await p.close();
}
await png(MASTER, 192, 'icon-192.png', true);
await png(MASTER, 512, 'icon-512.png', true);
await png(await readFile('_maskable.svg', 'utf8'), 512, 'icon-maskable-512.png', false);
await png(await readFile('_apple.svg', 'utf8'), 180, 'apple-touch-icon.png', false);
for (const s of [16, 32, 48]) await png(MASTER, s, `_ico-${s}.png`, true);
await b.close();
console.log('fertig');
