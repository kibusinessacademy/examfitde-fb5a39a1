import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 10), 25);

  // Fetch ready wave candidates with highest promotion priority
  const { data: candidates, error: candErr } = await sb
    .from("qualification_wave_candidates")
    .select(`
      *,
      qualification_catalog:qualification_catalog_id(*),
      draft:draft_id(*)
    `)
    .eq("candidate_status", "ready")
    .not("curriculum_id", "is", null)
    .order("promotion_priority", { ascending: false })
    .limit(limit);

  if (candErr) return json(500, { error: candErr.message }, origin);
  if (!candidates?.length) return json(200, { ok: true, seeded: 0 }, origin);

  // Create a new production wave
  const { data: wave, error: waveErr } = await sb
    .from("production_waves")
    .insert({
      name: `Qualification Auto-Wave ${new Date().toISOString().slice(0, 16)}`,
      status: "draft",
      track: "AUSBILDUNG_VOLL",
      target_count: candidates.length,
    })
    .select("id")
    .single();

  if (waveErr) return json(500, { error: waveErr.message }, origin);

  const seeded: any[] = [];
  const errors: any[] = [];

  for (const c of candidates) {
    try {
      const catalogTitle =
        (c as any).qualification_catalog?.canonical_title || "Qualification Course";

      // Check if course already exists for this curriculum
      const { data: existingCourse } = await sb
        .from("courses")
        .select("id")
        .eq("curriculum_id", c.curriculum_id)
        .limit(1)
        .single();

      let courseId: string;
      if (existingCourse) {
        courseId = existingCourse.id;
      } else {
        const { data: course, error: courseErr } = await sb
          .from("courses")
          .insert({
            curriculum_id: c.curriculum_id,
            title: catalogTitle,
            status: "draft",
          })
          .select("id")
          .single();

        if (courseErr) throw courseErr;
        courseId = course.id;
      }

      // Check if package already exists (curriculum-level dedup)
      const { data: existingPkg } = await sb
        .from("course_packages")
        .select("id")
        .eq("curriculum_id", c.curriculum_id)
        .in("status", ["planning", "queued", "building", "failed", "published", "draft"])
        .limit(1)
        .maybeSingle();

      let packageId: string;
      if (existingPkg) {
        packageId = existingPkg.id;
      } else {
        const canonicalTitle =
          (c as any).qualification_catalog?.canonical_title ||
          (c as any).draft?.title ||
          catalogTitle;

        const { data: pkg, error: pkgErr } = await sb
          .from("course_packages")
          .insert({
            course_id: courseId,
            curriculum_id: c.curriculum_id,
            title: canonicalTitle,
            status: "queued",
            priority: Math.round(c.promotion_priority || 5),
            track: "AUSBILDUNG_VOLL",
            version: 1,
          })
          .select("id")
          .single();

        if (pkgErr) throw pkgErr;
        packageId = pkg.id;
      }

      // Add to production wave
      await sb.from("production_wave_items").insert({
        wave_id: wave.id,
        curriculum_id: c.curriculum_id,
        course_id: courseId,
        package_id: packageId,
        status: "pending",
      });

      // Mark candidate as seeded
      await sb
        .from("qualification_wave_candidates")
        .update({
          candidate_status: "seeded",
          linked_wave_id: wave.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);

      seeded.push({
        candidate_id: c.id,
        curriculum_id: c.curriculum_id,
        course_id: courseId,
        package_id: packageId,
      });
    } catch (e) {
      errors.push({
        candidate_id: c.id,
        error: (e as Error).message,
      });
    }
  }

  return json(
    200,
    {
      ok: true,
      wave_id: wave.id,
      seeded: seeded.length,
      errors: errors.length,
      details: { seeded, errors },
    },
    origin,
  );
});
