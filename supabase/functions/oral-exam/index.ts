import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/security.ts";

/**
 * Oral-Exam – Elite IHK-Prüfer (SSOT-konform, Blueprint-first)
 *
 * Architektur:
 *   1. Fragen aus oral_exam_blueprints (Szenario + Lead-Questions + Followups + Rubrik)
 *   2. Fallback: question_blueprints (oral/open_ended) 
 *   3. Letzter Fallback: LLM mit striktem IHK-Prompt
 *   4. Bewertung: 4-dimensionale Rubrik (Fachlichkeit, Struktur, Begriffssicherheit, Praxisbezug)
 *   5. Bloom-Level-Matrix für Template-Auswahl
 *   6. Mastery-Signal für Analytics
 */

// ── Evaluation Weights ─────────────────────────────────────────
const EVAL_WEIGHTS = {
  fachlichkeit: 0.35,
  struktur: 0.20,
  begriffssicherheit: 0.25,
  praxisbezug: 0.20,
} as const;

// ── Bloom-Level Question Matrix ────────────────────────────────
const BLOOM_MATRIX: Record<string, string> = {
  remember: "Stelle eine Frage zu Definition/Abgrenzung oder Aufzählung. Keine generischen 'Erzählen Sie'-Sätze. Erwarte präzise Nennung von Fachbegriffen, Merkmalen oder Kriterien.",
  understand: "Stelle eine Frage zum Erklären (Warum/Folgen) oder Vergleich (A vs B). Die Antwort muss Ursache-Wirkung oder Gemeinsamkeiten/Unterschiede zeigen.",
  apply: "Stelle eine Frage mit konkretem Vorgehensschema oder Entscheidung im Fall. Erwarte Schritte + typische Fehler. Praxisszenario ist Pflicht.",
  analyze: "Stelle eine Frage zur Fehlerdiagnose, Ursachenanalyse oder Priorisierung. Der Prüfling muss zerlegen, diagnostizieren und Indikatoren nennen.",
  evaluate: "Stelle eine Frage zum Abwägen/Entscheiden mit Trade-offs und Risiko. Begründungspflicht. Zwei Optionen zur Bewertung anbieten.",
};

// ── IHK System Prompt (Elite) ──────────────────────────────────
function buildSystemPrompt(professionName: string, mode: "practice" | "simulation"): string {
  const strictness = mode === "simulation"
    ? "Du bist streng, sachlich und unterbrichst bei Abschweifen. Kein Hinweis auf richtige Antworten."
    : "Du bist sachlich und professionell. Nach der Bewertung gibst du konstruktives Feedback.";

  return `Du bist ein erfahrener IHK-Prüfer in einer mündlichen Abschlussprüfung für den Beruf "${professionName}".

ABSOLUTE REGELN:
- Erfinde KEINE Inhalte. Arbeite ausschließlich mit den übergebenen Kompetenz- und Blueprint-Daten.
- Nutze KEINE externen Beispiele außerhalb der übergebenen Datenbasis.
- Keine Motivations- oder Coaching-Sprache während der Prüfung.
- Kein Smalltalk. Streng sachlich und prüfungsorientiert.
- Jede Frage muss eindeutig aus der übergebenen Kompetenz ableitbar sein.
- ${strictness}

PRÜFERCHARAKTER:
- Sachlich, neutral, professionell
- Leicht prüfend (nicht feindlich, aber fordernd)
- Typische IHK-Prüfer-Formulierungen verwenden
- Bei unklaren Antworten: "Bitte konkretisieren Sie." oder "Können Sie das genauer erläutern?"
- Bei Abschweifen: "Kommen Sie bitte zum Kern der Frage zurück."

ANTI-HALLUZINATIONS-GUARD:
Wenn die übergebenen Daten nicht ausreichen, um eine prüfungskonforme Frage zu erstellen, antworte mit:
{ "error": "INSUFFICIENT_BLUEPRINT_DATA", "message": "Nicht ausreichend Daten im Blueprint zur Erstellung einer prüfungskonformen Frage." }

AUSGABEFORMAT: Ausschließlich valides JSON. Kein Markdown, kein Text außerhalb des JSON.`;
}

