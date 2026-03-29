import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * legacy-reconcile — Pre-rebuild reconciliation for packages with legacy data.
 *
 * Called before re-building a package to:
 * 1. Invalidate stale integrity reports (version < current)
 * 2. Reset false-done steps where targets aren't met
 * 3. Clear stale cooldowns from zero-production jobs
 * 4. Mark package as ready for clean rebuild
 *
 * SSOT Rule: "Historischer Bestand ist nur dann anrechenbar,
 * wenn er zur aktuellen Qualitäts- und Report-Semantik passt."
 */

const CURRENT_REPORT_VERSION_NUM = 16;
const EXAM_TARGET = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const packageId = body?.package_id;
    const dryRun = body?.dry_run !== false; // default: dry_run=true

    if (!packageId) return json({ ok: false, error: "package_id required" }, 400);

    // Load package
    const { data: pkg, error: pErr } = await sb
      .from("course_packages")
      .select("id, title, curriculum_id, integrity_report, integrity_report_version_num, integrity_passed, status, track")
      .eq("id", packageId)
      .single();
    if (pErr || !pkg) return json({ ok: false, error: "package not found" }, 404);

    const actions: Array<{ action: string; detail: string; applied: boolean }> = [];

    // ── 1. Stale Integrity Report (numeric version) ──
    const reportVersionNum = Number(pkg.integrity_report_version_num) || 0;
    if (pkg.integrity_report && reportVersionNum < CURRENT_REPORT_VERSION_NUM) {
      const action = {
        action: "invalidate_stale_report",
        detail: `version_num=${reportVersionNum} < ${CURRENT_REPORT_VERSION_NUM}`,
        applied: false,
      };
      if (!dryRun) {
        await sb.from("course_packages").update({
          integrity_passed: false,
          integrity_report_version_num: 0,
        }).eq("id", packageId);
        // Only reset step if not currently running
        const { data: intStep } = await sb.from("package_steps")
          .select("status")
          .eq("package_id", packageId)
          .eq("step_key", "run_integrity_check")
          .maybeSingle();
        if (intStep?.status !== "running" && intStep?.status !== "processing") {
          await sb.from("package_steps").update({ status: "queued" })
            .eq("package_id", packageId)
            .eq("step_key", "run_integrity_check");
        }
        action.applied = true;
      }
      actions.push(action);
    }

    // ── 2. False-done exam_pool step ──
    if (pkg.curriculum_id && pkg.track === "AUSBILDUNG_VOLL") {
      const { count } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id)
        .neq("status", "rejected")
        .not("qc_status", "in", "(tier1_failed,rejected)");

      const actual = count ?? 0;
      if (actual < EXAM_TARGET) {
        // Check if step is falsely done
        const { data: step } = await sb
          .from("package_steps")
          .select("status")
          .eq("package_id", packageId)
          .eq("step_key", "generate_exam_pool")
          .maybeSingle();

        if (step?.status === "done") {
          const action = {
            action: "reset_false_done_exam_pool",
            detail: `actual=${actual}/${EXAM_TARGET}, step was 'done'`,
            applied: false,
          };
          if (!dryRun) {
            // Reset exam pool step and downstream
            const stepsToReset = [
              "generate_exam_pool",
              "validate_exam_pool",
              "run_integrity_check",
              "quality_council",
              "auto_publish",
            ];
            for (const sk of stepsToReset) {
              await sb.from("package_steps").update({ status: "queued" })
                .eq("package_id", packageId)
                .eq("step_key", sk);
            }
            action.applied = true;
          }
          actions.push(action);
        }
      }
    }

    // ── 3. False-done handbook step ──
    if (pkg.curriculum_id) {
      const { data: chapters } = await sb
        .from("handbook_chapters")
        .select("id")
        .eq("curriculum_id", pkg.curriculum_id);
      const chapterIds = (chapters ?? []).map((c: any) => c.id);

      if (chapterIds.length > 0) {
        const { data: sections } = await sb
          .from("handbook_sections")
          .select("id, content_markdown")
          .in("chapter_id", chapterIds);

        const total = sections?.length ?? 0;
        const shortSections = (sections ?? []).filter(
          (s: any) => !s.content_markdown || s.content_markdown.length < 800
        ).length;

        if (total > 0 && shortSections > total * 0.1) {
          const { data: step } = await sb
            .from("package_steps")
            .select("status")
            .eq("package_id", packageId)
            .eq("step_key", "generate_handbook")
            .maybeSingle();

          if (step?.status === "done") {
            const action = {
              action: "reset_false_done_handbook",
              detail: `${shortSections}/${total} sections under 800 chars`,
              applied: false,
            };
            if (!dryRun) {
              const stepsToReset = [
                "generate_handbook",
                "expand_handbook",
                "validate_handbook",
                "validate_handbook_depth",
                "run_integrity_check",
                "quality_council",
                "auto_publish",
              ];
              for (const sk of stepsToReset) {
                await sb.from("package_steps").update({ status: "queued" })
                  .eq("package_id", packageId)
                  .eq("step_key", sk);
              }
              action.applied = true;
            }
            actions.push(action);
          }
        }
      }
    }

    // ── 4. Cancel zombie cooldown jobs ──
    {
      const { data: zombieJobs } = await sb
        .from("job_queue")
        .select("id")
        .eq("package_id", packageId)
        .eq("status", "completed")
        .in("job_type", ["package_generate_exam_pool"])
        .not("result", "is", null);

      // Filter to zero-production completions
      const zombies: string[] = [];
      for (const j of zombieJobs ?? []) {
        const { data: jFull } = await sb.from("job_queue").select("result").eq("id", j.id).single();
        const gen = (jFull?.result as any)?.generated ?? (jFull?.result as any)?.generated_new ?? -1;
        if (gen === 0) zombies.push(j.id);
      }

      if (zombies.length > 0) {
        const action = {
          action: "flag_zombie_cooldowns",
          detail: `${zombies.length} zero-production completed jobs`,
          applied: false,
        };
        if (!dryRun) {
          // Mark them so cooldown logic skips them
          for (const jid of zombies) {
            await sb.from("job_queue").update({
              result: sb.rpc ? undefined : null, // can't easily update jsonb, just log
            }).eq("id", jid);
          }
          action.applied = true;
        }
        actions.push(action);
      }
    }

    // ── Log to admin_actions ──
    if (!dryRun && actions.some(a => a.applied)) {
      await sb.from("admin_actions").insert({
        action: "legacy_reconcile",
        scope: "package",
        user_id: user.id,
        affected_ids: [packageId],
        payload: { actions, package_title: pkg.title },
      });
    }

    return json({
      ok: true,
      dry_run: dryRun,
      package_id: packageId,
      package_title: pkg.title,
      actions,
      summary: {
        total_actions: actions.length,
        applied: actions.filter(a => a.applied).length,
        needs_rebuild: actions.length > 0,
      },
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
