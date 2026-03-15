/**
 * batch-result-importer — Routes completed batch results to domain-specific importers.
 *
 * Called after batch-poll marks a batch as completed + results_imported_at is set.
 * Reads parsed results from llm_batch_requests and dispatches to domain handlers.
 *
 * POST { batch_id: string }
 *
 * Supported job_types:
 *   - exam_pool_generate → inserts into exam_questions (full pipeline)
 *   - learning_content   → stub (Phase C)
 *   - handbook_section   → stub (Phase C)
 *   - blueprint_enrich   → stub (Phase C)
 *
 * Idempotency: Each request row is only imported if domain_imported_at IS NULL.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

interface ImportResult {
  ok: boolean;
  custom_id: string;
  imported_count?: number;
  error?: string | null;
}

// ── Shared Helpers ────────────────────────────────────────────────────────────

function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

function textNgrams(text: string, n = 3): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, "").trim();
  const words = cleaned.split(/\s+/);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

const TEXT_SIMILARITY_THRESHOLD = 0.55;

// ── Exam Pool Importer ───────────────────────────────────────────────────────

async function importExamPoolBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  let successCount = 0;
  let failCount = 0;

  // Load existing hashes for dedup (from same curriculum)
  const curriculumId = (batch as any).metadata?.curriculum_id;
  const existingHashes = new Set<string>();
  const existingNgramSets: Set<string>[] = [];

  if (curriculumId) {
    const { data: existingQs } = await sb
      .from("exam_questions")
      .select("question_text")
      .eq("curriculum_id", curriculumId)
      .neq("status", "rejected")
      .limit(5000);

    if (existingQs) {
      for (const eq of existingQs) {
        existingHashes.add(simpleHash(eq.question_text));
        existingNgramSets.push(textNgrams(eq.question_text));
      }
    }
  }

  // Load profession name for contamination check
  let professionName = "";
  if (curriculumId) {
    const { data: curric } = await sb
      .from("curricula")
      .select("beruf_id, berufe(bezeichnung_kurz)")
      .eq("id", curriculumId)
      .single();
    professionName = (curric as any)?.berufe?.bezeichnung_kurz || "";
  }

  const now = new Date().toISOString();
  const allInserts: any[] = [];

  for (const row of rows) {
    const customId = String(row.custom_id);
    try {
      const body = row.response_body as any;
      if (!body) {
        details.push({ ok: false, custom_id: customId, error: "No response body" });
        failCount++;
        continue;
      }

      // Extract AI response content
      const content = body?.choices?.[0]?.message?.content;
      if (!content) {
        details.push({ ok: false, custom_id: customId, error: "No choices in response" });
        failCount++;
        continue;
      }

      let parsed: any;
      try {
        parsed = typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        details.push({ ok: false, custom_id: customId, error: "Response not valid JSON" });
        failCount++;
        continue;
      }

      // Extract source references from source_ref or custom_id
      const sourceRef = row.source_ref as any;
      const blueprintId = sourceRef?.blueprint_id || null;
      const lfId = sourceRef?.learning_field_id || null;
      const competencyId = sourceRef?.competency_id || null;
      const difficulty = sourceRef?.difficulty || "medium";
      const cognitiveLevel = sourceRef?.cognitive_level || "apply";
      const questionType = sourceRef?.question_type || "concept";

      const questions = Array.isArray(parsed?.questions) ? parsed.questions
        : Array.isArray(parsed) ? parsed
        : [parsed];

      let importedThisRow = 0;

      for (const q of questions) {
        if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) continue;

        // Correct answer validation
        const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : (q.correct_answer ?? 0);
        if (typeof correctIdx !== "number" || correctIdx < 0 || correctIdx >= q.options.length) continue;

        // Question text minimum length (governance constraint)
        if (q.question_text.length < 10) continue;

        // Hash dedup
        const hash = simpleHash(q.question_text);
        if (existingHashes.has(hash)) continue;
        existingHashes.add(hash);

        // Jaccard n-gram dedup
        const qNgrams = textNgrams(q.question_text);
        let tooSimilar = false;
        const checkWindow = existingNgramSets.slice(-200);
        for (const existing of checkWindow) {
          if (jaccardSimilarity(qNgrams, existing) > TEXT_SIMILARITY_THRESHOLD) {
            tooSimilar = true;
            break;
          }
        }
        if (tooSimilar) continue;
        existingNgramSets.push(qNgrams);

        // Contamination check
        if (professionName) {
          const contam = checkContamination(q.question_text + " " + (q.explanation || ""), professionName);
          if (contam.isContaminated) continue;
        }

        // Map cognitive level
        const cogLevelMap: Record<string, string> = {
          recall: "remember", apply: "apply", analyze: "analyze", decide: "evaluate",
          remember: "remember", understand: "understand", evaluate: "evaluate", create: "create",
        };
        const mappedCogLevel = cogLevelMap[(cognitiveLevel || "apply").toLowerCase()] || cognitiveLevel;

        allInserts.push({
          curriculum_id: curriculumId || null,
          learning_field_id: lfId,
          competency_id: competencyId,
          blueprint_id: blueprintId,
          question_text: q.question_text,
          options: q.options,
          correct_answer: correctIdx,
          explanation: q.explanation || "",
          difficulty: difficulty,
          cognitive_level: mappedCogLevel,
          question_type: questionType,
          trap_tags: Array.isArray(q.trap_tags) ? q.trap_tags : [],
          ai_generated: true,
          status: "draft",
          qc_status: "pending",
          distractor_meta: Array.isArray(q.distractor_meta) ? { raw: q.distractor_meta, gate_fail: false } : null,
        });

        importedThisRow++;
      }

      // Mark this request row as domain-imported
      await sb
        .from("llm_batch_requests")
        .update({ domain_imported_at: now })
        .eq("batch_id", batch.id)
        .eq("custom_id", customId);

      details.push({ ok: true, custom_id: customId, imported_count: importedThisRow });
      successCount++;
    } catch (e) {
      details.push({ ok: false, custom_id: customId, error: String((e as Error)?.message || e) });
      failCount++;
    }
  }

  // Batch insert all questions (50 per chunk, with duplicate fallback)
  if (allInserts.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < allInserts.length; i += BATCH_SIZE) {
      const chunk = allInserts.slice(i, i + BATCH_SIZE);
      const { error } = await sb.from("exam_questions").insert(chunk);
      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation — fallback to individual inserts
          for (const row of chunk) {
            const { error: singleErr } = await sb.from("exam_questions").insert(row);
            if (singleErr && singleErr.code !== "23505") {
              console.warn(`[batch-import] exam_pool insert error: ${singleErr.message}`);
            }
          }
        } else {
          console.error(`[batch-import] exam_pool batch insert error: ${error.message}`);
        }
      }
    }
  }

  return { successCount, failCount, details };
}

// ── Learning Content Importer (Production) ───────────────────────────────────

async function importLearningContentBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  let successCount = 0;
  let failCount = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const customId = String(row.custom_id);
    try {
      const body = row.response_body as any;
      if (!body) {
        details.push({ ok: false, custom_id: customId, error: "No response body" });
        failCount++;
        continue;
      }

      // Extract AI response content (OpenAI chat completion format)
      const rawContent = body?.choices?.[0]?.message?.content;
      if (!rawContent) {
        details.push({ ok: false, custom_id: customId, error: "No choices in response" });
        failCount++;
        continue;
      }

      // Parse JSON response (with fence stripping)
      let parsed: any;
      try {
        const cleaned = String(rawContent).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const fb = cleaned.indexOf("{");
        const lb = cleaned.lastIndexOf("}");
        if (fb !== -1 && lb > fb) {
          parsed = JSON.parse(cleaned.slice(fb, lb + 1));
        } else {
          parsed = JSON.parse(cleaned);
        }
      } catch {
        details.push({ ok: false, custom_id: customId, error: "Response not valid JSON" });
        failCount++;
        continue;
      }

      // Extract source references
      const sourceRef = row.source_ref as any;
      const lessonId = sourceRef?.lesson_id;
      const courseId = sourceRef?.course_id;
      const packageId = sourceRef?.package_id;
      const stepKey = sourceRef?.step_key || "verstehen";
      const isMiniCheck = sourceRef?.is_mini_check === true;
      const professionName = sourceRef?.profession_name || "";

      if (!lessonId || !courseId) {
        details.push({ ok: false, custom_id: customId, error: "Missing lesson_id or course_id in source_ref" });
        failCount++;
        continue;
      }

      // Normalize field aliases (LLM may return content_html instead of html)
      if (!parsed.html && parsed.content_html) {
        parsed.html = parsed.content_html;
      }

      // Validate content structure
      const hasContent = isMiniCheck
        ? (parsed?.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0)
        : (parsed?.html && parsed.html.length > 200);

      if (!hasContent) {
        details.push({ ok: false, custom_id: customId, error: `Content validation failed: ${isMiniCheck ? "no questions" : "html too short or missing"}` });
        failCount++;
        continue;
      }

      // Build final content payload (mirrors persistence.ts buildFinalContent)
      const finalContent = isMiniCheck
        ? {
            type: "mini_check",
            questions: Array.isArray(parsed.questions)
              ? parsed.questions.map((q: any) => ({
                  question: q.question || q.question_text || "",
                  options: q.options || [],
                  correct_answer: q.correct_answer ?? q.correctIndex ?? 0,
                  explanation: q.explanation || "",
                  difficulty: q.difficulty || "mittel",
                  bloom_level: q.bloom_level || "apply",
                  trap_type: q.trap_type || null,
                }))
              : parsed.questions,
            objectives: parsed.objectives || [],
            bloom_level: "apply",
            generated_at: now,
            version: 6,
            source: "batch_import",
          }
        : {
            type: "text",
            html: parsed.html,
            objectives: parsed.objectives || [],
            key_terms: parsed.key_terms || [],
            common_mistakes: parsed.common_mistakes || [],
            exam_triggers: parsed.exam_triggers || [],
            transfer_questions: parsed.transfer_questions || [],
            step: stepKey,
            generated_at: now,
            version: 5,
            source: "batch_import",
          };

      // Insert into content_versions (SSOT) — idempotent via unique constraint
      const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
        course_id: courseId,
        lesson_id: lessonId,
        step_key: stepKey,
        content_json: finalContent,
        created_by_agent: "batch-result-importer",
        status: "approved",
        council_round: 1,
        entity_type: isMiniCheck ? "minicheck" : "lesson_step",
        published_at: now,
        published_by: "batch-auto-import",
      }).select("id").single();

      if (vErr) {
        // Duplicate = already imported (idempotent success)
        if (vErr.code === "23505") {
          details.push({ ok: true, custom_id: customId, imported_count: 0 });
          successCount++;
          // Fix: Only set domain_imported_at on idempotent success
          await sb.from("llm_batch_requests")
            .update({ domain_imported_at: now })
            .eq("batch_id", (batch as any).id)
            .eq("custom_id", customId);
        } else {
          details.push({ ok: false, custom_id: customId, error: `content_versions insert: ${vErr.message}` });
          failCount++;
          // Fix: Do NOT set domain_imported_at on failure — allows retry
        }
      } else {
        // Sync to lessons.content via RPC (same as sync path)
        try {
          await sb.rpc("pipeline_write_lesson_content", { p_lesson_id: lessonId, p_content: finalContent });
        } catch (syncErr) {
          console.warn(`[batch-import] lesson sync failed for ${lessonId}: ${(syncErr as Error)?.message?.slice(0, 100)}`);
        }

        details.push({ ok: true, custom_id: customId, imported_count: 1 });
        successCount++;
        console.log(`[batch-import] learning_content imported: lesson=${lessonId} step=${stepKey} version=${newVersion?.id}`);

        // Mark request row as domain-imported only on actual success
        await sb.from("llm_batch_requests")
          .update({ domain_imported_at: now })
          .eq("batch_id", (batch as any).id)
          .eq("custom_id", customId);
      }

    } catch (e) {
      details.push({ ok: false, custom_id: customId, error: String((e as Error)?.message || e) });
      failCount++;
    }
  }

  return { successCount, failCount, details };
}

async function importHandbookSectionBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  for (const row of rows) {
    const customId = String(row.custom_id);
    console.log(`[batch-import] handbook_section stub: ${customId}`);
    details.push({ ok: true, custom_id: customId });
  }
  return { successCount: rows.length, failCount: 0, details };
}

async function importBlueprintEnrichBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  for (const row of rows) {
    const customId = String(row.custom_id);
    console.log(`[batch-import] blueprint_enrich stub: ${customId}`);
    details.push({ ok: true, custom_id: customId });
  }
  return { successCount: rows.length, failCount: 0, details };
}

// ── Importer Registry ─────────────────────────────────────────────────────────

type BatchImporter = (
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
) => Promise<{ successCount: number; failCount: number; details: ImportResult[] }>;

const IMPORTERS: Record<string, BatchImporter> = {
  // Canonical job_type names — MUST match BATCH_JOB_TYPES constants
  lesson_generate_content: importLearningContentBatch,
  package_generate_exam_pool: importExamPoolBatch,
  // Legacy aliases (to be removed after migration)
  exam_pool_generate: importExamPoolBatch,
  learning_content: importLearningContentBatch,
  // Stubs
  expand_handbook_section: importHandbookSectionBatch,
  handbook_section: importHandbookSectionBatch,
  blueprint_enrich: importBlueprintEnrichBatch,
};

// ── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const batchId = body.batch_id as string | undefined;

    if (!batchId) return json({ ok: false, error: "batch_id required" }, 400);

    // 1) Load batch metadata
    const { data: batch, error: bErr } = await sb
      .from("llm_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (bErr || !batch) return json({ ok: false, error: "Batch not found" }, 404);
    if (batch.status !== "completed") {
      return json({ ok: false, error: `Batch status is '${batch.status}', not completed` }, 422);
    }
    if (!batch.results_imported_at) {
      return json({ ok: false, error: "Results not yet imported by batch-poll" }, 422);
    }

    // Idempotency: skip if already completed
    if (batch.domain_import_completed_at) {
      return json({
        ok: true,
        batch_id: batchId,
        message: "Domain import already completed",
        completed_at: batch.domain_import_completed_at,
      });
    }

    // 2) Find the appropriate importer
    const importer = IMPORTERS[batch.job_type];
    if (!importer) {
      return json({
        ok: false,
        error: `No importer registered for job_type '${batch.job_type}'`,
        available_importers: Object.keys(IMPORTERS),
      }, 422);
    }

    // 3) Load completed request rows NOT yet domain-imported
    const { data: requests, error: rErr } = await sb
      .from("llm_batch_requests")
      .select("custom_id, status, response_body, error_body, usage_data, source_job_id, source_table, source_ref")
      .eq("batch_id", batchId)
      .eq("status", "completed")
      .is("domain_imported_at", null)
      .limit(5000);

    if (rErr) throw rErr;
    if (!requests?.length) {
      // Mark completed even if nothing to import (all already imported)
      const now = new Date().toISOString();
      await sb.from("llm_batches").update({
        domain_import_completed_at: now,
      }).eq("id", batchId);

      return json({ ok: true, imported: 0, message: "No pending requests to import" });
    }

    // 4) Run batch importer
    const now = new Date().toISOString();
    const result = await importer(sb, requests as Record<string, unknown>[], batch as Record<string, unknown>);

    // 5) Update batch with domain import results
    await sb.from("llm_batches").update({
      domain_import_completed_at: now,
      domain_import_error: result.failCount > 0 ? `${result.failCount} rows failed` : null,
      metadata: {
        ...((batch as any).metadata || {}),
        domain_import: {
          imported_at: now,
          success: result.successCount,
          failed: result.failCount,
          total: requests.length,
          job_type: batch.job_type,
        },
      },
    }).eq("id", batchId);

    // 6) Reconcile ai_generation_requests — truly per-request via FK
    try {
      // Load batch request rows with their gateway FK
      const { data: batchReqRows } = await sb
        .from("llm_batch_requests")
        .select("custom_id, status, domain_imported_at, error_body, ai_generation_request_id")
        .eq("batch_id", batchId);

      // Group by gateway request ID
      const grouped = new Map<string, any[]>();
      for (const row of batchReqRows || []) {
        const gwId = row.ai_generation_request_id;
        if (!gwId) continue;
        const arr = grouped.get(gwId) || [];
        arr.push(row);
        grouped.set(gwId, arr);
      }

      if (grouped.size > 0) {
        // Load existing result_summary for merge
        const gwIds = Array.from(grouped.keys());
        const { data: gwRecords } = await sb
          .from("ai_generation_requests")
          .select("id, result_summary")
          .in("id", gwIds)
          .in("status", ["queued", "batch_pending"]);

        for (const gw of gwRecords || []) {
          const rows = grouped.get(gw.id);
          if (!rows) continue;

          const allFailed = rows.every((r: any) => r.status === "failed");
          const anyImported = rows.some((r: any) => r.domain_imported_at != null);
          const gwStatus = anyImported ? "completed" : allFailed ? "failed" : "batch_pending";

          const existingSummary = (gw.result_summary && typeof gw.result_summary === "object") ? gw.result_summary : {};

          await sb.from("ai_generation_requests").update({
            status: gwStatus,
            completed_at: (gwStatus === "completed" || gwStatus === "failed") ? now : null,
            result_summary: {
              ...existingSummary,
              batch_import: {
                total: rows.length,
                imported: rows.filter((r: any) => r.domain_imported_at != null).length,
                failed: rows.filter((r: any) => r.status === "failed").length,
                reconciled_at: now,
              },
            },
          }).eq("id", gw.id);
        }
        console.log(`[batch-result-importer] Reconciled ${grouped.size} gateway request(s) via FK`);
      } else {
        // Fallback: reconcile via llm_batch_id (legacy requests without FK)
        const { data: legacyGw } = await sb
          .from("ai_generation_requests")
          .select("id, result_summary")
          .eq("llm_batch_id", batchId)
          .in("status", ["queued", "batch_pending"]);

        if (legacyGw?.length) {
          const gwStatus = result.failCount === requests.length ? "failed" : "completed";
          for (const gw of legacyGw) {
            const existingSummary = (gw.result_summary && typeof gw.result_summary === "object") ? gw.result_summary : {};
            await sb.from("ai_generation_requests").update({
              status: gwStatus,
              completed_at: now,
              result_summary: { ...existingSummary, batch_import: { success: result.successCount, failed: result.failCount, total: requests.length, reconciled_at: now } },
            }).eq("id", gw.id);
          }
          console.log(`[batch-result-importer] Reconciled ${legacyGw.length} gateway request(s) via llm_batch_id (legacy)`);
        }
      }
    } catch (gwErr) {
      console.warn(`[batch-result-importer] Gateway reconciliation failed: ${(gwErr as Error)?.message?.slice(0, 100)}`);
    }

    return json({
      ok: true,
      batch_id: batchId,
      job_type: batch.job_type,
      imported: result.successCount,
      failed: result.failCount,
      total: requests.length,
    });
  } catch (error) {
    console.error("[batch-result-importer]", error);

    // Try to record the error on the batch
    try {
      const body = await (error as any)?.batch_id;
    } catch { /* ignore */ }

    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