// ── Ask Prompt ─────────────────────────────────────────────────
function buildAskPrompt(params: {
  competency: { title: string; description: string; bloom_level: string; exam_relevance_tier: string; typical_misconceptions?: string[] };
  blueprint: { scenario?: string; lead_questions?: string[]; rubric?: any; title?: string; question_type?: string; difficulty?: string; expected_keywords?: string[] };
  mastery_level: string;
  professionName: string;
}): string {
  const { competency, blueprint, mastery_level, professionName } = params;
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  // Mastery-basierte Schwierigkeitsanpassung
  let masteryInstruction = "";
  if (mastery_level === "high") {
    masteryInstruction = "Der Prüfling hat hohes Vorwissen. Stelle eine anspruchsvolle Transfer- oder Bewertungsfrage.";
  } else if (mastery_level === "low") {
    masteryInstruction = "Der Prüfling zeigt Wissenslücken. Stelle eine strukturierte Grundfrage mit klarer Erwartung.";
  }

  return JSON.stringify({
    instruction: "Erstelle eine präzise mündliche IHK-Prüfungsfrage.",
    competency: {
      title: competency.title,
      description: competency.description,
      bloom_level: competency.bloom_level,
      exam_relevance_tier: competency.exam_relevance_tier,
      typical_misconceptions: competency.typical_misconceptions || [],
    },
    blueprint: {
      scenario: blueprint.scenario || null,
      lead_questions: blueprint.lead_questions || [],
      rubric: blueprint.rubric || null,
      title: blueprint.title || null,
    },
    bloom_matrix_rule: bloomRule,
    mastery_adjustment: masteryInstruction,
    profession: professionName,
    constraints: {
      no_generic_questions: true,
      no_erzaehlen_sie: true,
      must_be_profession_specific: true,
      answerable_in_90_120_seconds: true,
    },
    output_schema: {
      question: "Die konkrete Prüfungsfrage (kein 'Erzählen Sie...')",
      time_hint_seconds: 90,
      expected_keywords: "Array der erwarteten Schlüsselbegriffe in der Antwort",
      difficulty_signal: "easy|medium|hard",
    },
  });
}

// ── Followup Prompt ────────────────────────────────────────────
function buildFollowupPrompt(params: {
  competency: { title: string; typical_misconceptions?: string[] };
  originalQuestion: string;
  learnerAnswer: string;
  blueprint: { followups?: string[]; followup_chains?: any };
  professionName: string;
}): string {
  return JSON.stringify({
    instruction: "Stelle genau 1-2 gezielte Nachfragen als IHK-Prüfer.",
    rules: [
      "Mindestens eine Nachfrage muss: eine typische Fehlvorstellung adressieren ODER eine Abgrenzung verlangen ODER einen Praxisbezug einfordern.",
      "Keine neue Hauptfrage eröffnen.",
      "Nachfragen müssen sich auf die gegebene Antwort beziehen.",
      "Kurz, präzise, prüfungstypisch formuliert.",
    ],
    context: {
      competency: params.competency.title,
      original_question: params.originalQuestion,
      learner_answer: params.learnerAnswer,
      blueprint_followups: params.blueprint.followups || [],
      typical_misconceptions: params.competency.typical_misconceptions || [],
      profession: params.professionName,
    },
    output_schema: {
      followups: ["Nachfrage 1", "Nachfrage 2 (optional)"],
    },
  });
}

