import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

// ═══════════════════════════════════════════════════════════
// ROOT CAUSE DIAGNOSIS
// ═══════════════════════════════════════════════════════════
interface RootCause {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  recommended_action: string;
  action_type: string;
  risk: "low" | "medium" | "high";
  auto_healable: boolean;
  params?: Record<string, unknown>;
}

const ERROR_HINTS: Record<string, { title: string; description: string; action: string; action_type: string }> = {
  exam_pool_coverage_gap: {
    title: "Prüfungsfragen-Pool unvollständig",
    description: "Nicht genügend Prüfungsfragen für alle Lernfelder generiert.",
    action: "Auto-Gap-Closer starten (Modus: exam_only)",
    action_type: "run_auto_gap_closer",
  },
  handbook_chapters_insufficient: {
    title: "Handbuch-Kapitel fehlen",
    description: "Das Handbuch hat weniger Kapitel als erforderlich.",
    action: "Handbuch-Generator starten (chapters_and_sections)",
    action_type: "run_handbook_generator",
  },
  missing_minichecks: {
    title: "MiniChecks fehlen",
    description: "Lektionen ohne zugehörige Verständnisprüfungen.",
    action: "MiniCheck-Generator starten",
    action_type: "run_minicheck_generator",
  },
  exam_questions_below_target: {
    title: "Prüfungsfragen unter Zielwert",
    description: "Gesamtzahl der Prüfungsfragen liegt unter dem Minimum.",
    action: "Auto-Gap-Closer starten",
    action_type: "run_auto_gap_closer",
  },
  oral_exam_missing: {
    title: "Mündliche Prüfung fehlt",
    description: "Keine Szenarien für die mündliche Prüfung vorhanden.",
    action: "Oral-Exam-Generator starten",
    action_type: "run_oral_exam_generator",
  },
  INVALID_COMPETENCY_REF: {
    title: "Ungültige Kompetenz-Referenz",
    description: "Lektionen verweisen auf nicht existierende Kompetenzen.",
    action: "Lessons neu generieren",
    action_type: "regenerate_lessons",
  },
  LLM_TIMEOUT: {
    title: "KI-Timeout",
    description: "Die KI-Generierung hat zu lange gedauert.",
    action: "Job erneut starten mit erhöhtem Timeout",
    action_type: "retry_with_timeout",
  },
};

// ═══════════════════════════════════════════════════════════
// AUTO-HEAL POLICIES
// ═══════════════════════════════════════════════════════════

interface HealAction {
  action_type: string;
  target_id: string;
  target_type: string;
  params: Record<string, unknown>;
  description: string;
}

