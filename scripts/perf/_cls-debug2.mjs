import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8080/fiae-pruefungsvorbereitung', { waitUntil: 'networkidle' });
const meta = await page.evaluate(() => {
  const slot = document.querySelector('[data-testid="pdp-content-slot"]');
  const article = slot?.querySelector('article');
  const imgs = slot?.querySelectorAll('img') || [];
  return {
    slotH: slot?.getBoundingClientRect().height,
    hasContent: !!article,
    imgCount: imgs.length,
    imgsWithoutDims: Array.from(imgs).filter(i => !i.getAttribute('width') || !i.getAttribute('height')).length,
    contentLen: article?.innerHTML.length,
  };
});
console.log(JSON.stringify(meta, null, 2));
await browser.close();
