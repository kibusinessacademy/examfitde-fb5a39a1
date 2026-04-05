import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { computeElite, buildAnnotationInput } from "../_shared/elite-annotation.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * package-elite-harden — Pipeline Step (Phase-Split v3)
 *
 * Phase-isolated execution to prevent timeout coupling:
 *   phase: "annotations_only"  → P0: SSOT annotation, finalize immediately
 *   phase: "minichecks_only"   → Harden MiniChecks only
 *   phase: "oral_only"         → Harden Oral Blueprints only
 *   phase: "all"               → Enqueue follow-up phases (never inline)
 *
 * v3 Fixes:
 * 1. Phase-isolated finalization (each phase sets own run to done)
 * 2. Cursor/resume support for large curricula (seek-pagination by id)
 * 3. No pre-check overhead — upsert is idempotent via PK question_id
 * 4. Draft updates guarded with .eq("status","draft") to prevent race conditions
 * 5. "all" mode enqueues follow-ups instead of running inline
 * 6. Idempotency via unique (package_id, phase, idempotency_key)
 */

type Phase = "annotations_only" | "drafts_upgrade" | "minichecks_only" | "oral_only" | "all";

const TIME_BUDGET_MS = 110_000;
const MAX_EXAM_HARDEN = 80;
const MAX_MINICHECK_HARDEN = 40;
const MAX_ORAL_HARDEN = 30;
const MAX_AI_CALLS_PER_RUN = 100; // QW #6: AI budget guard
const BATCH_SIZE = 200;
const ANNOTATION_BATCH = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const chain = await getModelChainAsync("exam_questions");
  const result = await callAIWithFailover(
    chain.map(c => ({ provider: c.provider, model: c.model })),
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    },
  );
  return result.content || "";
}

function parseJSON(text: string): any {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Support both array [...] and object {...} responses
  const firstBracket = cleaned.indexOf("[");
  const firstBrace = cleaned.indexOf("{");
  const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
  if (isArray) {
    const last = cleaned.lastIndexOf("]");
    if (last <= firstBracket) throw new Error("AI_JSON_NOT_FOUND");
    return JSON.parse(cleaned.slice(firstBracket, last + 1));
  }
  const last = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || last === -1 || last <= firstBrace) throw new Error("AI_JSON_NOT_FOUND");
  return JSON.parse(cleaned.slice(firstBrace, last + 1));
}

/** QW #7: Strong JSON schema validation for AI exam question outputs */
function validateAIExamOutput(parsed: any): string | null {
  if (!parsed.question_text || typeof parsed.question_text !== "string" || parsed.question_text.length < 20)
    return "question_text too short or missing";
  if (!Array.isArray(parsed.options) || parsed.options.length < 4)
    return "options must have at least 4 items";
  for (let i = 0; i < parsed.options.length; i++) {
    if (!parsed.options[i]?.text || parsed.options[i].text.length < 3)
      return `option[${i}].text too short or missing`;
  }
  if (typeof parsed.correct_answer !== "number" || parsed.correct_answer < 0 || parsed.correct_answer > 3)
    return "correct_answer must be 0-3";
  if (!parsed.explanation || typeof parsed.explanation !== "string" || parsed.explanation.length < 50)
    return "explanation too short (min 50 chars)";
  return null; // valid
}

/** QW #8: Central finalize wrapper — no run ever stays "half done" */
async function finalizeRunSafe(
  sb: ReturnType<typeof createClient>,
  runId: string,
  status: "done" | "failed" | "partial",
  meta: Record<string, any> = {},
) {
  try {
    await sb.from("elite_hardening_runs").update({
      status,
      finished_at: status !== "partial" ? new Date().toISOString() : null,
      ...meta,
    }).eq("id", runId);
  } catch (e) {
    console.error(`[EliteHarden] finalizeRunSafe FAILED for ${runId}: ${e}`);
  }
}

function timeLeft(start: number): boolean {
  return (Date.now() - start) < TIME_BUDGET_MS;
}

