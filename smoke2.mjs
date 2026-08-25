import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1:8099') ? r.continue() : r.abort());
await page.goto('http://127.0.0.1:8099/#53.55,9.99,9', { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => ({
  num: document.getElementById('areaNum').textContent,
  area: document.getElementById('areaName').textContent,
  sub: document.getElementById('areaSub').textContent,
  badge: document.getElementById('areaState').textContent,
  age: document.getElementById('gaforAge').textContent,
  gafor: document.getElementById('gaforBody').innerText.slice(0, 300),
})));
await page.screenshot({ path: '/home/claude/shot-gafor.png', fullPage: false });
await browser.close();
