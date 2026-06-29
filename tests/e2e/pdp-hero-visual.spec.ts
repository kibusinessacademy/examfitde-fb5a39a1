/**
 * Visual regression: PDP-Hero (ProductHeroSection / CertificationSEOPage).
 *
 * Vergleicht den Hero-Bereich pixelgenau über mehrere Viewports hinweg
 * und prüft zusätzlich die Font-Fallback-Variante (Webfonts blockiert),
 * um Metric-Drift (size-adjust / ascent-override) sichtbar zu machen.
 *
 * Baseline aktualisieren:
 *   bunx playwright test tests/e2e/pdp-hero-visual.spec.ts --update-snapshots
 *
 * Snapshots: tests/e2e/__screenshots__/pdp-hero-visual/…
 */
import { test, expect, type Page } from "@playwright/test";

const ROUTES = [
  { name: "fiae",            path: "/fiae-pruefungsvorbereitung" },
  { name: "bilanzbuchhalter", path: "/bilanzbuchhalter-pruefungsvorbereitung" },
  { name: "ihk",             path: "/ihk-pruefungsvorbereitung" },
  { name: "aevo",            path: "/aevo-pruefungsvorbereitung" },
] as const;

const VIEWPORTS = [
  { name: "mobile",  width: 390,  height: 844  },
  { name: "tablet",  width: 768,  height: 1024 },
  { name: "desktop", width: 1366, height: 900  },
] as const;

const STABILIZE_CSS = `
  *,*::before,*::after{
    animation:none!important;
    transition:none!important;
    caret-color:transparent!important;
    scroll-behavior:auto!important;
  }
  /* Hide late-rendering chrome that can flake snapshots */
  [data-testid="cookie-banner"],[data-testid="toast-region"]{display:none!important}
`;

async function blockWebfonts(page: Page) {
  // Force the metric-override fallback stack to render; surfaces font-swap CLS
  // and any geometric drift the size-adjust/ascent-override bridge misses.
  await page.route("**/*.{woff,woff2,ttf,otf}", (route) => route.abort());
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
}

async function prepareHero(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: STABILIZE_CSS });

  const hero = page.getByTestId("pdp-hero").first();
  await hero.waitFor({ state: "visible", timeout: 15_000 });

  // Wait for hero image to actually be decoded — prevents racey diffs.
  await hero
    .locator("img")
    .first()
    .evaluate((img: HTMLImageElement) =>
      img.complete ? Promise.resolve() : img.decode().catch(() => undefined)
    )
    .catch(() => {});

  return hero;
}

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`pdp-hero visual: ${route.name} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const hero = await prepareHero(page, route.path);
      await expect(hero).toHaveScreenshot(
        `${route.name}-${vp.name}.png`,
        { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" }
      );
    });

    test(`pdp-hero font-fallback: ${route.name} @ ${vp.name}`, async ({ page }) => {
      await blockWebfonts(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const hero = await prepareHero(page, route.path);

      // Snapshot under fallback fonts — drift in size-adjust / ascent-override
      // shows up as layout deltas above the maxDiffPixelRatio threshold.
      await expect(hero).toHaveScreenshot(
        `${route.name}-${vp.name}-fallback.png`,
        { maxDiffPixelRatio: 0.03, animations: "disabled", caret: "hide" }
      );
    });
  }
}
