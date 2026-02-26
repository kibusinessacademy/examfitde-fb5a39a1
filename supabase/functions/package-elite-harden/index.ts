import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { computeElite, buildAnnotationInput } from "../_shared/elite-annotation.ts";

/**
 * package-elite-harden — Pipeline Step
 *
 * SSOT Rules:
 * 1. Approved questions → annotations go to exam_question_elite_annotations (NEVER mutate approved content)
 * 2. Draft questions → annotate directly in exam_questions + AI content upgrade for weak items
 * 3. Batch upserts (chunks of 200) to avoid timeout
 * 4. Manual joins (no FK constraints for PostgREST)
 * 5. Idempotent: skips if course_packages.elite_hardening_version >= 1
 */

const TIME_BUDGET_MS = 110_000;
const MAX_EXAM_HARDEN = 80;
const MAX_MINICHECK_HARDEN = 40;
const MAX_ORAL_HARDEN = 30;
const BATCH_SIZE = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const result = await callAIJSON({
    provider: "lovable" as AIProvider,
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 4096,
  });
  return result.content || "";
}

function parseJSON(text: string): any {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
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
// PHASE 1: SSOT Annotation (approved → annotation table, draft → exam_questions)
// PHASE 2: AI Content Upgrade (draft only)
// ═══════════════════════════════════════════════════════════════
async function hardenExamQuestions(
  sb: ReturnType<typeof createClient>,
  runId: string,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; annotated: number; failed: number; total: number }> {
  // ── Load ALL questions via pagination (Supabase 1000-row limit) ──
  const questions: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: page } = await sb
      .from("exam_questions")
      .select("id, status, difficulty, cognitive_level, trap_tags, distractor_meta, elite_level, multi_variable, transfer_variant, distractor_types, question_text, options, explanation, correct_answer, competency_id, blueprint_id")
      .eq("curriculum_id", curriculumId)
      .in("status", ["draft", "approved"])
      .range(offset, offset + PAGE - 1);
    if (!page?.length) break;
    questions.push(...page);
    if (page.length < PAGE) break;
  }

  if (!questions.length) return { upgraded: 0, annotated: 0, failed: 0, total: 0 };

  // ── Manual joins: load blueprints + competencies via IN query ──
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

  // ── Phase 1a: Approved → annotation table (batch upsert, never mutate exam_questions) ──
  const approved = questions.filter((q: any) => q.status === "approved");

  // Check which are already annotated
  const approvedIds = approved.map((q: any) => q.id);
  let annotatedSet = new Set<string>();
  if (approvedIds.length > 0) {
    // Load in batches of 200 to avoid query limits
    for (let i = 0; i < approvedIds.length; i += BATCH_SIZE) {
      const chunk = approvedIds.slice(i, i + BATCH_SIZE);
      const { data: existing } = await sb
        .from("exam_question_elite_annotations")
        .select("question_id")
        .in("question_id", chunk);
      for (const e of (existing || [])) annotatedSet.add(e.question_id);
    }
  }

  const approvedToAnnotate = approved.filter((q: any) => !annotatedSet.has(q.id));
  const annotationRows: any[] = [];

  for (const q of approvedToAnnotate) {
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
    await batchUpsert(sb, "exam_question_elite_annotations", annotationRows, "question_id");
  }

  console.log(`[EliteHarden] Phase 1a: ${annotationRows.length} approved → annotation table (${annotatedSet.size} already existed)`);

  // ── Phase 1b: Draft → direct annotation in exam_questions (batch upsert) ──
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
    await batchUpsert(sb, "exam_questions", draftMeta, "id");
  }

  const totalAnnotated = annotationRows.length + draftMeta.length;
  console.log(`[EliteHarden] Phase 1b: ${draftMeta.length} draft → direct annotation. Total annotated: ${totalAnnotated}`);

  // ── Phase 2: AI content upgrade for weak DRAFT questions only ──
  const weakDrafts: string[] = [];
  for (const q of draftQuestions) {
    const bp = bpMap.get(q.blueprint_id) || null;
    const comp = compMap.get(q.competency_id) || null;
    const { elite_score } = computeElite(buildAnnotationInput(q, bp, comp));
    const hasTags = Array.isArray(q.trap_tags) && q.trap_tags.length > 0;
    const hasMeta = q.distractor_meta && Object.keys(q.distractor_meta || {}).length > 0;
    if (elite_score <= 4 || (!hasTags && !hasMeta)) weakDrafts.push(q.id);
  }

  const toProcess = weakDrafts.slice(0, MAX_EXAM_HARDEN);
  let upgraded = 0, failed = 0;

  for (const qId of toProcess) {
    if (!timeLeft(start)) break;
    const q = questions.find((x: any) => x.id === qId)! as any;
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

      const parsed = parseJSON(await callAI(systemPrompt, userPrompt));
      if (!parsed.question_text || !parsed.options || parsed.options.length < 4) throw new Error("Invalid AI structure");

      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "upgraded",
        original_data: { question_text: q.question_text, options: q.options, explanation: q.explanation, cognitive_level: q.cognitive_level },
        upgraded_data: parsed,
      }).then(() => {}, () => {});

      // Re-compute elite after AI upgrade
      const upgradedInput = buildAnnotationInput(
        { ...q, trap_tags: parsed.trap_tags || q.trap_tags, distractor_meta: parsed.distractor_meta || q.distractor_meta, cognitive_level: parsed.cognitive_level || q.cognitive_level },
        bpMap.get(q.blueprint_id) || null,
        comp || null,
      );
      const newElite = computeElite(upgradedInput);

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
      }).eq("id", q.id);

      upgraded++;
    } catch (err) {
      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "failed", reason: String(err),
      }).then(() => {}, () => {});
      failed++;
    }
  }

  return { upgraded, annotated: totalAnnotated, failed, total: questions.length };
}