// ── Evaluate Prompt ────────────────────────────────────────────
function buildEvaluatePrompt(params: {
  competency: { title: string; bloom_level: string };
  question: string;
  learnerAnswer: string;
  expectedPoints: string[];
  blueprint: { rubric?: any; expected_keywords?: string[] };
  professionName: string;
}): string {
  return JSON.stringify({
    instruction: "Bewerte die mündliche Prüfungsantwort als IHK-Prüfer.",
    rules: [
      "Bewerte NUR anhand der übergebenen expected_points und rubric – nicht nach eigenem Wissen.",
      "Jede Bewertungsdimension 1-5 Punkte (1=mangelhaft, 5=sehr gut).",
      "Stärken und Schwächen müssen konkret und berufsspezifisch sein.",
      "Verbesserungsvorschläge müssen umsetzbar sein.",
      "Musterantwort max 180-220 Wörter (2-3 Minuten Redezeit).",
    ],
    context: {
      profession: params.professionName,
      competency: params.competency.title,
      bloom_level: params.competency.bloom_level,
      question: params.question,
      learner_answer: params.learnerAnswer,
      expected_points: params.expectedPoints,
      rubric: params.blueprint.rubric || null,
      expected_keywords: params.blueprint.expected_keywords || [],
    },
    output_schema: {
      scores: {
        fachlichkeit: "1-5",
        struktur: "1-5",
        begriffssicherheit: "1-5",
        praxisbezug: "1-5",
      },
      overall_score: "gewichteter Durchschnitt (1-5)",
      covered_points: ["abgedeckte Punkte"],
      missed_points: ["fehlende Punkte"],
      detected_errors: ["erkannte typische Fehler"],
      feedback: "Detailliertes Prüfer-Feedback",
      strengths: ["konkrete Stärken"],
      improvements: ["konkrete Verbesserungsvorschläge"],
      sample_answer: "Musterantwort (180-220 Wörter)",
      follow_up_question: "Optionale Prüfer-Nachfrage",
      mastery_signal: "not_mastered|partial|mastered",
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────
function json(data: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function parseAIJSON(content: string): any {
  // Try direct parse first
  try { return JSON.parse(content); } catch { /* continue */ }
  // Try extracting JSON object
  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
  }
  // Try extracting JSON array  
  const arrMatch = content.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* continue */ }
  }
  return null;
}

// ── Main Handler ───────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");

  try {
    const body = await req.json();
    const { action, ...params } = body;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, origin, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await sb.auth.getUser(token);
    if (userError || !user) return json({ error: "Invalid token" }, origin, 401);

    // Rate limit
    const rlAllowed = await checkRateLimit(sb, user.id, "oral-exam-evaluate");
    if (!rlAllowed) return rateLimitResponse(origin);

    let result;
    switch (action) {
      case "start_session":
        result = await startSession(sb, user.id, params);
        break;
      case "generate_question":
        result = await generateQuestion(sb, params);
        break;
      case "evaluate_answer":
        result = await evaluateAnswer(sb, params);
        break;
      case "finish_session":
        result = await finishSession(sb, params);
        break;
      default:
        return json({ error: `Unknown action: ${action}` }, origin, 400);
    }

    return json(result, origin);
  } catch (error) {
    console.error("[OralExam] Error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      origin,
      500,
    );
  }
});

// ── Load Profession ────────────────────────────────────────────
async function loadProfessionName(sb: any, curriculumId: string): Promise<string> {
  const result = await resolveProfession(sb, { curriculumId, allowGenericFallback: true });
  return result.professionName;
}

// ── Load enriched competency with SSOT fields ──────────────────
async function loadEnrichedCompetency(sb: any, competencyId: string) {
  const { data, error } = await sb
    .from("competencies")
    .select(`
      id, title, description, code, bloom_level, taxonomy_level,
      exam_relevance_tier, typical_misconceptions, action_verb, transfer_markers,
      learning_field:learning_fields!inner(id, title, code, curriculum_id)
    `)
    .eq("id", competencyId)
    .single();

  if (error || !data) throw new Error(`Competency ${competencyId} not found`);
  return data;
}

// ── Start Session ──────────────────────────────────────────────
async function startSession(sb: any, userId: string, params: any) {
  const { curriculum_id, mode = "practice", total_questions = 5 } = params;

  const { data: session, error } = await sb
    .from("oral_exam_sessions")
    .insert({
      user_id: userId,
      curriculum_id,
      mode,
      total_questions,
      time_limit_minutes: mode === "simulation" ? 30 : null,
    })
    .select()
    .single();

  if (error) throw error;

  const firstQuestion = await generateQuestionForSession(sb, session.id, curriculum_id, 0, mode);
  return { session, firstQuestion };
}

