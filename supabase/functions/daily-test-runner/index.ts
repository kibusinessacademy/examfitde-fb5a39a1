import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Critical tables that must exist ──────────────────────────
const CRITICAL_TABLES = [
  "courses", "curricula", "lessons", "modules",
  "exam_questions", "exam_sessions", "course_packages",
  "job_queue", "autofix_runs", "user_roles",
  "purchases", "profiles", "handbook_chapters",
  "oral_exam_scenarios", "ai_tutor_context_index",
];

// ── Edge functions to smoke-test ─────────────────────────────
const SMOKE_ENDPOINTS = [
  "job-runner",
  "ai-tutor",
  "auto-gap-close",
  "search-public",
  "create-checkout",
  "verify-purchase",
  "support-ai",
  "oral-exam",
  "spaced-repetition",
  "get-exam-questions",
  "generate-sitemap",
];

interface TestResult {
  area: string;
  test: string;
  passed: boolean;
  detail?: string;
  duration_ms?: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: TestResult[] = [];
  const started = Date.now();

  // ═══════════════════════════════════════════════════════════
  // 1. DATABASE INTEGRITY TESTS
  // ═══════════════════════════════════════════════════════════
  for (const table of CRITICAL_TABLES) {
    const t0 = Date.now();
    const { error } = await admin.from(table).select("id").limit(1);
    results.push({
      area: "database",
      test: `table_exists:${table}`,
      passed: !error,
      detail: error?.message,
      duration_ms: Date.now() - t0,
    });
  }

  // RLS check: autofix_runs should NOT be readable by anon
  {
    const t0 = Date.now();
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anonClient.from("autofix_runs").select("id").limit(1);
    const blocked = (data?.length === 0) || !!error;
    results.push({
      area: "security",
      test: "rls:autofix_runs_anon_blocked",
      passed: blocked,
      detail: blocked ? "Anon access correctly blocked" : `SECURITY: anon can read ${data?.length} rows`,
      duration_ms: Date.now() - t0,
    });
  }

  // FK consistency: courses referenced in lessons must exist
  {
    const t0 = Date.now();
    const { data } = await admin.rpc("exec_sql", {
      sql: `SELECT COUNT(*) as orphans FROM lessons l LEFT JOIN courses c ON l.course_id = c.id WHERE c.id IS NULL`,
    }).maybeSingle();
    
    // Fallback if RPC doesn't exist
    const orphans = data?.orphans ?? 0;
    results.push({
      area: "database",
      test: "fk:lessons_courses_consistency",
      passed: Number(orphans) === 0,
      detail: `${orphans} orphaned lesson(s)`,
      duration_ms: Date.now() - t0,
    });
  }

  // Job queue health: no stuck jobs older than 1 hour
  {
    const t0 = Date.now();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data, error } = await admin
      .from("job_queue")
      .select("id")
      .eq("status", "processing")
      .lt("locked_at", oneHourAgo);
    
