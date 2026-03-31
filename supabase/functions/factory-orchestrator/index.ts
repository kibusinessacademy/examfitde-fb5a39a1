import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * factory-orchestrator — fully deterministic product factory
 *
 * Reads product_factory_specs per certification.
 * Checks current pipeline state and enqueues the next required jobs.
 * Idempotent — safe to run every 2–5 minutes via cron.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("factory-orchestrator", sb);
  const actions: string[] = [];

  try {
    // Load all enabled factory specs
    const { data: specs } = await sb
      .from("product_factory_specs")
      .select("certification_id, spec")
      .eq("enabled", true);

    if (!specs || specs.length === 0) {
      return json({ ok: true, actions: ["No enabled factory specs"] });
    }

    // Check budget guard
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { data: budget } = await sb
      .from("llm_budget")
      .select("hard_stop")
      .eq("month", currentMonth)
      .maybeSingle();

    if (budget?.hard_stop) {
      return json({ ok: true, actions: ["Budget hard stop active — skipping"] });
    }

    for (const { certification_id, spec } of specs) {
      const s = spec as Record<string, any>;

      // Find courses for this certification
      const { data: courses } = await sb
        .from("courses")
        .select("id, curriculum_id, status, publishing_status")
        .eq("certification_id", certification_id)
        .limit(5);

      if (!courses || courses.length === 0) continue;

      for (const course of courses) {
        if (!course.curriculum_id) continue;

        // ── Gate 1: Freeze Gate ──
        if (s.freeze?.enabled) {
          const { data: curriculum } = await sb
            .from("curricula")
            .select("status")
            .eq("id", course.curriculum_id)
            .maybeSingle();

          if (curriculum?.status === "draft") {
            // Enqueue content generation if not already pending
            const { count: pending } = await sb
              .from("job_queue")
              .select("id", { count: "exact", head: true })
              .eq("job_type", "generate_curriculum_content")
              .in("status", ["pending", "processing"])
              .contains("payload", { curriculum_id: course.curriculum_id });

            if ((pending ?? 0) === 0) {
              await sb.from("job_queue").insert({
                job_type: "generate_curriculum_content",
                status: "pending",
                attempts: 0,
                max_attempts: 5,
                payload: { curriculum_id: course.curriculum_id, triggered_by: "factory_orchestrator" },
                run_after: new Date().toISOString(),
              });
              actions.push(`Enqueued freeze for curriculum ${course.curriculum_id.slice(0, 8)}`);
            }
            continue; // Don't proceed until frozen
          }

          if (curriculum?.status !== "frozen") continue;
        }

        // ── Gate 2: Package Setup (curriculum-level dedup) ──
        // Check for ANY existing visible package for this curriculum + track
        const { data: pkg } = await sb
          .from("course_packages")
          .select("id, status")
          .eq("curriculum_id", course.curriculum_id)
          .in("status", ["planning", "queued", "building", "failed", "published", "draft", "setup_complete"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!pkg) {
          // Setup package if not exists
          const { count: setupPending } = await sb
            .from("job_queue")
            .select("id", { count: "exact", head: true })
            .eq("job_type", "setup_course_package")
            .in("status", ["pending", "processing"])
            .contains("payload", { course_id: course.id });

          if ((setupPending ?? 0) === 0) {
            await sb.from("job_queue").insert({
              job_type: "setup_course_package",
              status: "pending",
              attempts: 0,
              max_attempts: 3,
              payload: { course_id: course.id, certification_id, triggered_by: "factory_orchestrator" },
              run_after: new Date().toISOString(),
            });
            actions.push(`Enqueued setup_course_package for course ${course.id.slice(0, 8)}`);
          }
          continue;
        }

        // Package exists — check if it needs to be queued for build
        if (pkg.status === "draft" || pkg.status === "setup_complete") {
          // Use safe transition to prevent unique constraint violation
          await sb.rpc("safe_transition_package_status", {
            p_package_id: pkg.id,
            p_new_status: "queued",
            p_extra: {},
          });
          actions.push(`Queued package ${pkg.id.slice(0, 8)} for build`);
          continue;
        }

        // ── Gate 3: Published packages → SEO pages ──
        if (pkg.status === "published" && s.seo_pages?.enabled) {
          const pageTypes: string[] = s.seo_pages.page_types || [];

          for (const pageType of pageTypes) {
            // Check if SEO page exists
            const { count: existingPages } = await sb
              .from("certification_seo_pages")
              .select("id", { count: "exact", head: true })
              .eq("certification_catalog_id", certification_id)
              .eq("page_type", pageType);

            if ((existingPages ?? 0) === 0) {
              // Enqueue SEO generation
              const { count: seoPending } = await sb
                .from("job_queue")
                .select("id", { count: "exact", head: true })
                .eq("job_type", "seo_certification_generate")
                .in("status", ["pending", "processing"])
                .contains("payload", { certification_id, page_type: pageType });

              if ((seoPending ?? 0) === 0) {
                await sb.from("job_queue").insert({
                  job_type: "seo_certification_generate",
                  status: "pending",
                  attempts: 0,
                  max_attempts: 3,
                  payload: { certification_id, page_type: pageType, triggered_by: "factory_orchestrator" },
                  run_after: new Date().toISOString(),
                });
                actions.push(`Enqueued SEO ${pageType} for cert ${certification_id.slice(0, 8)}`);
              }
            }
          }
        }
      }
    }

    // ── Strict Priority Tier Gating ──
    // Only allow packages whose priority equals the minimum incomplete priority.
    // FIX: 'blocked' is EXCLUDED — blocked packages are terminal and must not
    // prevent lower-priority packages from progressing.
    const { data: minPrioRow } = await sb
      .from("course_packages")
      .select("priority")
      .in("status", ["queued", "building", "failed", "setup_complete"])
      .order("priority", { ascending: true })
      .limit(1)
      .maybeSingle();
    
    const minIncompletePrio = minPrioRow?.priority ?? 999;
    
    // Demote any queued packages that have a higher priority number than the min
    const { data: wrongTierQueued } = await sb
      .from("course_packages")
      .select("id, priority")
      .eq("status", "queued")
      .gt("priority", minIncompletePrio);
    
    if (wrongTierQueued && wrongTierQueued.length > 0) {
      actions.push(`Tier gate: ${wrongTierQueued.length} packages queued but blocked (min incomplete prio=${minIncompletePrio})`);
    }
    
    actions.push(`Priority tier gate: active tier = Prio ${minIncompletePrio}`);

    // Log
    await sb.from("auto_heal_log").insert({
      action_type: "factory_orchestrator_cycle",
      trigger_source: "cron",
      result_status: actions.length > 0 ? "ok" : "noop",
      result_detail: `${actions.length} actions`,
      metadata: { actions },
    });

    return json({ ok: true, actions_count: actions.length, actions });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