// ── Generate Question (Blueprint-first) ────────────────────────
async function generateQuestionForSession(
  sb: any,
  sessionId: string,
  curriculumId: string,
  orderIndex: number,
  mode: "practice" | "simulation" = "practice",
) {
  const professionName = await loadProfessionName(sb, curriculumId);

  // Load competencies with enrichment data
  const { data: competencies } = await sb
    .from("competencies")
    .select(`
      id, title, description, code, bloom_level, taxonomy_level,
      exam_relevance_tier, typical_misconceptions, action_verb,
      learning_field:learning_fields!inner(id, title, code, curriculum_id)
    `)
    .eq("learning_fields.curriculum_id", curriculumId)
    .limit(100);

  if (!competencies?.length) throw new Error("No competencies found for curriculum");

  // Avoid repeats
  const { data: usedQuestions } = await sb
    .from("oral_exam_questions")
    .select("competency_id")
    .eq("session_id", sessionId);

  const usedCompIds = new Set((usedQuestions || []).map((q: any) => q.competency_id));
  const available = competencies.filter((c: any) => !usedCompIds.has(c.id));
  
  // Prefer high exam_relevance_tier competencies
  const pool = available.length > 0 ? available : competencies;
  const weighted = pool.sort((a: any, b: any) => {
    const tierA = parseInt(a.exam_relevance_tier) || 2;
    const tierB = parseInt(b.exam_relevance_tier) || 2;
    return tierA - tierB; // tier 1 = most relevant, pick first
  });
  
  // Pick from top tier with some randomness
  const topTier = weighted.filter((c: any) => (parseInt(c.exam_relevance_tier) || 2) <= 2);
  const candidates = topTier.length > 0 ? topTier : weighted;
  const competency = candidates[Math.floor(Math.random() * candidates.length)];

  // ── STEP 1: Try oral_exam_blueprints (richest source) ──
  const { data: oralBlueprints } = await sb
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, followup_chains, stress_config, scoring_weights, metadata")
    .eq("competency_id", competency.id)
    .eq("status", "approved")
    .limit(10);

  let questionText: string;
  let expectedPoints: string[] = [];
  let followUpQuestions: string[] = [];
  let blueprintId: string | null = null;
  let source: "oral_blueprint" | "question_blueprint" | "llm_fallback" = "oral_blueprint";
  let blueprintRubric: any = null;
  let blueprintFollowups: string[] = [];

  if (oralBlueprints?.length) {
    // ── Use oral_exam_blueprint ──
    const bp = oralBlueprints[Math.floor(Math.random() * oralBlueprints.length)];
    blueprintId = bp.id;
    blueprintRubric = bp.rubric;
    blueprintFollowups = bp.followups || [];

    // Use lead_questions from blueprint + LLM to contextualize
    const leadQ = bp.lead_questions || [];
    if (leadQ.length > 0) {
      // Pick a lead question and enhance with LLM context
      const selectedLead = leadQ[Math.floor(Math.random() * leadQ.length)];
      questionText = await enhanceLeadQuestion(selectedLead, competency, bp.scenario, professionName, mode);
    } else {
      // Generate from scenario
      questionText = await generateFromScenario(bp.scenario, competency, professionName, mode);
    }

    expectedPoints = extractExpectedPoints(bp.rubric);
    followUpQuestions = bp.followups?.slice(0, 2) || [];

    console.log(`[OralExam] ✅ oral_exam_blueprint for ${competency.code} (bp: ${bp.id.slice(0, 8)})`);
  } else {
    // ── STEP 2: Try question_blueprints (fallback) ──
    const { data: qBlueprints } = await sb
      .from("question_blueprints")
      .select(`
        id, question_template, question_type, difficulty,
        correct_answers:blueprint_correct_answers(answer_template),
        variables:blueprint_variables(variable_name, variable_type, allowed_values, range_min, range_max)
      `)
      .eq("competency_id", competency.id)
      .in("question_type", ["oral", "open_ended", "essay"])
      .eq("status", "approved")
      .limit(10);

    if (qBlueprints?.length) {
      source = "question_blueprint";
      const bp = qBlueprints[Math.floor(Math.random() * qBlueprints.length)];
      blueprintId = bp.id;
      questionText = renderTemplate(bp.question_template, bp.variables || []);
      expectedPoints = (bp.correct_answers || []).map((a: any) => a.answer_template);
      followUpQuestions = await generateFollowUps(competency, questionText, professionName);

      console.log(`[OralExam] ⚠️ question_blueprint fallback for ${competency.code} (bp: ${bp.id.slice(0, 8)})`);
    } else {
      // ── STEP 3: LLM fallback ──
      source = "llm_fallback";
      console.warn(`[OralExam] ❌ No blueprints for ${competency.code} – LLM fallback`);

      const llmResult = await generateQuestionViaLLM(competency, professionName, mode);
      questionText = llmResult.question;
      expectedPoints = llmResult.expected_points;
      followUpQuestions = llmResult.follow_up_questions;
    }
  }

  // Persist question
  const { data: question, error } = await sb
    .from("oral_exam_questions")
    .insert({
      session_id: sessionId,
      competency_id: competency.id,
      learning_field_id: competency.learning_field.id,
      blueprint_id: blueprintId,
      question_text: questionText,
      expected_answer_points: expectedPoints,
      follow_up_questions: followUpQuestions,
      order_index: orderIndex,
      time_limit_seconds: mode === "simulation" ? 120 : 180,
    })
    .select()
    .single();

  if (error) throw error;
  return question;
}

