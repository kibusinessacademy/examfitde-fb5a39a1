import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { generateBlueprintRows } from "../_shared/certifications/blueprint-fanout.ts";

/**
 * batch-direct-seed — Direct blueprint + variant seeding outside the queue.
 *
 * Modes:
 *   1. blueprints  — Seed question_blueprints for packages with 0 blueprints
 *   2. variants    — Seed variant inventory for packages with blueprints but 0 variants
 *   3. full        — blueprints then variants (default)
 *
 * POST { mode?: "full"|"blueprints"|"variants", limit?: number, package_ids?: string[] }
 */

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
  const mode: string = body.mode ?? "full";
  const limit = Math.min(Number(body.limit ?? 50), 200);
  const filterIds: string[] | null = body.package_ids ?? null;

  const results: any[] = [];
  const start = Date.now();
  const TIME_BUDGET_MS = 55_000; // 55s safety margin
  const timeLeft = () => Date.now() - start < TIME_BUDGET_MS;

  // ── Step 1: Blueprint seeding ──
  if (mode === "blueprints" || mode === "full") {
    // Find packages with curriculum but 0 blueprints
    let query = sb.rpc("fn_packages_needing_blueprints" as any, { p_limit: limit });
    if (filterIds?.length) {
      // If specific IDs given, use direct query instead
      query = null as any;
    }

    let packages: Array<{ package_id: string; curriculum_id: string; certification_id: string; slug: string; validation_profile: string }> = [];

    if (filterIds?.length) {
      // Direct lookup for specific packages
      const { data: pkgs } = await sb
        .from("course_packages")
        .select("id, curriculum_id, course_id")
        .in("id", filterIds);

      for (const pkg of pkgs ?? []) {
        if (!pkg.curriculum_id) continue;
        const { data: cert } = await sb
          .from("curricula")
          .select("certification_id, certifications!inner(slug, validation_profile)")
          .eq("id", pkg.curriculum_id)
          .maybeSingle();

        if (cert?.certification_id) {
          packages.push({
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: cert.certification_id,
            slug: (cert as any).certifications?.slug ?? "unknown",
            validation_profile: (cert as any).certifications?.validation_profile ?? "IHK_AUFSTIEG",
          });
        }
      }
    } else {
      const { data, error } = await query;
      if (error) {
        console.error("[batch-direct-seed] RPC error, falling back to manual query:", error.message);
        // Fallback: manual query for blocked packages with 0 blueprints
        const { data: pkgs } = await sb
          .from("course_packages")
          .select("id, curriculum_id")
          .in("status", ["blocked", "pending", "building"])
          .not("curriculum_id", "is", null)
          .limit(limit);

        for (const pkg of pkgs ?? []) {
          if (!timeLeft()) break;
          // Check blueprint count
          const { count } = await sb
            .from("question_blueprints")
            .select("id", { count: "exact", head: true })
            .eq("curriculum_id", pkg.curriculum_id!);

          if ((count ?? 0) > 0) continue;

          const { data: cur } = await sb
            .from("curricula")
            .select("certification_id")
            .eq("id", pkg.curriculum_id!)
            .maybeSingle();

          if (!cur?.certification_id) continue;

          const { data: cert } = await sb
            .from("certifications")
            .select("slug, validation_profile")
            .eq("id", cur.certification_id)
            .maybeSingle();

          packages.push({
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id!,
            certification_id: cur.certification_id,
            slug: cert?.slug ?? "unknown",
            validation_profile: cert?.validation_profile ?? "IHK_AUFSTIEG",
          });
        }
      } else {
        packages = data ?? [];
      }
    }

    console.log(`[batch-direct-seed] Blueprint seeding: ${packages.length} packages`);

    for (const pkg of packages) {
      if (!timeLeft()) {
        results.push({ package_id: pkg.package_id, step: "blueprints", skipped: "time_budget" });
        break;
      }

      try {
        // Get competencies for this curriculum
        const { data: lfs } = await sb
          .from("learning_fields")
          .select("id")
          .eq("curriculum_id", pkg.curriculum_id);

        if (!lfs?.length) {
          results.push({ package_id: pkg.package_id, slug: pkg.slug, step: "blueprints", skipped: "no_learning_fields" });
          continue;
        }

        const lfIds = lfs.map(lf => lf.id);
        const { data: comps } = await sb
          .from("competencies")
          .select("id, title, description, learning_field_id, bloom_level, code")
          .in("learning_field_id", lfIds)
          .order("id", { ascending: true });

        const validComps = (comps ?? []).filter((c: any) => c.id && c.learning_field_id);
        if (!validComps.length) {
          results.push({ package_id: pkg.package_id, slug: pkg.slug, step: "blueprints", skipped: "no_competencies" });
          continue;
        }

        // Generate blueprint rows
        const allRows = generateBlueprintRows({
          validationProfile: pkg.validation_profile,
          curriculumId: pkg.curriculum_id,
          competencies: validComps,
        });

        // Check existing
        const { data: existing } = await sb
          .from("question_blueprints")
          .select("competency_id, knowledge_type, cognitive_level")
          .eq("curriculum_id", pkg.curriculum_id)
          .neq("status", "deprecated");

        const existingSet = new Set(
          (existing ?? []).map((e: any) => `${e.competency_id}|${e.knowledge_type}|${e.cognitive_level}`)
        );

        const newRows = allRows.filter(
          (r) => !existingSet.has(`${r.competency_id}|${r.knowledge_type}|${r.cognitive_level}`)
        );

        if (!newRows.length) {
          results.push({ package_id: pkg.package_id, slug: pkg.slug, step: "blueprints", skipped: "all_exist", total: allRows.length });
          continue;
        }

        // Insert in batches
        let inserted = 0;
        for (let i = 0; i < newRows.length; i += 50) {
          const batch = newRows.slice(i, i + 50);
          const { error: insErr } = await sb.from("question_blueprints").insert(batch);
          if (insErr) {
            console.error(`[batch-direct-seed] Insert error for ${pkg.slug}:`, insErr.message);
            break;
          }
          inserted += batch.length;
        }

        results.push({
          package_id: pkg.package_id,
          slug: pkg.slug,
          step: "blueprints",
          ok: true,
          competencies: validComps.length,
          generated: inserted,
          skipped_existing: allRows.length - newRows.length,
        });
      } catch (e) {
        results.push({ package_id: pkg.package_id, slug: pkg.slug, step: "blueprints", error: (e as Error).message });
      }
    }
  }

  // ── Step 2: Variant inventory seeding ──
  if ((mode === "variants" || mode === "full") && timeLeft()) {
    // Get ALL packages with curriculum
    const { data: rawPkgs } = await sb
      .from("course_packages")
      .select("id, curriculum_id")
      .in("status", ["blocked", "pending", "building"])
      .not("curriculum_id", "is", null)
      .limit(500);

    const allPkgs = rawPkgs ?? [];
    const pkgIds = allPkgs.map(p => p.id);
    const curIds = [...new Set(allPkgs.map(p => p.curriculum_id).filter(Boolean))] as string[];

    // Batch: distinct package_ids that ALREADY have inventory
    const invSet = new Set<string>();
    for (let i = 0; i < pkgIds.length; i += 100) {
      const chunk = pkgIds.slice(i, i + 100);
      const { data: rows } = await sb
        .from("blueprint_variant_inventory")
        .select("package_id")
        .in("package_id", chunk);
      for (const r of rows ?? []) invSet.add((r as any).package_id);
    }

    // Batch: distinct curriculum_ids that have approved blueprints
    const approvedSet = new Set<string>();
    for (let i = 0; i < curIds.length; i += 100) {
      const chunk = curIds.slice(i, i + 100);
      const { data: rows } = await sb
        .from("question_blueprints")
        .select("curriculum_id")
        .in("curriculum_id", chunk)
        .eq("status", "approved")
        .limit(1000);
      for (const r of rows ?? []) approvedSet.add((r as any).curriculum_id);
    }

    const varPkgs = allPkgs
      .filter(p => !invSet.has(p.id) && approvedSet.has(p.curriculum_id!))
      .slice(0, limit)
      .map(p => ({ package_id: p.id, curriculum_id: p.curriculum_id! }));

    console.log(`[batch-direct-seed] Variant seeding: ${varPkgs.length} packages`);
    let variantSeeded = 0;

    for (const pkg of varPkgs) {
      if (!timeLeft() || variantSeeded >= limit) break;

      try {
        const { data: bps } = await sb
          .from("question_blueprints")
          .select("id")
          .eq("curriculum_id", pkg.curriculum_id)
          .eq("status", "approved");

        let seeded = 0;
        for (const bp of bps ?? []) {
          if (!timeLeft()) break;
          await sb.rpc("fn_upsert_variant_inventory" as any, {
            p_blueprint_id: bp.id,
            p_curriculum_id: pkg.curriculum_id,
            p_package_id: pkg.package_id,
            p_target_count: 6,
            p_new_materialized: 0,
            p_new_approved: 0,
          });
          seeded++;
        }

        // Update prebuild status
        await sb.rpc("fn_update_package_prebuild_status" as any, { p_package_id: pkg.package_id });

        results.push({
          package_id: pkg.package_id,
          step: "variants",
          ok: true,
          blueprints_seeded: seeded,
        });
        variantSeeded++;
      } catch (e) {
        results.push({ package_id: pkg.package_id, step: "variants", error: (e as Error).message });
      }
    }
  }

  const elapsed = Date.now() - start;

  return json(200, {
    ok: true,
    mode,
    processed: results.length,
    elapsed_ms: elapsed,
    results,
  }, origin);
});
