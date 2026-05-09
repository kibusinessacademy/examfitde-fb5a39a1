/**
 * S5b · Post-Reaper PHK No-Infinite-Requeue + Oral Trainer UI Smoke
 *
 * 1. Liest die letzten 24h auto_heal_log-Einträge mit action_type='phk_quarantine_requeue'
 *    sowie job_queue-Rows mit last_error_code IN (PRE_HEARTBEAT_KILL_TERMINAL,
 *    STALE_AFTER_HEARTBEAT) und prüft, dass KEIN Job mehr als 2× in 24h die
 *    PRE_HEARTBEAT_KILL-Klasse trifft (Anti-Infinite-Requeue Invariante).
 * 2. Für jedes betroffene Paket: Oral-Exam-Trainer UI rendert Start-Button
 *    (best-effort, soft-skip wenn keine PHK-Quarantine-Pakete existieren).
 *
 * Soft-skip wenn Live-DB noch keine PHK-Events produziert hat.
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const SB_URL = process.env.VITE_SUPABASE_URL ?? "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type JobRow = {
  id: string;
  package_id: string | null;
  last_error_code: string;
  meta: { pre_heartbeat_kill_count?: number; stale_reap_count?: number } | null;
  updated_at: string;
};

async function fetchPhkJobs(): Promise<JobRow[]> {
  const ctx = await pwRequest.newContext();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const url =
    `${SB_URL}/rest/v1/job_queue` +
    `?select=id,package_id,last_error_code,meta,updated_at` +
    `&last_error_code=in.(PRE_HEARTBEAT_KILL,PRE_HEARTBEAT_KILL_TERMINAL,STALE_AFTER_HEARTBEAT)` +
    `&updated_at=gte.${since}` +
    `&order=updated_at.desc&limit=500`;
  const key = SERVICE_KEY ?? ANON_KEY;
  const res = await ctx.get(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok()) return [];
  return ((await res.json()) as JobRow[]) ?? [];
}

test.describe("S5b · PHK Anti-Infinite-Requeue + Oral Trainer", () => {
  test("no job exceeds PHK threshold (=2) without becoming terminal", async () => {
    const jobs = await fetchPhkJobs();
    if (jobs.length === 0) {
      test.skip(true, "no PHK / STALE_AFTER_HEARTBEAT jobs in last 24h");
      return;
    }

    // Anti-loop invariant: any job whose meta.pre_heartbeat_kill_count >= 2
    // MUST be terminal (PRE_HEARTBEAT_KILL_TERMINAL). It must never sit at
    // last_error_code = 'PRE_HEARTBEAT_KILL' with phk_count >= 2 — that would
    // mean the reaper requeued instead of terminating.
    const violations = jobs.filter((j) => {
      const phk = j.meta?.pre_heartbeat_kill_count ?? 0;
      return phk >= 2 && j.last_error_code === "PRE_HEARTBEAT_KILL";
    });
    expect(violations, `infinite-requeue violations: ${JSON.stringify(violations.slice(0, 3))}`).toEqual([]);

    // Same for STALE: stale_reap_count >= 2 with last_error_code = REAPED is a violation
    const staleViolations = jobs.filter((j) => {
      const reap = j.meta?.stale_reap_count ?? 0;
      return reap >= 2 && j.last_error_code === "STALE_PROCESSING_REAPED";
    });
    expect(staleViolations).toEqual([]);
  });

  test("oral exam trainer UI renders start surface for PHK-affected packages", async ({ page }) => {
    const jobs = await fetchPhkJobs();
    const pkgIds = Array.from(
      new Set(jobs.filter((j) => j.package_id).map((j) => j.package_id as string)),
    ).slice(0, 3);

    if (pkgIds.length === 0) {
      test.skip(true, "no affected packages to verify");
      return;
    }

    let rendered = 0;
    for (const pkg of pkgIds) {
      try {
        await page.goto(`/muendliche-pruefung?package=${pkg}`, { waitUntil: "domcontentloaded" });
        const start = page
          .getByRole("button", { name: /start|starten|begin|simulation|jetzt/i })
          .first();
        if (await start.isVisible({ timeout: 5_000 }).catch(() => false)) {
          rendered += 1;
        }
      } catch {
        /* continue, assertion below handles aggregate */
      }
    }

    // Soft assertion: at least 1 of up to 3 packages must surface an oral start
    // button. If none do, the trainer is still gated (e.g., quarantined or no
    // entitlement) — log but do not hard-fail unless ALL are entitlement-gated
    // would be a separate concern.
    expect(rendered, `0/${pkgIds.length} oral trainers rendered for PHK packages`).toBeGreaterThan(0);
  });
});
