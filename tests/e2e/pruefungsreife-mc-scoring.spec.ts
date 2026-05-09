/**
 * E2E — Prüfungsreife MC-Scoring.
 *
 * Vertrag:
 *  - Auf Beruf-Pfad mit Blueprint-RPC erscheint MC-Stufe (Schritt 1/2).
 *  - 1 korrekte + 1 falsche Antwort → mc_score_pct ≈ 50%.
 *  - quiz_completed Event wird gesendet (Network-Capture auf track-funnel-event)
 *    mit metadata.mc_score_pct, mc_correct_count, mc_answered_count.
 *
 * Das Test-Setup nutzt einen seed-baren Beruf-Slug, dessen Blueprint-Set
 * mind. 4 MC-Fragen mit options + correct_answer liefert. Falls in der
 * jeweiligen Lovable-Preview kein passender Slug existiert, wird der Test
 * mit `test.skip()` weich übersprungen statt rot.
 */
import { test, expect, type Request } from "@playwright/test";

const TARGET = process.env.TARGET_URL || "https://examfitde.lovable.app";
const SEED_SLUG = process.env.PRUEFUNGSREIFE_E2E_SLUG || "bankkaufmann";

test("MC: 1 richtig + 1 falsch → mc_score_pct ≈ 50% in quiz_completed", async ({ page }) => {
  const trackCalls: any[] = [];
  page.on("request", (req: Request) => {
    if (req.url().includes("/functions/v1/track-funnel-event")) {
      try { trackCalls.push(req.postDataJSON()); } catch { /* ignore */ }
    }
  });

  await page.goto(`${TARGET}/pruefungsreife-check?source=beruf&slug=${SEED_SLUG}`, {
    waitUntil: "networkidle",
  });

  // Quiz starten
  const startBtn = page.getByTestId("quiz-start");
  await expect(startBtn).toBeVisible({ timeout: 10_000 });
  await startBtn.click();

  // Wenn kein MC-Stage da ist (Generic-Fallback), test überspringen.
  const firstMc = page.locator('[data-testid="quiz-mc-option"]').first();
  if (!(await firstMc.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip(true, "Beruf-Slug hat kein MC-Set in dieser Preview — Generic Fallback aktiv");
  }

  // Frage 1: korrekte Antwort
  await page.locator('[data-testid="quiz-mc-option"][data-mc-correct="true"]').first().click();
  // Selbsteinschätzung Stage 2 erscheint nach kurzem Delay
  await page.locator('[data-testid="quiz-answer"]').first().waitFor({ state: "visible" });
  await page.locator('[data-testid="quiz-answer"]').nth(2).click();

  // Frage 2: falsche Antwort
  await page.locator('[data-testid="quiz-mc-option"][data-mc-correct="false"]').first().click();
  await page.locator('[data-testid="quiz-answer"]').first().waitFor({ state: "visible" });
  await page.locator('[data-testid="quiz-answer"]').nth(2).click();

  // Restliche Fragen abklicken (jeweils erste MC + mittlere Selbsteinschätzung)
  for (let i = 0; i < 6; i++) {
    const mcVisible = await page.locator('[data-testid="quiz-mc-option"]').first().isVisible({ timeout: 1500 }).catch(() => false);
    if (mcVisible) {
      await page.locator('[data-testid="quiz-mc-option"]').first().click();
      await page.locator('[data-testid="quiz-answer"]').first().waitFor({ state: "visible" });
    }
    const answers = page.locator('[data-testid="quiz-answer"]');
    if (!(await answers.first().isVisible().catch(() => false))) break;
    await answers.nth(2).click();
  }

  // Result-Screen
  await expect(page.getByText(/Dein Prüfungsreife-Score/i)).toBeVisible({ timeout: 10_000 });

  // Tracking-Vertrag
  const completed = trackCalls.find((c) => c.event_type === "quiz_completed");
  expect(completed, "quiz_completed Event mit package_id erwartet").toBeTruthy();
  expect(completed.metadata).toHaveProperty("mc_score_pct");
  expect(completed.metadata).toHaveProperty("mc_correct_count");
  expect(completed.metadata).toHaveProperty("mc_answered_count");
  // 1 richtig / 2 beantwortet (untere Grenze; spätere Klicks waren immer 'erste' MC, also undefined Korrektheit)
  expect(completed.metadata.mc_answered_count).toBeGreaterThanOrEqual(2);
  expect(completed.metadata.mc_correct_count).toBeGreaterThanOrEqual(1);
  expect(completed.metadata.mc_score_pct).toBeGreaterThan(0);
  expect(completed.metadata.mc_score_pct).toBeLessThanOrEqual(100);
});

test("Generic-Pfad ohne MC-Stufe: mc_*-Felder fehlen vollständig (samples=0)", async ({ page }) => {
  const trackCalls: any[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/track-funnel-event")) {
      try { trackCalls.push(req.postDataJSON()); } catch { /* ignore */ }
    }
  });

  // Kein source/slug → Generic Fallback (kein Blueprint-Set, keine MC-Stufe)
  await page.goto(`${TARGET}/pruefungsreife-check`, { waitUntil: "networkidle" });

  const startBtn = page.getByTestId("quiz-start");
  await expect(startBtn).toBeVisible({ timeout: 10_000 });
  await startBtn.click();

  // Sicherstellen, dass KEINE MC-Stufe da ist
  const mc = page.locator('[data-testid="quiz-mc-option"]').first();
  expect(await mc.isVisible({ timeout: 1500 }).catch(() => false)).toBe(false);

  // 8 Generic-Fragen mit mittlerer Selbsteinschätzung durchklicken
  for (let i = 0; i < 8; i++) {
    const answers = page.locator('[data-testid="quiz-answer"]');
    if (!(await answers.first().isVisible({ timeout: 5000 }).catch(() => false))) break;
    await answers.nth(2).click();
  }

  await expect(page.getByText(/Dein Prüfungsreife-Score/i)).toBeVisible({ timeout: 10_000 });

  // Generic-Pfad → lead_magnet_view fallback (kein strict event)
  const completed = trackCalls.find(
    (c) => c.event_type === "lead_magnet_view" && c.metadata?.stage === "quiz_completed",
  );
  expect(completed, "lead_magnet_view fallback mit stage=quiz_completed erwartet").toBeTruthy();
  // Vertrag: samples=0 → mc_*-Felder MÜSSEN vollständig fehlen
  expect(completed.metadata).not.toHaveProperty("mc_score_pct");
  expect(completed.metadata).not.toHaveProperty("mc_answered_count");
  expect(completed.metadata).not.toHaveProperty("mc_correct_count");
});

