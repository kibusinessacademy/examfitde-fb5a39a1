/**
 * SEO Cluster Smoke + Regression
 * ------------------------------
 * Prüft alle 8 neuen Pilot-Cluster-Seiten:
 *  - HTTP 200 (kein 404/500)
 *  - keine Console-Errors (Lazy-Route / Import-Failures)
 *  - exakt 1 <h1>
 *  - canonical-Tag passt zur Route
 *  - Quiz-CTA sichtbar (Hero/Mid/Footer)
 *  - Screenshot pro Route (Baseline für visuelle Regression)
 *
 * Run:  npx playwright test tests/e2e/seo-cluster-smoke.spec.ts --project=smoke
 */
import { test, expect } from "@playwright/test";

const NEW_ROUTES = [
  "/bilanzbuchhalter-pruefungsvorbereitung",
  "/bilanzbuchhalter-buchhaltung",
  "/bilanzbuchhalter-jahresabschluss",
  "/bilanzbuchhalter-steuern",
  "/fachinformatiker-ae-pruefungsvorbereitung",
  "/fiae-anwendungsentwicklung",
  "/fiae-wiso",
  "/fiae-projektarbeit",
];

for (const route of NEW_ROUTES) {
  test(`SEO cluster page loads cleanly: ${route}`, async ({ page, baseURL }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const txt = msg.text();
        // Ignoriere bekannte third-party / dev-noise
        if (/favicon|sentry|gtag|preview/i.test(txt)) return;
        consoleErrors.push(`console: ${txt}`);
      }
    });

    const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(resp, `no response for ${route}`).not.toBeNull();
    expect(resp!.status(), `bad status for ${route}`).toBeLessThan(400);

    // genau 1 <h1>
    await expect(page.locator("h1")).toHaveCount(1);

    // canonical existiert + endet auf route
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical, `missing canonical for ${route}`).toBeTruthy();
    expect(canonical!.endsWith(route), `canonical mismatch: ${canonical} !endsWith ${route}`).toBeTruthy();

    // Quiz-CTA muss sichtbar sein (mindestens 1 Treffer)
    const ctaCount = await page.getByRole("link", { name: /selbsttest|quiz|jetzt starten/i }).count();
    expect(ctaCount, `no quiz CTA on ${route}`).toBeGreaterThan(0);

    // Lazy-Import-Fehler erkennen
    expect(
      consoleErrors.filter((e) => /Failed to fetch dynamically imported module|Loading chunk \d+ failed/i.test(e)),
      `lazy chunk load error on ${route}`
    ).toEqual([]);

    // Screenshot (Baseline / Regression-Hinweis)
    await page.screenshot({
      path: `test-results/seo-cluster${route.replace(/\//g, "_")}.png`,
      fullPage: true,
    });

    // Generic console errors → soft assertion (Logging only)
    if (consoleErrors.length) {
      console.warn(`[${route}] console errors:\n  - ` + consoleErrors.join("\n  - "));
    }
  });
}
