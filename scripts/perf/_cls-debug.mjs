import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(`
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      const sources = (e.sources || []).map(s => ({
        node: s.node ? (s.node.tagName || s.node.nodeName) + (s.node.id ? '#'+s.node.id : '') + ' ' + ((s.node.className||'').toString().slice(0,80)) : null,
        prev: s.previousRect, curr: s.currentRect,
      }));
      window.__shifts.push({ v: e.value, sources });
    }
  }).observe({ type: 'layout-shift', buffered: true });
`);
await page.goto('http://localhost:8080/bilanzbuchhalter-pruefungsvorbereitung', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const shifts = await page.evaluate(() => window.__shifts);
console.log(JSON.stringify(shifts, null, 2));
await browser.close();