/** Chunked upsert helper */
async function batchUpsert(sb: ReturnType<typeof createClient>, table: string, rows: any[], conflict: string) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: conflict });
    if (error) throw new Error(`Batch upsert ${table} failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: SSOT Annotation (cursor-based, idempotent upsert)
// ═══════════════════════════════════════════════════════════════
async function annotateQuestions(
  sb: ReturnType<typeof createClient>,
  runId: string,
  curriculumId: string,
  start: number,
  cursorState: Record<string, any>,
): Promise<{ annotated: number; draftAnnotated: number; total: number; cursor: Record<string, any>; done: boolean }> {
  const lastId: string | null = cursorState.last_question_id || null;
  let totalAnnotated = 0;
  let totalDraftAnnotated = 0;
  let totalSeen = 0;
  let currentLastId = lastId;
  let batchesDone = Number(cursorState.batches_done || 0);

  // ── Cursor-based pagination loop ──
  while (timeLeft(start)) {
    let query = sb
      .from("exam_questions")
      .select("id, status, difficulty, cognitive_level, trap_tags, distractor_meta, elite_level, multi_variable, transfer_variant, distractor_types, question_text, options, explanation, correct_answer, competency_id, blueprint_id, conflict_type")
      .eq("curriculum_id", curriculumId)
      .in("status", ["draft", "approved"])
      .order("id", { ascending: true })
      .limit(ANNOTATION_BATCH);

    if (currentLastId) {
      query = query.gt("id", currentLastId);
    }

    const { data: questions } = await query;
    if (!questions?.length) {
      // No more questions — persist done state to DB, then return
      await sb.from("elite_hardening_runs").update({
        cursor_state: { last_question_id: currentLastId, batches_done: batchesDone, done: true },
        phase_stats: { annotated: totalAnnotated, draft_annotated: totalDraftAnnotated, total_seen: totalSeen },
        status: "done",
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
      return {
        annotated: totalAnnotated,
        draftAnnotated: totalDraftAnnotated,
        total: totalSeen,
        cursor: { last_question_id: currentLastId, batches_done: batchesDone, done: true },
        done: true,
      };
    }

    totalSeen += questions.length;
    currentLastId = questions[questions.length - 1].id;

    // ── Load blueprints + competencies for this batch ──
    const bpIds = [...new Set(questions.map((q: any) => q.blueprint_id).filter(Boolean))];
    const compIds = [...new Set(questions.map((q: any) => q.competency_id).filter(Boolean))];

    const [{ data: blueprints }, { data: comps }] = await Promise.all([
      bpIds.length > 0
        ? sb.from("question_blueprints").select("id, exam_context_type, decision_structure, scenario_type, typical_errors, knowledge_type, real_world_context").in("id", bpIds)
        : Promise.resolve({ data: [] as any[] }),
      compIds.length > 0
        ? sb.from("competencies").select("id, bloom_level, exam_relevance_tier, transfer_markers, typical_misconceptions, description").in("id", compIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const bpMap = new Map((blueprints || []).map((b: any) => [b.id, b]));
    const compMap = new Map((comps || []).map((c: any) => [c.id, c]));

    // ── Approved → annotation table (idempotent upsert, no pre-check needed) ──
    const approved = questions.filter((q: any) => q.status === "approved");
    const annotationRows: any[] = [];

    for (const q of approved) {
      const bp = bpMap.get(q.blueprint_id) || null;
      const comp = compMap.get(q.competency_id) || null;
      const input = buildAnnotationInput(q, bp, comp);
      const a = computeElite(input);

      annotationRows.push({
        question_id: q.id,
        curriculum_id: curriculumId,
        run_id: runId,
        elite_level: a.elite_level,
        multi_variable: a.multi_variable,
        transfer_variant: a.transfer_variant,
        distractor_types: a.distractor_types,
        elite_score: a.elite_score,
        elite_breakdown: { ...a, blueprint_id: q.blueprint_id, competency_id: q.competency_id },
        annotated_at: new Date().toISOString(),
      });
    }

    if (annotationRows.length > 0) {
      // PK is question_id — upsert is idempotent, no pre-check needed
      await batchUpsert(sb, "exam_question_elite_annotations", annotationRows, "question_id");
      totalAnnotated += annotationRows.length;
    }

    // ── Draft → batch annotation in exam_questions (collected, then bulk upsert) ──
    const draftQuestions = questions.filter((q: any) => q.status === "draft");
    const draftMeta: any[] = [];
    for (const q of draftQuestions) {
      const bp = bpMap.get(q.blueprint_id) || null;
      const comp = compMap.get(q.competency_id) || null;
      const a = computeElite(buildAnnotationInput(q, bp, comp));
      draftMeta.push({
        id: q.id,
        elite_level: a.elite_level,
        multi_variable: a.multi_variable,
        transfer_variant: a.transfer_variant,
        distractor_types: a.distractor_types,
      });
    }
    if (draftMeta.length > 0) {
      // Bulk-update with status='draft' guard via RPC (1 roundtrip, race-safe)
      const { data: updatedCnt, error: draftErr } = await sb.rpc("update_exam_question_meta_if_draft", {
        p_ids: draftMeta.map((d: any) => d.id),
        p_elite_levels: draftMeta.map((d: any) => d.elite_level),
        p_multi_variables: draftMeta.map((d: any) => d.multi_variable),
        p_transfer_variants: draftMeta.map((d: any) => d.transfer_variant),
        p_distractor_types: draftMeta.map((d: any) => d.distractor_types),
      });
      if (draftErr) console.warn(`[EliteHarden] Draft RPC error: ${draftErr.message}`);
      totalDraftAnnotated += (updatedCnt ?? draftMeta.length);
    }

    // ── Update cursor after each batch (local counter, not stale) ──
    batchesDone += 1;
    await sb.from("elite_hardening_runs").update({
      cursor_state: { last_question_id: currentLastId, batches_done: batchesDone, done: false },
      phase_stats: { annotated: totalAnnotated, draft_annotated: totalDraftAnnotated, total_seen: totalSeen },
    }).eq("id", runId);

    console.log(`[EliteHarden] Annotation batch: ${annotationRows.length} approved, ${draftQuestions.length} draft (cursor: ${currentLastId?.slice(0, 8)})`);

    if (questions.length < ANNOTATION_BATCH) {
      // Last page — persist done state to DB, then return
      await sb.from("elite_hardening_runs").update({
        cursor_state: { last_question_id: currentLastId, batches_done: batchesDone, done: true },
        phase_stats: { annotated: totalAnnotated, draft_annotated: totalDraftAnnotated, total_seen: totalSeen },
        status: "done",
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
      return {
        annotated: totalAnnotated,
        draftAnnotated: totalDraftAnnotated,
        total: totalSeen,
        cursor: { last_question_id: currentLastId, batches_done: batchesDone, done: true },
        done: true,
      };
    }
  }

  // Time budget exhausted — partial result, resumable
  return {
    annotated: totalAnnotated,
    draftAnnotated: totalDraftAnnotated,
    total: totalSeen,
    cursor: { last_question_id: currentLastId, batches_done: batchesDone, done: false },
    done: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: AI Content Upgrade (draft only, guarded)
// ═══════════════════════════════════════════════════════════════
async function upgradeWeakDrafts(
  sb: ReturnType<typeof createClient>,
  runId: string,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  // Load draft questions with low elite scores
  const { data: questions } = await sb
    .from("exam_questions")
    .select("id, difficulty, cognitive_level, trap_tags, distractor_meta, elite_level, question_text, options, explanation, correct_answer, competency_id, blueprint_id, conflict_type")
    .eq("curriculum_id", curriculumId)
    .eq("status", "draft")
    .limit(1000);

  if (!questions?.length) return { upgraded: 0, failed: 0, total: 0 };

  const compIds = [...new Set(questions.map((q: any) => q.competency_id).filter(Boolean))];
  const bpIds = [...new Set(questions.map((q: any) => q.blueprint_id).filter(Boolean))];

  const [{ data: comps }, { data: blueprints }] = await Promise.all([
    compIds.length > 0
      ? sb.from("competencies").select("id, bloom_level, exam_relevance_tier, transfer_markers, typical_misconceptions, description").in("id", compIds)
      : Promise.resolve({ data: [] as any[] }),
    bpIds.length > 0
      ? sb.from("question_blueprints").select("id, exam_context_type, decision_structure, scenario_type, typical_errors, knowledge_type, real_world_context").in("id", bpIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const compMap = new Map((comps || []).map((c: any) => [c.id, c]));
  const bpMap = new Map((blueprints || []).map((b: any) => [b.id, b]));

  const weak = questions.filter((q: any) => {
    const bp = bpMap.get(q.blueprint_id) || null;
    const comp = compMap.get(q.competency_id) || null;
    const { elite_score } = computeElite(buildAnnotationInput(q, bp, comp));
    const hasTags = Array.isArray(q.trap_tags) && q.trap_tags.length > 0;
    const hasMeta = q.distractor_meta && Object.keys(q.distractor_meta || {}).length > 0;
    return elite_score <= 4 || (!hasTags && !hasMeta);
  }).slice(0, MAX_EXAM_HARDEN);

  let upgraded = 0, failed = 0, aiCalls = 0;

  for (const q of weak) {
    if (!timeLeft(start)) break;
    if (aiCalls >= MAX_AI_CALLS_PER_RUN) { console.log("[EliteHarden] AI budget exhausted"); break; }
    const comp = compMap.get(q.competency_id);
    const misconceptions = comp?.typical_misconceptions ? JSON.stringify(comp.typical_misconceptions) : "keine bekannt";

    try {
      const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Verbessere die Prüfungsfrage auf Elite-Niveau.
REGELN:
1. Wandle in praxisnahe Fallvignette um (konkreter Betrieb/Situation)
2. Füge Mehrschrittlogik hinzu (2-3 Denkschritte)
3. Integriere typische IHK-Prüfungsfallen in Distraktoren
4. Erklärung: für JEDEN Distraktor "verlockend weil... / falsch weil..."
5. Behalte fachlichen Kern bei
6. Antworte AUSSCHLIESSLICH als JSON`;

      const userPrompt = `Verbessere:
FRAGE: ${q.question_text}
OPTIONEN: ${JSON.stringify(q.options)}
KORREKT: Index ${q.correct_answer}
ERKLÄRUNG: ${q.explanation}
KOMPETENZ: ${comp?.description || "unbekannt"}
FEHLVORSTELLUNGEN: ${misconceptions}

JSON: {"question_text":"...","options":[{"text":"A"},{"text":"B"},{"text":"C"},{"text":"D"}],"correct_answer":0,"explanation":"...","cognitive_level":"apply|analyze|evaluate","trap_tags":["tag1"],"distractor_meta":{"d0_trap":"...","d1_trap":"...","d2_trap":"..."}}`;

      aiCalls++;
      const parsed = parseJSON(await callAI(systemPrompt, userPrompt));
      const validationErr = validateAIExamOutput(parsed);
      if (validationErr) throw new Error(`AI_VALIDATION: ${validationErr}`);

      try {
        await sb.from("elite_hardening_items").insert({
          run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "upgraded",
          original_data: { question_text: q.question_text, options: q.options, explanation: q.explanation, cognitive_level: q.cognitive_level },
          upgraded_data: parsed,
        });
      } catch (_e) { /* best-effort */ }

      const upgradedInput = buildAnnotationInput(
        { ...q, trap_tags: parsed.trap_tags || q.trap_tags, distractor_meta: parsed.distractor_meta || q.distractor_meta, cognitive_level: parsed.cognitive_level || q.cognitive_level },
        bpMap.get(q.blueprint_id) || null,
        comp || null,
      );
      const newElite = computeElite(upgradedInput);

      // Guard: only update if still draft
      await sb.from("exam_questions").update({
        question_text: parsed.question_text,
        options: parsed.options,
        correct_answer: parsed.correct_answer ?? q.correct_answer,
        explanation: parsed.explanation,
        cognitive_level: parsed.cognitive_level || q.cognitive_level,
        trap_tags: parsed.trap_tags || [],
        distractor_meta: parsed.distractor_meta || {},
        elite_level: newElite.elite_level,
        multi_variable: newElite.multi_variable,
        transfer_variant: newElite.transfer_variant,
        distractor_types: newElite.distractor_types,
      }).eq("id", q.id).eq("status", "draft");

      upgraded++;
    } catch (err) {
      try {
        await sb.from("elite_hardening_items").insert({
          run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "failed", reason: String(err),
        });
      } catch (_e) { /* best-effort */ }
      failed++;
    }
  }

  return { upgraded, failed, total: questions.length };
}

