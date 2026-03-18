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
import { isTemplateResponse, expandAllTemplates } from "../_shared/template-engine/exam-template-expander.ts";
import { parseLlmJson } from "../_shared/json-parse-safe.ts";
import { estimateCostEur } from "../_shared/model-pricing.ts";

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

async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

const TEXT_SIMILARITY_THRESHOLD = 0.55;

// ── Exam Pool Importer (Production — with fingerprint dedup) ─────────────────

async function importExamPoolBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  let successCount = 0;
  let failCount = 0;

  // Load existing hashes + n-grams for Jaccard dedup (from same curriculum)
  const curriculumId = (batch as any).metadata?.curriculum_id;
  const existingHashes = new Set<string>();
  const existingNgramSets: Set<string>[] = [];
  const existingFingerprints = new Set<string>();

  if (curriculumId) {
    const { data: existingQs } = await sb
      .from("exam_questions")
      .select("question_text, question_fingerprint")
      .eq("curriculum_id", curriculumId)
      .neq("status", "rejected")
      .limit(5000);

    if (existingQs) {
      for (const eq of existingQs) {
        existingHashes.add(simpleHash(eq.question_text));
        existingNgramSets.push(textNgrams(eq.question_text));
        if (eq.question_fingerprint) existingFingerprints.add(eq.question_fingerprint);
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
        const raw = typeof content === "string" ? content : JSON.stringify(content);
        const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        // Handle both array [...] and object {...} responses
        const firstBracket = cleaned.indexOf("[");
        const firstBrace = cleaned.indexOf("{");
        const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
        if (isArray) {
          const lb = cleaned.lastIndexOf("]");
          if (lb > firstBracket) {
            parsed = JSON.parse(cleaned.slice(firstBracket, lb + 1));
          } else {
            parsed = JSON.parse(cleaned);
          }
        } else if (firstBrace !== -1) {
          const lb = cleaned.lastIndexOf("}");
          if (lb > firstBrace) {
            parsed = JSON.parse(cleaned.slice(firstBrace, lb + 1));
          } else {
            parsed = JSON.parse(cleaned);
          }
        } else {
          parsed = JSON.parse(cleaned);
        }
      } catch {
        details.push({ ok: false, custom_id: customId, error: "Response not valid JSON" });
        failCount++;
        continue;
      }

      // ── Source references from source_ref (SSOT) ──
      const sourceRef = row.source_ref as any;
      const batchMeta = (batch as any).metadata || {};
      const blueprintId = sourceRef?.blueprint_id || null;
      const lfId = sourceRef?.learning_field_id || null;
      const competencyId = sourceRef?.competency_id || null;
      const resolvedCurriculumId = sourceRef?.curriculum_id || curriculumId;
      const packageId = sourceRef?.package_id || batchMeta.package_id || null;
      const fallbackDifficulty = sourceRef?.difficulty || "medium";
      const fallbackCognitiveLevel = sourceRef?.cognitive_level || "apply";
      const fallbackQuestionType = sourceRef?.question_type || "concept";

      if (!resolvedCurriculumId) {
        details.push({ ok: false, custom_id: customId, error: "Missing curriculum_id in source_ref and batch metadata" });
        failCount++;
        continue;
      }

      // ── Template-first: detect and expand templates before processing ──
      let questions: any[];
      let isTemplateExpanded = false;

      if (isTemplateResponse(parsed) || parsed?.templates) {
        const expanded = expandAllTemplates(parsed, {
          question_type: fallbackQuestionType,
          difficulty: fallbackDifficulty,
          cognitive_level: fallbackCognitiveLevel,
        });
        if (expanded.length > 0) {
          isTemplateExpanded = true;
          questions = expanded.map(eq => ({
            question_text: eq.question_text,
            options: eq.options,
            correct_answer: eq.correct_answer,
            explanation: eq.explanation,
            question_type: eq.question_type,
            difficulty: eq.difficulty,
            cognitive_level: eq.cognitive_level,
            is_template_expanded: true,
          }));
          console.log(`[batch-import] template-first: expanded ${expanded.length} questions from template (${customId})`);
        } else {
          questions = [parsed];
        }
      } else {
        // ── Standard: normalize question array (alias support) ──
        questions =
          Array.isArray(parsed?.questions) ? parsed.questions
          : Array.isArray(parsed?.items) ? parsed.items
          : Array.isArray(parsed?.results) ? parsed.results
          : Array.isArray(parsed) ? parsed
          : [parsed];
      }

      let importedThisRow = 0;

      for (const q of questions) {
        // ── Field alias normalization ──
        const questionText = String(q.question_text || q.question || "").trim();
        const rawOptions = Array.isArray(q.options) ? q.options
          : Array.isArray(q.answers) ? q.answers
          : [];

        if (!questionText || rawOptions.length < 4) continue;

        // Correct answer: support index (number) or text match
        let correctIdx: number;
        if (typeof q.correct_answer === "number") {
          correctIdx = q.correct_answer;
        } else if (typeof q.correct_option === "number") {
          correctIdx = q.correct_option;
        } else if (typeof q.correctIndex === "number") {
          correctIdx = q.correctIndex;
        } else if (typeof q.correct_answer === "string") {
          // Text-based correct answer → find matching option index
          const matchIdx = rawOptions.findIndex((o: any) =>
            normalizeText(String(o)) === normalizeText(q.correct_answer));
          correctIdx = matchIdx >= 0 ? matchIdx : 0;
        } else {
          correctIdx = 0;
        }

        if (correctIdx < 0 || correctIdx >= rawOptions.length) continue;

        // Question text minimum length (governance constraint)
        if (questionText.length < 10) continue;

        const explanation = q.explanation ?? q.reasoning ?? null;
        const difficulty = q.difficulty || fallbackDifficulty;
        const questionType = q.question_type || q.type || fallbackQuestionType;
        const cognitiveLevel = q.cognitive_level || q.bloom_level || fallbackCognitiveLevel;

        // ── SHA-256 fingerprint for idempotent dedup ──
        const normalizedQ = normalizeText(questionText);
        const normalizedA = normalizeText(String(correctIdx));
        const fingerprint = await sha256(`${blueprintId || "no-bp"}|${normalizedQ}|${normalizedA}`);

        // Skip if fingerprint already exists (in-memory fast check)
        if (existingFingerprints.has(fingerprint)) continue;
        existingFingerprints.add(fingerprint);

        // Hash dedup (fast structural)
        const hash = simpleHash(questionText);
        if (existingHashes.has(hash)) continue;
        existingHashes.add(hash);

        // Jaccard n-gram dedup (semantic similarity)
        const qNgrams = textNgrams(questionText);
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
          const contam = checkContamination(questionText + " " + (explanation || ""), professionName);
          if (contam.isContaminated) continue;
        }

        // Map cognitive level to canonical values
        const cogLevelMap: Record<string, string> = {
          recall: "remember", apply: "apply", analyze: "analyze", decide: "evaluate",
          remember: "remember", understand: "understand", evaluate: "evaluate", create: "evaluate",
        };
        const mappedCogLevel = cogLevelMap[(cognitiveLevel || "apply").toLowerCase()] || "apply";

        // Map question_type to DB-allowed values (chk_question_type constraint)
        // DB allows: concept, procedure, calculation, case_study, transfer
        const questionTypeMap: Record<string, string> = {
          best_option: "concept",
          error_detection: "procedure",
          risk_assessment: "concept",
          compliance_check: "procedure",
          mc_single: "concept",
          mc_multi: "concept",
          // Already valid:
          concept: "concept",
          procedure: "procedure",
          calculation: "calculation",
          case_study: "case_study",
          transfer: "transfer",
        };
        const mappedQuestionType = questionTypeMap[questionType.toLowerCase()] || "concept";

        allInserts.push({
          curriculum_id: resolvedCurriculumId,
          learning_field_id: lfId,
          competency_id: competencyId,
          blueprint_id: blueprintId,
          question_text: questionText,
          options: rawOptions,
          correct_answer: correctIdx,
          explanation: explanation || "",
          difficulty,
          cognitive_level: mappedCogLevel,
          question_type: mappedQuestionType,
          question_fingerprint: fingerprint,
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

  // Batch insert all questions (50 per chunk, with duplicate fallback via fingerprint unique index)
  if (allInserts.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < allInserts.length; i += BATCH_SIZE) {
      const chunk = allInserts.slice(i, i + BATCH_SIZE);
      const { error } = await sb.from("exam_questions").insert(chunk);
      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation — fallback to individual inserts
          for (const singleRow of chunk) {
            const { error: singleErr } = await sb.from("exam_questions").insert(singleRow);
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

  console.log(`[batch-import] exam_pool: ${allInserts.length} questions inserted, ${successCount} rows processed, ${failCount} failed`);
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

      // Parse JSON response using robust shared parser (handles arrays, truncation, concatenated objects)
      let parsed: any;
      try {
        parsed = parseLlmJson(String(rawContent));
      } catch (parseErr) {
        const errSnippet = String(rawContent).slice(0, 120);
        details.push({ ok: false, custom_id: customId, error: `Response not valid JSON: ${(parseErr as Error)?.message?.slice(0, 80)} | start: ${errSnippet}` });
        failCount++;
        continue;
      }

      // Extract source references
      const sourceRef = row.source_ref as any;
      const lessonId = sourceRef?.lesson_id;
      // Fallback: look up course_id from batch metadata or ai_generation_requests
      const courseId = sourceRef?.course_id || (batch as any)?.metadata?.course_id || null;
      const packageId = sourceRef?.package_id || (batch as any)?.metadata?.package_id || null;
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
        console.error(`[batch-import] content_versions insert error for ${customId}: code=${vErr.code} msg=${vErr.message?.slice(0, 200)}`);
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
      const errMsg = String((e as Error)?.message || e);
      console.error(`[batch-import] learning_content error for ${customId}: ${errMsg.slice(0, 200)}`);
      details.push({ ok: false, custom_id: customId, error: errMsg });
      failCount++;
    }
  }

  return { successCount, failCount, details };
}

// ── Handbook Section Importer (Production) ───────────────────────────────────

async function importHandbookSectionBatch(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
  batch: Record<string, unknown>,
): Promise<{ successCount: number; failCount: number; details: ImportResult[] }> {
  const details: ImportResult[] = [];
  let successCount = 0;
  let failCount = 0;
  const now = new Date().toISOString();
  const MIN_SECTION_CHARS = 800;

  for (const row of rows) {
    const customId = String(row.custom_id);
    try {
      const body = row.response_body as any;
      if (!body) { details.push({ ok: false, custom_id: customId, error: "No response body" }); failCount++; continue; }

      const rawContent = body?.choices?.[0]?.message?.content;
      if (!rawContent) { details.push({ ok: false, custom_id: customId, error: "No choices in response" }); failCount++; continue; }

      // Handbook returns markdown text, not JSON
      let content = String(rawContent).replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();
      // If LLM returned JSON-wrapped content, unwrap it
      if (content.startsWith("{") || content.startsWith('"')) {
        try {
          const parsed = JSON.parse(content);
          content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
        } catch { /* use as-is */ }
      }

      if (content.length < MIN_SECTION_CHARS) {
        details.push({ ok: false, custom_id: customId, error: `Content too short: ${content.length}/${MIN_SECTION_CHARS}` });
        failCount++;
        continue;
      }

      const sourceRef = row.source_ref as any;
      const chapterId = sourceRef?.chapter_id;
      const sectionKey = sourceRef?.section_key;
      const learningFieldId = sourceRef?.learning_field_id;
      const lfCode = sourceRef?.lf_code || "";
      const lfTitle = sourceRef?.lf_title || "";
      const wordTarget = sourceRef?.word_target || 600;
      const sortOrder = sourceRef?.sort_order || 1;

      if (!chapterId || !sectionKey) {
        details.push({ ok: false, custom_id: customId, error: "Missing chapter_id or section_key in source_ref" });
        failCount++;
        continue;
      }

      const sectionRow = {
        chapter_id: chapterId,
        section_key: sectionKey,
        title: `${lfCode}: ${lfTitle}`,
        content_markdown: content,
        basis_content: content,
        basis_generated_at: now,
        content_tier: "basis",
        expand_status: content.length >= 800 ? "pending" : "not_ready",
        content_type: "text",
        sort_order: sortOrder,
        learning_field_id: learningFieldId,
        metadata: {
          llm_generated: true,
          word_target: wordTarget,
          actual_chars: content.length,
          source: "batch_import",
          imported_at: now,
        },
      };

      const { error: upsertErr } = await sb.from("handbook_sections").upsert(sectionRow, {
        onConflict: "chapter_id,section_key",
        ignoreDuplicates: false,
      });

      if (upsertErr) {
        console.error(`[batch-import] handbook upsert error for ${customId}: ${upsertErr.message?.slice(0, 200)}`);
        details.push({ ok: false, custom_id: customId, error: `handbook upsert: ${upsertErr.message}` });
        failCount++;
      } else {
        details.push({ ok: true, custom_id: customId, imported_count: 1 });
        successCount++;
        console.log(`[batch-import] handbook imported: lf=${lfCode} section=${sectionKey} chars=${content.length}`);
      }

      await sb.from("llm_batch_requests").update({ domain_imported_at: now }).eq("batch_id", (batch as any).id).eq("custom_id", customId);
    } catch (e) {
      details.push({ ok: false, custom_id: customId, error: String((e as Error)?.message || e) });
      failCount++;
    }
  }

  return { successCount, failCount, details };
}

// ── Minichecks Importer (Production) ─────────────────────────────────────────

async function importMinichecksBatch(
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
      if (!body) { details.push({ ok: false, custom_id: customId, error: "No response body" }); failCount++; continue; }

      const rawContent = body?.choices?.[0]?.message?.content;
      if (!rawContent) { details.push({ ok: false, custom_id: customId, error: "No choices in response" }); failCount++; continue; }

      // Parse JSON array of questions
      let questions: any[];
      try {
        const cleaned = String(rawContent).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const firstBracket = cleaned.indexOf("[");
        if (firstBracket === -1) throw new Error("No JSON array found");
        let depth = 0;
        let endIdx = -1;
        for (let ci = firstBracket; ci < cleaned.length; ci++) {
          if (cleaned[ci] === "[") depth++;
          if (cleaned[ci] === "]") { depth--; if (depth === 0) { endIdx = ci; break; } }
        }
        questions = endIdx > firstBracket ? JSON.parse(cleaned.slice(firstBracket, endIdx + 1)) : JSON.parse(cleaned);
        if (!Array.isArray(questions)) questions = (questions as any)?.items || [questions];
      } catch (parseErr) {
        details.push({ ok: false, custom_id: customId, error: `Parse failed: ${(parseErr as Error)?.message?.slice(0, 80)}` });
        failCount++;
        continue;
      }

      const sourceRef = row.source_ref as any;
      const lessonId = sourceRef?.lesson_id || null;
      const curriculumId = sourceRef?.curriculum_id;
      const competencyId = sourceRef?.competency_id || null;
      const mode = sourceRef?.mode || "lesson";

      if (!curriculumId) {
        details.push({ ok: false, custom_id: customId, error: "Missing curriculum_id in source_ref" });
        failCount++;
        continue;
      }

      // Normalize options helper (inline)
      const normalizeOpts = (opts: unknown): Array<{ text: string }> => {
        if (!Array.isArray(opts)) return [];
        return opts.map((o: unknown) => {
          if (typeof o === "string") return { text: o.replace(/^[A-D]\)\s*/, "") };
          if (o && typeof o === "object" && "text" in (o as any)) return { text: String((o as any).text) };
          return { text: String(o) };
        });
      };

      const mcRows = questions.map((q: any, idx: number) => ({
        lesson_id: lessonId,
        curriculum_id: curriculumId,
        competency_id: competencyId,
        question_text: q.question_text || q.text || "",
        options: normalizeOpts(q.options),
        correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
        explanation: q.explanation || "",
        difficulty: q.difficulty || "medium",
        cognitive_level: q.cognitive_level || "understand",
        trap_tags: Array.isArray(q.trap_tags) ? q.trap_tags : [],
        distractor_meta: {},
        mode,
        status: "draft",
        sort_order: idx,
      }));

      const validRows = mcRows.filter((r: any) =>
        r.question_text.length > 10 &&
        Array.isArray(r.options) && r.options.length === 4 &&
        r.explanation.length > 20
      );

      let insertOk = 0;
      for (const mcRow of validRows) {
        const { error: insertErr } = await sb.from("minicheck_questions").insert(mcRow);
        if (insertErr) {
          if (insertErr.code !== "23505") console.warn(`[batch-import] minicheck insert: ${insertErr.message}`);
        } else {
          insertOk++;
        }
      }

      details.push({ ok: true, custom_id: customId, imported_count: insertOk });
      successCount++;
      if (insertOk > 0) console.log(`[batch-import] minichecks imported: ${insertOk}/${validRows.length} for ${lessonId ? `lesson=${lessonId.slice(0, 8)}` : `comp=${competencyId?.slice(0, 8)}`}`);

      await sb.from("llm_batch_requests").update({ domain_imported_at: now }).eq("batch_id", (batch as any).id).eq("custom_id", customId);
    } catch (e) {
      details.push({ ok: false, custom_id: customId, error: String((e as Error)?.message || e) });
      failCount++;
    }
  }

  return { successCount, failCount, details };
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
  package_generate_handbook: importHandbookSectionBatch,
  package_generate_lesson_minichecks: importMinichecksBatch,
  // Legacy aliases
  exam_pool_generate: importExamPoolBatch,
  learning_content: importLearningContentBatch,
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

    // 4b) ── Telemetry write-through: log llm_cost_events for batch results ──
    //    This closes the BLIND gap identified by ops_telemetry_lineage.
    //    Uses real usage_data from llm_batch_requests + SSOT pricing.
    try {
      // Re-load requests WITH usage_data for successfully imported rows
      const { data: importedRows } = await sb
        .from("llm_batch_requests")
        .select("custom_id, usage_data, source_ref, ai_generation_request_id")
        .eq("batch_id", batchId)
        .not("domain_imported_at", "is", null)
        .limit(5000);

      if (importedRows?.length) {
        const batchModel = batch.model || "unknown";
        const batchProvider = batch.provider || "openai";
        const batchJobType = batch.job_type || "unknown";
        const batchMeta = (batch as any).metadata || {};
        const packageId = batchMeta.package_id || null;
        const courseId = batchMeta.course_id || null;
        const certificationId = batchMeta.certification_id || null;

        // Build cost events in bulk — one per imported request
        const costEvents = importedRows.map((row: any) => {
          const usage = row.usage_data || {};
          const tokensIn = usage.input_tokens ?? usage.prompt_tokens ?? 0;
          const tokensOut = usage.output_tokens ?? usage.completion_tokens ?? 0;
          const cachedIn = usage.cached_input_tokens ?? 0;
          const isEstimated = tokensIn === 0 && tokensOut === 0;

          // SSOT pricing from model-pricing.ts
          const costEur = estimateCostEur(batchModel, tokensIn, tokensOut, cachedIn);
          // Batch API = 50% discount
          const batchCostEur = Math.round(costEur * 0.5 * 1_000_000) / 1_000_000;

          // Source ref for full lineage
          const sourceRef = row.source_ref || {};

          return {
            job_type: batchJobType,
            provider: batchProvider,
            model: batchModel,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cost_eur: batchCostEur,
            package_id: sourceRef.package_id || packageId,
            course_id: sourceRef.course_id || courseId,
            certification_id: sourceRef.certification_id || certificationId,
            meta: {
              event_kind: "batch_import",
              batch_id: batchId,
              custom_id: row.custom_id,
              ...(row.ai_generation_request_id ? { ai_generation_request_id: row.ai_generation_request_id } : {}),
              ...(sourceRef.lesson_id ? { lesson_id: sourceRef.lesson_id } : {}),
              ...(sourceRef.chapter_id ? { chapter_id: sourceRef.chapter_id } : {}),
              ...(sourceRef.section_key ? { section_key: sourceRef.section_key } : {}),
              ...(cachedIn > 0 ? { cached_input_tokens: cachedIn } : {}),
              ...(isEstimated ? { usage_estimated: true } : {}),
              batch_discount: 0.5,
            },
          };
        });

        // Dedupe: check which batch_id+custom_id combos already have events
        // Use a single bulk insert with conflict avoidance via meta check
        // Since llm_cost_events has no unique constraint on batch_id+custom_id,
        // we check for existing events first to prevent double-counting on retries
        const { data: existingEvents } = await sb
          .from("llm_cost_events")
          .select("id")
          .eq("job_type", batchJobType)
          .contains("meta", { event_kind: "batch_import", batch_id: batchId })
          .limit(1);

        if (!existingEvents?.length) {
          // No prior events for this batch — safe to bulk insert
          const CHUNK = 500;
          let inserted = 0;
          for (let i = 0; i < costEvents.length; i += CHUNK) {
            const chunk = costEvents.slice(i, i + CHUNK);
            const { error: insertErr } = await sb.from("llm_cost_events").insert(chunk);
            if (insertErr) {
              console.warn(`[batch-result-importer] llm_cost_events insert chunk failed: ${insertErr.message?.slice(0, 200)}`);
            } else {
              inserted += chunk.length;
            }
          }
          console.log(`[batch-result-importer] Telemetry write-through: ${inserted}/${costEvents.length} llm_cost_events logged for batch ${batchId.slice(0, 8)}`);
        } else {
          console.log(`[batch-result-importer] Telemetry already logged for batch ${batchId.slice(0, 8)}, skipping (dedupe)`);
        }
      }
    } catch (telErr) {
      // NEVER block domain import on telemetry failure
      console.warn(`[batch-result-importer] Telemetry write-through failed (non-fatal): ${(telErr as Error)?.message?.slice(0, 200)}`);
    }

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
          telemetry_logged: true,
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
      // Debug: include failure details when there are failures
      ...(result.failCount > 0 ? { failure_details: result.details.filter((d: any) => !d.ok) } : {}),
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
