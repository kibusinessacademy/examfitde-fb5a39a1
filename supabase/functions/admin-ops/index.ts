// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const cors = getCorsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Admin-only
  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ── retry_failed_jobs ──────────────────────────────────────
    if (action === "retry_failed_jobs") {
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          run_after: new Date().toISOString(),
          error: null,
        })
        .eq("status", "failed")
        .select("id");

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] retry_failed_jobs: ${data?.length ?? 0} jobs reset by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── recover_stuck_processing ───────────────────────────────
    if (action === "recover_stuck_processing") {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          run_after: new Date().toISOString(),
          error: "auto-recovered from stuck processing",
        })
        .eq("status", "processing")
        .lt("started_at", tenMinAgo)
        .select("id");

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] recover_stuck: ${data?.length ?? 0} jobs recovered by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── queue_health (read-only stats) ─────────────────────────
    if (action === "queue_health") {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

      const [pendingR, processingR, failedR, realFailedR, stuckR, completedR, cancelledR] = await Promise.all([
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
        // Real failures: actually executed (attempts > 0 OR has last_error)
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed").gt("attempts", 0),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing").lt("started_at", tenMinAgo),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "completed"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
      ]);

      return json({
        pending: pendingR.count ?? 0,
        processing: processingR.count ?? 0,
        failed: failedR.count ?? 0,
        real_failed: realFailedR.count ?? 0,
        stuck: stuckR.count ?? 0,
        completed: completedR.count ?? 0,
        cancelled: cancelledR.count ?? 0,
      });
    }

    // ── freeze_package ───────────────────────────────────────
    if (action === "freeze_package") {
      const packageId = body.package_id as string;
      if (!packageId) return json({ error: "package_id required" }, 400);
      const { error: err } = await sb
        .from("course_packages")
        .update({ status: "frozen" })
        .eq("id", packageId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] freeze_package: ${packageId} frozen by ${user.id}`);
      return json({ success: true });
    }

    // ── unfreeze_package ─────────────────────────────────────
    if (action === "unfreeze_package") {
      const packageId = body.package_id as string;
      if (!packageId) return json({ error: "package_id required" }, 400);
      const { error: err } = await sb
        .from("course_packages")
        .update({ status: "building" })
        .eq("id", packageId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] unfreeze_package: ${packageId} unfrozen by ${user.id}`);
      return json({ success: true });
    }

    // ── enqueue_job (privileged job creation) ─────────────────
    if (action === "enqueue_job") {
      const ALLOWED_JOB_TYPES = ["package_auto_publish", "package_rebuild_learning"];
      const VALID_SCOPES = ["learning", "handbook", "tutor", "all"];
      const jobType = body.job_type as string;
      const packageId = body.package_id as string;
      const courseId = body.course_id as string;

      if (!jobType || !ALLOWED_JOB_TYPES.includes(jobType)) {
        return json({ error: `job_type must be one of: ${ALLOWED_JOB_TYPES.join(", ")}` }, 400);
      }
      if (!packageId) return json({ error: "package_id required" }, 400);
      if (!courseId) return json({ error: "course_id required" }, 400);

      // Extra validation for rebuild jobs
      if (jobType === "package_rebuild_learning") {
        const scope = body.scope as string;
        if (!scope || !VALID_SCOPES.includes(scope)) {
          return json({ error: `scope must be one of: ${VALID_SCOPES.join(", ")}` }, 400);
        }

        // ── REBUILD WIP BOOST: Mark package as rebuild so it gets a separate WIP slot ──
        await sb
          .from("course_packages")
          .update({ is_rebuild: true, priority: 1, updated_at: new Date().toISOString() })
          .eq("id", packageId);
        console.log(`[admin-ops] Marked package ${packageId} as rebuild (WIP boost + Prio 1)`);
      }

      const maxAttempts = Math.max(1, Math.min(body.max_attempts ?? 3, 10));
      const payload: Record<string, unknown> = { package_id: packageId, course_id: courseId };
      if (body.scope) payload.scope = body.scope;

      const { data, error: err } = await sb
        .from("job_queue")
        .insert({
          job_type: jobType,
          status: "queued",
          payload,
          max_attempts: maxAttempts,
        })
        .select("id")
        .single();

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] enqueue_job: ${jobType} job=${data?.id} pkg=${packageId} by ${user.id}`);
      return json({ success: true, job_id: data?.id, is_rebuild: jobType === "package_rebuild_learning" });
    }

    // ── set_provider_pause ───────────────────────────────────
    if (action === "set_provider_pause") {
      const provider = body.provider as string;
      const pause = body.pause as boolean;
      if (!provider || typeof pause !== "boolean") {
        return json({ error: "provider (string) and pause (boolean) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_rate_limits")
        .update({ is_paused: pause, updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_provider_pause: ${provider} → ${pause ? "paused" : "resumed"} by ${user.id}`);
      return json({ success: true });
    }

    // ── set_provider_concurrency ─────────────────────────────
    if (action === "set_provider_concurrency") {
      const provider = body.provider as string;
      const value = Number(body.value);
      if (!provider || !Number.isFinite(value) || value < 1 || value > 50) {
        return json({ error: "provider (string) and value (1–50) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_rate_limits")
        .update({ max_concurrent: Math.round(value), updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_provider_concurrency: ${provider} → ${value} by ${user.id}`);
      return json({ success: true });
    }

    // ── set_hard_stop ────────────────────────────────────────
    if (action === "set_hard_stop") {
      const hardStop = body.hard_stop as boolean;
      const budgetId = body.budget_id as string;
      if (typeof hardStop !== "boolean" || !budgetId) {
        return json({ error: "budget_id (string) and hard_stop (boolean) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_budget")
        .update({ hard_stop: hardStop })
        .eq("id", budgetId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_hard_stop: ${hardStop} budget=${budgetId} by ${user.id}`);
      return json({ success: true });
    }

    // ── retry_rate_limited ───────────────────────────────────
    if (action === "retry_rate_limited") {
      const TRANSIENT_CODES = ["RATE_LIMIT", "RATE_LIMIT_EXHAUSTED", "TIMEOUT_EXHAUSTED", "TRANSIENT_NETWORK_EXHAUSTED"];
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          scheduled_at: null,
          rate_limited_until: null,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("status", "failed")
        .in("last_error_code", TRANSIENT_CODES)
        .select("id");
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] retry_rate_limited: ${data?.length ?? 0} jobs reset by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── cancel_failed ────────────────────────────────────────
    if (action === "cancel_failed") {
      const { data, error: err } = await sb
        .from("job_queue")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("status", "failed")
        .select("id");
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] cancel_failed: ${data?.length ?? 0} jobs cancelled by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── get_package_realness (read-only, service_role RPC proxy) ─
    if (action === "get_package_realness") {
      const packageId = body.package_id as string;
      if (!packageId) return json({ error: "package_id required" }, 400);

      const { data, error: err } = await sb.rpc("package_lessons_realness", { p_package_id: packageId });
      if (err) return json({ error: err.message }, 500);
      return json({ ok: true, realness: data });
    }

    // ── pipeline_health (6-KPI health panel with track WIP) ──
    if (action === "pipeline_health") {
      const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

      const [stalledR, dupsR, integrityNullR, wipR, trackWipR, qcCanaryR] = await Promise.all([
        sb.rpc("pipeline_health_stalled_content", { p_since: tenMinAgo }),
        sb.rpc("pipeline_health_duplicate_jobs", { p_since: sixHoursAgo }),
        sb.from("package_steps")
          .select("package_id,step_key,status,updated_at", { count: "exact", head: false })
          .eq("step_key", "run_integrity_check")
          .eq("status", "failed")
          .is("last_error", null)
          .gte("updated_at", twentyFourHoursAgo)
          .limit(20),
        Promise.all([
          sb.from("course_packages").select("id", { count: "exact", head: true }).eq("status", "queued"),
          sb.from("course_packages").select("id", { count: "exact", head: true }).eq("status", "building"),
        ]),
        // Track-level WIP breakdown
        sb.from("course_packages")
          .select("track,status")
          .in("status", ["queued", "building"]),
        // QC promotion canary
        sb.from("v_pipeline_canary_qc_promotion")
          .select("qc_approved_but_draft,oldest,latest")
          .maybeSingle(),
      ]);

      const stalledCount = typeof stalledR.data === "number" ? stalledR.data : (stalledR.data as any)?.count ?? 0;
      const dupsCount = typeof dupsR.data === "number" ? dupsR.data : (dupsR.data as any)?.count ?? 0;

      // Compute per-track WIP
      const trackWip: Record<string, { queued: number; building: number }> = {};
      for (const row of ((trackWipR.data ?? []) as { track: string; status: string }[])) {
        const t = row.track || "AUSBILDUNG_VOLL";
        if (!trackWip[t]) trackWip[t] = { queued: 0, building: 0 };
        if (row.status === "queued") trackWip[t].queued++;
        if (row.status === "building") trackWip[t].building++;
      }

      const qcApprovedButDraft = Number((qcCanaryR.data as any)?.qc_approved_but_draft ?? 0);

      return json({
        stalled_content: stalledCount,
        duplicate_pending_jobs: dupsCount,
        integrity_null_errors: integrityNullR.count ?? (integrityNullR.data as any[])?.length ?? 0,
        integrity_null_details: (integrityNullR.data ?? []).slice(0, 10),
        wip_queued: (wipR as any)[0]?.count ?? 0,
        wip_building: (wipR as any)[1]?.count ?? 0,
        track_wip: trackWip,
        qc_approved_but_draft: qcApprovedButDraft,
        qc_approved_but_draft_oldest: (qcCanaryR.data as any)?.oldest ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    // ── helpers: payload guards ──────────────────────────────
    const assertUuid = (x: unknown, name: string): string => {
      const s = String(x ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
        throw Object.assign(new Error(`Invalid UUID for ${name}`), { status: 400 });
      }
      return s;
    };
    const clampInt = (x: unknown, min: number, max: number, fallback: number): number => {
      const n = Number(x);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
    };
    const assertSeedMode = (x: unknown): string => {
      const s = String(x ?? "default");
      return ["light", "default", "heavy"].includes(s) ? s : "default";
    };
    const auditLog = async (act: string, entityId: string, payload: Record<string, unknown>) => {
      try {
        await sb.from("admin_actions").insert({
          action: act,
          user_id: user!.id,
          payload: { entity_id: entityId, ...payload },
        });
      } catch (_) { /* best-effort */ }
    };

    // ── seed_blueprint_targets ────────────────────────────────
    if (action === "seed_blueprint_targets") {
      const curriculumId = assertUuid(body.curriculum_id, "curriculum_id");
      const mode = assertSeedMode(body.mode);
      const track = body.track ? String(body.track) : null;

      const { data, error: err } = await sb.rpc("seed_blueprint_targets_for_curriculum", {
        p_curriculum_id: curriculumId,
        p_track: track,
        p_mode: mode,
      });
      if (err) return json({ error: err.message }, 500);

      console.log(`[admin-ops] seed_blueprint_targets: ${JSON.stringify(data)} by ${user!.id}`);
      await auditLog("seed_blueprint_targets", curriculumId, { mode, track, result: data });
      return json({ success: true, result: data });
    }

    // ── enqueue_bloom_gap_fill ────────────────────────────────
    if (action === "enqueue_bloom_gap_fill") {
      const curriculumId = assertUuid(body.curriculum_id, "curriculum_id");
      const packageId = body.package_id ? assertUuid(body.package_id, "package_id") : undefined;

      const { enqueueJob: enq } = await import("../_shared/enqueue.ts");
      const result = await enq(sb, {
        job_type: "pool_fill_bloom_gaps",
        payload: { curriculum_id: curriculumId, package_id: packageId },
        package_id: packageId,
      });

      console.log(`[admin-ops] enqueue_bloom_gap_fill: ${JSON.stringify(result)} by ${user!.id}`);
      await auditLog("enqueue_bloom_gap_fill", curriculumId, { package_id: packageId, result });
      return json({ success: true, result });
    }

    // ── enqueue_blueprint_gap_fill ─────────────────────────────
    if (action === "enqueue_blueprint_gap_fill") {
      const curriculumId = assertUuid(body.curriculum_id, "curriculum_id");
      const cap = clampInt(body.cap, 5, 200, 50);

      const { data, error: err } = await sb.rpc("enqueue_blueprint_gap_jobs", {
        p_curriculum_id: curriculumId,
        p_cap: cap,
        p_reason: "admin_ui_gap_fill",
      });
      if (err) return json({ error: err.message }, 500);

      console.log(`[admin-ops] enqueue_blueprint_gap_fill: ${JSON.stringify(data)} by ${user!.id}`);
      await auditLog("enqueue_blueprint_gap_fill", curriculumId, { cap, result: data });
      return json({ success: true, result: data });
    }

    // ── get_coverage_gaps ───────────────────────────────────────
    if (action === "get_coverage_gaps") {
      const curriculumId = assertUuid(body.curriculum_id, "curriculum_id");
      const minGap = clampInt(body.min_gap, 1, 50, 1);

      const { data, error: err } = await sb.rpc("get_blueprint_coverage_gaps", {
        p_curriculum_id: curriculumId,
        p_min_gap: minGap,
      });
      if (err) return json({ error: err.message }, 500);
      return json({ gaps: data ?? [] });
    }

    // ── upgrade_to_elite (batch + dry-run + idempotent) ──────
    if (action === "upgrade_to_elite") {
      const DIDAKTIK_STEPS = [
        "scaffold_learning_course",
        "generate_glossary",
        "generate_learning_content",
        "validate_learning_content",
        "generate_lesson_minichecks",
        "validate_lesson_minichecks",
        "generate_handbook",
        "validate_handbook",
        "elite_harden",
      ];
      const GATES_TO_RESET = ["run_integrity_check", "quality_council", "auto_publish"];

      const dryRun = Boolean(body.dry_run);
      const maxTargets = clampInt(body.max_targets, 1, 50, 25);

      // Accept single or batch
      const singleId = body.package_id ? String(body.package_id) : null;
      const batchIds: string[] = Array.isArray(body.package_ids) ? body.package_ids : [];
      const targets = (batchIds.length > 0 ? batchIds : singleId ? [singleId] : []).slice(0, maxTargets);
      if (!targets.length) return json({ error: "package_id or package_ids required" }, 400);

      async function upgradeOne(pkgId: string) {
        const id = assertUuid(pkgId, "package_id");

        const { data: pkg, error: pkgErr } = await sb
          .from("course_packages")
          .select("id, track, course_id, status, feature_flags, step_status_json, title")
          .eq("id", id)
          .single();
        if (pkgErr || !pkg) throw new Error(`Package ${id} not found`);

        // Get existing steps
        const { data: existingSteps } = await sb
          .from("package_steps")
          .select("step_key, status")
          .eq("package_id", id);
        const existingKeys = new Set((existingSteps ?? []).map((s: any) => s.step_key));
        const missingSteps = DIDAKTIK_STEPS.filter(k => !existingKeys.has(k));

        // Build new step_status_json
        const newStepStatus: Record<string, string> = { ...(pkg.step_status_json || {}) };
        for (const sk of missingSteps) newStepStatus[sk] = "queued";
        for (const g of GATES_TO_RESET) newStepStatus[g] = "queued";

        const newFlags = {
          ...(pkg.feature_flags || {}),
          has_learning_course: true,
          has_minichecks: true,
          has_handbook: true,
          ai_tutor_mode: "full",
        };

        if (dryRun) {
          return {
            package_id: id,
            title: pkg.title,
            previous_track: pkg.track,
            current_status: pkg.status,
            existing_steps: existingKeys.size,
            missing_steps: missingSteps,
            gates_to_reset: GATES_TO_RESET,
            will_set_track: "AUSBILDUNG_VOLL",
          };
        }

        // 1) Insert missing steps idempotently (ON CONFLICT via unique index)
        if (missingSteps.length > 0) {
          const rows = missingSteps.map(sk => ({
            package_id: id,
            step_key: sk,
            status: "queued",
            meta: { auto_created: true, reason: "upgrade_to_elite" },
          }));
          // Use upsert with onConflict to be fully idempotent
          await sb.from("package_steps").upsert(rows, {
            onConflict: "package_id,step_key",
            ignoreDuplicates: true,
          });
        }

        // 2) Reset gates if they exist
        for (const gate of GATES_TO_RESET) {
          await sb.from("package_steps")
            .update({ status: "queued", meta: { reset_reason: "upgrade_to_elite" } })
            .eq("package_id", id)
            .eq("step_key", gate);
        }

        // 3) Update package (track + flags + status)
        await sb.from("course_packages").update({
          track: "AUSBILDUNG_VOLL",
          feature_flags: newFlags,
          step_status_json: newStepStatus,
          status: "building",
          updated_at: new Date().toISOString(),
        }).eq("id", id);

        // 4) Clear generation lock
        if (pkg.course_id) {
          await sb.from("course_generation_locks").delete().eq("course_id", pkg.course_id);
        }

        return {
          package_id: id,
          title: pkg.title,
          previous_track: pkg.track,
          new_track: "AUSBILDUNG_VOLL",
          injected_steps: missingSteps,
          injected_count: missingSteps.length,
        };
      }

      const results = [];
      const errors = [];
      for (const tid of targets) {
        try {
          results.push(await upgradeOne(tid));
        } catch (e: any) {
          errors.push({ package_id: tid, error: e.message });
        }
      }

      await auditLog("upgrade_to_elite", targets[0], {
        dry_run: dryRun,
        target_count: targets.length,
        success_count: results.length,
        error_count: errors.length,
        package_ids: targets,
      });

      console.log(`[admin-ops] upgrade_to_elite: ${results.length}/${targets.length} upgraded (dry=${dryRun}) by ${user!.id}`);
      return json({ success: true, dry_run: dryRun, count: results.length, errors, results });
    }

    // ── switch_to_exam_first (safe track switch + step rebuild) ──
    if (action === "switch_to_exam_first") {
      const EXAM_FIRST_STEPS = [
        "scaffold_learning_course",
        "auto_seed_exam_blueprints",
        "validate_blueprints",
        "generate_exam_pool",
        "validate_exam_pool",
        "build_ai_tutor_index",
        "validate_tutor_index",
        "generate_oral_exam",
        "validate_oral_exam",
        "elite_harden",
        "run_integrity_check",
        "quality_council",
        "auto_publish",
      ];

      const dryRun = Boolean(body.dry_run);
      const maxTargets = clampInt(body.max_targets, 1, 50, 25);
      const singleId = body.package_id ? String(body.package_id) : null;
      const batchIds: string[] = Array.isArray(body.package_ids) ? body.package_ids : [];
      const targets = (batchIds.length > 0 ? batchIds : singleId ? [singleId] : []).slice(0, maxTargets);
      if (!targets.length) return json({ error: "package_id or package_ids required" }, 400);

      async function switchOne(pkgId: string) {
        const id = assertUuid(pkgId, "package_id");

        const { data: pkg, error: pkgErr } = await sb
          .from("course_packages")
          .select("id, track, course_id, status, feature_flags, title")
          .eq("id", id)
          .single();
        if (pkgErr || !pkg) throw new Error(`Package ${id} not found`);

        if (pkg.track === "EXAM_FIRST" && !dryRun) {
          return { package_id: id, title: pkg.title, skipped: true, reason: "already EXAM_FIRST" };
        }

        // Get existing steps
        const { data: existingSteps } = await sb
          .from("package_steps")
          .select("step_key, status")
          .eq("package_id", id);
        const existingKeys = new Set((existingSteps ?? []).map((s: any) => s.step_key));

        // Steps to remove (didaktik-only steps not in EXAM_FIRST)
        const stepsToRemove = [...existingKeys].filter(k => !EXAM_FIRST_STEPS.includes(k));
        const stepsToAdd = EXAM_FIRST_STEPS.filter(k => !existingKeys.has(k));

        const newFlags = {
          ...(pkg.feature_flags || {}),
          has_learning_course: false,
          has_minichecks: false,
          has_handbook: false,
          has_exam_trainer: true,
          has_oral_exam_trainer: true,
          has_ai_tutor: true,
          _track_switch_authorized: true,
        };

        if (dryRun) {
          return {
            package_id: id,
            title: pkg.title,
            previous_track: pkg.track,
            current_status: pkg.status,
            steps_to_remove: stepsToRemove,
            steps_to_add: stepsToAdd,
            will_set_track: "EXAM_FIRST",
          };
        }

        // 1) Cancel active lesson jobs for this package
        await sb.from("job_queue")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("status", "pending")
          .in("job_type", ["lesson_generate_content", "package_generate_learning_content", "package_generate_lesson_minichecks"])
          .or(`payload->>package_id.eq.${id}`);

        // 2) Remove didaktik-only steps
        if (stepsToRemove.length > 0) {
          for (const sk of stepsToRemove) {
            await sb.from("package_steps").delete().eq("package_id", id).eq("step_key", sk);
          }
        }

        // 3) Add missing EXAM_FIRST steps
        if (stepsToAdd.length > 0) {
          const rows = stepsToAdd.map((sk, i) => ({
            package_id: id,
            step_key: sk,
            status: "queued",
            sort_order: EXAM_FIRST_STEPS.indexOf(sk) + 1,
            meta: { auto_created: true, reason: "switch_to_exam_first" },
          }));
          await sb.from("package_steps").upsert(rows, {
            onConflict: "package_id,step_key",
            ignoreDuplicates: true,
          });
        }

        // 4) Reset all remaining steps to queued
        await sb.from("package_steps")
          .update({ status: "queued", meta: { reset_reason: "switch_to_exam_first" } })
          .eq("package_id", id);

        // 5) Update package (track + flags + status) — bypass trigger via flag
        await sb.from("course_packages").update({
          track: "EXAM_FIRST",
          feature_flags: newFlags,
          status: "building",
          updated_at: new Date().toISOString(),
        }).eq("id", id);

        // 6) Clear generation lock
        if (pkg.course_id) {
          await sb.from("course_generation_locks").delete().eq("course_id", pkg.course_id);
        }

        return {
          package_id: id,
          title: pkg.title,
          previous_track: pkg.track,
          new_track: "EXAM_FIRST",
          removed_steps: stepsToRemove,
          added_steps: stepsToAdd,
        };
      }

      const results = [];
      const errors = [];
      for (const tid of targets) {
        try {
          results.push(await switchOne(tid));
        } catch (e: any) {
          errors.push({ package_id: tid, error: e.message });
        }
      }

      await auditLog("switch_to_exam_first", targets[0], {
        dry_run: dryRun,
        target_count: targets.length,
        success_count: results.length,
        error_count: errors.length,
        package_ids: targets,
      });

      console.log(`[admin-ops] switch_to_exam_first: ${results.length}/${targets.length} switched (dry=${dryRun}) by ${user!.id}`);
      return json({ success: true, dry_run: dryRun, count: results.length, errors, results });
    }

    return json({
      error: "Unknown action",
    }, 400);
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    console.error(`[admin-ops] error (${status})`, e);
    return json({ error: String(e?.message || e) }, status);
  }
});
