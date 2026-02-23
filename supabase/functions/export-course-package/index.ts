import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

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

    // ── Oral Exam: ALL user sessions (paginated, may be empty for fresh packages) ──
    const allOralSessions: unknown[] = [];
    if (oralSessionsets?.length) {
      const setIds = (oralSessionsets as Record<string, unknown>[]).map(s => s.id as string);
      const pageSize = 500;
      let offset = 0;
      while (true) {
        const { data: batch, error: oErr } = await sb
          .from("oral_exam_sessions")
          .select("*")
          .in("sessionset_id", setIds)
          .order("sort_order")
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

    // ── Questions summary ──
    let questionsSummary: Record<string, unknown> = { note: "no_summary" };
    if (curriculumId) {
      const { count: totalCount } = await sb
        .from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId);
      const { count: approvedCount } = await sb
        .from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId).eq("qc_status", "approved");
      const { count: pendingCount } = await sb
        .from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId).eq("qc_status", "pending");
      questionsSummary = {
        total_exam_questions: totalCount ?? 0,
        approved_questions: approvedCount ?? 0,
        pending_questions: pendingCount ?? 0,
        curriculum_id: curriculumId,
        note: "approved = production-ready, pending = awaiting QC",
      };
    }

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
              .select("id, title, content, minicheck_parsed, sort_order, qc_status, step, status, duration_minutes, competency_id, exam_block, weight_tag, exam_relevance_score, mastery_weight, quality_gate_status, quality_flags")
              .eq("module_id", mod.id as string)
              .order("sort_order")
              .range(offset, offset + pageSize - 1);
            if (lErr) {
              console.log(`[export] Lesson query error for module ${mod.id}: ${lErr.message}`);
              break;
            }
            if (!batch || batch.length === 0) break;
              for (const l of batch as Record<string, unknown>[]) {
                // Derive bloom_level from step or content
                const contentObj = l.content as Record<string, unknown> | null;
                const bloomFromContent = contentObj?.bloom_level as string | null;
                const stepBloomMap: Record<string, string> = { einstieg: "remember", verstehen: "understand", anwenden: "apply", wiederholen: "analyze", mini_check: "apply" };
                const bloomLevel = bloomFromContent || stepBloomMap[(l.step as string) || ""] || "understand";
                const examRelScore = (contentObj?.exam_relevance_score as number) || null;
                
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
                  exam_relevance_score: examRelScore || l.exam_relevance_score,
                  content: l.content,
                  minicheck_parsed: l.minicheck_parsed,
                  sort_order: l.sort_order,
                  qc_status: l.qc_status,
                  duration_minutes: l.duration_minutes,
                  competency_id: l.competency_id,
                  exam_block: l.exam_block,
                  weight_tag: l.weight_tag,
                  mastery_weight: (contentObj?.mastery_weight as string) || l.mastery_weight,
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

    // ── ALL approved Exam Questions (paginated, no limit) ──
    const questionSamples: unknown[] = [];
    const seenQuestionIds = new Set<string>();
    if (curriculumId) {
      console.log(`[export] Collecting ALL approved exam questions for curriculum ${curriculumId}`);
      try {
        const pageSize = 500;
        let offset = 0;
        let duplicatesSkipped = 0;
        while (true) {
          const { data: batch, error: qErr } = await sb
            .from("exam_questions")
            .select("id, question_text, options, correct_answer, explanation, difficulty, cognitive_level, learning_field_id, qc_status, blueprint_id, competency_id, question_type, trap_tags, distractor_meta, variant_group, variant_label, item_difficulty, item_discrimination")
            .eq("curriculum_id", curriculumId)
            .in("qc_status", ["approved", "draft"])
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
            questionSamples.push({
              id: q.id,
              question_text: q.question_text,
              options: q.options,
              correct_answer: q.correct_answer,
              explanation: q.explanation,
              difficulty: q.difficulty,
              cognitive_level: q.cognitive_level,
              learning_field_id: q.learning_field_id,
              qc_status: q.qc_status,
              blueprint_id: q.blueprint_id,
              competency_id: q.competency_id,
              question_type: q.question_type,
              trap_tags: q.trap_tags,
              distractor_meta: q.distractor_meta,
              variant_group: q.variant_group,
              variant_label: q.variant_label,
              item_difficulty: q.item_difficulty,
              item_discrimination: q.item_discrimination,
            });
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
    console.log(`[export] Collected ${questionSamples.length} unique approved questions`);

    // ── ALL AI Tutor Logs (paginated) ──
    const allTutorLogs: unknown[] = [];
    try {
      const pageSize = 500;
      let offset = 0;
      while (true) {
        const { data: batch, error: tErr } = await sb
          .from("ai_tutor_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (tErr) {
          console.log(`[export] Tutor logs error at offset ${offset}: ${tErr.message}`);
          break;
        }
        if (!batch || batch.length === 0) break;
        for (const t of batch as Record<string, unknown>[]) {
          allTutorLogs.push(t);
        }
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
    } catch (e) {
      console.log(`[export] Tutor logs export error: ${(e as Error).message}`);
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
        const pageSize = 500;
        let offset = 0;
        while (true) {
          const { data: batch } = await sb.from("ai_validations")
            .select("id, generation_id, validator_model, validation_mode, overall_score, decision, dimension_scores, critical_issues, improvements, cost_eur, validated_at")
            .in("generation_id", genIds.slice(0, 200)) // limit to avoid query size issues
            .range(offset, offset + pageSize - 1);
          if (!batch || batch.length === 0) break;
          aiValidations.push(...batch);
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
      } catch (_e) { /* best-effort */ }
    }
    console.log(`[export] ${aiValidations.length} AI validations`);

    // ── 5. Quality Gates ──
    let qualityGates: unknown[] = [];
    if (aiGenerations.length > 0) {
      try {
        const genIds = (aiGenerations as Record<string, unknown>[]).map(g => g.id as string);
        const { data } = await sb.from("ai_quality_gates")
          .select("*")
          .in("generation_id", genIds.slice(0, 200))
          .order("created_at", { ascending: false });
        qualityGates = data || [];
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
            weight_percent: 0, // computed below
          });
        }
        // Compute weight percentages
        const totalAllQ = lfDistribution.reduce((s: number, d: any) => s + d.questions_total, 0);
        for (const d of lfDistribution as Record<string, unknown>[]) {
          (d as any).weight_percent = totalAllQ > 0 ? Math.round(((d as any).questions_total / totalAllQ) * 1000) / 10 : 0;
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

    // ── Build ZIP ──
    const zip = new JSZip();
    zip.file("package.json", JSON.stringify(pkg, null, 2));
    zip.file("plan.json", JSON.stringify(plan || {}, null, 2));
    zip.file("steps.json", JSON.stringify(steps || [], null, 2));
    zip.file("handbook.md", handbookMd);
    zip.file("handbook_structured.json", JSON.stringify(handbookStructured, null, 2));
    zip.file("oral_exam/sessionsets.json", JSON.stringify(oralSessionsets || [], null, 2));
    zip.file("oral_exam/blueprints.json", JSON.stringify(oralBlueprints, null, 2));
    zip.file("oral_exam/session_templates.json", JSON.stringify(oralSessionTemplates, null, 2));
    zip.file("oral_exam/sessions_all.json", JSON.stringify(allOralSessions, null, 2));
    zip.file("tutor/context_indices.json", JSON.stringify(tutorIndices || [], null, 2));
    zip.file("tutor/policies.json", JSON.stringify(tutorPolicies, null, 2));
    zip.file("tutor/logs_all.json", JSON.stringify(allTutorLogs, null, 2));
    zip.file("questions_summary.json", JSON.stringify(questionsSummary, null, 2));
    zip.file("course_snapshot.json", JSON.stringify(courseSnapshot || {}, null, 2));

    // Content (full course data for audit)
    zip.file("content/lessons_all.json", JSON.stringify(allLessons, null, 2));
    zip.file("content/exam_questions_approved.json", JSON.stringify(questionSamples, null, 2));
    zip.file("content/competencies.json", JSON.stringify(competencies, null, 2));

    // ── META / AUDIT DATA ──
    zip.file("meta/curriculum.json", JSON.stringify(curriculumFull || {}, null, 2));
    zip.file("meta/learning_fields.json", JSON.stringify(learningFields, null, 2));
    zip.file("meta/lf_distribution.json", JSON.stringify(lfDistribution, null, 2));
    zip.file("meta/question_blueprints.json", JSON.stringify(questionBlueprints, null, 2));
    zip.file("meta/blueprint_constraints.json", JSON.stringify(blueprintConstraints, null, 2));
    zip.file("meta/ai_generations.json", JSON.stringify(aiGenerations, null, 2));
    zip.file("meta/ai_validations.json", JSON.stringify(aiValidations, null, 2));
    zip.file("meta/quality_gates.json", JSON.stringify(qualityGates, null, 2));
    zip.file("meta/council_findings.json", JSON.stringify(councilFindings, null, 2));
    zip.file("meta/patch_plans.json", JSON.stringify(patchPlans, null, 2));
    zip.file("meta/auto_heal_log.json", JSON.stringify(autoHealLog, null, 2));
    zip.file("meta/autofix_runs.json", JSON.stringify(autofixRuns, null, 2));
    zip.file("meta/ai_cost_summary.json", JSON.stringify(aiCostSummary, null, 2));
    zip.file("meta/ai_budgets.json", JSON.stringify(aiBudgets, null, 2));
    zip.file("meta/worker_policies.json", JSON.stringify(workerPolicies, null, 2));

    // ── QUALITY ANALYSIS (computed from export data) ──
    const qualityAnalysis = (() => {
      // Difficulty distribution
      const diffDist: Record<string, number> = {};
      const cognDist: Record<string, number> = {};
      const typeDist: Record<string, number> = {};
      let withTraps = 0, withDistractorMeta = 0;
      for (const q of questionSamples as Record<string, unknown>[]) {
        const diff = (q.difficulty as string) || "unknown";
        diffDist[diff] = (diffDist[diff] || 0) + 1;
        const cogn = (q.cognitive_level as string) || "unknown";
        cognDist[cogn] = (cognDist[cogn] || 0) + 1;
        const qtype = (q.question_type as string) || "unknown";
        typeDist[qtype] = (typeDist[qtype] || 0) + 1;
        if (q.trap_tags && Array.isArray(q.trap_tags) && (q.trap_tags as unknown[]).length > 0) withTraps++;
        if (q.distractor_meta) withDistractorMeta++;
      }
      const totalQ = questionSamples.length;

      // Didactic step coverage + Bloom distribution
      const stepDist: Record<string, number> = {};
      const bloomDist: Record<string, number> = {};
      let withMinicheck = 0;
      let withBloomTag = 0;
      for (const l of allLessons as Record<string, unknown>[]) {
        const step = (l.step as string) || "unknown";
        stepDist[step] = (stepDist[step] || 0) + 1;
        if (l.minicheck_parsed) withMinicheck++;
        const bloom = (l.bloom_level as string) || "unknown";
        bloomDist[bloom] = (bloomDist[bloom] || 0) + 1;
        if (bloom !== "unknown") withBloomTag++;
      }

      // Blueprint coverage
      const bpsWithTraps = (questionBlueprints as Record<string, unknown>[]).filter(
        b => b.typical_errors && Array.isArray(b.typical_errors) && (b.typical_errors as unknown[]).length > 0
      ).length;
      const bpsWithContext = (questionBlueprints as Record<string, unknown>[]).filter(
        b => b.exam_context_type
      ).length;

      return {
        export_version: "4.0-premium",
        // ── Bloom Taxonomy Coverage ──
        bloom_taxonomy: {
          distribution: bloomDist,
          percentages: Object.fromEntries(Object.entries(bloomDist).map(([k, v]) => [k, allLessons.length > 0 ? Math.round((v / allLessons.length) * 1000) / 10 : 0])),
          tagged_count: withBloomTag,
          coverage_percent: allLessons.length > 0 ? Math.round((withBloomTag / allLessons.length) * 1000) / 10 : 0,
        },
        difficulty_distribution: diffDist,
        difficulty_percentages: Object.fromEntries(Object.entries(diffDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
        cognitive_distribution: cognDist,
        cognitive_percentages: Object.fromEntries(Object.entries(cognDist).map(([k, v]) => [k, totalQ > 0 ? Math.round((v / totalQ) * 1000) / 10 : 0])),
        question_type_distribution: typeDist,
        trap_coverage: { with_trap_tags: withTraps, without: totalQ - withTraps, percent: totalQ > 0 ? Math.round((withTraps / totalQ) * 1000) / 10 : 0 },
        distractor_meta_coverage: { with_meta: withDistractorMeta, without: totalQ - withDistractorMeta, percent: totalQ > 0 ? Math.round((withDistractorMeta / totalQ) * 1000) / 10 : 0 },
        didactic_step_distribution: stepDist,
        minicheck_coverage: { with_minicheck: withMinicheck, total_lessons: allLessons.length, percent: allLessons.length > 0 ? Math.round((withMinicheck / allLessons.length) * 1000) / 10 : 0 },
        blueprint_quality: {
          total: questionBlueprints.length,
          with_typical_errors: bpsWithTraps,
          with_exam_context_type: bpsWithContext,
          trap_coverage_percent: questionBlueprints.length > 0 ? Math.round((bpsWithTraps / questionBlueprints.length) * 1000) / 10 : 0,
        },
        competency_graph: {
          total_competencies: competencies.length,
          mastery_model: "three_tier",
          thresholds: { not_mastered: "<60%", partial: "60-80%", mastered: ">80%" },
        },
        lf_weight_distribution: lfDistribution,
      };
    })();
    zip.file("meta/quality_analysis.json", JSON.stringify(qualityAnalysis, null, 2));

    // Export manifest with counts for quick verification
    const manifest = {
      exported_at: new Date().toISOString(),
      export_version: "4.0-premium",
      package_id: packageId,
      course_id: cid,
      curriculum_id: curriculumId,
      content_counts: {
        lessons_total: allLessons.length,
        competencies_total: competencies.length,
        questions_approved: questionSamples.length,
        oral_exam_sessionsets: (oralSessionsets || []).length,
        oral_exam_blueprints: oralBlueprints.length,
        oral_exam_sessions: allOralSessions.length,
        tutor_logs: allTutorLogs.length,
        tutor_policy_versions: tutorPolicies.length,
        tutor_context_indices: (tutorIndices || []).length,
        handbook_chapters: handbookStructured.length,
        handbook_length_chars: handbookMd.length,
        handbook_is_placeholder: handbookMd.length < 500,
      },
      meta_counts: {
        learning_fields: learningFields.length,
        question_blueprints: questionBlueprints.length,
        blueprint_constraints: blueprintConstraints.length,
        ai_generations: aiGenerations.length,
        ai_validations: aiValidations.length,
        quality_gates: qualityGates.length,
        council_findings: councilFindings.length,
        patch_plans: patchPlans.length,
        auto_heal_entries: autoHealLog.length,
        autofix_runs: autofixRuns.length,
        worker_policies: workerPolicies.length,
      },
      lf_distribution: lfDistribution,
      ai_cost_summary: aiCostSummary,
      questions_summary: questionsSummary,
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

    // ── Signed URL (1h) ──
    const { data: signed, error: signErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    if (signErr) return json({ error: signErr.message }, 500);

    // ── Persist output link ──
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
          content: {
            lessons: allLessons.length,
            questions: questionSamples.length,
            oralExamSessions: allOralSessions.length,
            tutorLogs: allTutorLogs.length,
            tutorPolicies: tutorPolicies.length,
            handbookChapters: handbookStructured.length,
          },
          meta: {
            learningFields: learningFields.length,
            blueprints: questionBlueprints.length,
            aiGenerations: aiGenerations.length,
            aiValidations: aiValidations.length,
            qualityGates: qualityGates.length,
            councilFindings: councilFindings.length,
            autoHealEntries: autoHealLog.length,
            autofixRuns: autofixRuns.length,
          },
        },
      },
      { onConflict: "package_id,output_key" }
    );

    return json({
      ok: true,
      downloadUrl: signed.signedUrl,
      fileName: path,
      fileSize: bytes.length,
      content: {
        lessons: allLessons.length,
        questions: questionSamples.length,
        oralExamSessions: allOralSessions.length,
        tutorLogs: allTutorLogs.length,
        tutorPolicies: tutorPolicies.length,
        handbookChapters: handbookStructured.length,
      },
      meta: {
        learningFields: learningFields.length,
        blueprints: questionBlueprints.length,
        aiGenerations: aiGenerations.length,
        aiValidations: aiValidations.length,
        qualityGates: qualityGates.length,
        councilFindings: councilFindings.length,
        autoHealEntries: autoHealLog.length,
        autofixRuns: autofixRuns.length,
      },
      manifest,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package] Error:", message);
    return json({ error: message }, 500);
  }
});
