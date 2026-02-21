import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

/**
 * pool-rework — Scheduled Batch Job for Incremental Quality Upgrades
 *
 * Runs nightly (or on-demand) against published pools to bring them
 * up to current quality standards WITHOUT full regeneration.
 *
 * Four rework dimensions:
 *   1. CALC_QUOTA  — Backfill calculation questions to hit math_ratio target
 *   2. DIFFICULTY  — Re-label difficulty distribution to match target mix
 *   3. QC_REPLACE  — Flag/delete tier1_failed & needs_revision, trigger regen
 *   4. TRAP_TAGS   — Retrofit missing trap_tags on calc questions via LLM
 *
 * Guardrails:
 *   - Max 50 calc backfill per package per run
 *   - Max 200 difficulty re-labels per package
 *   - Max 100 QC replacements per package
 *   - Max 30 trap-tag retrofits per package (LLM calls)
 *   - Total budget: processes max 5 packages per invocation
 */

const MAX_PACKAGES_PER_RUN = 5;
const MAX_CALC_BACKFILL = 50;
const MAX_DIFFICULTY_RELABEL = 200;
const MAX_QC_DELETE = 100;
const MAX_TRAP_RETROFIT = 30;

const TARGET_DIFFICULTY: Record<string, number> = {
  easy: 0.25, medium: 0.35, hard: 0.25, very_hard: 0.15,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ReworkReport {
  packageId: string;
  curriculumId: string;
  profession: string;
  calcBackfill: { deficit: number; triggered: boolean };
  difficultyRebalance: { relabeled: number };
  qcReplace: { deleted: number; regenTriggered: boolean };
  trapRetrofit: { retrofitted: number; failed: number };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const forcePackageId = body.package_id || null; // optional: rework a specific package

  // ── Find eligible packages ──
  let query = sb
    .from("course_packages")
    .select("id, curriculum_id, certification_id")
    .eq("status", "published")
    .order("updated_at", { ascending: true })
    .limit(MAX_PACKAGES_PER_RUN);

  if (forcePackageId) {
    query = sb
      .from("course_packages")
      .select("id, curriculum_id, certification_id")
      .eq("id", forcePackageId)
      .limit(1);
  }

  const { data: packages, error: pkgErr } = await query;
  if (pkgErr) return json({ error: pkgErr.message }, 500);
  if (!packages?.length) return json({ ok: true, message: "No packages to rework" });

  console.log(`[pool-rework] Starting rework for ${packages.length} package(s)`);

  const reports: ReworkReport[] = [];

  for (const pkg of packages) {
    const report: ReworkReport = {
      packageId: pkg.id,
      curriculumId: pkg.curriculum_id,
      profession: "",
      calcBackfill: { deficit: 0, triggered: false },
      difficultyRebalance: { relabeled: 0 },
      qcReplace: { deleted: 0, regenTriggered: false },
      trapRetrofit: { retrofitted: 0, failed: 0 },
    };

    let professionName: string;
    try {
      const prof = await resolveProfession(sb, {
        certificationId: pkg.certification_id,
        curriculumId: pkg.curriculum_id,
      });
      professionName = prof.professionName;
      report.profession = professionName;
    } catch {
      console.log(`[pool-rework] Skip ${pkg.id.slice(0, 8)}: profession resolve failed`);
      continue;
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 1: CALC QUOTA BACKFILL
    // ════════════════════════════════════════════════════════════════
    try {
      const { count: totalCount } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id);

      const { count: calcCount } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("question_type", "calculation");

      const total = totalCount ?? 0;
      const calc = calcCount ?? 0;
      const calcRatio = 0.20; // default; could load from certification_catalog
      const calcTarget = Math.ceil(total * calcRatio);
      const deficit = calcTarget - calc;

      report.calcBackfill.deficit = deficit;

      if (deficit > 0) {
        const cappedDeficit = Math.min(deficit, MAX_CALC_BACKFILL);
        // Trigger the existing exam-pool function with a targeted payload
        const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/package-generate-exam-pool`;
        const triggerPayload = {
          package_id: pkg.id,
          curriculum_id: pkg.curriculum_id,
          certification_id: pkg.certification_id,
          rework_mode: "calc_backfill_only",
          calc_deficit: cappedDeficit,
        };

        // Enqueue as a job instead of direct call (avoids timeout)
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "package-generate-exam-pool",
          payload: triggerPayload,
          status: "pending",
          job_type: "generate_exam_pool",
          curriculum_id: pkg.curriculum_id,
          package_id: pkg.id,
        });

        if (jobErr && !jobErr.message?.includes("duplicate")) {
          console.log(`[pool-rework] Calc backfill job enqueue failed: ${jobErr.message}`);
        } else {
          report.calcBackfill.triggered = true;
          console.log(`[pool-rework] CALC_BACKFILL queued: pkg=${pkg.id.slice(0, 8)}, deficit=${cappedDeficit}/${deficit}`);
        }
      } else {
        console.log(`[pool-rework] CALC_OK: ${calc}/${total} = ${(100 * calc / Math.max(total, 1)).toFixed(1)}%`);
      }
    } catch (e) {
      console.log(`[pool-rework] Calc check error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 2: DIFFICULTY RE-BALANCING (SQL-only, no LLM)
    // ════════════════════════════════════════════════════════════════
    try {
      // Get current distribution
      const { data: diffDist } = await sb
        .from("exam_questions")
        .select("difficulty, id")
        .eq("curriculum_id", pkg.curriculum_id);

      if (diffDist && diffDist.length > 0) {
        const total = diffDist.length;
        const counts: Record<string, string[]> = {};
        for (const q of diffDist) {
          const d = q.difficulty || "medium";
          if (!counts[d]) counts[d] = [];
          counts[d].push(q.id);
        }

        let relabeled = 0;

        for (const [targetDiff, targetRatio] of Object.entries(TARGET_DIFFICULTY)) {
          const targetCount = Math.round(total * targetRatio);
          const current = counts[targetDiff]?.length ?? 0;
          const surplus = current - targetCount;

          if (surplus > 10) {
            // Find difficulty that's under-represented
            const underRep = Object.entries(TARGET_DIFFICULTY).find(([d, r]) => {
              const c = counts[d]?.length ?? 0;
              return c < Math.round(total * r) - 5;
            });

            if (underRep) {
              const [targetLabel] = underRep;
              const toRelabel = Math.min(surplus, MAX_DIFFICULTY_RELABEL - relabeled, Math.round(total * targetRatio) - (counts[targetLabel]?.length ?? 0));
              if (toRelabel > 0) {
                const ids = counts[targetDiff]!.slice(0, toRelabel);
                // Batch update in chunks of 50
                for (let i = 0; i < ids.length; i += 50) {
                  const chunk = ids.slice(i, i + 50);
                  await sb
                    .from("exam_questions")
                    .update({ difficulty: targetLabel })
                    .in("id", chunk);
                }
                relabeled += toRelabel;
                console.log(`[pool-rework] DIFF_RELABEL: ${toRelabel} questions ${targetDiff} → ${targetLabel}`);
              }
            }
          }
        }

        report.difficultyRebalance.relabeled = relabeled;
        if (relabeled === 0) {
          console.log(`[pool-rework] DIFF_OK: distribution within tolerance`);
        }
      }
    } catch (e) {
      console.log(`[pool-rework] Difficulty rebalance error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 3: QC-FAILED REPLACEMENT
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: failedQs } = await sb
        .from("exam_questions")
        .select("id")
        .eq("curriculum_id", pkg.curriculum_id)
        .in("qc_status", ["tier1_failed", "needs_revision"])
        .limit(MAX_QC_DELETE);

      if (failedQs && failedQs.length > 0) {
        const ids = failedQs.map((q) => q.id);
        // Delete in chunks
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          await sb.from("exam_questions").delete().in("id", chunk);
        }
        report.qcReplace.deleted = ids.length;

        // Trigger regen via job queue (same as calc backfill but for general questions)
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "package-generate-exam-pool",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            rework_mode: "qc_replacement",
            replacement_count: ids.length,
          },
          status: "pending",
          job_type: "generate_exam_pool",
          curriculum_id: pkg.curriculum_id,
          package_id: pkg.id,
        });

        if (!jobErr || jobErr.message?.includes("duplicate")) {
          report.qcReplace.regenTriggered = true;
        }

        console.log(`[pool-rework] QC_REPLACE: deleted ${ids.length} failed questions, regen queued`);
      } else {
        console.log(`[pool-rework] QC_OK: no failed questions`);
      }
    } catch (e) {
      console.log(`[pool-rework] QC replace error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 4: TRAP-TAGS RETROFIT (LLM for calc questions without tags)
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: untagged } = await sb
        .from("exam_questions")
        .select("id, question_text, options, correct_answer, explanation")
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("question_type", "calculation")
        .or("trap_tags.is.null,trap_tags.eq.{}")
        .limit(MAX_TRAP_RETROFIT);

      if (untagged && untagged.length > 0) {
        const routed = getModel("quality_audit");
        let retrofitted = 0;
        let failed = 0;

        for (const q of untagged) {
          try {
            const result = await callAIJSON({
              provider: routed.provider,
              model: routed.model,
              messages: [
                {
                  role: "system",
                  content: `Du bist ein IHK-Prüfungsexperte für ${professionName}. Analysiere die folgende Rechenaufgabe und identifiziere typische Prüfungsfallen (trap_tags).

Antworte NUR mit JSON: {"trap_tags": ["tag1", "tag2"], "distractor_analysis": [{"option_index": 0, "error_tag": "tag", "why_wrong": "..."}]}

Verwende nur Tags aus diesem Vokabular: percent_base, percent_direction, gross_net, brutto_netto, tax_included, rounding_error, unit_conversion, off_by_one, formula_swap, sign_error, skonto_rabatt_order, divisor_swap, period_mismatch, threshold_boundary, carry_error, decimal_shift, operator_precedence, partial_calculation, wrong_reference_value, interpolation_error, base_rate_fallacy, cumulative_vs_marginal, stock_flow_confusion, weight_average_error, compound_vs_simple`,
                },
                {
                  role: "user",
                  content: `FRAGE: ${q.question_text}\n\nOPTIONEN:\n${(Array.isArray(q.options) ? q.options : []).map((o: string, i: number) => `${i === q.correct_answer ? "✓" : "✗"} ${i + 1}. ${o}`).join("\n")}\n\nERKLÄRUNG: ${q.explanation || "(keine)"}`,
                },
              ],
              max_tokens: 800,
            });

            const clean = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const parsed = JSON.parse(clean);
            const tags = Array.isArray(parsed.trap_tags) ? parsed.trap_tags : [];

            if (tags.length > 0) {
              const normalizedTags = tags.map((t: string) =>
                String(t).toLowerCase().replace(/[\s-]+/g, "_").trim()
              );

              const updateData: Record<string, unknown> = { trap_tags: normalizedTags };
              if (parsed.distractor_analysis) {
                updateData.distractor_meta = parsed.distractor_analysis;
              }

              await sb.from("exam_questions").update(updateData).eq("id", q.id);
              retrofitted++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }

          // Rate limit protection
          await new Promise((r) => setTimeout(r, 2000));
        }

        report.trapRetrofit = { retrofitted, failed };
        console.log(`[pool-rework] TRAP_RETROFIT: ${retrofitted} tagged, ${failed} failed out of ${untagged.length}`);
      } else {
        console.log(`[pool-rework] TRAP_OK: all calc questions have trap_tags`);
      }
    } catch (e) {
      console.log(`[pool-rework] Trap retrofit error: ${(e as Error).message}`);
    }

    reports.push(report);
  }

  // Log summary
  const summary = {
    packagesProcessed: reports.length,
    totalCalcBackfills: reports.filter((r) => r.calcBackfill.triggered).length,
    totalDiffRelabeled: reports.reduce((s, r) => s + r.difficultyRebalance.relabeled, 0),
    totalQcDeleted: reports.reduce((s, r) => s + r.qcReplace.deleted, 0),
    totalTrapRetrofitted: reports.reduce((s, r) => s + r.trapRetrofit.retrofitted, 0),
  };

  console.log(`[pool-rework] DONE: ${JSON.stringify(summary)}`);

  // Insert ops alert for visibility
  await sb
    .from("ops_alerts")
    .insert({
      source: "pool-rework",
      severity: "info",
      message: `Rework: ${summary.packagesProcessed} pkgs, +${summary.totalCalcBackfills} calc-jobs, ${summary.totalDiffRelabeled} diff-relabeled, ${summary.totalQcDeleted} qc-deleted, ${summary.totalTrapRetrofitted} trap-tagged`,
      payload: { summary, reports },
    })
    .then(() => {})
    .catch(() => {});

  return json({ ok: true, summary, reports });
});