// ── Enhance lead question with LLM (keep SSOT, add profession context) ──
async function enhanceLeadQuestion(
  leadQuestion: string,
  competency: any,
  scenario: string | null,
  professionName: string,
  mode: string,
): Promise<string> {
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  try {
    const routed = getModel("oral_exam");
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(professionName, mode as any),
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Formuliere die folgende Prüfungsfrage für eine mündliche IHK-Prüfung um. Behalte den fachlichen Kern exakt bei, aber mache sie prüfungstypisch und berufsspezifisch.",
            lead_question: leadQuestion,
            scenario: scenario || null,
            competency: competency.title,
            bloom_level: competency.bloom_level,
            bloom_rule: bloomRule,
            profession: professionName,
            output_format: { question: "Die umformulierte Prüfungsfrage" },
          }),
        },
      ],
      max_tokens: 400,
    });

    const parsed = parseAIJSON(result.content);
    if (parsed?.question) return parsed.question;
  } catch (e) {
    console.warn("[OralExam] Lead question enhancement failed, using raw:", e);
  }

  // Fallback: use raw lead question
  return leadQuestion;
}

// ── Generate question from blueprint scenario ──────────────────
async function generateFromScenario(
  scenario: string,
  competency: any,
  professionName: string,
  mode: string,
): Promise<string> {
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  try {
    const routed = getModel("oral_exam");
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(professionName, mode as any),
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Erstelle aus dem Szenario eine präzise mündliche IHK-Prüfungsfrage.",
            scenario,
            competency: competency.title,
            bloom_level: competency.bloom_level,
            bloom_rule: bloomRule,
            profession: professionName,
            output_format: { question: "Die Prüfungsfrage basierend auf dem Szenario" },
          }),
        },
      ],
      max_tokens: 500,
    });

    const parsed = parseAIJSON(result.content);
    if (parsed?.question) return parsed.question;
  } catch (e) {
    console.warn("[OralExam] Scenario generation failed:", e);
  }

  return `Betrachten Sie folgendes Szenario: ${scenario?.slice(0, 200)}... Erläutern Sie als ${professionName}, wie Sie in dieser Situation vorgehen würden.`;
}

// ── Extract expected points from rubric ────────────────────────
function extractExpectedPoints(rubric: any): string[] {
  if (!rubric) return [];
  if (Array.isArray(rubric.criteria)) {
    return rubric.criteria.map((c: any) =>
      typeof c === "string" ? c : c.description || c.criterion || c.name || JSON.stringify(c)
    );
  }
  if (rubric.expected_points) return rubric.expected_points;
  return [];
}