// ═══════════════════════════════════════════════════════════════
// HARDEN: MiniChecks (draft/easy only)
// ═══════════════════════════════════════════════════════════════
async function hardenMiniChecks(
  sb: ReturnType<typeof createClient>,
  runId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; total: number }> {
  const { data: minichecks } = await sb
    .from("minicheck_questions")
    .select("id, lesson_id, question_text, options, explanation, correct_answer, difficulty")
    .limit(300);

  if (!minichecks?.length) return { upgraded: 0, total: 0 };

  const weak = minichecks.filter((mc: any) =>
    mc.difficulty === "easy" || !mc.explanation || (mc.explanation || "").length < 80
  ).slice(0, MAX_MINICHECK_HARDEN);

  let upgraded = 0;
  for (const mc of weak) {
    if (!timeLeft(start)) break;
    try {
      const systemPrompt = `Du bist IHK-Prüfungsexperte für ${berufName}. Transformiere einfache Wissensabfragen in prüfungsnahe MiniCheck-Items.
REGELN: 1. MiniCheck = Prüfungs-Simulation im Kleinformat 2. Kurzes Praxisszenario (1-2 Sätze) 3. Mindestens eine Prüfungsfalle 4. "verlockend weil / falsch weil" 5. Schwierigkeit: mindestens "medium" 6. NUR JSON`;

      const userPrompt = `Transformiere: ORIGINAL: ${mc.question_text} OPTIONEN: ${JSON.stringify(mc.options)} KORREKT: ${mc.correct_answer} ERKLÄRUNG: ${mc.explanation || "keine"}
JSON: {"question_text":"...","options":[{"text":"A"},{"text":"B"},{"text":"C"},{"text":"D"}],"correct_answer":0,"explanation":"...","difficulty":"medium"}`;

      const parsed = parseJSON(await callAI(systemPrompt, userPrompt));
      if (!parsed.question_text || !parsed.options) continue;

      try {
        await sb.from("elite_hardening_items").insert({
          run_id: runId, entity_type: "minicheck", entity_id: mc.id, action: "upgraded",
          original_data: { question_text: mc.question_text, options: mc.options, explanation: mc.explanation },
          upgraded_data: parsed,
        });
      } catch (_e) { /* best-effort */ }

      await sb.from("minicheck_questions").update({
        question_text: parsed.question_text,
        options: parsed.options,
        correct_answer: parsed.correct_answer ?? mc.correct_answer,
        explanation: parsed.explanation,
        difficulty: parsed.difficulty || "medium",
      }).eq("id", mc.id);

      upgraded++;
    } catch { /* skip */ }
  }

  return { upgraded, total: minichecks.length };
}

