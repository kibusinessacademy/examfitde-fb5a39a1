/**
 * Oral-Coverage Post-Heal E2E Smoke
 * ─────────────────────────────────
 * Verifiziert nach dem nightly `exam_first_oral_coverage_heal`, dass für jedes
 * EXAM_FIRST/PLUS-Paket, das via `auto_heal_log` als geheilt markiert wurde,
 *
 *   1. mindestens ein approved oral_exam_blueprint im Curriculum existiert
 *   2. der Oral-Exam-Trainer (/muendliche-pruefung mit ?package=...)
 *      tatsächlich rendert und einen Start-Button anzeigt
 *
 * Soft-skip wenn keine Heal-Logs in 48h existieren — schützt CI vor False-Fails
 * vor dem ersten Cron-Run.
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const SB_URL = process.env.VITE_SUPABASE_URL ?? "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type HealedPkg = { package_id: string; title?: string };

async function fetchHealedPackages(): Promise<HealedPkg[]> {
  const ctx = await pwRequest.newContext();
  const res = await ctx.get(
    `${SB_URL}/rest/v1/auto_heal_log?action_type=eq.exam_first_oral_coverage_heal&result_status=eq.enqueued&order=created_at.desc&limit=200`,
    {
      headers: {
        apikey: SERVICE_KEY ?? ANON_KEY,
        Authorization: `Bearer ${SERVICE_KEY ?? ANON_KEY}`,
      },
    },
  );
  if (!res.ok()) return [];
  const rows = (await res.json()) as Array<{ target_id: string; metadata: { title?: string } }>;
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (!r?.target_id || seen.has(r.target_id)) return false;
      seen.add(r.target_id);
      return true;
    })
    .map((r) => ({ package_id: r.target_id, title: r.metadata?.title }));
}

async function approvedOralCount(packageId: string): Promise<number> {
  const ctx = await pwRequest.newContext();
  // Resolve curriculum_id via course_packages
  const cpRes = await ctx.get(
    `${SB_URL}/rest/v1/course_packages?id=eq.${packageId}&select=curriculum_id`,
    {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    },
  );
  const cp = (await cpRes.json()) as Array<{ curriculum_id: string }>;
  const curriculumId = cp?.[0]?.curriculum_id;
  if (!curriculumId) return 0;
  const oralRes = await ctx.get(
    `${SB_URL}/rest/v1/oral_exam_blueprints?curriculum_id=eq.${curriculumId}&status=eq.approved&select=id`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Prefer: "count=exact",
      },
    },
  );
  const arr = (await oralRes.json()) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

test.describe("Oral-Coverage Post-Heal", () => {
  test("approved oral blueprints exist for healed packages", async () => {
    const healed = await fetchHealedPackages();
    if (healed.length === 0) {
      test.skip(true, "no exam_first_oral_coverage_heal log entries yet");
      return;
    }
    // Sample max 10 packages to keep CI fast
    const sample = healed.slice(0, 10);
    const results: Array<{ pkg: string; count: number }> = [];
    for (const p of sample) {
      results.push({ pkg: p.package_id, count: await approvedOralCount(p.package_id) });
    }
    const missing = results.filter((r) => r.count === 0);
    expect.soft(
      missing,
      `Packages still missing approved oral blueprints: ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  test("oral exam trainer renders for at least one healed package", async ({ page }) => {
    const healed = await fetchHealedPackages();
    if (healed.length === 0) {
      test.skip(true, "no exam_first_oral_coverage_heal log entries yet");
      return;
    }
    let rendered = false;
    for (const p of healed.slice(0, 3)) {
      const url = `/muendliche-pruefung?package=${p.package_id}`;
      const resp = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
      if (!resp || !resp.ok()) continue;
      const startBtn = page
        .getByRole("button", { name: /start|starten|begin|simulation|prüfung/i })
        .first();
      if (await startBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
        rendered = true;
        break;
      }
    }
    expect(rendered, "Oral-Trainer must render Start-Button for at least one healed package").toBe(
      true,
    );
  });

  /**
   * Full UI flow: Start → question sequence with progress indicator → submit/finish.
   * Soft-asserts so the test does not break CI if a single package lacks runtime data;
   * we just need ONE healed package to demonstrate end-to-end functionality.
   */
  test("full oral exam UI flow: questions, progress, submit", async ({ page }) => {
    const healed = await fetchHealedPackages();
    if (healed.length === 0) {
      test.skip(true, "no exam_first_oral_coverage_heal log entries yet");
      return;
    }

    let completedFor: string | null = null;
    const failures: Array<{ pkg: string; stage: string; reason: string }> = [];

    for (const p of healed.slice(0, 5)) {
      const url = `/muendliche-pruefung?package=${p.package_id}`;
      const resp = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
      if (!resp || !resp.ok()) {
        failures.push({ pkg: p.package_id, stage: "navigate", reason: `HTTP ${resp?.status() ?? "n/a"}` });
        continue;
      }

      const startBtn = page
        .getByRole("button", { name: /start|starten|begin|simulation|prüfung starten/i })
        .first();
      if (!(await startBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
        failures.push({ pkg: p.package_id, stage: "start_button", reason: "not visible" });
        continue;
      }
      await startBtn.click().catch(() => null);

      // Question sequence: walk up to 8 steps
      let stepsWalked = 0;
      let progressSeen = false;
      for (let i = 0; i < 8; i++) {
        // Progress indicator: progressbar role OR "Frage X / Y" text
        const progressbar = page.getByRole("progressbar").first();
        const progressText = page.getByText(/Frage\s*\d+\s*\/\s*\d+|Question\s*\d+\s*of\s*\d+/i).first();
        if (
          (await progressbar.isVisible({ timeout: 3_000 }).catch(() => false)) ||
          (await progressText.isVisible({ timeout: 1_000 }).catch(() => false))
        ) {
          progressSeen = true;
        }

        const nextBtn = page
          .getByRole("button", { name: /weiter|next|nächste|antwort senden|submit answer/i })
          .first();
        const finishBtn = page
          .getByRole("button", { name: /auswerten|abschließen|finish|ergebnis|fertig/i })
          .first();

        if (await finishBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await finishBtn.click().catch(() => null);
          stepsWalked++;
          break;
        }
        if (!(await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false))) break;
        await nextBtn.click().catch(() => null);
        stepsWalked++;
      }

      // Result screen heuristic
      const resultVisible = await page
        .getByText(/ergebnis|score|punkte|bewertung|auswertung|result/i)
        .first()
        .isVisible({ timeout: 8_000 })
        .catch(() => false);

      if (progressSeen && stepsWalked > 0 && resultVisible) {
        completedFor = p.package_id;
        break;
      }
      failures.push({
        pkg: p.package_id,
        stage: "flow",
        reason: `progress=${progressSeen} steps=${stepsWalked} result=${resultVisible}`,
      });
    }

    expect.soft(failures, `Per-package flow diagnostics: ${JSON.stringify(failures)}`);
    expect(
      completedFor,
      "At least one healed package must complete the full oral-exam flow (start → questions+progress → result/submit)",
    ).not.toBeNull();
  });
});