// ── Template rendering (for question_blueprints fallback) ──────
function renderTemplate(template: string, variables: any[]): string {
  let rendered = template;
  for (const v of variables) {
    const placeholder = `{{${v.variable_name}}}`;
    let value: string;
    if (v.allowed_values?.length) {
      value = v.allowed_values[Math.floor(Math.random() * v.allowed_values.length)];
    } else if (v.variable_type === "number" && v.range_min !== null && v.range_max !== null) {
      const step = v.range_step || 1;
      const range = Math.floor((v.range_max - v.range_min) / step);
      value = String(v.range_min + Math.floor(Math.random() * (range + 1)) * step);
    } else {
      value = v.variable_name;
    }
    rendered = rendered.replaceAll(placeholder, value);
  }
  return rendered;
}

// ── Generate follow-ups ────────────────────────────────────────
async function generateFollowUps(competency: any, mainQuestion: string, professionName: string): Promise<string[]> {
  try {
    const routed = getModel("oral_exam");
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        {
          role: "system",
          content: `Du bist ein IHK-Prüfer für ${professionName}. Generiere 2 gezielte Nachfragen. Mindestens eine muss: eine typische Fehlvorstellung adressieren ODER eine Abgrenzung verlangen ODER einen Praxisbezug einfordern. NUR JSON-Array: ["Frage1", "Frage2"]`,
        },
        {
          role: "user",
          content: `Kompetenz: ${competency.title}\nBloom: ${competency.bloom_level || "apply"}\nHauptfrage: ${mainQuestion}`,
        },
      ],
      max_tokens: 300,
    });

    const parsed = parseAIJSON(result.content);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallback */ }

  return [
    `Können Sie das an einem konkreten Beispiel aus Ihrem Berufsalltag als ${professionName} erläutern?`,
    `Welche typischen Fehler werden dabei in der Praxis häufig gemacht?`,
  ];
}

// ── LLM Fallback Question Generation ───────────────────────────
async function generateQuestionViaLLM(
  competency: any,
  professionName: string,
  mode: string,
): Promise<{ question: string; expected_points: string[]; follow_up_questions: string[] }> {
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  try {
    const routed = getModel("oral_exam");
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(professionName, mode as any),
        },
        {
          role: "user",
          content: buildAskPrompt({
            competency: {
              title: competency.title,
              description: competency.description || competency.title,
              bloom_level: competency.bloom_level || "apply",
              exam_relevance_tier: competency.exam_relevance_tier || "2",
              typical_misconceptions: competency.typical_misconceptions || [],
            },
            blueprint: { question_type: "application", difficulty: "medium" },
            mastery_level: "partial",
            professionName,
          }),
        },
      ],
      max_tokens: 600,
    });

    const parsed = parseAIJSON(result.content);
    if (parsed?.question) {
      return {
        question: parsed.question,
        expected_points: parsed.expected_keywords || [],
        follow_up_questions: await generateFollowUps(competency, parsed.question, professionName),
      };
    }
  } catch (e) {
    console.error("[OralExam] LLM fallback error:", e);
  }

  return {
    question: `Erläutern Sie als ${professionName} die wesentlichen Aspekte von "${competency.title}" und beschreiben Sie einen konkreten Fall aus Ihrem Arbeitsalltag.`,
    expected_points: ["Fachliche Definition mit berufsspezifischen Begriffen", "Praktische Anwendung im Berufsalltag"],
    follow_up_questions: [`Welche typischen Fehler werden dabei in der Praxis gemacht?`],
  };
}

// ── Generate Question (action handler) ─────────────────────────
async function generateQuestion(sb: any, params: any) {
  const { session_id } = params;

  const { data: session } = await sb
    .from("oral_exam_sessions")
    .select("*, curriculum_id, mode")
    .eq("id", session_id)
    .single();

  if (!session) throw new Error("Session not found");

  const question = await generateQuestionForSession(
    sb, session_id, session.curriculum_id, session.current_question_index, session.mode,
  );

  return { question };
}

