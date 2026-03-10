import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * package-validate-handbook-depth — Optional Quality/Elite Gate
 *
 * Soft gate: validates depth/quality of expanded handbook sections.
 * This step does NOT block basis publication — it only assigns quality tiers.
 *
 * Checks:
 * - Depth markers (examples, exam traps, transfer, misconceptions)
 * - Expansion coverage (% of sections expanded)
 * - Quality scores
 *
 * Results in a quality_tier: "standard" | "enhanced" | "elite"
 * This is informational — it NEVER fails the pipeline.
 */

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
const ELITE_DEPTH_SCORE = 75;    // ≥75% depth markers → elite
const ENHANCED_DEPTH_SCORE = 40; // ≥40% → enhanced, below → standard
const ELITE_EXPAND_COVERAGE = 90; // ≥90% sections expanded → can be elite
const ENHANCED_EXPAND_COVERAGE = 50; // ≥50% → enhanced

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

  // Load chapters
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (chErr || !chapters?.length) {
    return json({
      ok: true,
      batch_complete: true,
      basis_pass: true,
      depth_pass: false,
      quality_tier: "standard",
      message: "No chapters found",
    });
  }

  const chapterIds = chapters.map((c: any) => c.id);

  // Load all sections with expand data
  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("id, basis_content, expanded_content, expand_status, content_tier, quality_score, depth_markers")
    .in("chapter_id", chapterIds);

  if (secErr) throw new Error(`Section query: ${secErr.message}`);

  const allSections = sections || [];
  const totalSections = allSections.length;

  if (totalSections === 0) {
    return json({
      ok: true,
      batch_complete: true,
      basis_pass: true,
      depth_pass: false,
      quality_tier: "standard",
      message: "No sections",
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

  // Count depth marker coverage across all expanded sections
  const markerCounts: Record<string, number> = {};
  for (const s of expanded) {
    const markers = (s.depth_markers || {}) as Record<string, boolean>;
    for (const [key, val] of Object.entries(markers)) {
      if (val) markerCounts[key] = (markerCounts[key] || 0) + 1;
    }
  }

  // Determine quality tier
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

  // This step ALWAYS passes (soft gate) — quality_tier is informational
  return json({
    ok: true,
    batch_complete: true,
    basis_pass: true,
    depth_pass: depthPass,
    quality_tier: qualityTier,
    soft_fail: !depthPass,
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
