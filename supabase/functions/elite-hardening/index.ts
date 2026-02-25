import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_GATEWAY =
  Deno.env.get("AI_GATEWAY_URL") || `${SUPABASE_URL}/functions/v1/ai-gateway`;

// --- AI Helper ---
async function callAI(
  supabase: any,
  systemPrompt: string,
  userPrompt: string,
  model = "google/gemini-2.5-flash"
): Promise<string> {
  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`AI call failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.content || "";
}

function parseJSON(text: string): any {
  // Strip markdown code fences
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
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
  curriculumId: string
): Promise<AnalysisResult> {
  const { data: questions } = await supabase
    .from("exam_questions")
    .select("id, question_text, options, explanation, cognitive_level, difficulty, question_type, trap_tags, distractor_meta")
    .eq("curriculum_id", curriculumId)
    .in("status", ["approved", "draft"])
    .limit(500);

  if (!questions?.length) return { scenario_pct: 0, multistep_pct: 0, operator_variety: 0, weak_ids: [] };

  const scenarioKeywords = ["Betrieb", "Apotheke", "Kunde", "Patient", "Situation", "Fall", "Szenario", "bestellt", "reklamiert", "prüft", "berechnet"];
  const multistepKeywords = ["zunächst", "anschließend", "daraufhin", "im nächsten Schritt", "bevor", "nachdem"];
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

    // Weak criteria: no scenario, no trap tags, short explanation
    const isWeak =
      !isScenario &&
      (!q.trap_tags || q.trap_tags.length === 0) &&
      expl.length < 150 &&
      q.cognitive_level !== "analyze" &&
      q.cognitive_level !== "evaluate";

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
  curriculumId: string
): Promise<{ upgraded: number; failed: number }> {
  let upgraded = 0;
  let failed = 0;

  // Get curriculum context
  const { data: curriculum } = await supabase
    .from("curricula")
    .select("title, beruf_id")
    .eq("id", curriculumId)
    .single();

  const berufName = curriculum?.title || "Ausbildungsberuf";

  // Process in batches of 5
  for (let i = 0; i < weakIds.length; i += 5) {
    const batch = weakIds.slice(i, i + 5);
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

// --- Main Handler ---
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

    try {
      const results: any = { exam: null, minicheck: null, oral: null };

      // 1. Analyze exam pool
      if (scope === "all" || scope === "exam_pool") {
        const analysis = await analyzeExamPool(supabase, package_id, pkg.curriculum_id);
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
          results.exam = await hardenExamQuestions(supabase, runId, analysis.weak_ids, pkg.curriculum_id);
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
        const postAnalysis = await analyzeExamPool(supabase, package_id, pkg.curriculum_id);
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
        body: `Exam: ${results.exam?.upgraded || 0} upgraded | MiniCheck: ${results.minicheck?.upgraded || 0} | Oral: ${results.oral?.upgraded || 0}`,
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
