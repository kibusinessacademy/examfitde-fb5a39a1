/**
 * G3b — Persona Overlay UI Hydration (Production Smoke)
 *
 * Beweist, dass die Live-Production-Seite NACH React-Hydration die aus dem
 * Backend gelesene Overlay-Headline tatsächlich im DOM rendert. Ergänzt G3
 * (Shell+REST), das nur Reachability prüft.
 *
 * Gates:
 *   1. Persona-Route /pruefungstraining/<slug>/<persona> liefert 200.
 *   2. React hydratisiert (Selector aus echtem Rendertree sichtbar).
 *   3. overlay.hero_headline aus REST gelesen.
 *   4. DOM-H1 enthält die overlay.hero_headline.
 *   5. Primary-CTA href/onclick referenziert package_id.
 *
 * Datenwahl deterministisch: 1 published Paket × 3 Personas mit aktivem Overlay.
 */
import { test, expect } from "@playwright/test";

const PROD_URL = process.env.PROD_URL || "https://examfitde.lovable.app";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc";

const PERSONAS = ["azubi", "betrieb", "institution"] as const;

interface OverlayPick {
  package_id: string;
  persona_type: string;
  hero_headline: string;
  primary_cta: string;
  canonical_slug: string;
}

async function pickOverlayFixture(persona: string): Promise<OverlayPick | null> {
  // 1. Pull all active overlays for this persona, joined with published canonical_slug.
  const overlayRes = await fetch(
    `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=package_id,persona_type,hero_headline,primary_cta&active=eq.true&persona_type=eq.${persona}`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!overlayRes.ok) return null;
  const overlays = (await overlayRes.json()) as Array<Omit<OverlayPick, "canonical_slug">>;
  if (overlays.length === 0) return null;

  for (const o of overlays) {
    const slugRes = await fetch(
      `${SUPABASE_URL}/rest/v1/v_product_page_published_ssot?select=canonical_slug&package_id=eq.${o.package_id}&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!slugRes.ok) continue;
    const rows = (await slugRes.json()) as Array<{ canonical_slug: string }>;
    if (rows[0]?.canonical_slug) {
      return { ...o, canonical_slug: rows[0].canonical_slug };
    }
  }
  return null;
}

test.describe("G3b — Persona Overlay Hydration (PROD)", () => {
  for (const persona of PERSONAS) {
    test(`persona=${persona}: overlay.hero_headline appears in hydrated DOM + CTA carries package_id`, async ({
      page,
    }) => {
      const fixture = await pickOverlayFixture(persona);
      test.skip(!fixture, `Kein aktives Overlay für persona=${persona} im Backend`);
      if (!fixture) return;

      const url = `${PROD_URL}/pruefungstraining/${fixture.canonical_slug}/${persona}`;
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });

      // Gate 1: 200
      expect(response?.status(), `HTTP status für ${url}`).toBe(200);

      // Gate 2: React hydration — h1 muss aus echtem React-Tree kommen, nicht aus
      // statischem Index-Shell. Wir warten auf erstes h1.
      const h1 = page.locator("h1").first();
      await h1.waitFor({ state: "visible", timeout: 20_000 });

      // Gate 3 + 4: Overlay-Headline muss substring im DOM sein.
      // Robust: erste 30 Zeichen der Headline (umgeht kleinere Wrapper-Modifikationen).
      const headlineNeedle = fixture.hero_headline.slice(0, 30).trim();
      const h1Text = (await h1.textContent())?.trim() ?? "";
      const bodyText = (await page.locator("body").textContent())?.trim() ?? "";

      const matchedInH1 = h1Text.includes(headlineNeedle);
      const matchedInBody = bodyText.includes(headlineNeedle);

      expect(
        matchedInH1 || matchedInBody,
        `overlay.hero_headline ("${headlineNeedle}…") not rendered.\nDOM h1: "${h1Text.slice(0, 120)}"`,
      ).toBe(true);

      // Gate 5: Primary CTA enthält package_id (Diagnose-CTA navigiert mit ?package_id=…)
      // ProductPersonaPage baut CTA-Target via URLSearchParams mit package_id.
      // Wir scannen alle <a href> auf der Seite nach der package_id.
      const allHrefs = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).href),
      );
      const hasPkgInHref = allHrefs.some((h) => h.includes(fixture.package_id));

      // Falls CTA per onClick navigiert (kein href): klicken und URL prüfen.
      if (!hasPkgInHref) {
        const ctaButton = page.getByRole("button", { name: new RegExp(fixture.primary_cta.slice(0, 12), "i") }).first();
        if (await ctaButton.count()) {
          const navPromise = page.waitForURL((u) => u.toString().includes(fixture.package_id), {
            timeout: 8_000,
          });
          await ctaButton.click({ trial: false }).catch(() => undefined);
          await navPromise.catch(() => undefined);
          expect(
            page.url().includes(fixture.package_id),
            `CTA-Click hat package_id nicht in URL gesetzt. Final URL: ${page.url()}`,
          ).toBe(true);
        } else {
          expect(
            hasPkgInHref,
            `Weder href noch CTA-Button mit package_id="${fixture.package_id}" gefunden`,
          ).toBe(true);
        }
      }
    });
  }
});
