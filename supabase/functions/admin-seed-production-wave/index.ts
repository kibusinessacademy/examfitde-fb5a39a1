import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * admin-seed-production-wave — Creates a production wave and seeds curricula into it.
 *
 * Input:
 *   name:          string (wave name, e.g. "Canary Wave 1")
 *   track?:        string (default "AUSBILDUNG_VOLL")
 *   priority_min?: number (default 1)
 *   priority_max?: number (default 10)
 *   limit:         number (how many curricula to seed)
 *   max_concurrent?: number (default 8)
 *   dry_run?:      boolean (default false — preview without creating)
 *
 * Logic:
 *   1. Finds production-ready curricula (enrichment >= 100%, no active visible package)
 *   2. Ranks by market tier / priority
 *   3. Creates wave + wave_items
 *   4. Optionally creates course_packages for items that don't have one
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const auth = await validateAuth(req, true);
  if (auth.error || !auth.isAdmin) {
    return json(401, { error: auth.error || "Admin required" }, origin);
  }

  const body = await req.json().catch(() => ({}));
  const {
    name = `Wave ${new Date().toISOString().slice(0, 10)}`,
    track = null,
    priority_min = 1,
    priority_max = 10,
    limit: seedLimit = 5,
    max_concurrent = 8,
    dry_run = false,
    auto_create_packages = true,
  } = body;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Step 1: Find production-ready curricula ──
  // A curriculum is ready when:
  //   - It has a beruf with market data
  //   - enrichment_progress >= 100%
  //   - No existing visible package (building/queued/published/draft)
  let query = sb
    .from("curricula")
    .select(`
      id,
      title,
      beruf_id,
      track,
      enrichment_progress,
      berufe!inner(
        id,
        titel,
        beruf_market_data(fit_score, demand_percentile)
      )
    `)
    .gte("enrichment_progress", 100)
    .order("created_at", { ascending: true })
    .limit(500);

  if (track) {
    query = query.eq("track", track);
  }

  const { data: curricula, error: cErr } = await query;
  if (cErr) return json(500, { error: cErr.message }, origin);

  // Filter out curricula that already have a visible package
  const curriculumIds = (curricula || []).map((c: any) => c.id);

  const { data: existingCourses } = await sb
    .from("courses")
    .select("id, curriculum_id")
    .in("curriculum_id", curriculumIds.length > 0 ? curriculumIds : ["__none__"]);

  const courseByC = new Map<string, string>();
  for (const c of existingCourses || []) {
    courseByC.set(c.curriculum_id, c.id);
  }

  // Check existing visible packages
  const courseIds = [...courseByC.values()];
  const { data: existingPackages } = await sb
    .from("course_packages")
    .select("id, course_id, status")
    .in("course_id", courseIds.length > 0 ? courseIds : ["__none__"])
    .in("status", ["building", "queued", "planning", "draft", "published"]);

  const busyCourseIds = new Set((existingPackages || []).map((p: any) => p.course_id));

  // Rank and filter candidates
  type Candidate = {
    curriculum_id: string;
    title: string;
    beruf_titel: string;
    track: string;
    fit_score: number;
    demand_percentile: number;
    has_course: boolean;
    course_id: string | null;
    priority_score: number;
  };

  const candidates: Candidate[] = [];
  for (const c of curricula || []) {
    const courseId = courseByC.get(c.id) ?? null;
    if (courseId && busyCourseIds.has(courseId)) continue; // Skip busy ones

    const marketData = (c as any).berufe?.beruf_market_data?.[0];
    const fitScore = marketData?.fit_score ?? 0;
    const demandPct = marketData?.demand_percentile ?? 0;

    const priorityScore = fitScore * 0.6 + demandPct * 0.4;

    if (priorityScore < priority_min || priorityScore > priority_max * 10) continue;

    candidates.push({
      curriculum_id: c.id,
      title: c.title,
      beruf_titel: (c as any).berufe?.titel ?? "",
      track: c.track ?? "AUSBILDUNG_VOLL",
      fit_score: fitScore,
      demand_percentile: demandPct,
      has_course: !!courseId,
      course_id: courseId,
      priority_score: priorityScore,
    });
  }

  // Sort by priority (highest first)
  candidates.sort((a, b) => b.priority_score - a.priority_score);
  const selected = candidates.slice(0, seedLimit);

  if (dry_run) {
    return json(200, {
      dry_run: true,
      wave_name: name,
      total_eligible: candidates.length,
      selected_count: selected.length,
      selected: selected.map((c) => ({
        curriculum_id: c.curriculum_id,
        title: c.title,
        beruf: c.beruf_titel,
        track: c.track,
        priority_score: Math.round(c.priority_score * 10) / 10,
        has_course: c.has_course,
      })),
    }, origin);
  }

  if (selected.length === 0) {
    return json(200, {
      ok: false,
      error: "No eligible curricula found",
      total_checked: curricula?.length ?? 0,
      candidates_after_filter: candidates.length,
    }, origin);
  }

  // ── Step 2: Create wave ──
  const { data: wave, error: wErr } = await sb
    .from("production_waves")
    .insert({
      name,
      status: "seeding",
      track: track ?? "AUSBILDUNG_VOLL",
      priority_min,
      priority_max,
      target_count: selected.length,
      max_concurrent,
      created_by: auth.userId,
      meta: {
        total_eligible: candidates.length,
        seed_criteria: { track, priority_min, priority_max, limit: seedLimit },
      },
    })
    .select("id")
    .single();

  if (wErr) return json(500, { error: `Failed to create wave: ${wErr.message}` }, origin);

  // ── Step 3: Create wave items + optional packages ──
  const items: Array<{
    wave_id: string;
    curriculum_id: string;
    course_id: string | null;
    package_id: string | null;
    status: string;
    priority: number;
  }> = [];

  let packagesCreated = 0;
  let coursesCreated = 0;

  for (const cand of selected) {
    let courseId = cand.course_id;
    let packageId: string | null = null;

    if (auto_create_packages) {
      // Create course if needed
      if (!courseId) {
        const { data: newCourse, error: courseErr } = await sb
          .from("courses")
          .insert({
            curriculum_id: cand.curriculum_id,
            title: cand.title || cand.beruf_titel,
            status: "draft",
          })
          .select("id")
          .single();

        if (courseErr) {
          console.error(`[wave-seed] Failed to create course for ${cand.curriculum_id}: ${courseErr.message}`);
          continue;
        }
        courseId = newCourse.id;
        coursesCreated++;
      }

      // Create package
      const { data: newPkg, error: pkgErr } = await sb
        .from("course_packages")
        .insert({
          course_id: courseId,
          title: cand.title || cand.beruf_titel,
          status: "queued",
          priority: 100, // factory queue priority
          track: cand.track,
          version: 1,
          build_progress: 0,
        })
        .select("id")
        .single();

      if (pkgErr) {
        if (pkgErr.message.includes("uniq_visible_package")) {
          console.warn(`[wave-seed] Package already exists for course ${courseId}, skipping`);
        } else {
          console.error(`[wave-seed] Failed to create package: ${pkgErr.message}`);
        }
        continue;
      }
      packageId = newPkg.id;
      packagesCreated++;
    }

    items.push({
      wave_id: wave.id,
      curriculum_id: cand.curriculum_id,
      course_id: courseId,
      package_id: packageId,
      status: "pending",
      priority: Math.round(cand.priority_score),
    });
  }

  // Bulk insert wave items
  if (items.length > 0) {
    const { error: iErr } = await sb.from("production_wave_items").insert(items);
    if (iErr) {
      console.error(`[wave-seed] Failed to insert wave items: ${iErr.message}`);
    }
  }

  // Update wave counts
  await sb
    .from("production_waves")
    .update({
      seeded_count: items.length,
      status: "draft", // ready for activation
    })
    .eq("id", wave.id);

  return json(200, {
    ok: true,
    wave_id: wave.id,
    wave_name: name,
    seeded: items.length,
    courses_created: coursesCreated,
    packages_created: packagesCreated,
    skipped: selected.length - items.length,
  }, origin);
});
