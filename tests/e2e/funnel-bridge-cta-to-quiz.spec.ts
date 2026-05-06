/**
 * Bridge-Test: Lead-Magnet-CTA → quiz_started
 * --------------------------------------------------------------
 * Simuliert echten Browser-Flow:
 *   1. Visit AEVO SEO Page (rendert QuizCTA mit quiz_slug=aevo-pruefungsreife)
 *   2. Liest sessionStorage `ef_session_id`
 *   3. Klickt CTA → landet auf /quiz/aevo-pruefungsreife
 *   4. Klickt erste Antwort → triggert QUIZ_STARTED
 *   5. Verifiziert via REST (anon read durch admin_*-RPC NICHT nötig — wir
 *      nutzen service-role wenn vorhanden), dass in derselben session_id:
 *        - quiz_cta_clicked Event mit quiz_slug+source_page existiert
 *        - quiz_started      Event mit identischem quiz_slug existiert
 *
 * Skip-Pfad: ohne SERVICE_KEY oder HELPER_TOKEN überspringt der Test
 * die DB-Verifikation und prüft nur den Browser-Pfad (Click → URL).
 */
import { test, expect } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL } from './helpers/service-key';

const SOURCE_PATH = '/aevo-pruefungsvorbereitung';
const QUIZ_SLUG = 'aevo-pruefungsreife';

async function fetchEvents(sessionId: string, eventType: string) {
  if (!SERVICE_KEY || !SUPABASE_URL) return null;
  const url = new URL(`${SUPABASE_URL}/rest/v1/conversion_events`);
  url.searchParams.set('select', 'event_type,metadata,session_id,page_path,created_at');
  url.searchParams.set('session_id', `eq.${sessionId}`);
  url.searchParams.set('event_type', `eq.${eventType}`);
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '5');
  const r = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`conversion_events GET ${r.status}: ${await r.text()}`);
  return (await r.json()) as Array<{
    event_type: string;
    metadata: Record<string, any>;
    session_id: string;
    page_path: string | null;
  }>;
}

async function pollEvent(sessionId: string, eventType: string, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await fetchEvents(sessionId, eventType);
    if (rows && rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 750));
  }
  return null;
}

test.describe('Funnel Bridge · Lead-Magnet-CTA → quiz_started', () => {
  test('CTA-Klick erzeugt quiz_started in derselben Session mit identischem quiz_slug', async ({ page }) => {
    // 1. Visit SEO page
    await page.goto(SOURCE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500); // mount + impression fire

    // 2. Capture session_id from sessionStorage (set by getSessionId())
    const sessionId = await page.evaluate(() => window.sessionStorage.getItem('ef_session_id'));
    expect(sessionId, 'ef_session_id must be set on page mount').toBeTruthy();

    // 3. Click first visible Quiz-CTA (data-heatmap-id="quiz_cta")
    const cta = page.locator('[data-heatmap-id="quiz_cta"]').first();
    await expect(cta, 'QuizCTA must render on AEVO landing').toBeVisible({ timeout: 5000 });
    await cta.click();

    // 4. Verify navigation to /quiz/<slug>
    await page.waitForURL(new RegExp(`/quiz/${QUIZ_SLUG}`), { timeout: 10_000 });

    // 5. Click first answer to trigger QUIZ_STARTED
    //    LeadQuizRunner emits on first handleAnswer().
    const firstOption = page.locator('button[data-option-key], button:has-text("a)"), [role="radio"]').first();
    // Fallback: any button inside the question card
    const answerButton = (await firstOption.count())
      ? firstOption
      : page.locator('main button, [role="main"] button').filter({ hasNotText: /zurück|skip/i }).first();
    await expect(answerButton).toBeVisible({ timeout: 8000 });
    await answerButton.click();
    await page.waitForTimeout(800); // event dispatch

    // 6. DB-side verification (skip if no service key)
    test.skip(!SERVICE_KEY, 'No SERVICE_KEY — skipping DB verification (browser flow OK)');

    const ctaEvt = await pollEvent(sessionId!, 'quiz_cta_clicked');
    expect(ctaEvt, 'quiz_cta_clicked must be persisted').not.toBeNull();
    expect(ctaEvt!.metadata?.quiz_slug).toBe(QUIZ_SLUG);
    expect(ctaEvt!.metadata?.source_page || ctaEvt!.page_path).toContain(SOURCE_PATH);

    const quizEvt = await pollEvent(sessionId!, 'quiz_started');
    expect(quizEvt, 'quiz_started must be persisted in same session').not.toBeNull();
    expect(quizEvt!.metadata?.quiz_slug).toBe(QUIZ_SLUG);
    expect(quizEvt!.session_id).toBe(sessionId);
  });
});
