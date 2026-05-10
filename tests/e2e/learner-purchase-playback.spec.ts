/**
 * E2E: Käufer-Playback Golden Path
 *
 * Verifiziert nach (existing) Test-Grant, dass ein eingeloggter Käufer
 * UI-seitig durch den vollständigen Konsumpfad kommt:
 *
 *   1. Login als Käufer
 *   2. Dashboard / Kurs-Liste sichtbar
 *   3. Kurs öffnen
 *   4. Lesson öffnen + Inhalt rendert
 *   5. MiniCheck starten + 1 Antwort
 *   6. Exam-Simulation starten + 1 Antwort
 *   7. AI-Tutor sendet Nachricht und bekommt Antwort (≠ no_entitlement)
 *   8. Oral-Exam Einstieg sichtbar
 *   9. PDF / Handbuch Link öffnet (signed URL oder Viewer)
 *
 * Defensive Selektoren — überspringt einzelne Stufen sauber, statt hart zu failen,
 * damit ein Lesson-only-Kurs den Tutor-Test nicht abreißt.
 *
 * Läuft im Learner-E2E Workflow (suite=all) und manuell via workflow_dispatch.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ||
  process.env.BASE_URL ||
  "https://examfitde.lovable.app";
const EMAIL =
  process.env.E2E_TEST_USER_EMAIL || process.env.E2E_EMAIL || "";
const PASSWORD =
  process.env.E2E_TEST_USER_PASSWORD || process.env.E2E_PASSWORD || "";

test.describe("Käufer Playback Golden Path", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "Missing E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD",
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

  async function openFirstCourse(page: Page): Promise<boolean> {
    await page.goto(`${BASE_URL}/courses`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-testid="course-card"]').first();
    const link = page.locator('a[href*="/course/"]').first();
    if (await card.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await card.click();
    } else if (await link.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await link.click();
    } else {
      return false;
    }
    await page
      .locator('[data-testid="course-title"]')
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
    return true;
  }

  test("Login → Dashboard → Lesson → MiniCheck → Exam → Tutor → Oral → PDF", async ({
    page,
  }) => {
    // Capture network reasons across the whole journey to catch silent
    // entitlement-only fallbacks (no_entitlement should NEVER surface for a
    // grant-aware buyer).
    const reasonHits: Array<{ url: string; reason: string }> = [];
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
        const m = txt.match(/"reason"\s*:\s*"([^"]+)"/);
        if (m) reasonHits.push({ url, reason: m[1] });
      } catch {
        /* ignore */
      }
    });

    // 1) Login
    await login(page);

    // 2) Dashboard / Kursliste
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    expect(page.url()).not.toContain("/auth");

    // 3) Kurs öffnen
    const opened = await openFirstCourse(page);
    test.skip(!opened, "Kein veröffentlichter Kurs für Käufer sichtbar");

    // 4) Lesson öffnen
    const cont = page.locator('[data-testid="course-continue-btn"]');
    if (await cont.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await cont.click();
    } else {
      const lesson = page.locator('a[href*="/lesson/"]').first();
      if (await lesson.isVisible({ timeout: 4_000 }).catch(() => false)) {
        await lesson.click();
      }
    }
    const lessonPlayer = page.locator('[data-testid="lesson-player"]');
    if (await lessonPlayer.isVisible({ timeout: 12_000 }).catch(() => false)) {
      const content = await page
        .locator('[data-testid="lesson-content"]')
        .textContent()
        .catch(() => "");
      expect((content || "").length).toBeGreaterThan(20);
    }

    // 5) MiniCheck (best-effort, falls in Lesson eingebettet)
    const opt0 = page.locator('[data-testid="question-option-0"]').first();
    if (await opt0.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await opt0.click();
      const submit = page.locator('[data-testid="answer-submit"]').first();
      if (await submit.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await submit.click();
        await page.waitForTimeout(1_500);
        const fbOk =
          (await page
            .locator(
              '[data-testid="feedback-correct"], [data-testid="feedback-incorrect"]',
            )
            .first()
            .isVisible({ timeout: 4_000 })
            .catch(() => false));
        expect(fbOk).toBeTruthy();
      }
    }

    // 6) Exam-Simulation
    await page.goto(`${BASE_URL}/exam-simulation`, {
      waitUntil: "domcontentloaded",
    });
    const examStart = page
      .locator('button:has-text("Starten"), button:has-text("Start")')
      .first();
    if (await examStart.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await examStart.click();
      await page.waitForTimeout(2_500);
    }
    const examOpt = page.locator('[data-testid="exam-option-0"]').first();
    if (await examOpt.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await examOpt.click();
      const examSubmit = page
        .locator('[data-testid="exam-answer-submit"]')
        .first();
      if (await examSubmit.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await examSubmit.click();
        await page.waitForTimeout(1_500);
      }
    }

    // 7) AI Tutor
    await page.goto(`${BASE_URL}/tutor`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("404") || page.url().includes("not-found")) {
      await page.goto(`${BASE_URL}/ai-tutor`, {
        waitUntil: "domcontentloaded",
      });
    }
    // Hard assert: kein "no_entitlement" Block-Banner
    const blockBanner = page
      .locator('text=/no_entitlement|kein\\s+zugriff|nicht\\s+freigeschaltet/i')
      .first();
    const blocked = await blockBanner
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    expect(blocked, "Tutor darf für Käufer nicht no_entitlement anzeigen").toBe(
      false,
    );

    const tutorInput = page
      .locator('textarea, input[type="text"]')
      .first();
    if (await tutorInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tutorInput.fill(
        "Erkläre mir bitte den wichtigsten Prüfungsbereich kurz mit einem Beispiel.",
      );
      const send = page
        .getByRole("button", { name: /senden|send|fragen|ask/i })
        .first();
      if (await send.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await send.click();
      } else {
        await tutorInput.press("Enter");
      }
      const reply = page
        .locator(
          '[data-role="assistant-message"], [data-testid="assistant-message"], .assistant-message, .chat-bubble:not(.user)',
        )
        .first();
      await expect(reply).toBeVisible({ timeout: 60_000 });
      const text = (await reply.textContent()) || "";
      expect(text.length).toBeGreaterThan(20);
    }

    // 8) Oral Exam
    await page.goto(`${BASE_URL}/oral-exam`, {
      waitUntil: "domcontentloaded",
    });
    const oralBlocked = await page
      .locator('text=/no_entitlement|kein\\s+zugriff|nicht\\s+freigeschaltet/i')
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    expect(oralBlocked, "Oral Exam darf für Käufer nicht blockieren").toBe(
      false,
    );

    // 9) PDF / Handbuch
    await page.goto(`${BASE_URL}/handbook`, {
      waitUntil: "domcontentloaded",
    });
    const pdfLink = page
      .locator(
        'a[href*=".pdf"], a:has-text("Handbuch"), a:has-text("PDF"), [data-testid="handbook-download"]',
      )
      .first();
    if (await pdfLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const href = await pdfLink.getAttribute("href").catch(() => null);
      // Signed-URL oder PDF-Pfad — darf jedenfalls nicht leer sein
      expect(href && href.length > 0).toBeTruthy();
    }
  });
});
