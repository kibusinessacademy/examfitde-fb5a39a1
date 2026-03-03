import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import {
  assessLessonQuality,
  buildExpandSystemPrompt,
  getEliteStepThresholds,
  type StepQualityThresholds,
} from "../_shared/content-quality.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// --- AI Helper using shared ai-client ---
async function callAI(
  _supabase: any,
  systemPrompt: string,
  userPrompt: string,
  model = "google/gemini-2.5-flash"
): Promise<string> {
  const provider: AIProvider = model.startsWith("google/") ? "lovable" : "lovable";
  const result = await callAIJSON({
    provider,
    model,
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
  // Strip markdown code fences
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Berufsabhängige Szenario-Keywords (SSOT-konform, keine Cross-Berufs-Vermischung) ──
function getScenarioKeywords(profession: string): string[] {
  const base = ["betrieb", "situation", "fall", "szenario", "bestellt", "reklamiert", "prüft", "berechnet"];
  const p = profession.toLowerCase();

  if (p.includes("verkäufer") || p.includes("einzelhandel") || p.includes("kaufmann im einzelhandel")) {
    return [...base, "kunde", "filiale", "kasse", "geschäft", "laden", "markt", "warenbestand",
      "verkaufsgespräch", "reklamation", "angebot", "rabatt", "lieferung", "lager", "sortiment",
      "warenpräsentation", "inventur", "kassiervorgang", "umtausch", "servicebereich", "abteilung"];
  }
  if (p.includes("pka") || p.includes("pharmazeutisch")) {
    return [...base, "apotheke", "rezept", "arzneimittel", "patient", "lagerbestand", "btm",
      "retaxation", "rabattvertrag", "aut-idem", "defektur", "taxierung"];
  }
  if (p.includes("mfa") || p.includes("medizinische fachangestellte")) {
    return [...base, "patient", "praxis", "behandlung", "termin", "abrechnung", "ebm",
      "goä", "sprechstunde", "dokumentation", "hygiene", "labor"];
  }
  if (p.includes("industriekaufmann") || p.includes("industriekauffrau") || p.includes("industriekauf")) {
    return [...base, "kunde", "lieferant", "fertigung", "beschaffung", "kalkulation",
      "angebot", "auftrag", "rechnung", "lager", "produktion", "logistik", "abteilung"];
  }
  if (p.includes("büro") || p.includes("büromanagement")) {
    return [...base, "kunde", "termin", "korrespondenz", "ablage", "beschaffung",
      "protokoll", "veranstaltung", "reiseplanung", "posteingang", "abteilung"];
  }
  if (p.includes("bankkaufmann") || p.includes("bankkauffrau") || p.includes("bank")) {
    return [...base, "kunde", "konto", "kredit", "anlage", "beratungsgespräch",
      "finanzierung", "wertpapier", "zinsen", "bonität", "sicherheit"];
  }
  if (p.includes("e-commerce")) {
    return [...base, "kunde", "shop", "bestellung", "retoure", "conversion",
      "warenkorb", "zahlung", "versand", "tracking", "bewertung"];
  }
  return [...base, "kunde", "filiale", "abteilung", "geschäft", "kasse"];
}

// --- Analysis: Score existing content ---
interface AnalysisResult {
  scenario_pct: number;
  multistep_pct: number;
  operator_variety: number;
  weak_ids: string[];
}

async function analyzeExamPool(
  supabase: any,
  packageId: string,
  curriculumId: string,
  berufName = "",
): Promise<AnalysisResult> {
  const { data: questions } = await supabase
    .from("exam_questions")
    .select("id, question_text, options, explanation, cognitive_level, difficulty, question_type, trap_tags, distractor_meta")
    .eq("curriculum_id", curriculumId)
    .in("status", ["approved", "draft"])
    .limit(500);

  if (!questions?.length) return { scenario_pct: 0, multistep_pct: 0, operator_variety: 0, weak_ids: [] };

  const scenarioKeywords = getScenarioKeywords(berufName);
  const multistepKeywords = ["zunächst", "anschließend", "daraufhin", "im nächsten schritt", "bevor", "nachdem"];
  const operators = new Set<string>();
  const weak: string[] = [];

  for (const q of questions) {
    const text = (q.question_text || "").toLowerCase();
    const expl = (q.explanation || "").toLowerCase();

    const isScenario = scenarioKeywords.some((k) => text.includes(k.toLowerCase()));
    const isMultistep = multistepKeywords.some((k) => text.includes(k));

    // Extract operator (first verb-like word)
    const operatorMatch = (q.question_text || "").match(/^(Welche|Was|Wie|Wann|Warum|Nennen|Berechnen|Erklären|Beschreiben|Beurteilen|Analysieren|Ordnen|Prüfen)/i);
    if (operatorMatch) operators.add(operatorMatch[1].toLowerCase());

    // Weak criteria (broader): catches questions lacking elite characteristics
    // A question is weak if it has 2+ of these deficiencies:
    let deficiencyCount = 0;
    if (!isScenario) deficiencyCount++;
    if (!isMultistep) deficiencyCount++;
    if (!q.trap_tags || q.trap_tags.length === 0) deficiencyCount++;
    if (expl.length < 200) deficiencyCount++;
    if (!q.distractor_meta || (typeof q.distractor_meta === 'object' && Object.keys(q.distractor_meta).length === 0)) deficiencyCount++;
    if (q.cognitive_level === "remember" || q.cognitive_level === "understand") deficiencyCount++;
    if (!operatorMatch) deficiencyCount++;

    const isWeak = deficiencyCount >= 4;
    if (isWeak) weak.push(q.id);
  }

  const scenarioCount = questions.filter((q: any) =>
    scenarioKeywords.some((k) => (q.question_text || "").toLowerCase().includes(k.toLowerCase()))
  ).length;

  const multistepCount = questions.filter((q: any) =>
    multistepKeywords.some((k) => (q.question_text || "").toLowerCase().includes(k))
  ).length;

  return {
    scenario_pct: Math.round((scenarioCount / questions.length) * 100),
    multistep_pct: Math.round((multistepCount / questions.length) * 100),
    operator_variety: operators.size,
    weak_ids: weak.slice(0, 50), // Cap at 50 for processing
  };
}

// --- Hardening: Exam Questions ---
async function hardenExamQuestions(
  supabase: any,
  runId: string,
  weakIds: string[],
  curriculumId: string,
  startTime: number = Date.now()
): Promise<{ upgraded: number; failed: number; remaining: number }> {
  let upgraded = 0;
  let failed = 0;
  const TIME_BUDGET_MS = 110_000; // 110s budget (Edge Function timeout = 180s)

  // Get curriculum context
  const { data: curriculum } = await supabase
    .from("curricula")
    .select("title, beruf_id")
    .eq("id", curriculumId)
    .single();

  const berufName = curriculum?.title || "Ausbildungsberuf";

  // Process one at a time with time budget
  for (let i = 0; i < weakIds.length; i++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`[elite-hardening] Time budget exhausted after ${upgraded} upgrades, ${weakIds.length - i} remaining`);
      return { upgraded, failed, remaining: weakIds.length - i };
    }
    const batch = [weakIds[i]];
    const { data: questions } = await supabase
      .from("exam_questions")
      .select("id, question_text, options, explanation, correct_answer, cognitive_level, difficulty, competency_id")
      .in("id", batch);

    if (!questions?.length) continue;

    // Get competency context for these questions
    const compIds = [...new Set(questions.map((q: any) => q.competency_id).filter(Boolean))];
    const { data: competencies } = await supabase
      .from("competencies")
      .select("id, description, action_verbs, typical_misconceptions")
      .in("id", compIds);

    const compMap = new Map((competencies || []).map((c: any) => [c.id, c]));

    for (const q of questions) {
      try {
        const comp = compMap.get(q.competency_id);
        const misconceptions = comp?.typical_misconceptions
          ? JSON.stringify(comp.typical_misconceptions)
          : "keine bekannt";

        const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Du verbesserst bestehende Prüfungsfragen auf Elite-Niveau.

REGELN:
1. Wandle theoretische Fragen in praxisnahe Fallvignetten um (konkreter Betrieb/Apotheke/Situation)
2. Füge Mehrschrittlogik hinzu (der Prüfling muss 2-3 Denkschritte durchführen)
3. Integriere typische IHK-Prüfungsfallen in die Distraktoren
4. Die Erklärung muss für JEDEN Distraktor erklären, warum er falsch ist ("verlockend weil... / falsch weil...")
5. Behalte den fachlichen Kern der Frage bei
6. Antworte AUSSCHLIESSLICH als JSON-Objekt`;

        const userPrompt = `Verbessere diese Prüfungsfrage:

ORIGINALFRAGE:
${q.question_text}

OPTIONEN:
${JSON.stringify(q.options)}

KORREKTE ANTWORT: Index ${q.correct_answer}
ERKLÄRUNG: ${q.explanation}

KOMPETENZ: ${comp?.description || "unbekannt"}
TYPISCHE FEHLVORSTELLUNGEN: ${misconceptions}

Antworte als JSON:
{
  "question_text": "Verbesserte Frage mit Fallvignette und Praxisbezug",
  "options": [{"text": "Option A"}, {"text": "Option B"}, {"text": "Option C"}, {"text": "Option D"}],
  "correct_answer": 0,
  "explanation": "Detaillierte Erklärung mit Distraktor-Analyse (verlockend weil / falsch weil)",
  "cognitive_level": "apply|analyze|evaluate",
  "trap_tags": ["tag1", "tag2"],
  "distractor_meta": {"d0_trap": "Beschreibung", "d1_trap": "...", "d2_trap": "..."}
}`;

        const aiResult = await callAI(supabase, systemPrompt, userPrompt);
        const parsed = parseJSON(aiResult);

        if (!parsed.question_text || !parsed.options || parsed.options.length < 4) {
          throw new Error("Invalid AI response structure");
        }

        // Save original and upgrade
        await supabase.from("elite_hardening_items").insert({
          run_id: runId,
          entity_type: "exam_question",
          entity_id: q.id,
          action: "upgraded",
          original_data: {
            question_text: q.question_text,
            options: q.options,
            explanation: q.explanation,
            cognitive_level: q.cognitive_level,
          },
          upgraded_data: parsed,
        });

        // Apply upgrade
        await supabase
          .from("exam_questions")
          .update({
            question_text: parsed.question_text,
            options: parsed.options,
            correct_answer: parsed.correct_answer ?? q.correct_answer,
            explanation: parsed.explanation,
            cognitive_level: parsed.cognitive_level || q.cognitive_level,
            trap_tags: parsed.trap_tags || [],
            distractor_meta: parsed.distractor_meta || {},
          })
          .eq("id", q.id);

        upgraded++;
      } catch (err) {
        await supabase.from("elite_hardening_items").insert({
          run_id: runId,
          entity_type: "exam_question",
          entity_id: q.id,
          action: "failed",
          reason: String(err),
        });
        failed++;
      }
    }

    // Update run progress
    await supabase
      .from("elite_hardening_runs")
      .update({ exam_questions_upgraded: upgraded })
      .eq("id", runId);
  }

  return { upgraded, failed };
}

// --- Hardening: MiniChecks ---
async function hardenMiniChecks(
  supabase: any,
  runId: string,
  courseId: string,
  berufName: string
): Promise<{ upgraded: number; total: number }> {
  const { data: minichecks } = await supabase
    .from("minicheck_questions")
    .select("id, lesson_id, question_text, options, explanation, correct_answer, difficulty, competency_id")
    .limit(200);

  if (!minichecks?.length) return { upgraded: 0, total: 0 };

  // Filter to only easy/weak ones
  const weakChecks = minichecks.filter(
    (mc: any) =>
      mc.difficulty === "easy" ||
      !mc.explanation ||
      (mc.explanation || "").length < 80
  );

  let upgraded = 0;

  for (const mc of weakChecks.slice(0, 30)) {
    try {
      const systemPrompt = `Du bist IHK-Prüfungsexperte für ${berufName}. Du transformierst einfache Wissensabfragen in prüfungsnahe MiniCheck-Items.

REGELN:
1. MiniCheck = Prüfungs-Simulation im Kleinformat, KEINE Wissensabfrage
2. Nutze kurze Praxisszenarien (1-2 Sätze Kontext)
3. Integriere mindestens eine typische Prüfungsfalle
4. Erklärung muss "verlockend weil / falsch weil" für falsche Optionen enthalten
5. Schwierigkeit: mindestens "medium"
6. Antworte AUSSCHLIESSLICH als JSON`;

      const userPrompt = `Transformiere diesen MiniCheck:

ORIGINAL: ${mc.question_text}
OPTIONEN: ${JSON.stringify(mc.options)}
KORREKT: Index ${mc.correct_answer}
ERKLÄRUNG: ${mc.explanation || "keine"}

JSON-Antwort:
{
  "question_text": "Prüfungsnahe Frage mit kurzem Praxisszenario",
  "options": [{"text": "A"}, {"text": "B"}, {"text": "C"}, {"text": "D"}],
  "correct_answer": 0,
  "explanation": "Detaillierte Erklärung mit Trap-Analyse",
  "difficulty": "medium"
}`;

      const aiResult = await callAI(supabase, systemPrompt, userPrompt);
      const parsed = parseJSON(aiResult);

      if (!parsed.question_text || !parsed.options) continue;

      await supabase.from("elite_hardening_items").insert({
        run_id: runId,
        entity_type: "minicheck",
        entity_id: mc.id,
        action: "upgraded",
        original_data: { question_text: mc.question_text, options: mc.options, explanation: mc.explanation },
        upgraded_data: parsed,
      });

      await supabase
        .from("minicheck_questions")
        .update({
          question_text: parsed.question_text,
          options: parsed.options,
          correct_answer: parsed.correct_answer ?? mc.correct_answer,
          explanation: parsed.explanation,
          difficulty: parsed.difficulty || "medium",
        })
        .eq("id", mc.id);

      upgraded++;
    } catch {
      // Skip on error
    }
  }

  await supabase
    .from("elite_hardening_runs")
    .update({ minichecks_upgraded: upgraded, minichecks_total: minichecks.length })
    .eq("id", runId);

  return { upgraded, total: minichecks.length };
}

// --- Hardening: Oral Exam ---
async function hardenOralExam(
  supabase: any,
  runId: string,
  curriculumId: string,
  berufName: string
): Promise<{ upgraded: number; total: number }> {
  const { data: blueprints } = await supabase
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, competency_id")
    .eq("curriculum_id", curriculumId)
    .limit(50);

  if (!blueprints?.length) return { upgraded: 0, total: 0 };

  // Find weak blueprints: short scenario, no detailed rubric
  const weakBps = blueprints.filter(
    (bp: any) =>
      !bp.scenario ||
      (bp.scenario || "").length < 100 ||
      !bp.rubric ||
      Object.keys(bp.rubric || {}).length < 3
  );

  let upgraded = 0;

  for (const bp of weakBps.slice(0, 20)) {
    try {
      const systemPrompt = `Du bist IHK-Prüfungsexperte für mündliche Prüfungen im Beruf ${berufName}. Du verbesserst Oral-Exam-Blueprints auf Elite-Niveau.

REGELN:
1. Szenario muss eine ECHTE berufliche Situation beschreiben (min. 3 Sätze)
2. Für PKA: Apotheken-Alltag, Engpass-Szenarien, BtM-Situationen, Kundenberatung
3. Rubrik muss 4 Dimensionen bewerten: Fachlichkeit, Struktur, Begriffssicherheit, Praxisbezug
4. Followup-Fragen müssen Gesprächsdynamik simulieren
5. Antworte AUSSCHLIESSLICH als JSON`;

      const userPrompt = `Verbessere diesen Oral-Exam Blueprint:

TITEL: ${bp.title}
SZENARIO: ${bp.scenario || "fehlt"}
LEITFRAGEN: ${JSON.stringify(bp.lead_questions || [])}
FOLLOWUPS: ${JSON.stringify(bp.followups || [])}
RUBRIK: ${JSON.stringify(bp.rubric || {})}

JSON-Antwort:
{
  "scenario": "Detaillierte Praxissituation (min. 3 Sätze)",
  "lead_questions": ["Frage 1", "Frage 2", "Frage 3"],
  "followups": ["Vertiefung 1", "Vertiefung 2"],
  "rubric": {
    "fachlichkeit": {"gewicht": 40, "kriterien": ["K1", "K2"]},
    "struktur": {"gewicht": 20, "kriterien": ["K1"]},
    "begriffssicherheit": {"gewicht": 20, "kriterien": ["K1"]},
    "praxisbezug": {"gewicht": 20, "kriterien": ["K1"]}
  }
}`;

      const aiResult = await callAI(supabase, systemPrompt, userPrompt);
      const parsed = parseJSON(aiResult);

      if (!parsed.scenario) continue;

      await supabase.from("elite_hardening_items").insert({
        run_id: runId,
        entity_type: "oral_blueprint",
        entity_id: bp.id,
        action: "upgraded",
        original_data: { scenario: bp.scenario, rubric: bp.rubric },
        upgraded_data: parsed,
      });

      await supabase
        .from("oral_exam_blueprints")
        .update({
          scenario: parsed.scenario,
          lead_questions: parsed.lead_questions || bp.lead_questions,
          followups: parsed.followups || bp.followups,
          rubric: parsed.rubric || bp.rubric,
        })
        .eq("id", bp.id);

      upgraded++;
    } catch {
      // Skip
    }
  }

  await supabase
    .from("elite_hardening_runs")
    .update({ oral_blueprints_upgraded: upgraded, oral_blueprints_total: blueprints.length })
    .eq("id", runId);

  return { upgraded, total: blueprints.length };
}

// --- Hardening: Lesson Content (Elite Expansion Phase 2) ---
async function hardenLessons(
  supabase: any,
  runId: string,
  courseId: string,
  berufName: string,
  startTime: number = Date.now()
): Promise<{ upgraded: number; skipped: number; failed: number; total: number }> {
  const TIME_BUDGET_MS = 100_000;
  const MAX_EXPAND_RETRIES = 2;
  const MAX_LESSONS_PER_RUN = 20;

  // Get lessons via modules → course
  const { data: modules } = await supabase
    .from("modules")
    .select("id")
    .eq("course_id", courseId);

  if (!modules?.length) return { upgraded: 0, skipped: 0, failed: 0, total: 0 };

  const moduleIds = modules.map((m: any) => m.id);
  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, step, content, module_id")
    .in("module_id", moduleIds)
    .in("status", ["approved", "draft"])
    .order("sort_order", { ascending: true })
    .limit(500);

  if (!lessons?.length) return { upgraded: 0, skipped: 0, failed: 0, total: 0 };

  let upgraded = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const lesson of lessons) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break;
    if (processed >= MAX_LESSONS_PER_RUN) break;

    // Extract HTML from JSONB content: {html: "...", type: "text", ...}
    const contentObj = lesson.content ?? {};
    const htmlContent = typeof contentObj === "object" && contentObj !== null
      ? String((contentObj as any).html ?? "")
      : String(contentObj);

    const stepType = lesson.step || "verstehen";
    const thresholds = getEliteStepThresholds(stepType);
    const quality = assessLessonQuality(htmlContent, stepType, thresholds);

    if (quality.ok) {
      skipped++;
      continue;
    }

    processed++;

    // Expand-retry loop
    let currentHtml = htmlContent;
    let lastQuality = quality;
    let attempts = 0;
    let success = false;

    while (!lastQuality.ok && attempts < MAX_EXPAND_RETRIES) {
      if (Date.now() - startTime > TIME_BUDGET_MS - 12_000) break; // 12s safety margin
      attempts++;

      try {
        const expandSystem = buildExpandSystemPrompt({
          professionName: berufName,
          lessonTitle: lesson.title || "Lesson",
          step: stepType,
          missingReasons: lastQuality.reasons,
          thresholds,
        });

        const expandUser = `Hier ist der aktuelle Inhalt, der erweitert werden muss:\n\n${currentHtml}`;

        const expanded = await callAI(supabase, expandSystem, expandUser);

        if (expanded && expanded.length > currentHtml.length) {
          currentHtml = expanded;
          lastQuality = assessLessonQuality(currentHtml, stepType, thresholds);

          // Write back as JSONB preserving other fields
          const updatedContent = typeof contentObj === "object" && contentObj !== null
            ? { ...(contentObj as any), html: currentHtml }
            : { html: currentHtml, type: "text" };

          await supabase.from("lessons").update({
            content: updatedContent,
          }).eq("id", lesson.id);
        }
      } catch (err) {
        console.warn(`[elite-hardening] Expand failed for lesson ${String(lesson.id).slice(0,8)}: ${err}`);
        break;
      }
    }

    if (lastQuality.ok) {
      upgraded++;
      success = true;
    } else {
      failed++;
    }

    // Record in items log
    await supabase.from("elite_hardening_items").insert({
      run_id: runId,
      entity_type: "lesson",
      entity_id: lesson.id,
      action: success ? "upgraded" : "expand_incomplete",
      original_data: { charCount: quality.charCount, reasons: quality.reasons },
      upgraded_data: {
        charCount: lastQuality.charCount,
        wordCount: lastQuality.wordCount,
        ok: lastQuality.ok,
        reasons: lastQuality.reasons,
        attempts,
      },
    });
  }

  // Update run stats
  await supabase.from("elite_hardening_runs").update({
    lessons_upgraded: upgraded,
    lessons_total: lessons.length,
  }).eq("id", runId);

  return { upgraded, skipped, failed, total: lessons.length };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const { package_id, scope = "all" } = body;

    if (!package_id) {
      return new Response(JSON.stringify({ error: "package_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get package info
    const { data: pkg } = await supabase
      .from("course_packages")
      .select("id, title, curriculum_id, course_id")
      .eq("id", package_id)
      .single();

    if (!pkg) {
      return new Response(JSON.stringify({ error: "Package not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get beruf name
    const { data: curriculum } = await supabase
      .from("curricula")
      .select("title")
      .eq("id", pkg.curriculum_id)
      .single();

    const berufName = curriculum?.title || pkg.title || "Ausbildungsberuf";

    // Create run
    const { data: run } = await supabase
      .from("elite_hardening_runs")
      .insert({
        package_id,
        scope,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const runId = run!.id;

    const invocationStart = Date.now();

    try {
      const results: any = { exam: null, minicheck: null, oral: null, lessons: null };

      // 0. Harden Lessons (Elite Expansion — Phase 2)
      if (scope === "all" || scope === "lessons") {
        results.lessons = await hardenLessons(supabase, runId, pkg.course_id, berufName, invocationStart);
      }

      // 1. Analyze exam pool
      if (scope === "all" || scope === "exam_pool") {
        const analysis = await analyzeExamPool(supabase, package_id, pkg.curriculum_id, berufName);
        await supabase
          .from("elite_hardening_runs")
          .update({
            pre_scores: {
              scenario_pct: analysis.scenario_pct,
              multistep_pct: analysis.multistep_pct,
              operator_variety: analysis.operator_variety,
              weak_count: analysis.weak_ids.length,
            },
            exam_questions_total: analysis.weak_ids.length,
          })
          .eq("id", runId);

        if (analysis.weak_ids.length > 0) {
          results.exam = await hardenExamQuestions(supabase, runId, analysis.weak_ids, pkg.curriculum_id, invocationStart);
        }
      }

      // 2. Harden MiniChecks
      if (scope === "all" || scope === "minicheck") {
        results.minicheck = await hardenMiniChecks(supabase, runId, pkg.course_id, berufName);
      }

      // 3. Harden Oral Exam
      if (scope === "all" || scope === "oral_exam") {
        results.oral = await hardenOralExam(supabase, runId, pkg.curriculum_id, berufName);
      }

      // Post-analysis
      if (scope === "all" || scope === "exam_pool") {
        const postAnalysis = await analyzeExamPool(supabase, package_id, pkg.curriculum_id, berufName);
        await supabase
          .from("elite_hardening_runs")
          .update({
            post_scores: {
              scenario_pct: postAnalysis.scenario_pct,
              multistep_pct: postAnalysis.multistep_pct,
              operator_variety: postAnalysis.operator_variety,
              weak_count: postAnalysis.weak_ids.length,
            },
          })
          .eq("id", runId);
      }

      // Mark done
      await supabase
        .from("elite_hardening_runs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);

      // Admin notification
      await supabase.from("admin_notifications").insert({
        title: `Elite-Hardening abgeschlossen: ${pkg.title}`,
        body: `Lessons: ${results.lessons?.upgraded || 0}/${results.lessons?.total || 0} elite | Exam: ${results.exam?.upgraded || 0} upgraded | MiniCheck: ${results.minicheck?.upgraded || 0} | Oral: ${results.oral?.upgraded || 0}`,
        severity: "info",
        category: "pipeline",
        entity_type: "course_package",
        entity_id: package_id,
      });

      return new Response(
        JSON.stringify({ ok: true, run_id: runId, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      await supabase
        .from("elite_hardening_runs")
        .update({
          status: "failed",
          error_message: String(err),
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);

      throw err;
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
