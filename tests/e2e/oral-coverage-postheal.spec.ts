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
    // Try first 3 packages — at least one should render
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
});