async function diagnoseAndPlan(
  sb: ReturnType<typeof createClient>,
  mode: "full" | "package",
  packageId?: string,
): Promise<{ root_causes: RootCause[]; heal_actions: HealAction[]; health: any }> {
  const root_causes: RootCause[] = [];
  const heal_actions: HealAction[] = [];

  // 1) Get system health summary
  const { data: health } = await sb.from("ops_health_summary" as any).select("*").single();

  // 2) Diagnose failed jobs
  if (health?.failed_1h > 0) {
    const { data: failedJobs } = await sb.from("job_queue")
      .select("id, job_type, last_error, attempts, max_attempts, payload, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20);

    const failedByType: Record<string, number> = {};
    for (const j of failedJobs || []) {
      failedByType[j.job_type] = (failedByType[j.job_type] || 0) + 1;
    }

    for (const [jobType, count] of Object.entries(failedByType)) {
      const retryable = (failedJobs || []).filter(
        (j: any) => j.job_type === jobType && j.attempts < j.max_attempts,
      );
      if (retryable.length > 0) {
        root_causes.push({
          code: `failed_jobs_${jobType}`,
          severity: count > 5 ? "critical" : "warning",
          title: `${count}x ${jobType} fehlgeschlagen`,
          description: `${retryable.length} Jobs können erneut versucht werden.`,
          recommended_action: "Fehlgeschlagene Jobs retrien",
          action_type: "retry_failed_jobs",
          risk: "low",
          auto_healable: true,
          params: { job_type: jobType, limit: Math.min(retryable.length, 5) },
        });
        heal_actions.push({
          action_type: "retry_failed_jobs",
          target_id: jobType,
          target_type: "job",
          params: { job_type: jobType, limit: 5 },
          description: `${retryable.length} ${jobType} Jobs retrien`,
        });
      }
    }
  }

  // 3) Diagnose stuck jobs
  if (health?.stuck_jobs > 0) {
    root_causes.push({
      code: "stuck_jobs",
      severity: "critical",
      title: `${health.stuck_jobs} Jobs hängen fest`,
      description: "Jobs im Processing-Status seit >30 Min. Möglicher Worker-Crash.",
      recommended_action: "Stuck Jobs zurücksetzen",
      action_type: "reset_stuck_jobs",
      risk: "low",
      auto_healable: true,
    });
    heal_actions.push({
      action_type: "reset_stuck_jobs",
      target_id: "all",
      target_type: "job",
      params: {},
      description: `${health.stuck_jobs} stuck Jobs zurücksetzen`,
    });
  }

  // 4) Diagnose blocked packages
  const { data: blocked } = await sb.from("ops_blocked_packages" as any)
    .select("*")
    .limit(10);

  for (const pkg of blocked || []) {
    // Parse integrity report for root causes
    const report = pkg.integrity_report;
    if (report?.issues) {
      for (const issue of report.issues) {
        const hint = ERROR_HINTS[issue.type] || null;
        if (hint) {
          root_causes.push({
            code: issue.type,
            severity: issue.severity === "critical" ? "critical" : "warning",
            title: `${pkg.title}: ${hint.title}`,
            description: hint.description,
            recommended_action: hint.action,
            action_type: hint.action_type,
            risk: "low",
            auto_healable: hint.action_type === "run_auto_gap_closer",
            params: { package_id: pkg.package_id },
          });
        }
      }
    }

    // If package is failed with no autofix running
    if (pkg.status === "failed" && pkg.autofix_status !== "running") {
      const score = pkg.integrity_score || 0;
      if (score < 85) {
        heal_actions.push({
          action_type: "run_auto_gap_closer",
          target_id: pkg.package_id,
          target_type: "package",
          params: {
            package_id: pkg.package_id,
            target_score: 90,
            max_rounds: 3,
            budget_eur: 5,
          },
          description: `Auto-Gap-Closer für ${pkg.title || pkg.package_id.substring(0, 8)} (Score: ${score})`,
        });
      }
    }
  }

  // 5) Budget guard
  if (health?.daily_autofix_cost >= 12) {
    root_causes.push({
      code: "budget_high",
      severity: health.daily_autofix_cost >= 15 ? "critical" : "warning",
      title: `Budget bei €${health.daily_autofix_cost.toFixed(2)}/€15`,
      description: "Tägliches Auto-Heal-Budget nähert sich dem Limit.",
      recommended_action: health.daily_autofix_cost >= 15
        ? "Auto-Heal pausieren"
        : "Batch-Größen reduzieren",
      action_type: health.daily_autofix_cost >= 15 ? "freeze_auto_heal" : "reduce_batch_size",
      risk: "medium",
      auto_healable: false,
    });
  }

  // 6) Frozen autofix runs
  if (health?.frozen_autofix > 0) {
    root_causes.push({
      code: "frozen_autofix",
      severity: "warning",
      title: `${health.frozen_autofix} Autofix-Runs eingefroren`,
      description: "Regression-Freeze oder Budget-Stop aktiv. Manuelle Prüfung nötig.",
      recommended_action: "Diagnostik-Report öffnen",
      action_type: "open_diagnostic",
      risk: "medium",
      auto_healable: false,
    });
  }

  return { root_causes, heal_actions, health };
}

// ═══════════════════════════════════════════════════════════
// AUTO-HEAL EXECUTOR
// ═══════════════════════════════════════════════════════════

async function executeHealAction(
  sb: ReturnType<typeof createClient>,
  action: HealAction,
  triggerSource: string,
): Promise<{ success: boolean; detail: string }> {
  const startMs = Date.now();

  try {
    switch (action.action_type) {
      case "retry_failed_jobs": {
        const jobType = action.params.job_type as string;
        const limit = (action.params.limit as number) || 5;
        const { data, error } = await sb.from("job_queue")
          .update({ status: "pending", attempts: 0, run_after: new Date().toISOString() } as any)
          .eq("status", "failed")
          .eq("job_type", jobType)
          .limit(limit)
          .select("id");
        if (error) throw error;
        const count = data?.length || 0;
        await logHealAction(sb, action, triggerSource, "success", `${count} Jobs zurückgesetzt`, Date.now() - startMs);
        return { success: true, detail: `${count} ${jobType} Jobs retried` };
      }

      case "reset_stuck_jobs": {
        const cutoff = new Date(Date.now() - 1800_000).toISOString();
        const { data, error } = await sb.from("job_queue")
          .update({ status: "pending", attempts: 0, locked_at: null, locked_by: null } as any)
          .eq("status", "processing")
          .lt("locked_at", cutoff)
          .select("id");
        if (error) throw error;
        const count = data?.length || 0;
        await logHealAction(sb, action, triggerSource, "success", `${count} stuck Jobs zurückgesetzt`, Date.now() - startMs);
        return { success: true, detail: `${count} stuck jobs reset` };
      }

      case "run_auto_gap_closer": {
        const pkgId = action.params.package_id as string;
        // Get package details to find curriculum_id and course_id
        const { data: pkg } = await sb.from("course_packages")
          .select("id, curriculum_id, course_id")
          .eq("id", pkgId)
          .single();
        if (!pkg) {
          await logHealAction(sb, action, triggerSource, "failed", "Package not found", Date.now() - startMs);
          return { success: false, detail: "Package not found" };
        }

        // Check if already running
        const { data: existing } = await sb.from("autofix_runs")
          .select("id")
          .eq("package_id", pkgId)
          .eq("status", "running")
          .maybeSingle();
        if (existing) {
          await logHealAction(sb, action, triggerSource, "skipped", "Autofix already running", Date.now() - startMs);
          return { success: true, detail: "Autofix already running" };
        }

        // Enqueue auto-gap-close job
        await sb.from("job_queue").insert({
          job_type: "auto_gap_close",
          status: "pending",
          payload: {
            package_id: pkgId,
            course_id: pkg.course_id,
            curriculum_id: pkg.curriculum_id,
            target_score: (action.params.target_score as number) || 90,
            max_rounds: (action.params.max_rounds as number) || 3,
            budget_eur: (action.params.budget_eur as number) || 5,
          },
          max_attempts: 1,
        });
        await logHealAction(sb, action, triggerSource, "success", "Auto-Gap-Closer enqueued", Date.now() - startMs);
        return { success: true, detail: "Auto-Gap-Closer enqueued" };
      }

      default:
        await logHealAction(sb, action, triggerSource, "skipped", `Unknown action: ${action.action_type}`, Date.now() - startMs);
        return { success: false, detail: `Unknown action: ${action.action_type}` };
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await logHealAction(sb, action, triggerSource, "failed", msg, Date.now() - startMs);
    return { success: false, detail: msg };
  }
}

async function logHealAction(
  sb: ReturnType<typeof createClient>,
  action: HealAction,
  triggerSource: string,
  status: string,
  detail: string,
  durationMs: number,
) {
  await sb.from("auto_heal_log").insert({
    trigger_source: triggerSource,
    action_type: action.action_type,
    target_id: action.target_id,
    target_type: action.target_type,
    input_params: action.params,
    result_status: status,
    result_detail: detail,
    duration_ms: durationMs,
  });
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (req.method === "GET" || (req.method === "POST" && req.headers.get("content-type")?.includes("json"))) {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body.mode || "diagnose"; // 'diagnose' | 'heal' | 'heal_single'
    const triggerSource = body.trigger_source || "manual";
    const packageId = body.package_id;

    try {
      // Diagnose
      const diagnosis = await diagnoseAndPlan(sb, packageId ? "package" : "full", packageId);

      if (mode === "diagnose") {
        return json({
          ok: true,
          health_score: diagnosis.health?.health_score,
          traffic_light: diagnosis.health?.traffic_light,
          auto_heal_allowed: diagnosis.health?.auto_heal_allowed,
          root_causes: diagnosis.root_causes,
          recommended_actions: diagnosis.heal_actions,
          stats: {
            failed_1h: diagnosis.health?.failed_1h,
            stuck_jobs: diagnosis.health?.stuck_jobs,
            failed_packages: diagnosis.health?.failed_packages,
            daily_cost: diagnosis.health?.daily_autofix_cost,
            active_autofix: diagnosis.health?.active_autofix,
            frozen_autofix: diagnosis.health?.frozen_autofix,
          },
        }, 200, origin);
      }

      if (mode === "heal_single") {
        // Execute a specific action
        const actionType = body.action_type;
        const action = diagnosis.heal_actions.find((a) => a.action_type === actionType);
        if (!action) {
          return json({ error: "No matching action found", available: diagnosis.heal_actions.map((a) => a.action_type) }, 404, origin);
        }
        // Merge any user-provided params
        if (body.params) Object.assign(action.params, body.params);
        const result = await executeHealAction(sb, action, triggerSource);
        return json({ ok: result.success, action: action.action_type, detail: result.detail }, 200, origin);
      }

      if (mode === "heal") {
        // Execute all auto-healable actions
        if (!diagnosis.health?.auto_heal_allowed) {
          return json({
            ok: false,
            reason: "Auto-heal not allowed (stuck jobs, too many failures, or budget exceeded)",
            health: diagnosis.health,
          }, 200, origin);
        }

        const results: Array<{ action: string; success: boolean; detail: string }> = [];
        for (const action of diagnosis.heal_actions) {
          const rc = diagnosis.root_causes.find((r) => r.action_type === action.action_type);
          if (rc && !rc.auto_healable) continue;

          const result = await executeHealAction(sb, action, triggerSource);
          results.push({ action: action.action_type, ...result });
        }

        return json({
          ok: true,
          mode: "heal",
          actions_executed: results.length,
          results,
          health_score: diagnosis.health?.health_score,
        }, 200, origin);
      }

      return json({ error: "Invalid mode. Use: diagnose, heal, heal_single" }, 400, origin);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      console.error("[OpsAutoHealer] Error:", msg);
      return json({ error: msg }, 500, origin);
    }
  }

  return json({ error: "POST with JSON body required" }, 405, origin);
});
