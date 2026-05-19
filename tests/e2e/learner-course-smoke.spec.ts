/**
 * Learner E2E smoke for published courses (uses public readiness RPC).
 *
 * In CI default we sample N courses (PR speed). Set
 *   LEARNER_SMOKE_FULL=1
 * to walk all 143+ ready courses (nightly).
 *
 * Per-course assertions:
 *   1. /course/:id loads (no 404, status < 400)
 *   2. exactly 1 <h1>, course title visible
 *   3. at least one Modul/Lektion text present
 *   4. no JS pageerror
 *
 * Auth-gated lesson playback is covered by `uat.azubi-flow.spec.ts`.
 * This suite stays anonymous to keep it fast and stable.
 */
import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const FULL = process.env.LEARNER_SMOKE_FULL === "1";
const SAMPLE = Number(process.env.LEARNER_SMOKE_SAMPLE || "8");

type Ready = { id: string; title: string; modules: number; lessons: number; is_ready: boolean };

async function fetchReady(): Promise<Ready[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("⏭️  learner-course-smoke skipped: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing");
    return [];
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_learner_course_readiness`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!r.ok) throw new Error(`readiness RPC ${r.status}: ${await r.text()}`);
  return (await r.json()) as Ready[];
}

const allReady = (await fetchReady()).filter((c) => c.is_ready);
const sampled = FULL ? allReady : pickSample(allReady, SAMPLE);

function pickSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  // deterministic spread sample (no randomness → stable CI)
  const step = Math.floor(arr.length / n);
  return Array.from({ length: n }, (_, i) => arr[i * step]);
}

test.describe(`Learner smoke (${sampled.length}/${allReady.length} courses, full=${FULL})`, () => {
  test.skip(sampled.length === 0, "no public learner-course readiness data available");

  for (const course of sampled) {
    test(`course renders: ${course.title}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const t = msg.text();
        if (/favicon|sentry|gtag|preview|ResizeObserver|chrome-extension/i.test(t)) return;
        errors.push(`console: ${t}`);
      });

      const resp = await page.goto(`/course/${course.id}`, { waitUntil: "domcontentloaded" });
      expect(resp, `no response for /course/${course.id}`).toBeTruthy();
      expect(resp!.status(), `bad status for /course/${course.id}`).toBeLessThan(400);

      await page.waitForLoadState("networkidle").catch(() => {});

      // Exactly 1 H1 (a11y baseline)
      await expect(page.locator("h1")).toHaveCount(1);

      // Course title shown somewhere on page
      await expect(page.getByText(course.title, { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      });

      // Modul/Lektion vocabulary visible (anchor that ModuleLessonList rendered)
      await expect(page.getByText(/modul|lektion/i).first()).toBeVisible();

      // Lazy-chunk failures specifically
      const lazy = errors.filter((e) =>
        /Failed to fetch dynamically imported module|Loading chunk \d+ failed/i.test(e),
      );
      expect(lazy, `lazy chunk failure on /course/${course.id}`).toEqual([]);

      // Hard pageerror = fail; soft console errors = log
      const hard = errors.filter((e) => e.startsWith("pageerror:"));
      expect(hard, `JS pageerror on /course/${course.id}`).toEqual([]);

      if (errors.length) {
        console.warn(`[/course/${course.id}] soft console errors:\n  - ` + errors.join("\n  - "));
      }
    });
  }
});