// ═══════════════════════════════════════════════════════════════
// HARDEN: Oral Exam Blueprints (weak only)
// ═══════════════════════════════════════════════════════════════
async function hardenOralBlueprints(
  sb: ReturnType<typeof createClient>,
  runId: string,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; total: number }> {
  const { data: blueprints } = await sb
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, competency_id")
    .eq("curriculum_id", curriculumId)
    .limit(50);

  if (!blueprints?.length) return { upgraded: 0, total: 0 };

  const weak = blueprints.filter((bp: any) =>
    !bp.scenario || (bp.scenario || "").length < 100 || !bp.rubric || Object.keys(bp.rubric || {}).length < 3
  ).slice(0, MAX_ORAL_HARDEN);

  let upgraded = 0;
  for (const bp of weak) {
    if (!timeLeft(start)) break;
    try {
      const systemPrompt = `Du bist IHK-Prüfungsexperte für mündliche Prüfungen im Beruf ${berufName}.
REGELN: 1. Szenario: ECHTE berufliche Situation (min. 3 Sätze) 2. Rubrik: 4 Dimensionen (Fachlichkeit 40%, Struktur 25%, Begriffssicherheit 20%, Praxisbezug 15%) 3. Followups: Gesprächsdynamik simulieren 4. NUR JSON`;

      const userPrompt = `Verbessere: TITEL: ${bp.title} SZENARIO: ${bp.scenario || "fehlt"} LEITFRAGEN: ${JSON.stringify(bp.lead_questions || [])} RUBRIK: ${JSON.stringify(bp.rubric || {})}
JSON: {"scenario":"...","lead_questions":["..."],"followups":["..."],"rubric":{"criteria":[{"name":"Fachlichkeit","weight":40,"levels":["..."]},{"name":"Struktur","weight":25,"levels":["..."]},{"name":"Begriffssicherheit","weight":20,"levels":["..."]},{"name":"Praxisbezug","weight":15,"levels":["..."]}]}}`;

      const parsed = parseJSON(await callAI(systemPrompt, userPrompt));
      if (!parsed.scenario) continue;

      try {
        await sb.from("elite_hardening_items").insert({
          run_id: runId, entity_type: "oral_blueprint", entity_id: bp.id, action: "upgraded",
          original_data: { scenario: bp.scenario, rubric: bp.rubric },
          upgraded_data: parsed,
        });
      } catch (_e) { /* best-effort */ }

      await sb.from("oral_exam_blueprints").update({
        scenario: parsed.scenario,
        lead_questions: parsed.lead_questions || bp.lead_questions,
        followups: parsed.followups || bp.followups,
        rubric: parsed.rubric || bp.rubric,
      }).eq("id", bp.id);

      upgraded++;
    } catch { /* skip */ }
  }

  return { upgraded, total: blueprints.length };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER (Phase-Split v3)
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  const courseId = p.course_id as string | undefined;

  // ── Track-aware phase resolution ──
  // EXAM_FIRST only needs deterministic SSOT annotations (no AI upgrade)
  const { data: trackPkg } = await sb
    .from("course_packages")
    .select("track")
    .eq("id", packageId)
    .single();
  const isExamFirst = trackPkg?.track === "EXAM_FIRST" || trackPkg?.track === "EXAM_FIRST_PLUS";
  const requestedPhase = p.phase as Phase | undefined;
  const phase: Phase = isExamFirst && !requestedPhase
    ? "annotations_only"  // Auto-force annotations_only for exam-centric tracks
    : (["annotations_only", "minichecks_only", "oral_only", "all"] as Phase[])
        .includes(requestedPhase as Phase) ? requestedPhase as Phase : "all";
  const idempotencyKey: string | null = typeof p.idempotency_key === "string" ? p.idempotency_key : null;

  // ── Package lookup ──
  const { data: pkg } = await sb
    .from("course_packages")
    .select("elite_hardening_version, title, curriculum_id")
    .eq("id", packageId)
    .single();

  if (!pkg) return json({ error: "Package not found" }, 404);

  // ── Idempotency check: existing run with same key? ──
  if (idempotencyKey) {
    const { data: existingRun } = await sb
      .from("elite_hardening_runs")
      .select("id, status, phase_stats")
      .eq("package_id", packageId)
      .eq("phase", phase)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingRun?.status === "done") {
      return json({ ok: true, already_done: true, run_id: existingRun.id, stats: existingRun.phase_stats });
    }
    // If partial/running, we resume below
  }

  const { data: curriculum } = await sb
    .from("curricula")
    .select("title")
    .eq("id", curriculumId)
    .single();

  const berufName = curriculum?.title || pkg.title || "Ausbildungsberuf";

  // ── Create or resume run ──
  let runId: string;
  let cursorState: Record<string, any> = {};

  if (idempotencyKey) {
    const { data: existing } = await sb
      .from("elite_hardening_runs")
      .select("id, cursor_state")
      .eq("package_id", packageId)
      .eq("phase", phase)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      runId = existing.id;
      cursorState = existing.cursor_state || {};
      await sb.from("elite_hardening_runs").update({ status: "running" }).eq("id", runId);
    } else {
      const { data: run } = await sb
        .from("elite_hardening_runs")
        .insert({
          package_id: packageId,
          scope: `phase_${phase}`,
          phase,
          status: "running",
          started_at: new Date().toISOString(),
          idempotency_key: idempotencyKey,
        })
        .select("id")
        .single();
      runId = run!.id;
    }
  } else {
    const { data: run } = await sb
      .from("elite_hardening_runs")
      .insert({
        package_id: packageId,
        scope: phase === "all" ? "pipeline_auto" : `phase_${phase}`,
        phase,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run!.id;
  }

  const start = Date.now();

  try {
    // ════════════════════════════════════════════════════
    // PHASE: annotations_only — isolated, cursor-based
    // ════════════════════════════════════════════════════
    if (phase === "annotations_only") {
      const result = await annotateQuestions(sb, runId, curriculumId, start, cursorState);

      const finalStatus = result.done ? "done" : "partial";
      await sb.from("elite_hardening_runs").update({
        status: finalStatus,
        finished_at: result.done ? new Date().toISOString() : null,
        cursor_state: result.cursor,
        phase_stats: { annotated: result.annotated, draft_annotated: result.draftAnnotated, total: result.total },
        exam_questions_total: result.total,
      }).eq("id", runId);

      // Update package version only when fully done
      if (result.done) {
        await sb.from("course_packages").update({
          elite_hardening_version: 1,
          elite_hardened_at: new Date().toISOString(),
        }).eq("id", packageId).eq("elite_hardening_version", 0);
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[EliteHarden] ✅ annotations_only ${finalStatus} in ${elapsed}s — ${result.annotated} approved, ${result.draftAnnotated} draft`);

      return json({
        ok: true,
        batch_complete: result.done,
        phase: "annotations_only",
        run_id: runId,
        results: result,
        elapsed_s: parseFloat(elapsed),
      });
    }

    // ════════════════════════════════════════════════════
    // PHASE: minichecks_only — isolated
    // ════════════════════════════════════════════════════
    if (phase === "minichecks_only") {
      const mcResult = await hardenMiniChecks(sb, runId, berufName, start);

      await sb.from("elite_hardening_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        phase_stats: mcResult,
        minichecks_upgraded: mcResult.upgraded,
        minichecks_total: mcResult.total,
      }).eq("id", runId);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[EliteHarden] ✅ minichecks_only done in ${elapsed}s — ${mcResult.upgraded}/${mcResult.total}`);
      return json({ ok: true, batch_complete: true, phase, run_id: runId, results: { minicheck: mcResult }, elapsed_s: parseFloat(elapsed) });
    }

    // ════════════════════════════════════════════════════
    // PHASE: oral_only — isolated
    // ════════════════════════════════════════════════════
    if (phase === "oral_only") {
      const oralResult = await hardenOralBlueprints(sb, runId, curriculumId, berufName, start);

      await sb.from("elite_hardening_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        phase_stats: oralResult,
        oral_blueprints_upgraded: oralResult.upgraded,
        oral_blueprints_total: oralResult.total,
      }).eq("id", runId);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[EliteHarden] ✅ oral_only done in ${elapsed}s — ${oralResult.upgraded}/${oralResult.total}`);
      return json({ ok: true, batch_complete: true, phase, run_id: runId, results: { oral: oralResult }, elapsed_s: parseFloat(elapsed) });
    }

    // ════════════════════════════════════════════════════
    // PHASE: drafts_upgrade — AI upgrade of weak draft questions
    // ════════════════════════════════════════════════════
    if (phase === "drafts_upgrade") {
      const draftResult = await upgradeWeakDrafts(sb, runId, curriculumId, berufName, start);

      await sb.from("elite_hardening_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        phase_stats: draftResult,
        exam_questions_upgraded: draftResult.upgraded,
        exam_questions_total: draftResult.total,
      }).eq("id", runId);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[EliteHarden] ✅ drafts_upgrade done in ${elapsed}s — ${draftResult.upgraded}/${draftResult.total} upgraded`);
      return json({ ok: true, batch_complete: true, phase, run_id: runId, results: { drafts: draftResult }, elapsed_s: parseFloat(elapsed) });
    }

    // ════════════════════════════════════════════════════
    // PHASE: all — enqueue follow-ups, never inline
    // ════════════════════════════════════════════════════
    if (phase === "all") {
      // Skip if already hardened
      if ((pkg as any).elite_hardening_version >= 1) {
        await sb.from("elite_hardening_runs").update({
          status: "done", finished_at: new Date().toISOString(),
          phase_stats: { skipped: true, reason: "already_hardened" },
        }).eq("id", runId);
        return json({ ok: true, batch_complete: true, skipped: true, reason: "already_hardened" });
      }

      // Step 1: Run annotations inline (this is fast/safe)
      const annotResult = await annotateQuestions(sb, runId, curriculumId, start, {});

      // Step 2: Enqueue ALL follow-up phases as separate jobs (never inline)
      // BUG FIX: Previously missing drafts_upgrade — weak drafts were never AI-upgraded
      try {
        const phases = ["drafts_upgrade", "minichecks_only", "oral_only"];
        for (const phase of phases) {
          await enqueueJob(sb, {
            job_type: "package_elite_harden",
            package_id: packageId,
            payload: { package_id: packageId, curriculum_id: curriculumId, course_id: courseId, phase },
          }).catch(e => console.warn(`[elite-harden] Enqueue ${phase} failed: ${(e as Error).message?.slice(0, 80)}`));
        }
      } catch (_e) { /* best-effort */ }

      // Finalize THIS run as done (follow-ups are independent)
      await sb.from("elite_hardening_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        phase_stats: { annotations: annotResult, enqueued: ["drafts_upgrade", "minichecks_only", "oral_only"] },
        exam_questions_total: annotResult.total,
      }).eq("id", runId);

      // Update package version
      if (annotResult.done) {
        await sb.from("course_packages").update({
          elite_hardening_version: 1,
          elite_hardened_at: new Date().toISOString(),
        }).eq("id", packageId).eq("elite_hardening_version", 0);
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[EliteHarden] ✅ "all" done in ${elapsed}s — annotations: ${annotResult.annotated}, enqueued drafts_upgrade+minichecks+oral`);

      return json({
        ok: true,
        batch_complete: true,
        phase: "all",
        run_id: runId,
        results: { annotations: annotResult, enqueued: ["drafts_upgrade", "minichecks_only", "oral_only"] },
        elapsed_s: parseFloat(elapsed),
      });
    }

    return json({ error: `Unknown phase: ${phase}` }, 400);
  } catch (err) {
    // QW #8: Central finalize — no run stays "half done"
    await finalizeRunSafe(sb, runId, "failed", {
      error_message: String(err),
      last_error: String((err as Error)?.message || err),
    });
    console.error(`[EliteHarden] FATAL: ${(err as Error)?.message || err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
