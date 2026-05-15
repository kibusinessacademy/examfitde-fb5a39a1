import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Gate definitions (unchanged) ──────────────────────────────
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

const HARD_FLAGS = new Set([
  "MISSING_TRAP",
  "TOO_FEW_DISTRACTORS",
  "TRANSFER_WITHOUT_NEW_CONTEXT",
]);

interface ValidationResult {
  blueprint_id: string;
  blueprint_name: string;
  total_variants: number;
  reviewed: number;
  rejected: number;
  kept_review: number;
  passed: boolean;
  gates: Record<string, { passed: boolean; actual: number; required: number; detail?: string }>;
}

/** Decide reject vs keep for a single review-status variant */
function shouldReject(v: any, minQuality: number): { reject: boolean; reason?: string } {
  const flags: string[] = Array.isArray(v.quality_flags) ? v.quality_flags : [];
  const hard = flags.find((f) => HARD_FLAGS.has(f));
  if (hard) return { reject: true, reason: `hard_flag:${hard}` };

  if (v.quality_score == null || Number(v.quality_score) < minQuality) {
    return { reject: true, reason: `quality_below_${minQuality}` };
  }
  if (!v.question_text || String(v.question_text).length < 20) {
    return { reject: true, reason: "question_text_too_short" };
  }
  if (!Array.isArray(v.options) || v.options.length < 2) {
    return { reject: true, reason: "options_insufficient" };
  }
  const correctIdx = v.options.findIndex((o: any) => o && o.is_correct === true);
  if (correctIdx < 0) return { reject: true, reason: "no_correct_answer" };

  return { reject: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Aggregate result that we ALWAYS persist to variant_validation_worker_result
  let auditPayload: Record<string, unknown> = {};

  try {
    const body = await req.json();
    const p = body.payload || body;

    const blueprintId = p.blueprintId ?? p.blueprint_id ?? null;
    const curriculumId = p.curriculumId ?? p.curriculum_id ?? null;
    const packageId = p.package_id ?? p.packageId ?? null;
    const jobId = p.job_id ?? p.jobId ?? body.job_id ?? null;
    const isStudium = p.isStudium ?? p.is_studium ?? true;
    const minVariants = p.minVariants ?? p.min_variants ?? 10;
    const minAvgQuality = p.minAvgQuality ?? p.min_avg_quality ?? 70;
    const maxFlaggedPct = p.maxFlaggedPct ?? p.max_flagged_pct ?? 30;
    const dryRun = p.dryRun ?? p.dry_run ?? false;

    if (!blueprintId && !curriculumId && !packageId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "blueprintId, curriculumId, or package_id required",
          noop_reason: "missing_scope",
          reviewed_count: 0,
          rejected_count: 0,
          approved_count: 0,
          status_changed_count: 0,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Could not resolve curriculum_id from package",
          noop_reason: "scope_unresolvable",
          reviewed_count: 0,
          rejected_count: 0,
          approved_count: 0,
          status_changed_count: 0,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Resolve blueprints in scope ────────────────────────────
    const blueprintIds: string[] = [];
    const blueprintNames = new Map<string, string>();

    if (blueprintId) {
      blueprintIds.push(blueprintId);
      const { data: bpRow } = await sb
        .from("question_blueprints")
        .select("id, name")
        .eq("id", blueprintId)
        .single();
      if (bpRow) blueprintNames.set(bpRow.id, bpRow.name ?? "?");
    } else {
      const { data: bps } = await sb
        .from("question_blueprints")
        .select("id, name")
        .eq("curriculum_id", resolvedCurriculumId!)
        .order("id", { ascending: true });
      for (const bp of bps ?? []) {
        blueprintIds.push(bp.id);
        blueprintNames.set(bp.id, bp.name ?? "?");
      }
    }

    const scope = blueprintId ? "blueprint" : packageId ? "package" : "curriculum";

    if (blueprintIds.length === 0) {
      auditPayload = {
        scope,
        ok: false,
        noop_reason: "no_blueprints_in_scope",
        reviewed_count: 0,
        rejected_count: 0,
        approved_count: 0,
        kept_review_count: 0,
      };
      await sb.from("variant_validation_worker_result").insert({
        job_id: jobId,
        package_id: packageId,
        curriculum_id: resolvedCurriculumId,
        blueprint_id: blueprintId,
        scope,
        ok: false,
        noop_reason: "no_blueprints_in_scope",
      });
      return new Response(
        JSON.stringify({
          ok: false,
          noop_reason: "no_blueprints_in_scope",
          reviewed_count: 0,
          rejected_count: 0,
          approved_count: 0,
          status_changed_count: 0,
          summary: { total_blueprints: 0 },
          results: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch ALL variants in scope (paginated) ────────────────
    const allVariants: any[] = [];
    const PAGE_SIZE = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: vErr } = await sb
        .from("exam_question_variants")
        .select("id, blueprint_id, variant_type, quality_score, quality_flags, trap_applied, distractor_meta, status, question_text, options")
        .in("blueprint_id", blueprintIds)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (vErr) {
        console.error("variant fetch error:", vErr.message);
        break;
      }
      if (page && page.length > 0) {
        allVariants.push(...page);
        offset += page.length;
        hasMore = page.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // ── Per-variant classification phase 1: reject ─────────────
    // Only status='review' is mutated. Approve happens in phase 2 after gates.
    const APPROVE_MIN_QUALITY = 80;
    const rejectIds: string[] = [];
    const rejectIdSet = new Set<string>();
    const candidateApproveByBp = new Map<string, string[]>(); // bp → variant ids passing variant-level approve checks
    let reviewedCount = 0;
    let rejectedCount = 0;

    for (const v of allVariants) {
      if (v.status !== "review") continue;
      reviewedCount++;
      const dec = shouldReject(v, minAvgQuality);
      if (dec.reject) {
        rejectIds.push(v.id);
        rejectIdSet.add(v.id);
        rejectedCount++;
        continue;
      }

      // Variant-level approve eligibility (gate-summary clean is checked later per blueprint)
      const flags: string[] = Array.isArray(v.quality_flags) ? v.quality_flags : [];
      const noHardFlags = !flags.some((f) => HARD_FLAGS.has(f));
      const qOk = v.quality_score != null && Number(v.quality_score) >= APPROVE_MIN_QUALITY;
      const textOk = typeof v.question_text === "string" && v.question_text.length >= 20;
      const optsOk = Array.isArray(v.options) && v.options.length >= 2 &&
        v.options.findIndex((o: any) => o && o.is_correct === true) >= 0;

      if (noHardFlags && qOk && textOk && optsOk) {
        const arr = candidateApproveByBp.get(v.blueprint_id) || [];
        arr.push(v.id);
        candidateApproveByBp.set(v.blueprint_id, arr);
      }
    }

    // ── Bulk reject (chunked to keep PostgREST URLs sane) ──
    if (!dryRun && rejectIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < rejectIds.length; i += CHUNK) {
        const slice = rejectIds.slice(i, i + CHUNK);
        const { error: uErr } = await sb
          .from("exam_question_variants")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .in("id", slice);
        if (uErr) {
          console.error("variant reject update error:", uErr.message, "chunk", i);
          rejectedCount = i + slice.length === rejectIds.length ? rejectedCount : i;
          break;
        }
      }
    }

    // ── Per-blueprint gate evaluation (after rejection so gates see live state) ──
    const variantsByBlueprint = new Map<string, any[]>();
    for (const v of allVariants) {
      const live = rejectIdSet.has(v.id) ? { ...v, status: "rejected" } : v;
      const arr = variantsByBlueprint.get(live.blueprint_id) || [];
      arr.push(live);
      variantsByBlueprint.set(live.blueprint_id, arr);
    }

    const distGates = isStudium ? STUDIUM_GATES : VOCATIONAL_GATES;
    const results: ValidationResult[] = [];
    let allPassed = true;

    for (const bpId of blueprintIds) {
      const variants = (variantsByBlueprint.get(bpId) || []).filter((v) => v.status !== "rejected");
      const total = variants.length;
      const gates: ValidationResult["gates"] = {};

      gates.min_variants = { passed: total >= minVariants, actual: total, required: minVariants };

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

      const avgScore = total > 0
        ? variants.reduce((s: number, v: any) => s + (Number(v.quality_score) || 0), 0) / total
        : 0;
      gates.avg_quality = { passed: avgScore >= minAvgQuality, actual: Math.round(avgScore), required: minAvgQuality };

      const flagged = variants.filter((v: any) => Array.isArray(v.quality_flags) && v.quality_flags.length > 0).length;
      const flaggedPct = total > 0 ? (flagged / total) * 100 : 0;
      gates.flagged_pct = { passed: flaggedPct <= maxFlaggedPct, actual: Math.round(flaggedPct), required: maxFlaggedPct };

      const withTrap = variants.filter((v: any) => v.trap_applied != null).length;
      const trapPct = total > 0 ? (withTrap / total) * 100 : 0;
      gates.trap_coverage = { passed: trapPct >= 60, actual: Math.round(trapPct), required: 60 };

      const withDist = variants.filter((v: any) => v.distractor_meta != null).length;
      const distPct = total > 0 ? (withDist / total) * 100 : 0;
      gates.distractor_meta_coverage = { passed: distPct >= 50, actual: Math.round(distPct), required: 50 };

      const bpPassed = Object.values(gates).every((g) => g.passed);
      if (!bpPassed) allPassed = false;

      results.push({
        blueprint_id: bpId,
        blueprint_name: blueprintNames.get(bpId) ?? "?",
        total_variants: total,
        reviewed: (variantsByBlueprint.get(bpId) || []).filter((v) => v.status === "rejected" || v.status === "review").length,
        rejected: (variantsByBlueprint.get(bpId) || []).filter((v) => v.status === "rejected").length,
        kept_review: (variantsByBlueprint.get(bpId) || []).filter((v) => v.status === "review").length,
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

    // ── Phase 2: APPROVE pass — only for variants whose blueprint passed gates ──
    const approveIds: string[] = [];
    const approveIdSet = new Set<string>();
    for (const r of results) {
      if (!r.passed) continue;
      const cands = candidateApproveByBp.get(r.blueprint_id) || [];
      for (const id of cands) {
        approveIds.push(id);
        approveIdSet.add(id);
      }
    }

    let approvedCount = 0;
    if (!dryRun && approveIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < approveIds.length; i += CHUNK) {
        const slice = approveIds.slice(i, i + CHUNK);
        const { error: aErr } = await sb
          .from("exam_question_variants")
          .update({ status: "approved", updated_at: new Date().toISOString() })
          .in("id", slice)
          .eq("status", "review"); // safety: only flip review→approved
        if (aErr) {
          console.error("variant approve update error:", aErr.message, "chunk", i);
          break;
        }
        approvedCount += slice.length;
      }
    }

    // kept = reviewed - rejected - approved (idempotent definition)
    const keptReview = Math.max(0, reviewedCount - rejectedCount - approvedCount);
    const statusChangedCount = rejectedCount + approvedCount;

    // ── FAIL-CLOSED: if no review variants existed in scope, this is a no-op. ──
    let ok = true;
    let noopReason: string | null = null;
    if (reviewedCount === 0) {
      ok = false;
      noopReason = "no_review_variants_in_scope";
    }

    auditPayload = {
      scope,
      ok,
      noop_reason: noopReason,
      reviewed_count: reviewedCount,
      rejected_count: rejectedCount,
      approved_count: approvedCount,
      kept_review_count: keptReview,
      status_changed_count: statusChangedCount,
      gate_summary: summary,
    };

    // Persist audit row (best-effort; never block the response)
    try {
      await sb.from("variant_validation_worker_result").insert({
        job_id: jobId,
        package_id: packageId,
        curriculum_id: resolvedCurriculumId,
        blueprint_id: blueprintId,
        scope,
        reviewed_count: reviewedCount,
        rejected_count: rejectedCount,
        approved_count: approvedCount,
        kept_review_count: keptReview,
        status_changed_count: statusChangedCount,
        ok,
        noop_reason: noopReason,
        gate_summary: summary,
        notes: { dry_run: dryRun, blueprints: blueprintIds.length, approve_min_quality: 80 },
      });
    } catch (auditErr) {
      console.error("vvwr insert failed:", auditErr instanceof Error ? auditErr.message : auditErr);
    }

    return new Response(
      JSON.stringify({
        ok,
        noop_reason: noopReason,
        reviewed_count: reviewedCount,
        rejected_count: rejectedCount,
        approved_count: approvedCount,
        kept_review_count: keptReview,
        status_changed_count: statusChangedCount,
        summary,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("validate-blueprint-variants error:", e);
    // Best-effort audit of the failure
    try {
      await sb.from("variant_validation_worker_result").insert({
        scope: "error",
        ok: false,
        noop_reason: `exception:${e instanceof Error ? e.message : "unknown"}`.slice(0, 500),
        ...auditPayload,
      });
    } catch (_) { /* swallow */ }

    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
        noop_reason: "exception",
        reviewed_count: 0,
        rejected_count: 0,
        approved_count: 0,
        status_changed_count: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