// ═══════════════════════════════════════════════════════════════
// HARDEN: MiniChecks (draft/easy only)
// ═══════════════════════════════════════════════════════════════
async function hardenMiniChecks(
  sb: ReturnType<typeof createClient>,
  runId: string,
  courseId: string,
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

      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "minicheck", entity_id: mc.id, action: "upgraded",
        original_data: { question_text: mc.question_text, options: mc.options, explanation: mc.explanation },
        upgraded_data: parsed,
      }).then(() => {}, () => {});

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

      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "oral_blueprint", entity_id: bp.id, action: "upgraded",
        original_data: { scenario: bp.scenario, rubric: bp.rubric },
        upgraded_data: parsed,
      }).then(() => {}, () => {});

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
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
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

  // ── Idempotency ──
  const { data: pkg } = await sb
    .from("course_packages")
    .select("elite_hardening_version, title, curriculum_id")
    .eq("id", packageId)
    .single();

  if (!pkg) return json({ error: "Package not found" }, 404);

  if ((pkg as any).elite_hardening_version >= 1) {
    console.log(`[EliteHarden] Package ${packageId.slice(0, 8)} already hardened — skipping`);
    return json({ ok: true, batch_complete: true, skipped: true, reason: "already_hardened" });
  }

  const { data: curriculum } = await sb
    .from("curricula")
    .select("title")
    .eq("id", curriculumId)
    .single();

  const berufName = curriculum?.title || pkg.title || "Ausbildungsberuf";

  const { data: run } = await sb
    .from("elite_hardening_runs")
    .insert({ package_id: packageId, scope: "pipeline_auto", status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();

  const runId = run!.id;
  const start = Date.now();

  try {
    const examResult = await hardenExamQuestions(sb, runId, curriculumId, berufName, start);
    console.log(`[EliteHarden] Exam: ${examResult.upgraded} upgraded, ${examResult.annotated} annotated, ${examResult.failed} failed (${examResult.total} total)`);

    const mcResult = timeLeft(start)
      ? await hardenMiniChecks(sb, runId, courseId || packageId, berufName, start)
      : { upgraded: 0, total: 0 };

    const oralResult = timeLeft(start)
      ? await hardenOralBlueprints(sb, runId, curriculumId, berufName, start)
      : { upgraded: 0, total: 0 };

    await sb.from("elite_hardening_runs").update({
      status: "done", finished_at: new Date().toISOString(),
      exam_questions_upgraded: examResult.upgraded, exam_questions_total: examResult.total,
      minichecks_upgraded: mcResult.upgraded, minichecks_total: mcResult.total,
      oral_blueprints_upgraded: oralResult.upgraded, oral_blueprints_total: oralResult.total,
    }).eq("id", runId);

    await sb.from("course_packages").update({
      elite_hardening_version: 1,
      elite_hardened_at: new Date().toISOString(),
    }).eq("id", packageId).eq("elite_hardening_version", 0);

    const totalUpgraded = examResult.upgraded + examResult.annotated + mcResult.upgraded + oralResult.upgraded;
    if (totalUpgraded > 0) {
      await sb.from("admin_notifications").insert({
        title: `Elite-Hardening (Auto): ${berufName}`,
        body: `Exam: ${examResult.upgraded} upgraded, ${examResult.annotated} annotated | MC: ${mcResult.upgraded} | Oral: ${oralResult.upgraded}`,
        severity: "info", category: "pipeline", entity_type: "course_package", entity_id: packageId,
      }).then(() => {}, () => {});
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[EliteHarden] ✅ Done in ${elapsed}s`);

    return json({ ok: true, batch_complete: true, run_id: runId, results: { exam: examResult, minicheck: mcResult, oral: oralResult }, elapsed_s: parseFloat(elapsed) });
  } catch (err) {
    await sb.from("elite_hardening_runs").update({
      status: "failed", error_message: String(err), finished_at: new Date().toISOString(),
    }).eq("id", runId);

    console.error(`[EliteHarden] FATAL: ${(err as Error)?.message || err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
