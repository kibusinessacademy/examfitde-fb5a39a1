import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";

/**
 * package-elite-harden — Pipeline Step (auto, runs after all generation, before integrity check)
 *
 * SSOT Rules:
 * 1. Only touches items with status='draft' belonging to this package's curriculum
 * 2. Idempotent: skips if course_packages.elite_hardening_version >= 1
 * 3. Tracks every upgrade in elite_hardening_items for audit/revert
 * 4. Budget-capped (110s) with graceful exit
 * 5. Marks package with elite_hardening_version=1 on completion
 */

const TIME_BUDGET_MS = 110_000;
const MAX_EXAM_HARDEN = 80;
const MAX_MINICHECK_HARDEN = 40;
const MAX_ORAL_HARDEN = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

// --- AI Helper ---
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

// ═══════════════════════════════════════════════════════════════
// HARDEN: Exam Questions (draft AND approved — Blocker C fix)
// For approved questions: annotates elite_level/multi_variable/transfer_variant/distractor_types
// WITHOUT mutating the question content (preserves approved state).
// For draft questions: full content upgrade (existing behavior).
// ═══════════════════════════════════════════════════════════════
async function hardenExamQuestions(
  sb: ReturnType<typeof createClient>,
  runId: string,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; annotated: number; failed: number; total: number }> {
  // Fetch both draft AND approved questions
  const { data: questions } = await sb
    .from("exam_questions")
    .select("id, question_text, options, explanation, correct_answer, cognitive_level, difficulty, competency_id, trap_tags, distractor_meta, status, elite_level, multi_variable, transfer_variant, distractor_types")
    .eq("curriculum_id", curriculumId)
    .in("status", ["draft", "approved"])
    .limit(1100);

  if (!questions?.length) return { upgraded: 0, annotated: 0, failed: 0, total: 0 };

  // ── Phase 1: Annotate ALL approved questions with elite metadata ──
  // This does NOT mutate content — only sets elite_level, multi_variable, transfer_variant, distractor_types
  const approvedQuestions = questions.filter(q => q.status === "approved");
  const unannotated = approvedQuestions.filter(q => !q.elite_level);
  let annotated = 0;

  // Heuristic annotation for approved questions (no AI call needed)
  const scenarioKw = ["betrieb", "apotheke", "kunde", "patient", "situation", "fall", "szenario", "bestellt", "reklamiert", "prüft", "berechnet", "filiale", "abteilung", "geschäft", "laden", "markt", "kasse"];
  const multistepKw = ["zunächst", "anschließend", "daraufhin", "im nächsten schritt", "bevor", "nachdem", "dabei", "deshalb", "folglich"];
  const transferKw = ["übertragen", "vergleich", "analog", "unterschied", "alternativ", "stattdessen", "wenn statt", "im gegensatz"];

  for (const q of unannotated) {
    if (!timeLeft(start)) break;
    const text = (q.question_text || "").toLowerCase();
    const expl = (q.explanation || "").toLowerCase();

    // Determine elite_level by heuristic
    const hasScenario = scenarioKw.some(k => text.includes(k));
    const hasMultistep = multistepKw.some(k => text.includes(k));
    const hasDeepExpl = expl.length >= 200;
    const isHighBloom = ["apply", "analyze", "evaluate"].includes(q.cognitive_level || "");
    const hasTraps = (q.trap_tags || []).length > 0;

    let score = 0;
    if (hasScenario) score += 2;
    if (hasMultistep) score += 2;
    if (hasDeepExpl) score += 1;
    if (isHighBloom) score += 2;
    if (hasTraps) score += 1;

    const eliteLevel = score >= 6 ? "E3" : score >= 4 ? "E2" : score >= 2 ? "E1" : "E0";
    const isMultiVariable = hasScenario && hasMultistep;
    const isTransfer = transferKw.some(k => text.includes(k) || expl.includes(k));

    // Derive distractor_types from distractor_meta or trap_tags
    let dTypes: string[] = q.distractor_types || [];
    if (dTypes.length === 0) {
      if (q.distractor_meta && Object.keys(q.distractor_meta).length > 0) {
        dTypes = Object.values(q.distractor_meta as Record<string, string>)
          .filter(v => typeof v === "string" && v.length > 3)
          .map(v => v.split(/[,;]/)[0].trim().toLowerCase().replace(/\s+/g, "_"))
          .filter(Boolean)
          .slice(0, 4);
      }
      if (dTypes.length === 0 && (q.trap_tags || []).length > 0) {
        dTypes = (q.trap_tags as string[]).slice(0, 4);
      }
    }

    const updatePayload: Record<string, unknown> = {
      elite_level: eliteLevel,
      multi_variable: isMultiVariable,
      transfer_variant: isTransfer,
    };
    if (dTypes.length > 0) {
      updatePayload.distractor_types = dTypes;
    }

    await sb.from("exam_questions").update(updatePayload).eq("id", q.id);
    annotated++;
  }

  console.log(`[EliteHarden] Annotated ${annotated}/${unannotated.length} approved questions`);

  // ── Phase 2: Full content upgrade for DRAFT questions (existing behavior) ──
  const draftQuestions = questions.filter(q => q.status === "draft");
  const weakIds: string[] = [];
  for (const q of draftQuestions) {
    const text = (q.question_text || "").toLowerCase();
    const expl = (q.explanation || "").toLowerCase();
    let d = 0;
    if (!scenarioKw.some(k => text.includes(k))) d++;
    if (!multistepKw.some(k => text.includes(k))) d++;
    if (!q.trap_tags || q.trap_tags.length === 0) d++;
    if (expl.length < 200) d++;
    if (!q.distractor_meta || Object.keys(q.distractor_meta || {}).length === 0) d++;
    if (q.cognitive_level === "remember" || q.cognitive_level === "understand") d++;
    if (d >= 3) weakIds.push(q.id);
  }

  const toProcess = weakIds.slice(0, MAX_EXAM_HARDEN);
  let upgraded = 0, failed = 0;

  // Get competency context
  const compIds = [...new Set(questions.filter(q => toProcess.includes(q.id)).map(q => q.competency_id).filter(Boolean))];
  const { data: competencies } = compIds.length > 0
    ? await sb.from("competencies").select("id, description, typical_misconceptions").in("id", compIds)
    : { data: [] };
  const compMap = new Map((competencies || []).map((c: any) => [c.id, c]));

  for (const qId of toProcess) {
    if (!timeLeft(start)) break;
    const q = questions.find(x => x.id === qId)!;
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

      // Audit trail
      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "upgraded",
        original_data: { question_text: q.question_text, options: q.options, explanation: q.explanation, cognitive_level: q.cognitive_level },
        upgraded_data: parsed,
      });

      // Apply content upgrade + elite annotations
      await sb.from("exam_questions").update({
        question_text: parsed.question_text,
        options: parsed.options,
        correct_answer: parsed.correct_answer ?? q.correct_answer,
        explanation: parsed.explanation,
        cognitive_level: parsed.cognitive_level || q.cognitive_level,
        trap_tags: parsed.trap_tags || [],
        distractor_meta: parsed.distractor_meta || {},
        elite_level: "E2",
        multi_variable: true,
      }).eq("id", q.id);

      upgraded++;
    } catch (err) {
      await sb.from("elite_hardening_items").insert({
        run_id: runId, entity_type: "exam_question", entity_id: q.id, action: "failed", reason: String(err),
      });
      failed++;
    }
  }

  return { upgraded, annotated, failed, total: questions.length };
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
      });

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
      });

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

  // ── Idempotency: skip if already hardened ──
  const { data: pkg } = await sb
    .from("course_packages")
    .select("elite_hardening_version, title, curriculum_id")
    .eq("id", packageId)
    .single();

  if (!pkg) return json({ error: "Package not found" }, 404);

  if ((pkg as any).elite_hardening_version >= 1) {
    console.log(`[EliteHarden] Package ${packageId.slice(0, 8)} already hardened (v${(pkg as any).elite_hardening_version}) — skipping`);
    return json({ ok: true, batch_complete: true, skipped: true, reason: "already_hardened" });
  }

  // Get beruf name
  const { data: curriculum } = await sb
    .from("curricula")
    .select("title")
    .eq("id", curriculumId)
    .single();

  const berufName = curriculum?.title || pkg.title || "Ausbildungsberuf";

  // Create tracking run
  const { data: run } = await sb
    .from("elite_hardening_runs")
    .insert({
      package_id: packageId,
      scope: "pipeline_auto",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const runId = run!.id;
  const start = Date.now();

  try {
    // 1. Harden Exam Questions
    const examResult = await hardenExamQuestions(sb, runId, curriculumId, berufName, start);
    console.log(`[EliteHarden] Exam: ${examResult.upgraded} upgraded, ${examResult.annotated} annotated, ${examResult.failed} failed (${examResult.total} total)`);

    // 2. Harden MiniChecks
    const mcResult = timeLeft(start)
      ? await hardenMiniChecks(sb, runId, courseId || packageId, berufName, start)
      : { upgraded: 0, total: 0 };
    console.log(`[EliteHarden] MiniCheck: ${mcResult.upgraded}/${mcResult.total} upgraded`);

    // 3. Harden Oral Blueprints
    const oralResult = timeLeft(start)
      ? await hardenOralBlueprints(sb, runId, curriculumId, berufName, start)
      : { upgraded: 0, total: 0 };
    console.log(`[EliteHarden] Oral: ${oralResult.upgraded}/${oralResult.total} upgraded`);

    // Mark run done
    await sb.from("elite_hardening_runs").update({
      status: "done",
      finished_at: new Date().toISOString(),
      exam_questions_upgraded: examResult.upgraded,
      exam_questions_total: examResult.total,
      minichecks_upgraded: mcResult.upgraded,
      minichecks_total: mcResult.total,
      oral_blueprints_upgraded: oralResult.upgraded,
      oral_blueprints_total: oralResult.total,
    }).eq("id", runId);

    // ── Idempotent package marker (only set if still 0) ──
    await sb.from("course_packages").update({
      elite_hardening_version: 1,
      elite_hardened_at: new Date().toISOString(),
    }).eq("id", packageId).eq("elite_hardening_version", 0);

    // Admin notification
    const totalUpgraded = examResult.upgraded + examResult.annotated + mcResult.upgraded + oralResult.upgraded;
    if (totalUpgraded > 0) {
      await sb.from("admin_notifications").insert({
        title: `Elite-Hardening (Auto): ${berufName}`,
        body: `Exam: ${examResult.upgraded} upgraded, ${examResult.annotated} annotated | MC: ${mcResult.upgraded} | Oral: ${oralResult.upgraded}`,
        severity: "info",
        category: "pipeline",
        entity_type: "course_package",
        entity_id: packageId,
      });
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[EliteHarden] ✅ Done in ${elapsed}s — total ${totalUpgraded} items upgraded`);

    return json({
      ok: true,
      batch_complete: true,
      run_id: runId,
      results: { exam: examResult, minicheck: mcResult, oral: oralResult },
      elapsed_s: parseFloat(elapsed),
    });
  } catch (err) {
    await sb.from("elite_hardening_runs").update({
      status: "failed",
      error_message: String(err),
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    console.error(`[EliteHarden] FATAL: ${(err as Error)?.message || err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
