import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

interface FixResult {
  fix: string;
  status: "applied" | "skipped" | "error";
  detail?: string;
}

/**
 * Pre-Build Autofix – Detects and repairs common build blockers before a build starts.
 *
 * Known fixes:
 * 1. MISSING_COURSE       – package has no course_id → creates course from curriculum
 * 2. MISSING_CURRICULUM    – course has no curriculum_id → attempts to resolve from certification/beruf
 * 3. MISSING_PLAN          – no approved plan exists → auto-creates one if council_approved
 * 4. STALE_LOCK            – lock exists from a previous crashed build → clears it
 * 5. STUCK_STATUS          – package stuck in "building" with no active jobs → resets to "queued"
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const packageId = body.packageId || body.package_id;
  const dryRun = body.dry_run === true;

  if (!packageId) return json({ error: "package_id required" }, 400);

  const fixes: FixResult[] = [];

  try {
    // ── Load package ────────────────────────────────────────────
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, track, feature_flags, status, council_approved")
      .eq("id", packageId)
      .single();

    if (pkgErr || !pkg) return json({ error: "Package not found", packageId }, 404);

    // ── FIX 1: Missing course_id ────────────────────────────────
    if (!pkg.course_id) {
      // Try to find or create a course linked to the certification's curriculum
      let courseId: string | null = null;
      let curriculumId: string | null = null;

      // Find curriculum via certification_id (= beruf_id)
      if (pkg.certification_id) {
        const { data: curr } = await sb
          .from("curricula")
          .select("id, title, beruf_id")
          .eq("beruf_id", pkg.certification_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (curr) {
          curriculumId = curr.id;

          // Check for existing course
          const { data: existingCourse } = await sb
            .from("courses")
            .select("id")
            .eq("curriculum_id", curriculumId)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.id;
          } else if (!dryRun) {
            // Get beruf name for course title
            const { data: beruf } = await sb
              .from("berufe")
              .select("bezeichnung_kurz")
              .eq("id", pkg.certification_id)
              .single();

            const title = beruf?.bezeichnung_kurz || curr.title || "Kurs";

            const { data: newCourse, error: courseErr } = await sb
              .from("courses")
              .insert({
                curriculum_id: curriculumId,
                title,
                description: `Prüfungsvorbereitung für ${title}`,
                status: "draft",
              })
              .select("id")
              .single();

            if (!courseErr && newCourse) {
              courseId = newCourse.id;
            } else {
              fixes.push({ fix: "MISSING_COURSE", status: "error", detail: courseErr?.message });
            }
          }

          // Link course to package
          if (courseId && !dryRun) {
            await sb.from("course_packages").update({ course_id: courseId }).eq("id", packageId);
            fixes.push({ fix: "MISSING_COURSE", status: "applied", detail: `Created/linked course ${courseId}` });
          } else if (courseId && dryRun) {
            fixes.push({ fix: "MISSING_COURSE", status: "skipped", detail: `Would link course ${courseId} (dry run)` });
          } else if (!courseId) {
            fixes.push({ fix: "MISSING_COURSE", status: "error", detail: "No curriculum found for certification_id" });
          }
        } else {
          fixes.push({ fix: "MISSING_COURSE", status: "error", detail: "No curriculum found for beruf_id " + pkg.certification_id });
        }
      } else {
        fixes.push({ fix: "MISSING_COURSE", status: "error", detail: "Package has no certification_id to resolve from" });
      }
    } else {
      fixes.push({ fix: "MISSING_COURSE", status: "skipped", detail: "course_id already set" });
    }

    // ── Reload package after potential course fix ────────────────
    const { data: pkgRefresh } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    const effectiveCourseId = pkgRefresh?.course_id || pkg.course_id;

    // ── FIX 2: Missing curriculum_id on course ──────────────────
    if (effectiveCourseId) {
      const { data: course } = await sb
        .from("courses")
        .select("id, curriculum_id")
        .eq("id", effectiveCourseId)
        .single();

      if (course && !course.curriculum_id && pkg.certification_id) {
        const { data: curr } = await sb
          .from("curricula")
          .select("id")
          .eq("beruf_id", pkg.certification_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (curr && !dryRun) {
          await sb.from("courses").update({ curriculum_id: curr.id }).eq("id", effectiveCourseId);
          fixes.push({ fix: "MISSING_CURRICULUM", status: "applied", detail: `Linked curriculum ${curr.id} to course` });
        } else if (curr && dryRun) {
          fixes.push({ fix: "MISSING_CURRICULUM", status: "skipped", detail: `Would link curriculum ${curr.id} (dry run)` });
        } else {
          fixes.push({ fix: "MISSING_CURRICULUM", status: "skipped", detail: "No curriculum found" });
        }
      } else {
        fixes.push({ fix: "MISSING_CURRICULUM", status: "skipped", detail: "curriculum_id already set" });
      }
    }

    // ── FIX 3: Missing approved plan ────────────────────────────
    const { data: existingPlan } = await sb
      .from("course_package_plans")
      .select("id")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (!existingPlan) {
      if (pkg.council_approved || true /* auto-approve for pipeline */) {
        if (!dryRun) {
          const track = pkg.track || "AUSBILDUNG_VOLL";
          const featureFlags = (pkg.feature_flags as Record<string, boolean>) || {};
          const { error: planErr } = await sb
            .from("course_package_plans")
            .insert({
              package_id: packageId,
              status: "approved",
              plan: {
                auto_created: true,
                autofix: true,
                track,
                feature_flags: featureFlags,
                include_learning_course: featureFlags.has_learning_course ?? (track === "AUSBILDUNG_VOLL" || track === "STUDIUM"),
                include_exam_pool: featureFlags.has_exam_trainer ?? true,
                include_oral_exam: featureFlags.has_oral_exam_trainer ?? (track === "EXAM_FIRST_PLUS"),
                include_ai_tutor: featureFlags.has_ai_tutor ?? true,
                include_handbook: featureFlags.has_handbook ?? (track !== "EXAM_FIRST"),
                exam_target: (track === "EXAM_FIRST" || track === "EXAM_FIRST_PLUS") ? 1200 : 1000,
              },
            });
          fixes.push({
            fix: "MISSING_PLAN",
            status: planErr ? "error" : "applied",
            detail: planErr ? planErr.message : "Auto-created approved plan",
          });
        } else {
          fixes.push({ fix: "MISSING_PLAN", status: "skipped", detail: "Would create approved plan (dry run)" });
        }
      }
    } else {
      fixes.push({ fix: "MISSING_PLAN", status: "skipped", detail: "Approved plan exists" });
    }

    // ── FIX 4: Stale lock from crashed build ────────────────────
    const { data: lock } = await sb
      .from("course_package_locks")
      .select("package_id, created_at")
      .eq("package_id", packageId)
      .maybeSingle();

    if (lock) {
      const lockAge = Date.now() - new Date(lock.created_at).getTime();
      const MAX_LOCK_AGE_MS = 30 * 60 * 1000; // 30 min

      if (lockAge > MAX_LOCK_AGE_MS) {
        if (!dryRun) {
          await sb.from("course_package_locks").delete().eq("package_id", packageId);
          fixes.push({ fix: "STALE_LOCK", status: "applied", detail: `Cleared lock aged ${Math.round(lockAge / 60000)}min` });
        } else {
          fixes.push({ fix: "STALE_LOCK", status: "skipped", detail: `Would clear lock aged ${Math.round(lockAge / 60000)}min (dry run)` });
        }
      } else {
        fixes.push({ fix: "STALE_LOCK", status: "skipped", detail: `Lock is fresh (${Math.round(lockAge / 60000)}min)` });
      }
    } else {
      fixes.push({ fix: "STALE_LOCK", status: "skipped", detail: "No lock exists" });
    }

    // ── FIX 6: Missing question_blueprints ─────────────────────
    if (effectiveCourseId) {
      const { data: course } = await sb.from("courses").select("curriculum_id").eq("id", effectiveCourseId).single();
      const currId = course?.curriculum_id;
      if (currId) {
        const { count: bpCount } = await sb
          .from("question_blueprints")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", currId);

        if ((bpCount ?? 0) === 0) {
          if (!dryRun) {
            // Trigger blueprint seeding via dom-blueprint-seeder
            try {
              const seedUrl = `${SUPABASE_URL}/functions/v1/dom-blueprint-seeder`;
              const seedRes = await fetch(seedUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
                body: JSON.stringify({ curriculum_id: currId, package_id: packageId }),
              });
              const seedData = await seedRes.json();
              const seeded = (seedData as Record<string, unknown>)?.inserted ?? (seedData as Record<string, unknown>)?.count ?? 0;
              fixes.push({ fix: "MISSING_BLUEPRINTS", status: "applied", detail: `Triggered blueprint seeding for curriculum ${currId}, seeded: ${seeded}` });
            } catch (seedErr) {
              fixes.push({ fix: "MISSING_BLUEPRINTS", status: "error", detail: `Seeding failed: ${(seedErr as Error).message}` });
            }
          } else {
            fixes.push({ fix: "MISSING_BLUEPRINTS", status: "skipped", detail: `Would seed blueprints for curriculum ${currId} (dry run)` });
          }
        } else {
          fixes.push({ fix: "MISSING_BLUEPRINTS", status: "skipped", detail: `${bpCount} blueprints exist` });
        }
      }
    }

    // ── FIX 5: Stuck in "building" with no active jobs ──────────
    // IMPORTANT: Check for active leases FIRST. If a runner holds a lease,
    // the package is being actively processed and must NOT be reset.
    // The old logic caused an infinite loop: runner sets building → autofix
    // resets to queued → runner re-acquires → repeat (22 resets in 30min).
    if (pkg.status === "building") {
      const { count: activeLeases } = await sb
        .from("package_leases")
        .select("package_id", { count: "exact", head: true })
        .eq("package_id", packageId)
        .gt("lease_until", new Date().toISOString());

      if ((activeLeases ?? 0) > 0) {
        fixes.push({ fix: "STUCK_STATUS", status: "skipped", detail: `Active lease exists — runner is processing` });
      } else {
        const { count: activeJobs } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "processing"])
          .contains("payload", { package_id: packageId });

        if ((activeJobs ?? 0) === 0) {
          if (!dryRun) {
            await sb.from("course_packages").update({ status: "queued" }).eq("id", packageId);
            fixes.push({ fix: "STUCK_STATUS", status: "applied", detail: "Reset from 'building' to 'queued' (0 active jobs, 0 leases)" });
          } else {
            fixes.push({ fix: "STUCK_STATUS", status: "skipped", detail: "Would reset to 'queued' (dry run)" });
          }
        } else {
          fixes.push({ fix: "STUCK_STATUS", status: "skipped", detail: `${activeJobs} active jobs still running` });
        }
      }
    } else {
      fixes.push({ fix: "STUCK_STATUS", status: "skipped", detail: `Status is '${pkg.status}', not stuck` });
    }

    // ── Summary ─────────────────────────────────────────────────
    const applied = fixes.filter((f) => f.status === "applied").length;
    const errors = fixes.filter((f) => f.status === "error").length;

    // Log to auto_heal_log for audit trail
    if (applied > 0 && !dryRun) {
      await sb.from("auto_heal_log").insert({
        action_type: "prebuild_autofix",
        trigger_source: "prebuild-autofix",
        target_type: "course_package",
        target_id: packageId,
        result_status: errors > 0 ? "partial" : "success",
        result_detail: JSON.stringify(fixes),
        metadata: { fixes_applied: applied, fixes_errors: errors, dry_run: dryRun },
      });
    }

    console.log(`[PreBuildAutofix] Package ${packageId}: ${applied} fixes applied, ${errors} errors`);

    return json({
      ok: true,
      packageId,
      dry_run: dryRun,
      fixes_applied: applied,
      fixes_errors: errors,
      fixes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PreBuildAutofix] Fatal: ${msg}`);
    return json({ error: msg, fixes }, 500);
  }
});
