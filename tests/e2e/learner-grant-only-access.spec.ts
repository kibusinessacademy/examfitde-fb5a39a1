/**
 * E2E: Grant-only Käufer (kein Entitlement)
 *
 * Beweist Layer 2 des Access-SSOT (Loop-C):
 * Ein User mit aktivem `learner_course_grants`, aber OHNE entitlement-Zeile,
 * darf Tutor und Storage/PDF trotzdem voll nutzen. Wenn dieser Test failt,
 * ist `can_access_product` / `tutor_access_check` / `has_storage_entitlement`
 * wieder entitlement-only geworden (P0-Regression).
 *
 * Erwartete Test-Identität:
 *   E2E_GRANT_ONLY_EMAIL / E2E_GRANT_ONLY_PASSWORD
 * Setup: synthetisches paid order → Trigger erzeugt Grant; Entitlement-Zeile
 * (source_ref=order_id) wird vor Test entfernt.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ||
  process.env.BASE_URL ||
  "https://examfitde.lovable.app";
const EMAIL = process.env.E2E_GRANT_ONLY_EMAIL || "";
const PASSWORD = process.env.E2E_GRANT_ONLY_PASSWORD || "";

test.describe("Grant-only Access (no entitlement)", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "Missing E2E_GRANT_ONLY_EMAIL / E2E_GRANT_ONLY_PASSWORD",
  );

  async function login(page: Page) {
    await page.goto(`${BASE_URL}/auth`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/auth"), {
      timeout: 20_000,
    });
  }

  test("Tutor + PDF müssen für Grant-only Nutzer offen bleiben", async ({
    page,
  }) => {
    const reasonHits: Array<{ url: string; reason: string; allowed?: unknown }> = [];
    page.on("response", async (resp) => {
      const url = resp.url();
      if (
        !/tutor_access_check|check_product_access|has_storage_entitlement|can_access_product|storage-signed-url|ai-tutor/i.test(
          url,
        )
      )
        return;
      try {
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json")) return;
        const body = await resp.json().catch(() => null);
        const txt = JSON.stringify(body || {});
        const reasonMatch = txt.match(/"reason"\s*:\s*"([^"]+)"/);
        const allowedMatch = txt.match(/"allowed"\s*:\s*(true|false)/);
        if (reasonMatch || allowedMatch) {
          reasonHits.push({
            url,
            reason: reasonMatch?.[1] ?? "",
            allowed: allowedMatch ? allowedMatch[1] === "true" : undefined,
          });
        }
      } catch {
        /* ignore */
      }
    });

    await login(page);

    // Tutor
    await page.goto(`${BASE_URL}/tutor`, { waitUntil: "domcontentloaded" });
    const tutorBlock = await page
      .locator('text=/no_entitlement|kein\\s+zugriff|nicht\\s+freigeschaltet/i')
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    expect(
      tutorBlock,
      "Grant-only: Tutor darf nicht blockieren (Path D / D2)",
    ).toBe(false);

    // Optional Tutor-Roundtrip
    const input = page.locator('textarea, input[type="text"]').first();
    if (await input.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await input.fill("Test: Grant-only Zugriff ok?");
      await input.press("Enter");
      const reply = page
        .locator(
          '[data-role="assistant-message"], [data-testid="assistant-message"], .assistant-message',
        )
        .first();
      await expect(reply).toBeVisible({ timeout: 60_000 });
    }

    // PDF
    await page.goto(`${BASE_URL}/handbook`, {
      waitUntil: "domcontentloaded",
    });
    const pdfLink = page
      .locator(
        'a[href*=".pdf"], a[href*="signed"], [data-testid="handbook-download"]',
      )
      .first();
    if (await pdfLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const href = await pdfLink.getAttribute("href").catch(() => null);
      expect(href && href.length > 0).toBeTruthy();
      if (href && /^https?:\/\//.test(href)) {
        const resp = await page.request.get(href);
        expect(resp.status(), "Grant-only: PDF signed URL muss 200 liefern").toBe(
          200,
        );
      }
    }

    // Hard-Assert: keine no_entitlement reason in irgendeiner gefangenen
    // Access-RPC-Antwort, und kein allowed=false bei Tutor/Storage
    const noEnt = reasonHits.filter((h) => h.reason === "no_entitlement");
    expect(
      noEnt,
      `Grant-only Path: 'no_entitlement' reason aufgetreten — Access-RPC ist wieder entitlement-only. Treffer: ${JSON.stringify(noEnt)}`,
    ).toHaveLength(0);

    const denied = reasonHits.filter(
      (h) => h.allowed === false && /tutor|storage|product/i.test(h.url),
    );
    expect(
      denied,
      `Grant-only Path: allowed=false in Access-RPC. Treffer: ${JSON.stringify(denied)}`,
    ).toHaveLength(0);
  });
});
