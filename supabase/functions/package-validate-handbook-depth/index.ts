import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkValidatorBypass, buildBypassMeta, buildFullRunMeta } from "../_shared/validator-bypass.ts";
import { mergePackageStepMeta } from "../_shared/merge-step-meta.ts";

/**
 * package-validate-handbook-depth — Optional Quality/Elite Gate
 *
 * v2: Fingerprint-based bypass support.
 * If handbook artifact is unchanged since last successful validation,
 * the step is bypassed (marked done) without running the expensive checks.
 *
 * Soft gate: validates depth/quality of expanded handbook sections.
 * This step does NOT block basis publication — it only assigns quality tiers.
 */

const VALIDATOR_VERSION = "v1";

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

// Thresholds for quality tiers
const ELITE_DEPTH_SCORE = 75;
const ENHANCED_DEPTH_SCORE = 40;
const ELITE_EXPAND_COVERAGE = 90;
const ENHANCED_EXPAND_COVERAGE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p?.package_id as string;
  const curriculumId = p?.curriculum_id as string;

  if (!packageId || !curriculumId) {
    return json({ error: "package_id and curriculum_id required" }, 400);
  }

  // ── Phase 1: Check bypass eligibility ──
  const bypass = await checkValidatorBypass(sb, {
    packageId,
    stepKey: "validate_handbook_depth",
    curriculumId,
    validatorVersion: VALIDATOR_VERSION,
    fingerprintFn: "fn_compute_handbook_depth_fingerprint",
  });

  if (bypass.eligible) {
    console.log(`[validate-handbook-depth] BYPASS for ${packageId.slice(0, 8)}: ${bypass.reason} (fp=${bypass.fingerprint?.slice(0, 12)})`);

    // Atomically store bypass meta
    await mergePackageStepMeta(sb, packageId, "validate_handbook_depth",
      buildBypassMeta(bypass, { quality_tier: "reused" }),
    );

    return json({
      ok: true,
      batch_complete: true,
      basis_pass: true,
      depth_pass: true,
      quality_tier: "reused",
      bypassed: true,
      bypass_reason: bypass.reason,
      fingerprint: bypass.fingerprint,
    });
  }

  console.log(`[validate-handbook-depth] FULL RUN for ${packageId.slice(0, 8)}: bypass_ineligible=${bypass.reason}`);

  // ── Phase 2: Full validation (unchanged logic) ──
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (chErr || !chapters?.length) {
    return json({
      ok: true, batch_complete: true, basis_pass: true,
      depth_pass: false, quality_tier: "standard", message: "No chapters found",
    });
  }

  const chapterIds = chapters.map((c: any) => c.id);

  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("id, basis_content, expanded_content, expand_status, content_tier, quality_score, depth_markers")
    .in("chapter_id", chapterIds);

  if (secErr) throw new Error(`Section query: ${secErr.message}`);

  const allSections = sections || [];
  const totalSections = allSections.length;

  if (totalSections === 0) {
    return json({
      ok: true, batch_complete: true, basis_pass: true,
      depth_pass: false, quality_tier: "standard", message: "No sections",
    });
  }

  // Calculate metrics
  const expanded = allSections.filter((s: any) => s.expand_status === "done" && s.expanded_content);
  const expandCoverage = Math.round((expanded.length / totalSections) * 100);

  const depthScores = expanded
    .map((s: any) => (s.quality_score as number) || 0)
    .filter(s => s > 0);
  const avgDepthScore = depthScores.length > 0
    ? Math.round(depthScores.reduce((a, b) => a + b, 0) / depthScores.length)
    : 0;

  const markerCounts: Record<string, number> = {};
  for (const s of expanded) {
    const markers = (s.depth_markers || {}) as Record<string, boolean>;
    for (const [key, val] of Object.entries(markers)) {
      if (val) markerCounts[key] = (markerCounts[key] || 0) + 1;
    }
  }

  let qualityTier: "standard" | "enhanced" | "elite" = "standard";
  let depthPass = false;

  if (expandCoverage >= ELITE_EXPAND_COVERAGE && avgDepthScore >= ELITE_DEPTH_SCORE) {
    qualityTier = "elite";
    depthPass = true;
  } else if (expandCoverage >= ENHANCED_EXPAND_COVERAGE && avgDepthScore >= ENHANCED_DEPTH_SCORE) {
    qualityTier = "enhanced";
    depthPass = true;
  }

  const failedSoft = allSections.filter((s: any) => s.expand_status === "failed_soft").length;
  const pending = allSections.filter((s: any) => s.expand_status === "pending").length;
  const notReady = allSections.filter((s: any) => s.expand_status === "not_ready").length;

  console.log(`[validate-handbook-depth] Package ${packageId.slice(0, 8)}: tier=${qualityTier}, expand_coverage=${expandCoverage}%, avg_depth=${avgDepthScore}%, expanded=${expanded.length}/${totalSections}, failed_soft=${failedSoft}, pending=${pending}`);

  // ── Phase 3: Store fingerprint for future bypass ──
  if (bypass.fingerprint) {
    await mergePackageStepMeta(sb, packageId, "validate_handbook_depth",
      buildFullRunMeta(bypass.fingerprint, VALIDATOR_VERSION, {
        quality_tier: qualityTier,
        chapter_count: chapters.length,
        section_count: totalSections,
        expanded_sections: expanded.length,
        expand_coverage_pct: expandCoverage,
        avg_depth_score: avgDepthScore,
      }),
    );
  }

  return json({
    ok: true,
    batch_complete: true,
    basis_pass: true,
    depth_pass: depthPass,
    quality_tier: qualityTier,
    soft_fail: !depthPass,
    bypassed: false,
    fingerprint: bypass.fingerprint,
    metrics: {
      total_sections: totalSections,
      expanded_sections: expanded.length,
      expand_coverage_pct: expandCoverage,
      avg_depth_score: avgDepthScore,
      failed_soft: failedSoft,
      pending,
      not_ready: notReady,
      marker_counts: markerCounts,
    },
  });
});