// ── Evaluate Answer (Elite Rubric) ─────────────────────────────
async function evaluateAnswer(sb: any, params: any) {
  const { question_id, user_answer } = params;

  if (!user_answer?.trim()) throw new Error("Empty answer");

  const { data: question } = await sb
    .from("oral_exam_questions")
    .select("*")
    .eq("id", question_id)
    .single();

  if (!question) throw new Error("Question not found");

  // Load session for mode + curriculum
  const { data: session } = await sb
    .from("oral_exam_sessions")
    .select("curriculum_id, mode, current_question_index, total_questions")
    .eq("id", question.session_id)
    .single();

  if (!session) throw new Error("Session not found");

  const professionName = await loadProfessionName(sb, session.curriculum_id);

  // Load enriched competency if available
  let competency: any = { title: "", bloom_level: "apply" };
  if (question.competency_id) {
    try {
      competency = await loadEnrichedCompetency(sb, question.competency_id);
    } catch { /* use defaults */ }
  }

  // Load blueprint rubric if available
  let blueprintData: any = {};
  if (question.blueprint_id) {
    const { data: bp } = await sb
      .from("oral_exam_blueprints")
      .select("rubric, followups, scoring_weights")
      .eq("id", question.blueprint_id)
      .maybeSingle();
    if (bp) blueprintData = bp;
  }

  // Build evaluation prompt
  const routed = getModel("oral_exam");
  const result = await callAIJSON({
    provider: routed.provider,
    model: routed.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(professionName, session.mode || "practice"),
      },
      {
        role: "user",
        content: buildEvaluatePrompt({
          competency: {
            title: competency.title || "",
            bloom_level: competency.bloom_level || "apply",
          },
          question: question.question_text,
          learnerAnswer: user_answer,
          expectedPoints: question.expected_answer_points || [],
          blueprint: {
            rubric: blueprintData.rubric || null,
            expected_keywords: [],
          },
          professionName,
        }),
      },
    ],
    max_tokens: 1200,
  });

  let evaluation = parseAIJSON(result.content);

  if (!evaluation?.scores) {
    // Fallback evaluation
    evaluation = {
      scores: { fachlichkeit: 3, struktur: 3, begriffssicherheit: 3, praxisbezug: 3 },
      overall_score: 3,
      covered_points: [],
      missed_points: question.expected_answer_points || [],
      detected_errors: [],
      feedback: "Die automatische Bewertung konnte nicht vollständig durchgeführt werden.",
      strengths: [],
      improvements: ["Bitte versuchen Sie es erneut mit einer ausführlicheren Antwort."],
      sample_answer: "",
      follow_up_question: "",
      mastery_signal: "partial",
    };
  }

  // Normalize scores (handle both 1-5 scale and 0-1 scale from old prompts)
  const scores = evaluation.scores || evaluation;
  const fach = normalizeScore(scores.fachlichkeit ?? evaluation.fachlichkeit_score);
  const struk = normalizeScore(scores.struktur ?? evaluation.struktur_score);
  const begrif = normalizeScore(scores.begriffssicherheit ?? evaluation.begriffssicherheit_score);
  const praxis = normalizeScore(scores.praxisbezug ?? evaluation.praxisbezug_score);

  const overallWeighted =
    fach * EVAL_WEIGHTS.fachlichkeit +
    struk * EVAL_WEIGHTS.struktur +
    begrif * EVAL_WEIGHTS.begriffssicherheit +
    praxis * EVAL_WEIGHTS.praxisbezug;

  // Persist to DB (store as 0-1 for backwards compat)
  const { error } = await sb
    .from("oral_exam_questions")
    .update({
      user_answer,
      answer_submitted_at: new Date().toISOString(),
      fachlichkeit_score: fach / 5,
      struktur_score: struk / 5,
      begriffssicherheit_score: begrif / 5,
      praxisbezug_score: praxis / 5,
      covered_points: evaluation.covered_points || [],
      missed_points: evaluation.missed_points || [],
      ai_feedback: evaluation.feedback || "",
    })
    .eq("id", question_id);

  if (error) throw error;

  // Update session index
  await sb
    .from("oral_exam_sessions")
    .update({ current_question_index: (session.current_question_index || 0) + 1 })
    .eq("id", question.session_id);

  return {
    evaluation: {
      scores: { fachlichkeit: fach, struktur: struk, begriffssicherheit: begrif, praxisbezug: praxis },
      overall_score: overallWeighted,
      covered_points: evaluation.covered_points || [],
      missed_points: evaluation.missed_points || [],
      detected_errors: evaluation.detected_errors || [],
      feedback: evaluation.feedback || "",
      strengths: evaluation.strengths || [],
      improvements: evaluation.improvements || [],
      sample_answer: evaluation.sample_answer || "",
      follow_up_question: evaluation.follow_up_question || "",
      mastery_signal: deriveMasterySignal(overallWeighted),
    },
    is_last: (session.current_question_index || 0) + 1 >= session.total_questions,
  };
}

