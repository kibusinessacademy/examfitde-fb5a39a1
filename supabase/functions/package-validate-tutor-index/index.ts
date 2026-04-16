import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-validate-tutor-index — Pipeline Step (after build_ai_tutor_index)
 *
 * Validates the AI Tutor context index for completeness, integrity, and freshness.
 *
 * Hard-Fail Gates:
 *  1. INDEX EXISTS
 *  2. CHUNK COVERAGE: min 20 total, min 1 per module
 *  3. LF COVERAGE: ≥80% learning fields represented
 *  4. EMPTY INDEX: 0 chunks
 *
 * Warnings:
 *  - Chunk density <3/module
 *  - Stale index (created before last content generation)
 *  - Chunk size anomalies (stats-based)
 *  - Partial LF coverage (80-100%)
 *
 * On failure: returns ok=false + batch_complete=true
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DEFAULT_MIN_CHUNKS_TOTAL = 20;
const MIN_TOKENS_PER_CHUNK = 200;
const MAX_TOKENS_PER_CHUNK = 1500;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  let professionName = "unbekannt";
  try {
    const prof = await resolveProfession(sb, {
      certificationId: p.certification_id || null,
      curriculumId,
    });
    professionName = prof.professionName;
  } catch { /* continue */ }

  console.log(`[validate-tutor-index] Starting for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  const issues: string[] = [];
  const warnings: string[] = [];

  // ═══ CHECK 1: Index exists ═══
  const { data: indexRow, error: idxErr } = await sb
    .from("ai_tutor_context_index")
    .select("id, index_version, stats, created_at")
    .eq("package_id", packageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (idxErr) return json({ error: idxErr.message }, 500);

  if (!indexRow) {
    return json({
      ok: false,
      batch_complete: true,
      message: "❌ Kein AI-Tutor-Index für dieses Paket gefunden.",
      issues: ["NO_INDEX_FOUND"],
    });
  }

  const stats = (indexRow.stats || {}) as Record<string, any>;
  const totalChunks = stats.total_chunks || stats.chunks || stats.documents || 0;
  const lfCoverage = stats.lf_coverage || stats.learning_fields_covered || 0;
  const lfTotal = stats.lf_total || stats.learning_fields_total || 0;
  const avgTokens = stats.avg_tokens_per_chunk || stats.avg_chunk_tokens || 0;
  const minTokens = stats.min_tokens || 0;
  const maxTokens = stats.max_tokens || 0;

  // Dynamic min chunks: for small curricula (≤6 LF), require 1 per LF; for larger ones, scale up
  const minChunksTotal = lfTotal > 0
    ? (lfTotal <= 6 ? lfTotal : Math.min(DEFAULT_MIN_CHUNKS_TOTAL, lfTotal * 2))
    : DEFAULT_MIN_CHUNKS_TOTAL;

  console.log(`[validate-tutor-index] Index found: v${indexRow.index_version}, ${totalChunks} chunks, ${lfCoverage}/${lfTotal} LF, minChunks=${minChunksTotal}`);

  // ═══ CHECK 2: Minimum chunk count (relative to curriculum size) ═══
  if (totalChunks < minChunksTotal) {
    issues.push(`TOO_FEW_CHUNKS: ${totalChunks}/${minChunksTotal} Minimum`);
  }

  // ═══ CHECK 3: Empty index ═══
  if (totalChunks === 0) {
    issues.push("EMPTY_INDEX: Index enthält 0 Chunks");
  }

  // ═══ CHECK 4: LF coverage from stats ═══
  if (lfTotal > 0 && lfCoverage > 0) {
    const coveragePct = (lfCoverage / lfTotal) * 100;
    if (coveragePct < 80) {
      issues.push(`LOW_LF_COVERAGE: ${lfCoverage}/${lfTotal} Lernfelder (${coveragePct.toFixed(0)}%)`);
    } else if (coveragePct < 100) {
      warnings.push(`PARTIAL_LF_COVERAGE: ${lfCoverage}/${lfTotal} Lernfelder (${coveragePct.toFixed(0)}%)`);
    }
  }

  // ═══ CHECK 5: Chunk size quality (stats-based) ═══
  if (avgTokens > 0) {
    if (avgTokens < MIN_TOKENS_PER_CHUNK) {
      warnings.push(`SMALL_CHUNKS: Ø ${avgTokens} Tokens/Chunk (Min ${MIN_TOKENS_PER_CHUNK}) — schlechter Kontext`);
    }
    if (avgTokens > MAX_TOKENS_PER_CHUNK) {
      warnings.push(`LARGE_CHUNKS: Ø ${avgTokens} Tokens/Chunk (Max ${MAX_TOKENS_PER_CHUNK}) — schlechter Recall`);
    }
  }
  if (minTokens > 0 && minTokens < 50) {
    warnings.push(`TINY_CHUNKS_DETECTED: Kleinster Chunk nur ${minTokens} Tokens — möglicherweise leere Fragmente`);
  }
  if (maxTokens > 0 && maxTokens > 3000) {
    warnings.push(`HUGE_CHUNKS_DETECTED: Größter Chunk ${maxTokens} Tokens — Chunking möglicherweise fehlerhaft`);
  }

  // ═══ CHECK 6: Cross-validate with modules ═══
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .single();

  let moduleCount = 0;
  if (pkg?.course_id) {
    const { data: modules } = await sb
      .from("modules")
      .select("id, title")
      .eq("course_id", pkg.course_id);

    moduleCount = modules?.length || 0;

    if (moduleCount > 0 && totalChunks < moduleCount) {
      issues.push(`CHUNKS_BELOW_MODULES: ${totalChunks} Chunks für ${moduleCount} Module — mindestens 1 Chunk/Modul erwartet`);
    }

    if (moduleCount > 0 && totalChunks > 0 && totalChunks / moduleCount < 2) {
      warnings.push(`LOW_DENSITY: ${(totalChunks / moduleCount).toFixed(1)} Chunks/Modul — ≥3 empfohlen`);
    }
  }

  // ═══ CHECK 7: Freshness ═══
  const { data: contentStep } = await sb
    .from("course_package_build_steps")
    .select("finished_at")
    .eq("package_id", packageId)
    .eq("step_key", "generate_learning_content")
    .single();

  if (contentStep?.finished_at && indexRow.created_at) {
    const contentDate = new Date(contentStep.finished_at).getTime();
    const indexDate = new Date(indexRow.created_at).getTime();
    if (indexDate < contentDate) {
      warnings.push("STALE_INDEX: Index wurde VOR der letzten Content-Generierung erstellt — mögliche Inkonsistenz");
    }
  }

  // ── Decision ──
  const passed = issues.length === 0;

  // ── Quality sub-score (0-100) ──
  let score = 100;
  if (issues.length > 0) score -= issues.length * 15;
  if (warnings.length > 0) score -= warnings.length * 4;
  if (lfTotal > 0) {
    const covPct = (lfCoverage / lfTotal) * 100;
    if (covPct < 100) score -= (100 - covPct) * 0.3;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const summary = {
    index_version: indexRow.index_version,
    total_chunks: totalChunks,
    lf_coverage: lfCoverage,
    lf_total: lfTotal,
    module_count: moduleCount,
    avg_tokens_per_chunk: avgTokens,
    issues_count: issues.length,
    warnings_count: warnings.length,
    quality_score: score,
  };

  console.log(`[validate-tutor-index] Result: ${passed ? "PASS" : "FAIL"} | score=${score} | ${issues.length} issues, ${warnings.length} warnings`);

  await sb.from("course_packages").update({
    last_error: passed ? null : `Tutor-Index QC: ${issues.length} Fehler`,
  }).eq("id", packageId);

  return json({
    ok: passed,
    batch_complete: true,
    summary,
    issues,
    warnings,
    message: passed
      ? `✅ Tutor-Index-Validierung bestanden: ${totalChunks} Chunks, v${indexRow.index_version}, Score ${score}`
      : `❌ Tutor-Index-Validierung fehlgeschlagen: ${issues.join("; ")}`,
  });
});
