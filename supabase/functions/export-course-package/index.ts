import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function safeFilename(name: string) {
  return name
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let { packageId, courseId } = await req.json().catch(() => ({} as Record<string, unknown>));

  // If UI sends courseId: resolve latest package for that course
  if (!packageId && courseId) {
    const { data: latestPkg } = await sb
      .from("course_packages")
      .select("id")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestPkg?.id) packageId = latestPkg.id;
  }

  if (!packageId) return json({ error: "packageId or courseId required" }, 400);

  try {
    // ── Load package ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("*")
      .eq("id", packageId)
      .single();
    if (pkgErr || !pkg) return json({ error: pkgErr?.message || "Package not found" }, 404);

    const cid = courseId || (pkg as Record<string, unknown>).course_id;
    console.log(`[export] Package ${packageId}, course ${cid}`);

    // ── Load build steps (with correct columns) ──
    const { data: steps } = await sb
      .from("package_steps")
      .select("id, package_id, step_key, status, attempts, max_attempts, timeout_seconds, started_at, finished_at, last_heartbeat_at, runner_id, last_error, meta, created_at, updated_at, job_id")
      .eq("package_id", packageId)
      .order("created_at");

    // ── Load approved plan ──
    const { data: plan } = await sb
      .from("course_package_plans")
      .select("*")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const planJson = plan as Record<string, unknown> | null;
    let curriculumId = (planJson?.plan as Record<string, unknown>)?.curriculum_id as string | undefined;

    // Fallback: resolve curriculumId from course record
    if (!curriculumId && cid) {
      try {
        const { data: cRec } = await sb.from("courses").select("curriculum_id").eq("id", cid).maybeSingle();
        if (cRec?.curriculum_id) curriculumId = cRec.curriculum_id;
      } catch (_e) { /* best-effort */ }
    }

    console.log(`[export] curriculumId: ${curriculumId}`);

    // ── Load FULL handbook (chapters + sections + exercises) ──
    let handbookMd = "# Handbuch\n\n_(nicht verfügbar)_\n";
    const handbookStructured: unknown[] = [];
    if (curriculumId) {
      try {
        const { data: chapters } = await sb
          .from("handbook_chapters")
          .select("*")
          .eq("curriculum_id", curriculumId)
          .order("sort_order");

        if (chapters?.length) {
          const parts: string[] = ["# Handbuch\n"];
          for (const ch of chapters as Record<string, unknown>[]) {
            parts.push(`\n## ${ch.title}\n`);
            if (ch.description) parts.push(`\n${ch.description}\n`);

            const { data: sections } = await sb
              .from("handbook_sections")
              .select("*")
              .eq("chapter_id", ch.id as string)
              .order("sort_order");

            const { data: exercises } = await sb
              .from("handbook_exercises")
              .select("*")
              .eq("chapter_id", ch.id as string)
              .order("sort_order");

            for (const s of (sections || []) as Record<string, unknown>[]) {
              parts.push(`\n### ${s.title}\n\n${s.content_markdown || "_(kein Inhalt)_"}\n`);
            }

            if ((exercises || []).length > 0) {
              parts.push(`\n### Übungen\n`);
              for (const ex of (exercises || []) as Record<string, unknown>[]) {
                parts.push(`\n**${ex.exercise_type}:** ${ex.question_text}\n`);
                if (ex.hint_text) parts.push(`> Hinweis: ${ex.hint_text}\n`);
              }
            }

            handbookStructured.push({
              ...ch,
              sections: sections || [],
              exercises: exercises || [],
            });
          }
          handbookMd = parts.join("\n");
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] Handbook: ${handbookStructured.length} chapters, ${handbookMd.length} chars`);

    // ── Oral Exam: ALL sessionsets for this package ──
    const { data: oralSessionsets } = await sb
      .from("oral_exam_sessionsets")
      .select("*")
      .eq("package_id", packageId)
      .order("created_at", { ascending: false });

    // ── Oral Exam: Blueprints (via curriculum) ──
    let oralBlueprints: unknown[] = [];
    if (curriculumId) {
      const { data } = await sb
        .from("oral_exam_blueprints")
        .select("*")
        .eq("curriculum_id", curriculumId)
        .order("created_at", { ascending: false });
      oralBlueprints = data || [];
    }

    // ── Oral Exam: Session Templates (pipeline-generated, not user-specific) ──
    let oralSessionTemplates: unknown[] = [];
    try {
      const { data } = await sb.from("oral_exam_session_templates")
        .select("*")
        .eq("package_id", packageId)
        .order("sort_order");
      oralSessionTemplates = data || [];
    } catch (_e) { /* best-effort */ }

    // ── Oral Exam: ALL user sessions (paginated, via blueprint_id) ──
    const allOralSessions: unknown[] = [];
    if (oralBlueprints.length > 0) {
      const bpIds = (oralBlueprints as Record<string, unknown>[]).map(b => b.id as string);
      const pageSize = 500;
      let offset = 0;
      while (true) {
        const { data: batch, error: oErr } = await sb
          .from("oral_exam_sessions")
          .select("id, user_id, curriculum_id, blueprint_id, mode, total_questions, time_limit_minutes, current_question_index, started_at, finished_at, overall_score, passed, created_at")
          .in("blueprint_id", bpIds)
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (oErr) { console.log(`[export] Oral sessions error: ${oErr.message}`); break; }
        if (!batch || batch.length === 0) break;
        allOralSessions.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
    }
    console.log(`[export] Oral exam: ${(oralSessionsets || []).length} sets, ${oralBlueprints.length} blueprints, ${oralSessionTemplates.length} templates, ${allOralSessions.length} user sessions`);

    // ── Tutor: ALL context indices for this package ──
    const { data: tutorIndices } = await sb
      .from("ai_tutor_context_index")
      .select("*")
      .eq("package_id", packageId)
      .order("created_at", { ascending: false });

    // ── Tutor: ALL policy versions for this curriculum ──
    let tutorPolicies: unknown[] = [];
    if (curriculumId) {
      const { data } = await sb
        .from("ai_tutor_policies")
        .select("*")
        .eq("curriculum_id", curriculumId)
        .order("version", { ascending: false });
      tutorPolicies = data || [];
    }

    // ── Questions summary (deferred — computed AFTER question collection for SSOT consistency) ──
    let questionsSummary: Record<string, unknown> = { note: "no_summary" };

    // ── Course snapshot ──
    let courseSnapshot: unknown = null;
    let moduleIds: string[] = [];
    if (cid) {
      try {
        const { data: course } = await sb.from("courses").select("id, title, status, description, estimated_duration, curriculum_id").eq("id", cid).maybeSingle();
        const { data: modules } = await sb.from("modules").select("id, title, sort_order").eq("course_id", cid).order("sort_order");
        moduleIds = (modules || []).map((m: Record<string, unknown>) => m.id as string);
        let lessonCount = 0;
        let placeholderCount = 0;
        if (moduleIds.length > 0) {
          const { count } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);
          lessonCount = count ?? 0;
          // Count REAL placeholders: content IS NULL OR content contains _placeholder flag
          const { data: allLs } = await sb.from("lessons").select("id, content").in("module_id", moduleIds);
          if (allLs) {
            placeholderCount = allLs.filter((l: any) => {
              if (!l.content) return true;
              if (typeof l.content === 'object' && l.content._placeholder) return true;
              if (typeof l.content === 'string') {
                try { const p = JSON.parse(l.content); return p._placeholder === true; } catch { return false; }
              }
              return false;
            }).length;
          }
        }
        courseSnapshot = { course, modules, lessonsCount: lessonCount, placeholderLessons: placeholderCount };
      } catch (_e) { /* best-effort */ }
    }

    // ══════════════════════════════════════════════════════
    // ── CONTENT SAMPLES for Quality Audit ──
    // ══════════════════════════════════════════════════════

    // ── ALL Lessons (paginated, full content) ──
    const allLessons: unknown[] = [];
    if (cid && moduleIds.length > 0) {
      console.log(`[export] Collecting ALL lessons from ${moduleIds.length} modules`);
      try {
        const { data: modules } = await sb.from("modules").select("id, title, sort_order, learning_field_id, learning_field_code").eq("course_id", cid).order("sort_order");
        for (const mod of (modules || []) as Record<string, unknown>[]) {
          const pageSize = 500;
          let offset = 0;
          while (true) {
            const { data: batch, error: lErr } = await sb
              .from("lessons")
              .select("id, title, sort_order, qc_status, step, status, duration_minutes, competency_id, exam_block, weight_tag, exam_relevance_score, mastery_weight, quality_gate_status, quality_flags")
              .eq("module_id", mod.id as string)
              .order("sort_order")
              .range(offset, offset + pageSize - 1);
            if (lErr) {
              console.log(`[export] Lesson query error for module ${mod.id}: ${lErr.message}`);
              break;
            }
            if (!batch || batch.length === 0) break;
              for (const l of batch as Record<string, unknown>[]) {
                const stepBloomMap: Record<string, string> = { einstieg: "remember", verstehen: "understand", anwenden: "apply", wiederholen: "analyze", mini_check: "apply" };
                const bloomLevel = stepBloomMap[(l.step as string) || ""] || "understand";
                
                allLessons.push({
                  module: mod.title,
                  module_id: mod.id,
                  learning_field_id: mod.learning_field_id,
                  learning_field_code: mod.learning_field_code,
                  lesson_id: l.id,
                  title: l.title,
                  step: l.step,
                  status: l.status,
                  bloom_level: bloomLevel,
                  exam_relevance_score: l.exam_relevance_score,
                  sort_order: l.sort_order,
                  qc_status: l.qc_status,
                  duration_minutes: l.duration_minutes,
                  competency_id: l.competency_id,
                  exam_block: l.exam_block,
                  weight_tag: l.weight_tag,
                  mastery_weight: l.mastery_weight,
                  quality_gate_status: l.quality_gate_status,
                  quality_flags: l.quality_flags,
                });
            }
            if (batch.length < pageSize) break;
            offset += pageSize;
          }
        }
      } catch (e) {
        console.log(`[export] Lessons export error: ${(e as Error).message}`);
      }
    }
    console.log(`[export] Collected ${allLessons.length} lessons (full content)`);

    // ── ALL Exam Questions (paginated, no limit) ──
    // CRITICAL: Use exam_questions_elite_v view to get *_eff fields from annotations
    // The base table's elite_level/elite_score are intentionally NULL for approved questions
    // (immutability principle). The view merges annotations via exam_question_elite_annotations.
    // MEMORY OPTIMIZATION: Only load approved questions with full data.
    // Non-approved counts are fetched via a lightweight count query.
    const allQuestions: unknown[] = [];
    const approvedQuestions: unknown[] = [];
    const seenQuestionIds = new Set<string>();
    let totalQuestionCount = 0;
    let pendingQuestionCount = 0;
    if (curriculumId) {
      console.log(`[export] Collecting APPROVED exam questions via elite view for curriculum ${curriculumId}`);
      
      // Lightweight count query for total/pending (no full row load)
      try {
        const { count: totalCount } = await sb.from("exam_questions_elite_v").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
        totalQuestionCount = totalCount ?? 0;
        const { count: pendCount } = await sb.from("exam_questions_elite_v").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId).eq("qc_status", "pending");
        pendingQuestionCount = pendCount ?? 0;
      } catch (_e) { /* best-effort */ }

      try {
        const pageSize = 500;
        let offset = 0;
        let duplicatesSkipped = 0;
        while (true) {
          const { data: batch, error: qErr } = await sb
            .from("exam_questions_elite_v")
            .select("id, question_text, options, correct_answer, explanation, difficulty, cognitive_level, learning_field_id, qc_status, blueprint_id, competency_id, question_type, trap_tags, distractor_meta, variant_group, variant_label, item_difficulty, item_discrimination, status, created_at, exam_part, scenario_type, bloom_level_validated, time_estimate_seconds, typical_errors, discrimination_tier, elite_level_eff, elite_score_eff, complexity_score, multi_variable_eff, conflict_type, dynamic_scenario, transfer_variant_eff, distractor_types_eff")
            .eq("curriculum_id", curriculumId)
            .or("qc_status.eq.approved,status.eq.approved")
            .order("id")
            .range(offset, offset + pageSize - 1);
          if (qErr) {
            console.log(`[export] Question query error at offset ${offset}: ${qErr.message}`);
            break;
          }
          if (!batch || batch.length === 0) break;
          for (const q of batch as Record<string, unknown>[]) {
            const qId = q.id as string;
            if (seenQuestionIds.has(qId)) {
              duplicatesSkipped++;
              continue;
            }
            seenQuestionIds.add(qId);
            const qObj = {
              id: q.id,
              question_text: q.question_text,
              options: q.options,
              correct_answer: q.correct_answer,
              explanation: q.explanation,
              difficulty: q.difficulty,
              cognitive_level: q.cognitive_level,
              learning_field_id: q.learning_field_id,
              qc_status: q.qc_status,
              status: q.status,
              blueprint_id: q.blueprint_id,
              competency_id: q.competency_id,
              question_type: q.question_type,
              trap_tags: q.trap_tags,
              distractor_meta: q.distractor_meta,
              variant_group: q.variant_group,
              variant_label: q.variant_label,
              item_difficulty: q.item_difficulty,
              item_discrimination: q.item_discrimination,
              created_at: q.created_at,
              exam_part: q.exam_part,
              scenario_type: q.scenario_type,
              bloom_level_validated: q.bloom_level_validated,
              time_estimate_seconds: q.time_estimate_seconds,
              typical_errors: q.typical_errors,
              discrimination_tier: q.discrimination_tier,
              // Elite v2 fields — from *_eff (annotation-merged) columns
              elite_level: q.elite_level_eff,
              elite_score: q.elite_score_eff,
              complexity_score: q.complexity_score,
              multi_variable: q.multi_variable_eff,
              conflict_type: q.conflict_type,
              dynamic_scenario: q.dynamic_scenario,
              transfer_variant: q.transfer_variant_eff,
              distractor_types: q.distractor_types_eff,
            };
            allQuestions.push(qObj);
            approvedQuestions.push(qObj);
          }
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
        if (duplicatesSkipped > 0) {
          console.log(`[export] ⚠️ Deduplicated: ${duplicatesSkipped} duplicate question IDs removed`);
        }
      } catch (e) {
        console.log(`[export] Question export error: ${(e as Error).message}`);
      }
    }
    console.log(`[export] Collected ${allQuestions.length} approved questions (${totalQuestionCount} total in DB)`);

    // ── P0-B: Compute questionsSummary ──
    if (curriculumId) {
      questionsSummary = {
        total_exam_questions: totalQuestionCount,
        approved_questions: approvedQuestions.length,
        pending_questions: pendingQuestionCount,
        draft_questions: totalQuestionCount - approvedQuestions.length - pendingQuestionCount,
        curriculum_id: curriculumId,
        note: "SSOT: approved questions exported with full data; non-approved counted only",
        approval_filter: "qc_status=approved OR status=approved",
      };
    }

    // ── Exam Sessions (all simulation data) ──
    const allExamSessions: unknown[] = [];
    if (curriculumId) {
      try {
        const pageSize = 500;
        let offset = 0;
        while (true) {
          const { data: batch } = await sb
            .from("exam_sessions")
            .select("id, curriculum_id, mode, total_questions, score_percentage, passed, started_at, finished_at, learning_field_weights, difficulty_distribution, created_at")
            .eq("curriculum_id", curriculumId)
            .order("created_at", { ascending: false })
            .range(offset, offset + pageSize - 1);
          if (!batch || batch.length === 0) break;
          allExamSessions.push(...batch);
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${allExamSessions.length} exam sessions`);

    // ── AI Tutor Logs (limited to 1000 most recent, scoped to curriculum sessions) ──
    const allTutorLogs: unknown[] = [];
    if (curriculumId) {
      try {
        // Get session IDs for this curriculum to scope tutor logs
        const { data: sessionIds } = await sb
          .from("exam_sessions")
          .select("id")
          .eq("curriculum_id", curriculumId)
          .order("created_at", { ascending: false })
          .limit(500);
        if (sessionIds?.length) {
          const sIds = (sessionIds as Record<string, unknown>[]).map(s => s.id as string);
          const { data: batch, error: tErr } = await sb
            .from("ai_tutor_logs")
            .select("id, session_id, session_type, mode, prompt_length, response_length, tokens_used, was_blocked, block_reason, created_at")
            .in("session_id", sIds)
            .order("created_at", { ascending: false })
            .limit(1000);
          if (tErr) {
            console.log(`[export] Tutor logs error: ${tErr.message}`);
          } else if (batch) {
            allTutorLogs.push(...batch);
          }
        }
      } catch (e) {
        console.log(`[export] Tutor logs export error: ${(e as Error).message}`);
      }
    }
    console.log(`[export] Collected ${allTutorLogs.length} tutor logs`);

    // ══════════════════════════════════════════════════════
    // ── META-DATEN für tiefgreifendes Kurs-Audit ──
    // ══════════════════════════════════════════════════════

    // ── 1. Curriculum + Learning Fields ──
    let curriculumFull: unknown = null;
    let learningFields: unknown[] = [];
    if (curriculumId) {
      try {
        const { data: cur } = await sb.from("curricula").select("*").eq("id", curriculumId).maybeSingle();
        curriculumFull = cur;
        const { data: lfs } = await sb.from("learning_fields").select("*").eq("curriculum_id", curriculumId).order("sort_order");
        learningFields = lfs || [];
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] Curriculum loaded, ${learningFields.length} learning fields`);

    // ── 2. Question Blueprints + Constraints ──
    let questionBlueprints: unknown[] = [];
    let blueprintConstraints: unknown[] = [];
    if (curriculumId) {
      try {
        const { data: bps } = await sb.from("question_blueprints").select("*").eq("curriculum_id", curriculumId).order("created_at");
        questionBlueprints = bps || [];
        if (questionBlueprints.length > 0) {
          const bpIds = (questionBlueprints as Record<string, unknown>[]).map(b => b.id as string);
          // Paginate constraints
          const pageSize = 500;
          let offset = 0;
          while (true) {
            const { data: batch } = await sb.from("blueprint_constraints").select("*").in("blueprint_id", bpIds).range(offset, offset + pageSize - 1);
            if (!batch || batch.length === 0) break;
            blueprintConstraints.push(...batch);
            if (batch.length < pageSize) break;
            offset += pageSize;
          }
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${questionBlueprints.length} blueprints, ${blueprintConstraints.length} constraints`);

    // ── 3. AI Generations (for this package/curriculum) ──
    let aiGenerations: unknown[] = [];
    if (curriculumId) {
      try {
        const pageSize = 500;
        let offset = 0;
        while (true) {
          const { data: batch } = await sb.from("ai_generations")
            .select("id, entity_type, entity_id, generator_model, status, validation_score, validation_decision, input_tokens, output_tokens, cost_eur, latency_ms, created_at")
            .eq("entity_id", curriculumId)
            .order("created_at", { ascending: false })
            .range(offset, offset + pageSize - 1);
          if (!batch || batch.length === 0) break;
          aiGenerations.push(...batch);
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${aiGenerations.length} AI generations`);

    // ── 4. AI Validations (linked to generations) ──
    let aiValidations: unknown[] = [];
    if (aiGenerations.length > 0) {
      try {
        const genIds = (aiGenerations as Record<string, unknown>[]).map(g => g.id as string);
        const chunkSize = 200;
        for (let ci = 0; ci < genIds.length; ci += chunkSize) {
          const chunk = genIds.slice(ci, ci + chunkSize);
          const pageSize = 500;
          let offset = 0;
          while (true) {
            const { data: batch } = await sb.from("ai_validations")
              .select("id, generation_id, validator_model, validation_mode, overall_score, decision, dimension_scores, critical_issues, improvements, cost_eur, validated_at")
              .in("generation_id", chunk)
              .range(offset, offset + pageSize - 1);
            if (!batch || batch.length === 0) break;
            aiValidations.push(...batch);
            if (batch.length < pageSize) break;
            offset += pageSize;
          }
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${aiValidations.length} AI validations`);

    // ── 5. Quality Gates ──
    let qualityGates: unknown[] = [];
    if (aiGenerations.length > 0) {
      try {
        const genIds = (aiGenerations as Record<string, unknown>[]).map(g => g.id as string);
        const chunkSize = 200;
        for (let ci = 0; ci < genIds.length; ci += chunkSize) {
          const chunk = genIds.slice(ci, ci + chunkSize);
          const { data } = await sb.from("ai_quality_gates")
            .select("*")
            .in("generation_id", chunk)
            .order("created_at", { ascending: false });
          if (data) qualityGates.push(...data);
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${qualityGates.length} quality gates`);

    // ── 6. Tech Council findings ──
    let councilFindings: unknown[] = [];
    if (curriculumId) {
      try {
        const { data } = await sb.from("tech_council_findings")
          .select("*")
          .or(`affected_entity.eq.${curriculumId},affected_entity.eq.${cid},affected_entity.eq.${packageId}`)
          .order("created_at", { ascending: false });
        councilFindings = data || [];
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${councilFindings.length} council findings`);

    // ── 7. Patch Plans ──
    let patchPlans: unknown[] = [];
    if (councilFindings.length > 0) {
      try {
        const findingIds = (councilFindings as Record<string, unknown>[]).map(f => f.id as string);
        const { data } = await sb.from("admin_patch_plans")
          .select("*")
          .in("finding_id", findingIds)
          .order("created_at", { ascending: false });
        patchPlans = data || [];
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${patchPlans.length} patch plans`);

    // ── 8. Auto-Heal Log ──
    let autoHealLog: unknown[] = [];
    if (curriculumId || cid || packageId) {
      try {
        const targets = [curriculumId, cid, packageId].filter(Boolean);
        const { data } = await sb.from("auto_heal_log")
          .select("*")
          .in("target_id", targets)
          .order("created_at", { ascending: false })
          .limit(500);
        autoHealLog = data || [];
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${autoHealLog.length} auto-heal entries`);

    // ── 9. AI Cost Summary (usage log) ──
    let aiCostSummary: Record<string, unknown> = {};
    try {
      const { data: usageLogs } = await sb.from("ai_usage_log")
        .select("job_type, cost_eur, input_tokens, output_tokens, total_tokens, success, model")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (usageLogs?.length) {
        const totalCost = usageLogs.reduce((s: number, l: any) => s + (l.cost_eur || 0), 0);
        const totalTokens = usageLogs.reduce((s: number, l: any) => s + (l.total_tokens || 0), 0);
        const byJobType: Record<string, { count: number; cost: number; tokens: number }> = {};
        for (const l of usageLogs as Record<string, unknown>[]) {
          const jt = (l.job_type as string) || "unknown";
          if (!byJobType[jt]) byJobType[jt] = { count: 0, cost: 0, tokens: 0 };
          byJobType[jt].count++;
          byJobType[jt].cost += (l.cost_eur as number) || 0;
          byJobType[jt].tokens += (l.total_tokens as number) || 0;
        }
        aiCostSummary = { total_cost_eur: totalCost, total_tokens: totalTokens, entries: usageLogs.length, by_job_type: byJobType };
      }
    } catch (_e) { /* best-effort */ }
    console.log(`[export] AI cost summary: ${JSON.stringify(aiCostSummary).length} bytes`);

    // ── 10. LF Distribution Analysis (enriched with lesson/minicheck/competency counts) ──
    let lfDistribution: unknown[] = [];
    if (curriculumId && learningFields.length > 0) {
      try {
        // Pre-compute lesson counts per LF from allLessons
        const lessonsByLF: Record<string, { total: number; minichecks: number; steps: Record<string, number> }> = {};
        for (const l of allLessons as Record<string, unknown>[]) {
          const lfId = l.learning_field_id as string;
          if (!lfId) continue;
          if (!lessonsByLF[lfId]) lessonsByLF[lfId] = { total: 0, minichecks: 0, steps: {} };
          lessonsByLF[lfId].total++;
          const step = (l.step as string) || "unknown";
          lessonsByLF[lfId].steps[step] = (lessonsByLF[lfId].steps[step] || 0) + 1;
          if (step === "mini_check") lessonsByLF[lfId].minichecks++;
        }

        for (const lf of learningFields as Record<string, unknown>[]) {
          const lfId = lf.id as string;
          const { count: totalQ } = await sb.from("exam_questions").select("id", { count: "exact", head: true })
            .eq("curriculum_id", curriculumId).eq("learning_field_id", lfId);
          const { count: approvedQ } = await sb.from("exam_questions").select("id", { count: "exact", head: true })
            .eq("curriculum_id", curriculumId).eq("learning_field_id", lfId).eq("qc_status", "approved");
          const { count: bpCount } = await sb.from("question_blueprints").select("id", { count: "exact", head: true })
            .eq("curriculum_id", curriculumId).eq("learning_field_id", lfId);
          const { count: compCount } = await sb.from("competencies").select("id", { count: "exact", head: true })
            .eq("learning_field_id", lfId);
          const lfLessons = lessonsByLF[lfId] || { total: 0, minichecks: 0, steps: {} };
          lfDistribution.push({
            learning_field_id: lfId,
            title: lf.title,
            sort_order: lf.sort_order,
            questions_total: totalQ ?? 0,
            questions_approved: approvedQ ?? 0,
            blueprints: bpCount ?? 0,
            competencies: compCount ?? 0,
            lessons_total: lfLessons.total,
            minichecks: lfLessons.minichecks,
            didactic_steps: lfLessons.steps,
            // Use curriculum-defined weight (SSOT), fallback to question-based
            weight_percent: typeof lf.weight_percent === "number" ? lf.weight_percent : 0,
          });
        }
        // If no curriculum weights exist, compute from question counts as fallback
        const hasCurriculumWeights = lfDistribution.some((d: any) => d.weight_percent > 0);
        if (!hasCurriculumWeights) {
          const totalAllQ = lfDistribution.reduce((s: number, d: any) => s + d.questions_total, 0);
          for (const d of lfDistribution as Record<string, unknown>[]) {
            (d as any).weight_percent = totalAllQ > 0 ? Math.round(((d as any).questions_total / totalAllQ) * 1000) / 10 : 0;
          }
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] LF distribution: ${lfDistribution.length} fields analyzed`);

    // ── 10b. Competencies Export (full graph with mastery thresholds) ──
    let competencies: unknown[] = [];
    if (curriculumId && learningFields.length > 0) {
      try {
        const lfIds = (learningFields as Record<string, unknown>[]).map(lf => lf.id as string);
        const { data: comps } = await sb.from("competencies")
          .select("id, learning_field_id, code, title, description, taxonomy_level, sort_order")
          .in("learning_field_id", lfIds)
          .order("sort_order");
        competencies = (comps || []).map((c: any) => ({
          ...c,
          mastery_thresholds: { not_mastered: 0.6, partial: 0.8, mastered: 1.0 },
        }));
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${competencies.length} competencies exported`);

    // ── 11. Autofix Runs ──
    let autofixRuns: unknown[] = [];
    if (curriculumId) {
      try {
        const { data } = await sb.from("autofix_runs")
          .select("*")
          .eq("curriculum_id", curriculumId)
          .order("created_at", { ascending: false });
        autofixRuns = data || [];
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${autofixRuns.length} autofix runs`);

    // ── 12. AI Budget Info ──
    let aiBudgets: unknown[] = [];
    try {
      const { data } = await sb.from("ai_cost_budgets")
        .select("*")
        .order("month", { ascending: false })
        .limit(6);
      aiBudgets = data || [];
    } catch (_e) { /* best-effort */ }

    // ── 13. Worker Policies ──
    let workerPolicies: unknown[] = [];
    try {
      const { data } = await sb.from("ai_worker_policies").select("*");
      workerPolicies = data || [];
    } catch (_e) { /* best-effort */ }

    // ══════════════════════════════════════════════════════
    // ── 14. Content Versions / Publish Log ──
    // ══════════════════════════════════════════════════════
    let contentVersions: unknown[] = [];
    if (cid && moduleIds.length > 0) {
      try {
        const { data: lessonIds } = await sb.from("lessons").select("id").in("module_id", moduleIds);
        if (lessonIds?.length) {
          const ids = lessonIds.map((l: any) => l.id as string);
          const chunkSize = 200;
          for (let ci = 0; ci < ids.length; ci += chunkSize) {
            const chunk = ids.slice(ci, ci + chunkSize);
            const pageSize = 500;
            let offset = 0;
            while (true) {
              const { data: batch } = await sb.from("content_versions")
                .select("id, lesson_id, version_number, status, published_at, published_by, verdict, created_at, agent")
                .in("lesson_id", chunk)
                .order("created_at", { ascending: false })
                .range(offset, offset + pageSize - 1);
              if (!batch || batch.length === 0) break;
              contentVersions.push(...batch);
              if (batch.length < pageSize) break;
              offset += pageSize;
            }
          }
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${contentVersions.length} content versions`);

    // ── 15. MiniChecks (extracted from lessons) ──
    const minichecks: unknown[] = [];
    for (const l of allLessons as Record<string, unknown>[]) {
      if (l.minicheck_parsed || l.step === "mini_check") {
        minichecks.push({
          lesson_id: l.lesson_id,
          lesson_title: l.title,
          module_id: l.module_id,
          learning_field_id: l.learning_field_id,
          competency_id: l.competency_id,
          minicheck_data: l.minicheck_parsed,
          mastery_weight: l.mastery_weight,
        });
      }
    }
    console.log(`[export] ${minichecks.length} minichecks extracted`);

    // ══════════════════════════════════════════════════════
    // ── TRACEABILITY PROTOCOL (question → blueprint → competency → LF) ──
    // ══════════════════════════════════════════════════════
    const traceProtocol: unknown[] = [];
    const bpMap = new Map((questionBlueprints as Record<string, unknown>[]).map(b => [b.id as string, b]));
    const compMap = new Map((competencies as Record<string, unknown>[]).map(c => [c.id as string, c]));
    const lfMap = new Map((learningFields as Record<string, unknown>[]).map(lf => [lf.id as string, lf]));
    for (const q of allQuestions as Record<string, unknown>[]) {
      const bp = bpMap.get(q.blueprint_id as string);
      const comp = compMap.get(q.competency_id as string);
      const compLfId = comp ? (comp as Record<string, unknown>).learning_field_id as string : null;
      const qLfId = q.learning_field_id as string | null;
      const resolvedLfId = qLfId || compLfId || null;
      const lfMismatch = !!(qLfId && compLfId && qLfId !== compLfId);
      const lf = lfMap.get(resolvedLfId || "");
      traceProtocol.push({
        question_id: q.id,
        blueprint_id: q.blueprint_id || null,
        blueprint_name: bp ? (bp as Record<string, unknown>).name : null,
        competency_id: q.competency_id || null,
        competency_title: comp ? (comp as Record<string, unknown>).title : null,
        learning_field_id: resolvedLfId,
        lf_from_question: qLfId || null,
        lf_from_competency: compLfId || null,
        lf_mismatch: lfMismatch,
        learning_field_title: lf ? (lf as Record<string, unknown>).title : null,
        variant_group: q.variant_group || null,
        variant_label: q.variant_label || null,
        qc_status: q.qc_status,
        difficulty: q.difficulty,
        cognitive_level: q.cognitive_level,
        has_blueprint: !!q.blueprint_id,
        has_competency: !!q.competency_id,
        has_learning_field: !!resolvedLfId,
      });
    }
    console.log(`[export] Trace protocol: ${traceProtocol.length} entries`);

    // ══════════════════════════════════════════════════════
    // ── RED-FLAG REPORT ──
    // ══════════════════════════════════════════════════════
    const redFlags: Record<string, unknown> = (() => {
      const flags: { severity: string; category: string; message: string; count: number; details?: unknown }[] = [];

      // 1. Blueprints without templates
      const bpsNoTemplate = (questionBlueprints as Record<string, unknown>[]).filter(b => !b.question_template || (b.question_template as string).trim() === "");
      if (bpsNoTemplate.length > 0) flags.push({ severity: "critical", category: "blueprint_quality", message: "Blueprints ohne question_template", count: bpsNoTemplate.length, details: bpsNoTemplate.map(b => ({ id: b.id, name: b.name })) });

      // 2. Blueprints without traps
      const bpsNoTraps = (questionBlueprints as Record<string, unknown>[]).filter(b => !b.typical_exam_trap && (!b.typical_errors || !Array.isArray(b.typical_errors) || (b.typical_errors as unknown[]).length === 0));
      if (bpsNoTraps.length > 0) flags.push({ severity: "critical", category: "blueprint_quality", message: "Blueprints ohne Traps/typical_errors", count: bpsNoTraps.length });

      // 3. Competencies without questions
      const compIdsWithQ = new Set((allQuestions as Record<string, unknown>[]).map(q => q.competency_id as string).filter(Boolean));
      const compsWithoutQ = (competencies as Record<string, unknown>[]).filter(c => !compIdsWithQ.has(c.id as string));
      if (compsWithoutQ.length > 0) flags.push({ severity: "high", category: "coverage_gap", message: "Kompetenzen ohne Fragen", count: compsWithoutQ.length, details: compsWithoutQ.map(c => ({ id: c.id, title: c.title })) });

      // 4. LFs with undercoverage (against LF weight targets, not flat 5%)
      const totalQ = allQuestions.length;
      const qByLf: Record<string, number> = {};
      for (const q of allQuestions as Record<string, unknown>[]) {
        const lfId = (q.learning_field_id as string) || "_none";
        qByLf[lfId] = (qByLf[lfId] || 0) + 1;
      }
      // Use LF weight_percentage as target share; fallback to even distribution
      const totalWeight = (learningFields as Record<string, unknown>[]).reduce((s, lf) => s + ((lf as any).weight_percentage || (lf as any).weight || 0), 0);
      const underCoveredLFs = (learningFields as Record<string, unknown>[]).filter(lf => {
        const count = qByLf[lf.id as string] || 0;
        const actualShare = totalQ > 0 ? count / totalQ : 0;
        const lfWeight = ((lf as any).weight_percentage || (lf as any).weight || 0) as number;
        const targetShare = totalWeight > 0 ? lfWeight / totalWeight : (1 / Math.max(learningFields.length, 1));
        return totalQ > 0 && actualShare < targetShare * 0.6; // undercovered if actual < 60% of target
      });
      if (underCoveredLFs.length > 0) flags.push({ severity: "high", category: "lf_undercoverage", message: "Lernfelder mit Unterdeckung (< 60% des Ziel-Anteils laut LF-Gewichtung)", count: underCoveredLFs.length, details: underCoveredLFs.map(lf => {
        const count = qByLf[lf.id as string] || 0;
        const lfWeight = ((lf as any).weight_percentage || (lf as any).weight || 0) as number;
        const targetShare = totalWeight > 0 ? lfWeight / totalWeight : (1 / Math.max(learningFields.length, 1));
        return { id: lf.id, title: lf.title, questions: count, actual_percent: totalQ > 0 ? Math.round((count / totalQ) * 1000) / 10 : 0, target_percent: Math.round(targetShare * 1000) / 10, gap_percent: Math.round((targetShare - (totalQ > 0 ? count / totalQ : 0)) * 1000) / 10 };
      }) });

      // 5. Questions without blueprint_id
      const qNoBp = (allQuestions as Record<string, unknown>[]).filter(q => !q.blueprint_id).length;
      if (qNoBp > 0) flags.push({ severity: "medium", category: "traceability", message: "Fragen ohne blueprint_id (nicht rückverfolgbar)", count: qNoBp, details: { percent: totalQ > 0 ? Math.round((qNoBp / totalQ) * 1000) / 10 : 0 } });

      // 6. Questions without competency_id
      const qNoComp = (allQuestions as Record<string, unknown>[]).filter(q => !q.competency_id).length;
      if (qNoComp > 0) flags.push({ severity: "medium", category: "traceability", message: "Fragen ohne competency_id", count: qNoComp, details: { percent: totalQ > 0 ? Math.round((qNoComp / totalQ) * 1000) / 10 : 0 } });

      // 7. Difficulty bias (> 60% same difficulty)
      const diffDist: Record<string, number> = {};
      for (const q of allQuestions as Record<string, unknown>[]) {
        const d = (q.difficulty as string) || "unknown";
        diffDist[d] = (diffDist[d] || 0) + 1;
      }
      for (const [diff, count] of Object.entries(diffDist)) {
        if (totalQ > 20 && (count / totalQ) > 0.6) {
          flags.push({ severity: "high", category: "difficulty_bias", message: `Difficulty-Bias: > 60% der Fragen sind '${diff}'`, count, details: { percent: Math.round((count / totalQ) * 1000) / 10 } });
        }
      }

      // 8. "Fake approved" (approved but no approved_at on blueprint)
      const approvedBpsNoAudit = (questionBlueprints as Record<string, unknown>[]).filter(b => b.status === "approved" && !b.approved_at);
      if (approvedBpsNoAudit.length > 0) flags.push({ severity: "critical", category: "governance", message: "Blueprints 'approved' ohne approved_at (Fake-Approval)", count: approvedBpsNoAudit.length });

      // 9. Similarity clusters (variant_group with > 10 questions)
      const variantGroups: Record<string, number> = {};
      for (const q of allQuestions as Record<string, unknown>[]) {
        const vg = q.variant_group as string;
        if (vg) variantGroups[vg] = (variantGroups[vg] || 0) + 1;
      }
      const largeGroups = Object.entries(variantGroups).filter(([_, c]) => c > 10);
      if (largeGroups.length > 0) flags.push({ severity: "low", category: "similarity", message: "Varianten-Cluster mit > 10 Fragen (Duplikat-Risiko)", count: largeGroups.length, details: largeGroups.map(([g, c]) => ({ variant_group: g, count: c })) });

      return {
        generated_at: new Date().toISOString(),
        total_flags: flags.length,
        critical: flags.filter(f => f.severity === "critical").length,
        high: flags.filter(f => f.severity === "high").length,
        medium: flags.filter(f => f.severity === "medium").length,
        low: flags.filter(f => f.severity === "low").length,
        flags,
      };
    })();
    console.log(`[export] Red flags: ${(redFlags as any).total_flags} (${(redFlags as any).critical} critical)`);

    // ══════════════════════════════════════════════════════
    // ── DIFFICULTY + LF DISTRIBUTION (separate files) ──
    // ══════════════════════════════════════════════════════
    const difficultyDistribution = (() => {
      const isApproved = (q: Record<string, unknown>) => q.qc_status === "approved" || q.status === "approved";
      const dist: Record<string, { total: number; approved: number; draft: number }> = {};
      for (const q of allQuestions as Record<string, unknown>[]) {
        const d = (q.difficulty as string) || "unknown";
        if (!dist[d]) dist[d] = { total: 0, approved: 0, draft: 0 };
        dist[d].total++;
        if (isApproved(q)) dist[d].approved++;
        else dist[d].draft++;
      }
      const total = allQuestions.length;
      return {
        total_questions: total,
        distribution: dist,
        percentages: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, { percent: total > 0 ? Math.round((v.total / total) * 1000) / 10 : 0, ...v }])),
        target: { easy: "10-20%", medium: "40-60%", hard: "25-40%" },
      };
    })();

    // ── Mastery Model ──
    const masteryModel = {
      model_type: "three_tier_competency",
      has_runtime_mastery_data: false, // No user_progress/competency_mastery tables queried – static spec only
      thresholds: { not_mastered: { max_score: 0.6, label: "Nicht beherrscht" }, partial: { min_score: 0.6, max_score: 0.8, label: "Teilweise beherrscht" }, mastered: { min_score: 0.8, label: "Beherrscht" } },
      progression_rules: {
        lesson_completion: "All 5 didactic steps (einstieg → mini_check) completed",
        minicheck_threshold: "Score >= 70% to advance",
        mastery_update: "Weighted average of minicheck scores + exam performance",
      },
      didactic_steps: ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"],
      competencies_total: competencies.length,
    };

    // ══════════════════════════════════════════════════════
    // ── BUILD ZIP (v5.0 Critical Audit) ──
    // ══════════════════════════════════════════════════════
    const zip = new JSZip();

    // ── Block 1: Curriculum SSOT ──
    zip.file("1_curriculum/curriculum.json", JSON.stringify(curriculumFull || {}, null, 2));
    zip.file("1_curriculum/learning_fields.json", JSON.stringify(learningFields, null, 2));
    zip.file("1_curriculum/competencies.json", JSON.stringify(competencies, null, 2));
    zip.file("1_curriculum/lf_distribution.json", JSON.stringify(lfDistribution, null, 2));

    // ── Block 2: Blueprints SSOT ──
    zip.file("2_blueprints/question_blueprints.json", JSON.stringify(questionBlueprints, null, 2));
    zip.file("2_blueprints/constraints.json", JSON.stringify(blueprintConstraints, null, 2));
    zip.file("2_blueprints/quality_summary.json", JSON.stringify((() => {
      const bpsWithTraps = (questionBlueprints as Record<string, unknown>[]).filter(b => Array.isArray(b.typical_errors) && (b.typical_errors as unknown[]).length > 0).length;
      const bpsWithContext = (questionBlueprints as Record<string, unknown>[]).filter(b => b.exam_context_type && b.exam_context_type !== "isolated_knowledge").length;
      const bpsWithTemplate = (questionBlueprints as Record<string, unknown>[]).filter(b => b.question_template && (b.question_template as string).trim() !== "").length;
      return {
        total: questionBlueprints.length,
        with_question_template: bpsWithTemplate,
        with_typical_errors: bpsWithTraps,
        with_exam_context: bpsWithContext,
        with_decision_structure: (questionBlueprints as Record<string, unknown>[]).filter(b => b.decision_structure).length,
        with_trap_spec: (questionBlueprints as Record<string, unknown>[]).filter(b => b.typical_exam_trap).length,
        by_status: (() => { const m: Record<string, number> = {}; for (const b of questionBlueprints as Record<string, unknown>[]) { const s = (b.status as string) || "unknown"; m[s] = (m[s] || 0) + 1; } return m; })(),
        by_cognitive_level: (() => { const m: Record<string, number> = {}; for (const b of questionBlueprints as Record<string, unknown>[]) { const cl = (b.cognitive_level as string) || "unknown"; m[cl] = (m[cl] || 0) + 1; } return m; })(),
        by_exam_context_type: (() => { const m: Record<string, number> = {}; for (const b of questionBlueprints as Record<string, unknown>[]) { const t = (b.exam_context_type as string) || "none"; m[t] = (m[t] || 0) + 1; } return m; })(),
        avg_exam_relevance_score: questionBlueprints.length > 0 ? Math.round((questionBlueprints as Record<string, unknown>[]).reduce((s, b) => s + ((b.exam_relevance_score as number) || 0), 0) / questionBlueprints.length * 10) / 10 : 0,
      };
    })(), null, 2));
    // Group by LF
    const bpsByLf: Record<string, unknown[]> = {};
    for (const bp of questionBlueprints as Record<string, unknown>[]) {
      const lfId = (bp.learning_field_id as string) || "_unassigned";
      if (!bpsByLf[lfId]) bpsByLf[lfId] = [];
      bpsByLf[lfId].push(bp);
    }
    for (const [lfId, bps] of Object.entries(bpsByLf)) {
      const lfObj = (learningFields as Record<string, unknown>[]).find(lf => lf.id === lfId);
      const lfName = safeFilename((lfObj as any)?.title || lfId.slice(0, 8));
      zip.file(`2_blueprints/by_lf/${lfName}.json`, JSON.stringify({ learning_field_id: lfId, learning_field_title: (lfObj as any)?.title || "Unbekannt", blueprint_count: bps.length, blueprints: bps }, null, 2));
    }

    // ── Block 3: Questions + Exam Pool ──
    // NOTE: allQuestions = approved only (memory optimization). Non-approved are counted in summary.
    zip.file("3_exam_pool/exam_questions_approved.json", JSON.stringify(allQuestions, null, 2));
    zip.file("3_exam_pool/difficulty_distribution.json", JSON.stringify(difficultyDistribution, null, 2));
    zip.file("3_exam_pool/lf_distribution.json", JSON.stringify(lfDistribution, null, 2));
    zip.file("3_exam_pool/exam_sessions_all.json", JSON.stringify(allExamSessions, null, 2));
    // Trace protocol written as NDJSON (one JSON line per entry) to reduce peak memory
    zip.file("3_exam_pool/trace.ndjson", traceProtocol.map(t => JSON.stringify(t)).join("\n"));

    // ── Block 4: Didaktik (Lessons, MiniChecks, Mastery) ──
    zip.file("4_didaktik/lessons_all.json", JSON.stringify(allLessons, null, 2));
    zip.file("4_didaktik/minichecks.json", JSON.stringify(minichecks, null, 2));
    zip.file("4_didaktik/mastery_model.json", JSON.stringify(masteryModel, null, 2));
    zip.file("4_didaktik/course_snapshot.json", JSON.stringify(courseSnapshot || {}, null, 2));
    zip.file("4_didaktik/handbook.md", handbookMd);
    zip.file("4_didaktik/handbook_structured.json", JSON.stringify(handbookStructured, null, 2));

    // ── Block 5: Governance & Quality Gates ──

    // ═══ NEW: Package-level Quality Gate Report ═══
    let qualityGateReport: unknown = { error: "not_available" };
    try {
      // Fetch pipeline steps status for this package
      const { data: pipelineSteps } = await sb
        .from("package_steps")
        .select("step_key, status, attempts, started_at, completed_at, last_error")
        .eq("package_id", packageId)
        .order("created_at");

      // Compute live snapshot metrics
      const totalQ = (allQuestions || []).length;
      const approvedQ = (approvedQuestions || []).length;
      const approvedRatio = totalQ > 0 ? Math.round((approvedQ / totalQ) * 1000) / 10 : 0;

      // LF coverage from approved questions
      const lfIdsWithQuestions = new Set((approvedQuestions || []).map((q: any) => q.learning_field_id).filter(Boolean));
      const totalLfs = (learningFields || []).length;
      const coveredLfs = Math.min(lfIdsWithQuestions.size, totalLfs);

      // Duplicate detection (same question_text)
      const textSet = new Set<string>();
      let duplicateCount = 0;
      for (const q of (approvedQuestions || []) as any[]) {
        const t = (q.question_text || "").trim().toLowerCase();
        if (t && textSet.has(t)) duplicateCount++;
        else textSet.add(t);
      }
      const duplicateRate = approvedQ > 0 ? Math.round((duplicateCount / approvedQ) * 1000) / 10 : 0;

      // Bloom distribution
      const bloomDist: Record<string, number> = {};
      for (const q of (approvedQuestions || []) as any[]) {
        const cl = q.cognitive_level || "unknown";
        bloomDist[cl] = (bloomDist[cl] || 0) + 1;
      }

      // Council verdict (latest)
      const latestCouncilVerdict = councilFindings.length > 0
        ? (councilFindings as any[])[0]?.severity || "unknown"
        : "no_council_run";

      qualityGateReport = {
        report_generated_at: new Date().toISOString(),
        package_id: packageId,
        curriculum_id: curriculumId,
        pipeline_steps: pipelineSteps || [],
        snapshot: {
          total_questions: totalQ,
          approved_questions: approvedQ,
          approved_ratio: approvedRatio,
          lf_total: totalLfs,
          lf_covered: coveredLfs,
          lf_coverage_ratio: totalLfs > 0 ? Math.round((coveredLfs / totalLfs) * 1000) / 10 : 0,
          duplicate_count: duplicateCount,
          duplicate_rate: duplicateRate,
          bloom_distribution: bloomDist,
          blueprints_total: (questionBlueprints || []).length,
          blueprints_approved: (questionBlueprints as any[]).filter((b: any) => b.status === "approved").length,
          lessons_total: (allLessons || []).length,
          council_findings_count: councilFindings.length,
          latest_council_verdict: latestCouncilVerdict,
        },
        gate_results: {
          G0_LF_COVERAGE: coveredLfs >= totalLfs ? "PASS" : `FAIL (${coveredLfs}/${totalLfs})`,
          G1_APPROVAL_RATE: approvedRatio >= 95 ? "PASS" : `FAIL (${approvedRatio}%)`,
          G2_DUPLICATE_RATE: duplicateRate <= 2 ? "PASS" : `WARN (${duplicateRate}%)`,
          G3_BLUEPRINT_APPROVED: (questionBlueprints as any[]).filter((b: any) => b.status === "approved").length === (questionBlueprints || []).length ? "PASS" : "FAIL",
          G4_COUNCIL: latestCouncilVerdict === "no_council_run" ? "PENDING" : (councilFindings.length === 0 ? "PASS" : `${councilFindings.length} findings`),
        },
      };
    } catch (gateErr) {
      console.error(`[export] Quality gate report error: ${(gateErr as Error).message}`);
      qualityGateReport = { error: (gateErr as Error).message };
    }

    zip.file("5_governance/quality_gate_report.json", JSON.stringify(qualityGateReport, null, 2));
    zip.file("5_governance/quality_gates.json", JSON.stringify(qualityGates, null, 2));
    zip.file("5_governance/ai_validations.json", JSON.stringify(aiValidations, null, 2));
    zip.file("5_governance/council_findings.json", JSON.stringify(councilFindings, null, 2));
    zip.file("5_governance/content_versions.json", JSON.stringify(contentVersions, null, 2));
    zip.file("5_governance/auto_heal_log.json", JSON.stringify(autoHealLog, null, 2));
    zip.file("5_governance/patch_plans.json", JSON.stringify(patchPlans, null, 2));
    zip.file("5_governance/autofix_runs.json", JSON.stringify(autofixRuns, null, 2));
    zip.file("5_governance/ai_generations.json", JSON.stringify(aiGenerations, null, 2));
    zip.file("5_governance/ai_cost_summary.json", JSON.stringify(aiCostSummary, null, 2));
    zip.file("5_governance/ai_budgets.json", JSON.stringify(aiBudgets, null, 2));
    zip.file("5_governance/worker_policies.json", JSON.stringify(workerPolicies, null, 2));

    // ── Red-Flag Report (top-level) ──
    zip.file("red_flags.json", JSON.stringify(redFlags, null, 2));

    // ── Oral Exam ──
    zip.file("oral_exam/sessionsets.json", JSON.stringify(oralSessionsets || [], null, 2));
    zip.file("oral_exam/blueprints.json", JSON.stringify(oralBlueprints, null, 2));
    zip.file("oral_exam/session_templates.json", JSON.stringify(oralSessionTemplates, null, 2));
    zip.file("oral_exam/sessions_all.json", JSON.stringify(allOralSessions, null, 2));

    // ── Tutor ──
    zip.file("tutor/context_indices.json", JSON.stringify(tutorIndices || [], null, 2));
    zip.file("tutor/policies.json", JSON.stringify(tutorPolicies, null, 2));
    zip.file("tutor/logs_all.json", JSON.stringify(allTutorLogs, null, 2));

    // ── Legacy compat files ──
    zip.file("package.json", JSON.stringify(pkg, null, 2));
    zip.file("plan.json", JSON.stringify(plan || {}, null, 2));
    zip.file("steps.json", JSON.stringify(steps || [], null, 2));
    zip.file("questions_summary.json", JSON.stringify(questionsSummary, null, 2));

    // ══════════════════════════════════════════════════════
    // ── INTEGRITY GUARD: step metadata vs actual DB counts ──
    // ══════════════════════════════════════════════════════
    const integrityCheck = (() => {
      const issues: { severity: string; step: string; message: string; expected: unknown; actual: unknown }[] = [];

      // Helper: find step meta
      const stepMeta = (key: string) => {
        const s = (steps || []).find((st: any) => st.step_key === key);
        return s ? { status: s.status, meta: s.meta || {} } : null;
      };

      // Check: blueprints seeded vs DB count
      const bpStep = stepMeta("auto_seed_exam_blueprints");
      if (bpStep?.status === "done") {
        const claimedSeeded = (bpStep.meta as any)?.seeded;
        if (typeof claimedSeeded === "number" && claimedSeeded > 0 && questionBlueprints.length === 0) {
          issues.push({ severity: "critical", step: "auto_seed_exam_blueprints", message: `Step claims ${claimedSeeded} seeded but DB has 0 blueprints`, expected: claimedSeeded, actual: 0 });
        }
      }

      // Check: exam pool generated vs DB count
      const epStep = stepMeta("generate_exam_pool");
      if (epStep?.status === "done") {
        const claimedQ = (epStep.meta as any)?.total_questions;
        if (typeof claimedQ === "number" && claimedQ > 0 && allQuestions.length === 0) {
          issues.push({ severity: "critical", step: "generate_exam_pool", message: `Step claims ${claimedQ} questions but DB has 0`, expected: claimedQ, actual: 0 });
        }
      }

      // Check: lessons generated vs DB count  
      const lcStep = stepMeta("generate_learning_content");
      if (lcStep?.status === "done") {
        const claimedL = (lcStep.meta as any)?.lessonsGenerated || (lcStep.meta as any)?.lessons_generated;
        if (typeof claimedL === "number" && claimedL > 0 && allLessons.length === 0) {
          issues.push({ severity: "critical", step: "generate_learning_content", message: `Step claims ${claimedL} lessons but DB has 0`, expected: claimedL, actual: 0 });
        }
      }

      // Check: course scaffold (modules)
      const scStep = stepMeta("scaffold_learning_course");
      if (scStep?.status === "done") {
        const snap = courseSnapshot as Record<string, unknown> | null;
        const moduleCount = snap?.modules ? (snap.modules as unknown[]).length : 0;
        if (moduleCount === 0) {
          issues.push({ severity: "critical", step: "scaffold_learning_course", message: "Step done but 0 modules in DB", expected: ">0", actual: 0 });
        }
      }

      // Check: oral exam blueprints
      const oeStep = stepMeta("generate_oral_exam");
      if (oeStep?.status === "done" && oralBlueprints.length === 0) {
        issues.push({ severity: "high", step: "generate_oral_exam", message: "Step done but 0 oral blueprints in DB", expected: ">0", actual: 0 });
      }

      const hasCritical = issues.some(i => i.severity === "critical");
      return {
        status: issues.length === 0 ? "healthy" : hasCritical ? "INTEGRITY_FAILURE" : "degraded",
        issues_count: issues.length,
        critical_count: issues.filter(i => i.severity === "critical").length,
        issues,
        recommendation: hasCritical
          ? "PIPELINE DATA LOSS DETECTED: Steps report success but data is missing from DB. A full pipeline re-run is required."
          : issues.length > 0
            ? "Some data inconsistencies detected. Review issues and consider targeted re-generation."
            : "All step metadata matches actual DB counts.",
      };
    })();
    if (integrityCheck.status === "INTEGRITY_FAILURE") {
      console.error(`[export] ⚠️ INTEGRITY FAILURE: ${integrityCheck.critical_count} critical issues detected`);
    }
    zip.file("integrity_check.json", JSON.stringify(integrityCheck, null, 2));

    // ── QUALITY ANALYSIS (computed from all data) ──
    const qualityAnalysis = (() => {
      const diffDist: Record<string, number> = {};
      const cognDist: Record<string, number> = {};
      const typeDist: Record<string, number> = {};
      let withTraps = 0, withDistractorMeta = 0;
      for (const q of allQuestions as Record<string, unknown>[]) {
        const diff = (q.difficulty as string) || "unknown";
        diffDist[diff] = (diffDist[diff] || 0) + 1;
        const cogn = (q.cognitive_level as string) || "unknown";
        cognDist[cogn] = (cognDist[cogn] || 0) + 1;
        const qtype = (q.question_type as string) || "unknown";
        typeDist[qtype] = (typeDist[qtype] || 0) + 1;
        if (q.trap_tags && Array.isArray(q.trap_tags) && (q.trap_tags as unknown[]).length > 0) withTraps++;
        if (q.distractor_meta) withDistractorMeta++;
      }
      const totalQ = allQuestions.length;
      const stepDist: Record<string, number> = {};
      const bloomDist: Record<string, number> = {};
      let withMinicheck = 0, withBloomTag = 0;
      for (const l of allLessons as Record<string, unknown>[]) {
        const step = (l.step as string) || "unknown";
        stepDist[step] = (stepDist[step] || 0) + 1;
        if (l.minicheck_parsed) withMinicheck++;
        const bloom = (l.bloom_level as string) || "unknown";
        bloomDist[bloom] = (bloomDist[bloom] || 0) + 1;
        if (bloom !== "unknown") withBloomTag++;
      }
      const bpsWithTraps = (questionBlueprints as Record<string, unknown>[]).filter(b => b.typical_errors && Array.isArray(b.typical_errors) && (b.typical_errors as unknown[]).length > 0).length;
      const bpsWithContext = (questionBlueprints as Record<string, unknown>[]).filter(b => b.exam_context_type).length;
      // Exam-pool specific quality metrics (computed from questions, NOT lessons)
      const examPoolQuality = (() => {
        const bloomFromQ: Record<string, number> = {};
        let qWithBloom = 0;
        let qWithTrapTags = 0;
        let qWithDistractorMeta = 0;
        let qWithExamPart = 0;
        const examPartDist: Record<string, number> = {};
        const questionTypeDist2: Record<string, number> = {};

        for (const q of allQuestions as Record<string, unknown>[]) {
          const cl = (q.cognitive_level as string);
          if (cl && cl !== "unknown" && cl !== "") {
            bloomFromQ[cl] = (bloomFromQ[cl] || 0) + 1;
            qWithBloom++;
          }
          if (q.trap_tags && Array.isArray(q.trap_tags) && (q.trap_tags as unknown[]).length > 0) qWithTrapTags++;
          if (q.distractor_meta && typeof q.distractor_meta === "object") qWithDistractorMeta++;
          const ep = (q.exam_part as string);
          if (ep) { qWithExamPart++; examPartDist[ep] = (examPartDist[ep] || 0) + 1; }
          const qt = (q.question_type as string) || "unknown";
          questionTypeDist2[qt] = (questionTypeDist2[qt] || 0) + 1;
        }

        return {
          total_questions: totalQ,
          bloom_coverage: {
            tagged_count: qWithBloom,
            coverage_percent: totalQ > 0 ? Math.round((qWithBloom / totalQ) * 1000) / 10 : 0,
            distribution: bloomFromQ,
            percentages: Object.fromEntries(Object.entries(bloomFromQ).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
          },
          difficulty_coverage: {
            distribution: diffDist,
            percentages: Object.fromEntries(Object.entries(diffDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
            targets: { easy: "5-15%", medium: "40-50%", hard: "25-35%", very_hard: "10-20%" },
          },
          cognitive_coverage: {
            distribution: cognDist,
            percentages: Object.fromEntries(Object.entries(cognDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
            targets: { remember: "<20%", understand: "15-25%", apply: "30-40%", analyze: "20-30%", evaluate: "5-15%" },
          },
          trap_coverage: {
            with_trap_tags: qWithTrapTags,
            coverage_percent: totalQ > 0 ? Math.round((qWithTrapTags / totalQ) * 1000) / 10 : 0,
          },
          distractor_meta_coverage: {
            with_meta: qWithDistractorMeta,
            coverage_percent: totalQ > 0 ? Math.round((qWithDistractorMeta / totalQ) * 1000) / 10 : 0,
          },
          exam_part_coverage: {
            with_exam_part: qWithExamPart,
            coverage_percent: totalQ > 0 ? Math.round((qWithExamPart / totalQ) * 1000) / 10 : 0,
            distribution: examPartDist,
          },
          question_type_distribution: questionTypeDist2,
        };
      })();

      return {
        export_version: "6.0-elite-audit",
        track_type: allLessons.length > 0 ? (totalQ > 0 ? "hybrid" : "lesson_first") : "exam_first",
        primary_quality_source: allLessons.length > 0 ? "lessons+questions" : "exam_pool",
        // Lesson-based bloom (may be 0 for exam-first tracks)
        bloom_taxonomy_lessons: { distribution: bloomDist, percentages: Object.fromEntries(Object.entries(bloomDist).map(([k, v]) => [k, allLessons.length > 0 ? Math.round((v / allLessons.length) * 1000) / 10 : 0])), tagged_count: withBloomTag, coverage_percent: allLessons.length > 0 ? Math.round((withBloomTag / allLessons.length) * 1000) / 10 : 0 },
        // Question-based metrics (PRIMARY for exam-pool quality)
        exam_pool_quality: examPoolQuality,
        difficulty_distribution: diffDist,
        difficulty_percentages: Object.fromEntries(Object.entries(diffDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
        cognitive_distribution: cognDist,
        cognitive_percentages: Object.fromEntries(Object.entries(cognDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
        question_type_distribution: typeDist,
        trap_coverage: { with_trap_tags: withTraps, without: totalQ - withTraps, percent: totalQ > 0 ? Math.round((withTraps / totalQ) * 1000) / 10 : 0 },
        distractor_meta_coverage: { with_meta: withDistractorMeta, without: totalQ - withDistractorMeta, percent: totalQ > 0 ? Math.round((withDistractorMeta / totalQ) * 1000) / 10 : 0 },
        didactic_step_distribution: stepDist,
        minicheck_coverage: { with_minicheck: withMinicheck, total_lessons: allLessons.length, percent: allLessons.length > 0 ? Math.round((withMinicheck / allLessons.length) * 1000) / 10 : 0 },
        blueprint_quality: { total: questionBlueprints.length, with_typical_errors: bpsWithTraps, with_exam_context_type: bpsWithContext, trap_coverage_percent: questionBlueprints.length > 0 ? Math.round((bpsWithTraps / questionBlueprints.length) * 1000) / 10 : 0 },
        competency_graph: { total_competencies: competencies.length, mastery_model: "three_tier", thresholds: { not_mastered: "<60%", partial: "60-80%", mastered: ">80%" } },
        lf_weight_distribution: lfDistribution,
        red_flags_summary: { total: (redFlags as any).total_flags, critical: (redFlags as any).critical, high: (redFlags as any).high },
      };
    })();
    zip.file("quality_analysis.json", JSON.stringify(qualityAnalysis, null, 2));

    // ══════════════════════════════════════════════════════
    // ── QUALITY AUDIT FULL (Elite-Standard, all 6 layers) ──
    // ══════════════════════════════════════════════════════
    const qualityAuditFull = (() => {
      const totalQ = allQuestions.length;
      const qs = allQuestions as Record<string, unknown>[];

      // Elite aggregation per LF
      const lfEliteAgg: Record<string, any> = {};
      for (const q of qs) {
        const lfId = (q.learning_field_id as string) || "_none";
        if (!lfEliteAgg[lfId]) lfEliteAgg[lfId] = { total: 0, elite: 0, advanced: 0, standard: 0, evaluate: 0, knowledge: 0, multivar: 0, conflict: 0, transfer: 0, distractor_diverse: 0 };
        const a = lfEliteAgg[lfId];
        a.total++;
        const el = q.elite_level as string;
        if (el === "elite") a.elite++;
        else if (el === "advanced") a.advanced++;
        else a.standard++;
        const cl = q.cognitive_level as string;
        if (cl === "evaluate" || cl === "analyze") a.evaluate++;
        if (cl === "remember" || cl === "understand") a.knowledge++;
        if (q.multi_variable === true) a.multivar++;
        if (q.conflict_type && q.conflict_type !== "none" && q.conflict_type !== "") a.conflict++;
        if (q.transfer_variant === true) a.transfer++;
        const dt = q.distractor_types as string[] | null;
        if (Array.isArray(dt) && dt.length >= 3) a.distractor_diverse++;
      }
      const lfEliteArray = Object.entries(lfEliteAgg).map(([lfId, a]) => {
        const lfObj = (learningFields as Record<string, unknown>[]).find(lf => lf.id === lfId);
        return {
          learning_field_id: lfId,
          learning_field_title: lfObj ? (lfObj as any).title : "Unbekannt",
          total_questions: a.total,
          elite_count: a.elite, advanced_count: a.advanced, standard_count: a.standard,
          elite_ratio: a.total > 0 ? Math.round((a.elite / a.total) * 1000) / 10 : 0,
          evaluate_ratio: a.total > 0 ? Math.round((a.evaluate / a.total) * 1000) / 10 : 0,
          knowledge_ratio: a.total > 0 ? Math.round((a.knowledge / a.total) * 1000) / 10 : 0,
          multi_variable_ratio: a.total > 0 ? Math.round((a.multivar / a.total) * 1000) / 10 : 0,
          conflict_ratio: a.total > 0 ? Math.round((a.conflict / a.total) * 1000) / 10 : 0,
          transfer_ratio: a.total > 0 ? Math.round((a.transfer / a.total) * 1000) / 10 : 0,
          distractor_diversity_ratio: a.total > 0 ? Math.round((a.distractor_diverse / a.total) * 1000) / 10 : 0,
        };
      });

      // Global elite metrics
      const eliteCnt = qs.filter(q => q.elite_level === "elite").length;
      const evalCnt = qs.filter(q => q.cognitive_level === "evaluate" || q.cognitive_level === "analyze").length;
      const knowCnt = qs.filter(q => q.cognitive_level === "remember" || q.cognitive_level === "understand").length;
      const multiVarCnt = qs.filter(q => q.multi_variable === true).length;
      const conflictCnt = qs.filter(q => q.conflict_type && q.conflict_type !== "none" && q.conflict_type !== "").length;
      const transferCnt = qs.filter(q => q.transfer_variant === true).length;
      const distrDiverseCnt = qs.filter(q => Array.isArray(q.distractor_types) && (q.distractor_types as string[]).length >= 3).length;

      const pct = (n: number) => totalQ > 0 ? Math.round((n / totalQ) * 1000) / 10 : 0;

      // SSOT coverage
      const hasComp = qs.filter(q => q.competency_id).length;
      const hasLf = qs.filter(q => q.learning_field_id).length;
      const hasBp = qs.filter(q => q.blueprint_id).length;
      const hasDiff = qs.filter(q => q.difficulty).length;
      const hasCog = qs.filter(q => q.cognitive_level && q.cognitive_level !== "unknown").length;

      // Scoring (0-100)
      const ssotScore = Math.min(30, Math.round((pct(hasComp) + pct(hasLf) + pct(hasBp)) / 3 * 0.30));
      const metaScore = Math.min(25, Math.round((pct(hasDiff) + pct(hasCog)) * 0.12 + pct(qs.filter(q => q.distractor_meta).length) * 0.01));
      const depthScore = Math.min(25, Math.round(
        Math.min(10, pct(multiVarCnt) * 0.10) +
        Math.min(6, pct(conflictCnt) * 0.06) +
        Math.min(4, pct(transferCnt) * 0.04) +
        Math.min(5, pct(evalCnt) * 0.05)
      ));
      const approvedR = pct(approvedQuestions.length);
      const govScore = Math.min(10, (approvedR >= 95 ? 6 : Math.round(approvedR * 0.06)) + (councilFindings.length > 0 ? 2 : 0) + (aiValidations.length > 0 ? 2 : 0));
      const riskDeduct = Math.min(10, (redFlags as any).total_flags * 1);
      const riskScore = Math.max(0, 10 - riskDeduct);
      const totalScore = ssotScore + metaScore + depthScore + govScore + riskScore;

      // Rules
      const rules: { id: string; status: string; reason: string }[] = [];
      const gate = (id: string, ok: boolean, pass: string, fail: string) => rules.push({ id, status: ok ? "pass" : "fail", reason: ok ? pass : fail });
      gate("G0_SSOT_BINDING", pct(hasComp) >= 98 && pct(hasLf) >= 98, "SSOT binding ≥98%", "SSOT binding incomplete");
      gate("G1_APPROVAL", approvedR >= 95, "Approved ≥95%", `Approved only ${approvedR}%`);
      gate("G2_META", pct(hasDiff) >= 98 && pct(hasCog) >= 98, "Meta coverage ≥98%", "Missing difficulty/cognitive_level");
      gate("E1_MULTIVAR", pct(multiVarCnt) >= 25, "Multi-variable ≥25%", `Multi-variable only ${pct(multiVarCnt)}%`);
      gate("E2_EVALUATE", pct(evalCnt) >= 15, "Evaluate ≥15%", `Evaluate only ${pct(evalCnt)}%`);
      gate("E3_KNOWLEDGE", pct(knowCnt) <= 20, "Knowledge ≤20%", `Knowledge ${pct(knowCnt)}% (too high)`);

      const level = totalScore >= 90 ? "elite_ready" : totalScore >= 75 ? "strong" : totalScore >= 60 ? "medium" : "blocked";

      return {
        meta: {
          export_version: "6.0-elite-audit",
          created_at: new Date().toISOString(),
          package_id: packageId,
          curriculum_id: curriculumId,
          track_type: qualityAnalysis.track_type,
        },
        score: { total: totalScore, level, bands: { ssot: ssotScore, metadata: metaScore, depth: depthScore, governance: govScore, risk: riskScore } },
        rules,
        elite_metrics: {
          total_questions: totalQ,
          elite_count: eliteCnt, elite_ratio: pct(eliteCnt),
          evaluate_ratio: pct(evalCnt), knowledge_ratio: pct(knowCnt),
          multi_variable_ratio: pct(multiVarCnt), conflict_ratio: pct(conflictCnt),
          transfer_ratio: pct(transferCnt), distractor_diversity_ratio: pct(distrDiverseCnt),
        },
        coverage: {
          competency_id: pct(hasComp), learning_field_id: pct(hasLf), blueprint_id: pct(hasBp),
          difficulty: pct(hasDiff), cognitive_level: pct(hasCog),
        },
        lf_elite_aggregation: lfEliteArray,
        governance_summary: {
          approved_ratio: approvedR,
          council_findings: councilFindings.length,
          ai_validations: aiValidations.length,
          red_flags_total: (redFlags as any).total_flags,
          red_flags_critical: (redFlags as any).critical,
        },
      };
    })();
    zip.file("quality_audit_full.json", JSON.stringify(qualityAuditFull, null, 2));

    // ── Export Manifest ──
    const manifest = {
      exported_at: new Date().toISOString(),
      export_version: "6.0-elite-audit",
      package_id: packageId,
      course_id: cid,
      curriculum_id: curriculumId,
      blocks: {
        "1_curriculum": { curriculum: 1, learning_fields: learningFields.length, competencies: competencies.length },
        "2_blueprints": { total: questionBlueprints.length, constraints: blueprintConstraints.length, by_lf: Object.keys(bpsByLf).length },
        "3_exam_pool": { questions_all: allQuestions.length, questions_approved: approvedQuestions.length, exam_sessions: allExamSessions.length, trace_entries: traceProtocol.length },
        "4_didaktik": { lessons: allLessons.length, minichecks: minichecks.length, handbook_chapters: handbookStructured.length },
        "5_governance": { quality_gates: qualityGates.length, ai_validations: aiValidations.length, council_findings: councilFindings.length, content_versions: contentVersions.length, auto_heal: autoHealLog.length, patch_plans: patchPlans.length },
        "oral_exam": { sessionsets: (oralSessionsets || []).length, blueprints: oralBlueprints.length, sessions: allOralSessions.length },
        "tutor": { logs: allTutorLogs.length, policies: tutorPolicies.length, indices: (tutorIndices || []).length },
      },
      red_flags: redFlags,
      questions_summary: questionsSummary,
      ai_cost_summary: aiCostSummary,
      integrity_check: integrityCheck,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const bytes = await zip.generateAsync({ type: "uint8array" });

    // ── Upload to Storage ──
    const bucket = "exports";
    const pkgTitle = safeFilename(String((pkg as Record<string, unknown>).title || packageId));
    const dateStr = new Date().toISOString().split("T")[0];
    const path = `packages/${packageId}/${pkgTitle}-${dateStr}.zip`;

    const { error: uploadErr } = await sb.storage
      .from(bucket)
      .upload(path, bytes, { contentType: "application/zip", upsert: true });
    if (uploadErr) return json({ error: `Upload failed: ${uploadErr.message}` }, 500);

    const { data: signed, error: signErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    if (signErr) return json({ error: signErr.message }, 500);

    // QW #15: Compute export checksum for delta detection
    const exportChecksum = await (async () => {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
        JSON.stringify({ blocks: manifest.blocks, fileSize: bytes.length })
      ));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    })();

    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId,
        output_key: "export_zip",
        payload: {
          downloadUrl: signed.signedUrl,
          bucket,
          path,
          fileSize: bytes.length,
          created_at: new Date().toISOString(),
          blocks: manifest.blocks,
          red_flags_summary: { total: (redFlags as any).total_flags, critical: (redFlags as any).critical },
          checksum: exportChecksum,
        },
        last_exported_at: new Date().toISOString(),
        export_checksum: exportChecksum,
      },
      { onConflict: "package_id,output_key" }
    );

    return json({
      ok: true,
      downloadUrl: signed.signedUrl,
      fileName: path,
      fileSize: bytes.length,
      export_version: "6.1-integrity-guard",
      blocks: manifest.blocks,
      red_flags: { total: (redFlags as any).total_flags, critical: (redFlags as any).critical, high: (redFlags as any).high },
      integrity_check: { status: integrityCheck.status, issues: integrityCheck.issues_count, critical: integrityCheck.critical_count },
      manifest,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package] Error:", message);
    return json({ error: message }, 500);
  }
});
