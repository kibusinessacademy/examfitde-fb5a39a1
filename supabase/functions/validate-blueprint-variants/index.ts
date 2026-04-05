import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ValidationResult {
  blueprint_id: string;
  blueprint_name: string;
  total_variants: number;
  passed: boolean;
  gates: Record<string, { passed: boolean; actual: number; required: number; detail?: string }>;
}

interface DistributionGate {
  type: string;
  min_pct: number;
  max_pct?: number;
}

const STUDIUM_GATES: DistributionGate[] = [
  { type: "transfer_shift", min_pct: 20 },
  { type: "trap_shift", min_pct: 15 },
  { type: "context_shift", min_pct: 15 },
  { type: "parameter_shift", min_pct: 0, max_pct: 35 },
];

const VOCATIONAL_GATES: DistributionGate[] = [
  { type: "transfer_shift", min_pct: 15 },
  { type: "trap_shift", min_pct: 15 },
  { type: "context_shift", min_pct: 15 },
  { type: "parameter_shift", min_pct: 0, max_pct: 40 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const p = body.payload || body;

    // Boundary normalization: accept both camelCase and snake_case
    const blueprintId = p.blueprintId ?? p.blueprint_id ?? null;
    const curriculumId = p.curriculumId ?? p.curriculum_id ?? null;
    const packageId = p.package_id ?? p.packageId ?? null;
    const isStudium = p.isStudium ?? p.is_studium ?? true;
    const minVariants = p.minVariants ?? p.min_variants ?? 10;
    const minAvgQuality = p.minAvgQuality ?? p.min_avg_quality ?? 70;
    const maxFlaggedPct = p.maxFlaggedPct ?? p.max_flagged_pct ?? 30;

    if (!blueprintId && !curriculumId && !packageId) {
      return new Response(JSON.stringify({ error: "blueprintId, curriculumId, or package_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve curriculum_id from package_id if needed
    let resolvedCurriculumId = curriculumId;
    if (!resolvedCurriculumId && packageId) {
      const { data: pkg } = await sb
        .from("course_packages")
        .select("curriculum_id")
        .eq("id", packageId)
        .single();
      resolvedCurriculumId = pkg?.curriculum_id ?? null;
    }

    if (!blueprintId && !resolvedCurriculumId) {
      return new Response(JSON.stringify({ error: "Could not resolve curriculum_id from package" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch blueprints to validate
    let blueprintIds: string[] = [];
    if (blueprintId) {
      blueprintIds = [blueprintId];
    } else {
      const { data: bps } = await sb
        .from("question_blueprints")
        .select("id")
        .eq("curriculum_id", resolvedCurriculumId!)
        .order("id", { ascending: true });
      blueprintIds = (bps ?? []).map((b: any) => b.id);
    }

    const distGates = isStudium ? STUDIUM_GATES : VOCATIONAL_GATES;
    const results: ValidationResult[] = [];
    let allPassed = true;

    for (const bpId of blueprintIds) {
      // Fetch blueprint name
      const { data: bpRow } = await sb
        .from("question_blueprints")
        .select("name")
        .eq("id", bpId)
        .single();

      // Fetch all variants for this blueprint
      const { data: variants, error: vErr } = await sb
        .from("exam_question_variants")
        .select("variant_type, quality_score, quality_flags, trap_applied, distractor_meta, status")
        .eq("blueprint_id", bpId)
        .order("id", { ascending: true });

      if (vErr || !variants) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bpRow?.name ?? "?",
          total_variants: 0,
          passed: false,
          gates: { min_variants: { passed: false, actual: 0, required: minVariants } },
        });
        allPassed = false;
        continue;
      }

      const total = variants.length;
      const gates: ValidationResult["gates"] = {};

      // Gate 1: Minimum variant count
      gates.min_variants = {
        passed: total >= minVariants,
        actual: total,
        required: minVariants,
      };

      // Gate 2: Distribution checks
      const typeCounts: Record<string, number> = {};
      for (const v of variants) typeCounts[v.variant_type] = (typeCounts[v.variant_type] ?? 0) + 1;

      for (const g of distGates) {
        const count = typeCounts[g.type] ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        const minOk = pct >= g.min_pct;
        const maxOk = g.max_pct == null || pct <= g.max_pct;
        gates[`dist_${g.type}`] = {
          passed: minOk && maxOk,
          actual: Math.round(pct),
          required: g.min_pct,
          detail: !maxOk ? `exceeds max ${g.max_pct}%` : undefined,
        };
      }

      // Gate 3: Average quality score
      const avgScore = total > 0
        ? variants.reduce((s, v) => s + (v.quality_score ?? 0), 0) / total
        : 0;
      gates.avg_quality = {
        passed: avgScore >= minAvgQuality,
        actual: Math.round(avgScore),
        required: minAvgQuality,
      };

      // Gate 4: Flagged variant percentage
      const flagged = variants.filter(
        (v) => v.quality_flags && Array.isArray(v.quality_flags) && v.quality_flags.length > 0
      ).length;
      const flaggedPct = total > 0 ? (flagged / total) * 100 : 0;
      gates.flagged_pct = {
        passed: flaggedPct <= maxFlaggedPct,
        actual: Math.round(flaggedPct),
        required: maxFlaggedPct,
        detail: "max allowed %",
      };

      // Gate 5: trap_applied coverage
      const withTrap = variants.filter((v) => v.trap_applied != null).length;
      const trapPct = total > 0 ? (withTrap / total) * 100 : 0;
      gates.trap_coverage = {
        passed: trapPct >= 60,
        actual: Math.round(trapPct),
        required: 60,
      };

      // Gate 6: distractor_meta coverage
      const withDist = variants.filter((v) => v.distractor_meta != null).length;
      const distPct = total > 0 ? (withDist / total) * 100 : 0;
      gates.distractor_meta_coverage = {
        passed: distPct >= 50,
        actual: Math.round(distPct),
        required: 50,
      };

      const bpPassed = Object.values(gates).every((g) => g.passed);
      if (!bpPassed) allPassed = false;

      results.push({
        blueprint_id: bpId,
        blueprint_name: bpRow?.name ?? "?",
        total_variants: total,
        passed: bpPassed,
        gates,
      });
    }

    const summary = {
      total_blueprints: results.length,
      passed_blueprints: results.filter((r) => r.passed).length,
      failed_blueprints: results.filter((r) => !r.passed).length,
      all_passed: allPassed,
    };

    return new Response(JSON.stringify({ ok: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validate-blueprint-variants error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
