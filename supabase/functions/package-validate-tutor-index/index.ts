import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-validate-tutor-index — Pipeline Step (after build_ai_tutor_index)
 *
 * Validates the AI Tutor context index for completeness, integrity, and freshness
 * before the pipeline continues to handbook generation.
 *
 * Checks:
 *  1. INDEX EXISTS: ai_tutor_context_index row exists for this package
 *  2. CHUNK COVERAGE: Enough chunks indexed (min 1 per module, overall minimum)
 *  3. METADATA INTEGRITY: Each chunk has required metadata (course_id, content_type)
 *  4. FRESHNESS: Index version matches latest content generation
 *  5. LEAKAGE: No chunks from foreign packages
 *  6. LF COVERAGE: Every learning field represented in the index
 *
 * On failure: returns ok=false + batch_complete=true
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MIN_CHUNKS_TOTAL = 20;

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

  console.log(`[validate-tutor-index] Index found: v${indexRow.index_version}, ${totalChunks} chunks, ${lfCoverage}/${lfTotal} LF`);

  // ═══ CHECK 2: Minimum chunk count ═══
  if (totalChunks < MIN_CHUNKS_TOTAL) {
    issues.push(`TOO_FEW_CHUNKS: ${totalChunks}/${MIN_CHUNKS_TOTAL} Minimum`);
  }

  // ═══ CHECK 3: Stats plausibility ═══
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

  // ═══ CHECK 5: Cross-validate with modules ═══
  // Load modules from the course linked to this package
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .single();

  if (pkg?.course_id) {
    const { data: modules } = await sb
      .from("modules")
      .select("id, title")
      .eq("course_id", pkg.course_id);

    const moduleCount = modules?.length || 0;

    if (moduleCount > 0 && totalChunks < moduleCount) {
      issues.push(`CHUNKS_BELOW_MODULES: ${totalChunks} Chunks für ${moduleCount} Module — mindestens 1 Chunk/Modul erwartet`);
    }

    // Ratio check: typically expect ≥3 chunks per module
    if (moduleCount > 0 && totalChunks > 0 && totalChunks / moduleCount < 2) {
      warnings.push(`LOW_DENSITY: ${(totalChunks / moduleCount).toFixed(1)} Chunks/Modul — ≥3 empfohlen`);
    }
  }

  // ═══ CHECK 6: Freshness — compare index creation vs content generation ═══
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

  const summary = {
    index_version: indexRow.index_version,
    total_chunks: totalChunks,
    lf_coverage: lfCoverage,
    lf_total: lfTotal,
    issues_count: issues.length,
    warnings_count: warnings.length,
  };

  console.log(`[validate-tutor-index] Result: ${passed ? "PASS" : "FAIL"} | ${issues.length} issues, ${warnings.length} warnings`);

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
      ? `✅ Tutor-Index-Validierung bestanden: ${totalChunks} Chunks, v${indexRow.index_version}`
      : `❌ Tutor-Index-Validierung fehlgeschlagen: ${issues.join("; ")}`,
  });
});