// ── Normalize score to 1-5 scale ───────────────────────────────
function normalizeScore(value: number | undefined): number {
  if (value === undefined || value === null) return 3;
  if (value <= 1) return Math.round(value * 5 * 10) / 10; // 0-1 → 1-5
  return Math.min(5, Math.max(1, Math.round(value * 10) / 10)); // already 1-5
}

// ── Derive mastery signal ──────────────────────────────────────
function deriveMasterySignal(overallScore: number): "not_mastered" | "partial" | "mastered" {
  if (overallScore >= 4.5) return "mastered";
  if (overallScore >= 3.0) return "partial";
  return "not_mastered";
}

// ── Finish Session ─────────────────────────────────────────────
async function finishSession(sb: any, params: any) {
  const { session_id } = params;

  const { data: questions } = await sb
    .from("oral_exam_questions")
    .select("*")
    .eq("session_id", session_id);

  if (!questions?.length) throw new Error("No questions found");

  const avgFach = questions.reduce((s: number, q: any) => s + (q.fachlichkeit_score || 0), 0) / questions.length;
  const avgStruk = questions.reduce((s: number, q: any) => s + (q.struktur_score || 0), 0) / questions.length;
  const avgBegrif = questions.reduce((s: number, q: any) => s + (q.begriffssicherheit_score || 0), 0) / questions.length;
  const avgPraxis = questions.reduce((s: number, q: any) => s + (q.praxisbezug_score || 0), 0) / questions.length;

  const overallScore = (
    avgFach * EVAL_WEIGHTS.fachlichkeit +
    avgStruk * EVAL_WEIGHTS.struktur +
    avgBegrif * EVAL_WEIGHTS.begriffssicherheit +
    avgPraxis * EVAL_WEIGHTS.praxisbezug
  ) * 100;

  const allStrengths = new Set<string>();
  const allWeaknesses = new Set<string>();
  questions.forEach((q: any) => {
    if (q.covered_points) q.covered_points.forEach((p: string) => allStrengths.add(p));
    if (q.missed_points) q.missed_points.forEach((p: string) => allWeaknesses.add(p));
  });

  const { data: session, error } = await sb
    .from("oral_exam_sessions")
    .update({
      finished_at: new Date().toISOString(),
      overall_score: overallScore,
      passed: overallScore >= 50,
      fachlichkeit_score: avgFach * 100,
      struktur_score: avgStruk * 100,
      begriffssicherheit_score: avgBegrif * 100,
      praxisbezug_score: avgPraxis * 100,
      strengths: Array.from(allStrengths).slice(0, 5),
      weaknesses: Array.from(allWeaknesses).slice(0, 5),
      improvement_suggestions: Array.from(allWeaknesses).slice(0, 3).map((w) => `Vertiefen Sie: ${w}`),
    })
    .eq("id", session_id)
    .select()
    .single();

  if (error) throw error;

  return {
    session,
    questions,
    summary: {
      overall_score: overallScore,
      passed: overallScore >= 50,
      mastery_signal: deriveMasterySignal(overallScore / 100 * 5),
      criteria: {
        fachlichkeit: avgFach * 100,
        struktur: avgStruk * 100,
        begriffssicherheit: avgBegrif * 100,
        praxisbezug: avgPraxis * 100,
      },
    },
  };
}