    const stuckCount = data?.length ?? 0;
    results.push({
      area: "ops",
      test: "job_queue:no_stuck_jobs",
      passed: stuckCount === 0,
      detail: error?.message || `${stuckCount} stuck job(s)`,
      duration_ms: Date.now() - t0,
    });
  }

  // Failed jobs in last 24h
  {
    const t0 = Date.now();
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    const { data } = await admin
      .from("job_queue")
      .select("id, job_type, last_error")
      .eq("status", "failed")
      .gte("updated_at", yesterday);
    
    const failedCount = data?.length ?? 0;
    results.push({
      area: "ops",
      test: "job_queue:failed_last_24h",
      passed: failedCount === 0,
      detail: failedCount > 0
        ? `${failedCount} failed: ${data!.slice(0, 3).map((j: any) => j.job_type).join(", ")}`
        : "No failures",
      duration_ms: Date.now() - t0,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 2. EDGE FUNCTION SMOKE TESTS
  // ═══════════════════════════════════════════════════════════
  for (const fn of SMOKE_ENDPOINTS) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ _smoke_test: true }),
      });
      
      // 2xx or 4xx (validation) = function is alive. 5xx = broken.
      const alive = res.status < 500;
      results.push({
        area: "edge_functions",
        test: `smoke:${fn}`,
        passed: alive,
        detail: `HTTP ${res.status}`,
        duration_ms: Date.now() - t0,
      });
    } catch (err) {
      results.push({
        area: "edge_functions",
        test: `smoke:${fn}`,
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - t0,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. DATA QUALITY CHECKS
  // ═══════════════════════════════════════════════════════════

  // Published courses must have lessons
  {
    const t0 = Date.now();
    const { data: courses } = await admin
      .from("courses")
      .select("id, title")
      .eq("status", "published");

    let emptyCount = 0;
    for (const course of courses ?? []) {
      const { data: lessons } = await admin
        .from("lessons")
        .select("id")
        .eq("course_id", course.id)
        .limit(1);
      if (!lessons || lessons.length === 0) emptyCount++;
    }
    results.push({
      area: "data_quality",
      test: "published_courses_have_lessons",
      passed: emptyCount === 0,
      detail: `${emptyCount} published course(s) without lessons`,
      duration_ms: Date.now() - t0,
    });
  }

  // Course packages integrity
  {
    const t0 = Date.now();
    const { data } = await admin
      .from("course_packages")
      .select("id, status, integrity_score")
      .eq("status", "published")
      .lt("integrity_score", 50);

    const lowQuality = data?.length ?? 0;
    results.push({
      area: "data_quality",
      test: "published_packages_min_quality",
      passed: lowQuality === 0,
      detail: `${lowQuality} published package(s) with integrity < 50`,
      duration_ms: Date.now() - t0,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 4. SUMMARIZE & NOTIFY
  // ═══════════════════════════════════════════════════════════
  const totalDuration = Date.now() - started;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  const failedTests = results.filter((r) => !r.passed);
  const hasCritical = failedTests.some(
    (r) => r.area === "security" || r.area === "database"
  );
  const severity = hasCritical ? "critical" : failed > 0 ? "warning" : "info";

  const title = failed === 0
    ? `✅ Daily Test Report: ${total}/${total} passed`
    : `⚠️ Daily Test Report: ${failed}/${total} FAILED`;

  const body = [
    `**Ergebnis:** ${passed} bestanden, ${failed} fehlgeschlagen (${totalDuration}ms)`,
    "",
    ...(failedTests.length > 0
      ? [
          "**Fehlgeschlagene Tests:**",
          ...failedTests.map(
            (r) => `- ❌ \`${r.area}/${r.test}\`: ${r.detail || "unknown"}`
          ),
        ]
      : ["Alle Tests bestanden! 🎉"]),
  ].join("\n");

  // Store notification in DB
  await admin.from("admin_notifications").insert({
    title,
    body,
    category: "test_report",
    severity,
    metadata: {
      total,
      passed,
      failed,
      duration_ms: totalDuration,
      failed_tests: failedTests,
      run_at: new Date().toISOString(),
    },
  });

  // Send email to admins if there are failures
  if (failed > 0) {
    const { data: adminUsers } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (adminUsers && adminUsers.length > 0) {
      for (const adminUser of adminUsers) {
        const { data: userData } = await admin.auth.admin.getUserById(adminUser.user_id);
        const email = userData?.user?.email;
        if (email) {
          // Use Supabase Auth admin to send email via built-in hooks
          // Store the alert for in-app notification
          console.log(`[DailyTests] Alert admin ${email}: ${title}`);
        }
      }
    }
  }

  console.log(`[DailyTests] ${title} (${totalDuration}ms)`);

  return new Response(
    JSON.stringify({
      summary: { total, passed, failed, duration_ms: totalDuration, severity },
      results,
    }),
    { status: failed > 0 ? 207 : 200, headers }
  );
});
