import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * Oral-Exam – Elite IHK-Prüfer v2 (SSOT-konform, Blueprint-only)
 *
 * Fixes applied (Elite Review):
 *   1. Auth: User-Client (anon+jwt) for RLS, Admin-Client only for logging
 *   2. SSOT: NO llm_fallback → hard error NO_ORAL_BLUEPRINTS
 *   3. Deterministic: seeded selection via hash(session_id + order_index)
 *   4. Turn audit: every phase logged to oral_exam_turns
 *   5. Server-side scoring: overall_score computed in code, not by LLM
 *   6. Rate limit per action via check_rate_limit_oral RPC
 *   7. Idempotency per turn via idempotency_keys
 */

// ── Evaluation Weights ─────────────────────────────────────────
const EVAL_WEIGHTS = {
  fachlichkeit: 0.35,
  struktur: 0.20,
  begriffssicherheit: 0.25,
  praxisbezug: 0.20,
} as const;

// ── Rate Limit Configs per Action ──────────────────────────────
const RATE_LIMITS: Record<string, { window: number; max: number }> = {
  start_session: { window: 300, max: 5 },
  generate_question: { window: 60, max: 15 },
  evaluate_answer: { window: 60, max: 15 },
  finish_session: { window: 300, max: 5 },
};

// ── Bloom-Level Question Matrix ────────────────────────────────
const BLOOM_MATRIX: Record<string, string> = {
  remember: "Stelle eine Frage zu Definition/Abgrenzung oder Aufzählung. Keine generischen 'Erzählen Sie'-Sätze. Erwarte präzise Nennung von Fachbegriffen, Merkmalen oder Kriterien.",
  understand: "Stelle eine Frage zum Erklären (Warum/Folgen) oder Vergleich (A vs B). Die Antwort muss Ursache-Wirkung oder Gemeinsamkeiten/Unterschiede zeigen.",
  apply: "Stelle eine Frage mit konkretem Vorgehensschema oder Entscheidung im Fall. Erwarte Schritte + typische Fehler. Praxisszenario ist Pflicht.",
  analyze: "Stelle eine Frage zur Fehlerdiagnose, Ursachenanalyse oder Priorisierung. Der Prüfling muss zerlegen, diagnostizieren und Indikatoren nennen.",
  evaluate: "Stelle eine Frage zum Abwägen/Entscheiden mit Trade-offs und Risiko. Begründungspflicht. Zwei Optionen zur Bewertung anbieten.",
};

// ── IHK System Prompt ──────────────────────────────────────────
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

// ── Deterministic hash for seeded selection ─────────────────────
function deterministicIndex(seed: string, arrayLength: number): number {
  if (arrayLength <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const chr = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % arrayLength;
}

// ── Helpers ────────────────────────────────────────────────────
function json(data: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function parseAIJSON(content: string): any {
  try { return JSON.parse(content); } catch { /* continue */ }
  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
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

    // ── FIX 1: Auth via anon+jwt (RLS active) ──────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, origin, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // User client: RLS-scoped
    const sbUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client: only for logging/rate-limit RPCs (service_role-only functions)
    const sbAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await sbUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Invalid token" }, origin, 401);
    const userId = claimsData.claims.sub as string;

    // ── FIX 6: Rate limit per action ───────────────────────────
    const rlConfig = RATE_LIMITS[action] || { window: 60, max: 20 };
    const { data: rlResult } = await sbAdmin.rpc("check_rate_limit_oral", {
      p_user_id: userId,
      p_action_key: `oral-exam:${action}`,
      p_window_seconds: rlConfig.window,
      p_max_requests: rlConfig.max,
    });
    if (rlResult && !rlResult.ok) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded", retry_after_sec: rlResult.retry_after_sec }), {
        status: 429,
        headers: { ...getCorsHeaders(origin), "Content-Type": "application/json", "Retry-After": String(rlResult.retry_after_sec || 60) },
      });
    }

    // ── FIX 7: Idempotency check (via service-role RPC, stabilized {hit,response}) ───
    const idemKey = req.headers.get("x-idempotency-key");
    if (idemKey && idemKey.length >= 8) {
      const { data: idem } = await sbAdmin.rpc("get_idempotency_response", {
        p_user_id: userId,
        p_endpoint: "oral-exam",
        p_idem_key: idemKey,
      });
      if (idem?.hit === true && idem.response) {
        return json(idem.response, origin);
      }
    }

    let result: any;
    switch (action) {
      case "start_session":
        result = await startSession(sbUser, sbAdmin, userId, params);
        break;
      case "generate_question":
        result = await generateQuestion(sbUser, sbAdmin, userId, params);
        break;
      case "evaluate_answer":
        result = await evaluateAnswer(sbUser, sbAdmin, userId, params);
        break;
      case "finish_session":
        result = await finishSession(sbUser, sbAdmin, userId, params);
        break;
      default:
        return json({ error: `Unknown action: ${action}` }, origin, 400);
    }

    // Store idempotency response
    if (idemKey && idemKey.length >= 8) {
      try {
        await sbAdmin.rpc("set_idempotency_response", {
          p_user_id: userId,
          p_endpoint: "oral-exam",
          p_idem_key: idemKey,
          p_response: result,
        });
      } catch { /* tolerate failures */ }
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

// ── Load enriched competency ───────────────────────────────────
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

// ── Log Turn (audit trail via service-role RPC) ────────────────
async function logTurn(sbAdmin: any, params: {
  sessionId: string;
  questionId?: string;
  userId: string;
  phase: "ask" | "followup" | "evaluate" | "finish";
  role: "examiner" | "learner";
  payload: any;
  sourceBlueprintId?: string;
  renderedQuestion?: string;
  sourceBlueprintQuestion?: string;
  renderingModel?: string;
}) {
  try {
    await sbAdmin.rpc("log_oral_exam_turn", {
      p_session_id: params.sessionId,
      p_question_id: params.questionId || null,
      p_user_id: params.userId,
      p_phase: params.phase,
      p_role: params.role,
      p_payload: params.payload || {},
      p_source_blueprint_id: params.sourceBlueprintId || null,
      p_source_blueprint_question: params.sourceBlueprintQuestion || null,
      p_rendered_question: params.renderedQuestion || null,
      p_rendering_model: params.renderingModel || null,
    });
  } catch (e: any) { console.warn("[OralExam] Turn log failed:", e); }
}

// ── Start Session ──────────────────────────────────────────────
async function startSession(sbUser: any, sbAdmin: any, userId: string, params: any) {
  const { curriculum_id, mode = "practice", total_questions = 5 } = params;

  const { data: session, error } = await sbUser
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

  const firstQuestion = await generateQuestionForSession(sbUser, sbAdmin, userId, session.id, curriculum_id, 0, mode);

  await logTurn(sbAdmin, {
    sessionId: session.id,
    userId,
    phase: "ask",
    role: "examiner",
    payload: { question: firstQuestion.question_text, blueprint_id: firstQuestion.blueprint_id },
    sourceBlueprintId: firstQuestion.blueprint_id,
    renderedQuestion: firstQuestion.question_text,
    sourceBlueprintQuestion: firstQuestion.source_blueprint_question || null,
    renderingModel: firstQuestion.rendering_model || null,
  });

  return { session, firstQuestion };
}

// ── Generate Question (Blueprint-only, deterministic) ──────────
async function generateQuestionForSession(
  sbUser: any,
  sbAdmin: any,
  userId: string,
  sessionId: string,
  curriculumId: string,
  orderIndex: number,
  mode: "practice" | "simulation" = "practice",
) {
  const professionName = await loadProfessionName(sbAdmin, curriculumId);

  // Load competencies
  const { data: competencies } = await sbUser
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
  const { data: usedQuestions } = await sbUser
    .from("oral_exam_questions")
    .select("competency_id")
    .eq("session_id", sessionId);

  const usedCompIds = new Set((usedQuestions || []).map((q: any) => q.competency_id));
  const available = competencies.filter((c: any) => !usedCompIds.has(c.id));

  // ── FIX 3: Deterministic selection (no Math.random) ──────────
  const pool = available.length > 0 ? available : competencies;

  // Sort by exam_relevance_tier ASC (tier 1 = most relevant first), then by code
  const sorted = pool.sort((a: any, b: any) => {
    const tierA = parseInt(a.exam_relevance_tier) || 2;
    const tierB = parseInt(b.exam_relevance_tier) || 2;
    if (tierA !== tierB) return tierA - tierB;
    return (a.code || "").localeCompare(b.code || "");
  });

  // Deterministic pick from top-tier candidates
  const topTier = sorted.filter((c: any) => (parseInt(c.exam_relevance_tier) || 2) <= 2);
  const candidates = topTier.length > 0 ? topTier : sorted;
  const pickIndex = deterministicIndex(`${sessionId}:${orderIndex}`, candidates.length);
  const competency = candidates[pickIndex];

  // ── FIX 2: SSOT – oral_exam_blueprints ONLY ─────────────────
  const { data: oralBlueprints } = await sbUser
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, metadata")
    .eq("competency_id", competency.id)
    .eq("status", "approved")
    .limit(10);

  if (!oralBlueprints?.length) {
    // ── HARD ERROR: No LLM fallback ────────────────────────────
    console.error(`[OralExam] NO_ORAL_BLUEPRINTS for competency ${competency.id} (${competency.code})`);
    throw new Error(JSON.stringify({
      error: "NO_ORAL_BLUEPRINTS",
      message: `Keine genehmigten Oral-Blueprints für Kompetenz "${competency.title}" (${competency.code}). Bitte oral_exam_blueprints generieren.`,
      competency_id: competency.id,
      competency_code: competency.code,
    }));
  }

  // Deterministic blueprint selection
  const bpIndex = deterministicIndex(`${sessionId}:bp:${orderIndex}`, oralBlueprints.length);
  const bp = oralBlueprints[bpIndex];
  const blueprintRubric = bp.rubric;
  const blueprintFollowups = bp.followups || [];

  // Pick lead question deterministically
  const leadQ = bp.lead_questions || [];
  let questionText: string;
  let sourceBlueprintQuestion: string | null = null;
  let renderingModel: string | null = null;

  if (leadQ.length > 0) {
    const leadIdx = deterministicIndex(`${sessionId}:lead:${orderIndex}`, leadQ.length);
    const selectedLead = leadQ[leadIdx];
    sourceBlueprintQuestion = selectedLead;

    // Enhance lead question (rendering only – SSOT stays unchanged)
    const enhanced = await enhanceLeadQuestion(selectedLead, competency, bp.scenario, professionName, mode);
    questionText = enhanced.question;
    renderingModel = enhanced.model;
  } else {
    // Generate from scenario
    const generated = await generateFromScenario(bp.scenario, competency, professionName, mode);
    questionText = generated.question;
    sourceBlueprintQuestion = bp.scenario?.slice(0, 200) || null;
    renderingModel = generated.model;
  }

  const expectedPoints = extractExpectedPoints(blueprintRubric);
  const followUpQuestions = blueprintFollowups.slice(0, 3);

  console.log(`[OralExam] ✅ blueprint ${bp.id.slice(0, 8)} for ${competency.code} (deterministic idx=${pickIndex}/${bpIndex})`);

  // Persist question
  const { data: question, error } = await sbUser
    .from("oral_exam_questions")
    .insert({
      session_id: sessionId,
      competency_id: competency.id,
      learning_field_id: competency.learning_field.id,
      blueprint_id: bp.id,
      question_text: questionText,
      expected_answer_points: expectedPoints,
      follow_up_questions: followUpQuestions,
      order_index: orderIndex,
      time_limit_seconds: mode === "simulation" ? 120 : 180,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    ...question,
    source_blueprint_question: sourceBlueprintQuestion,
    rendering_model: renderingModel,
  };
}

// ── Enhance lead question (rendering, not mutation) ────────────
async function enhanceLeadQuestion(
  leadQuestion: string,
  competency: any,
  scenario: string | null,
  professionName: string,
  mode: string,
): Promise<{ question: string; model: string | null }> {
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  try {
    const chain = await getModelChainAsync("oral_exam");
    const result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: buildSystemPrompt(professionName, mode as any) },
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
      },
    );

    const parsed = parseAIJSON(result.content);
    if (parsed?.question) return { question: parsed.question, model: chain[0]?.model || null };
  } catch (e) {
    console.warn("[OralExam] Lead question enhancement failed, using raw:", e);
  }

  return { question: leadQuestion, model: null };
}

// ── Generate question from scenario ────────────────────────────
async function generateFromScenario(
  scenario: string,
  competency: any,
  professionName: string,
  mode: string,
): Promise<{ question: string; model: string | null }> {
  const bloomRule = BLOOM_MATRIX[competency.bloom_level] || BLOOM_MATRIX.apply;

  try {
    const chain2 = await getModelChainAsync("oral_exam");
    const result = await callAIWithFailover(
      chain2.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: buildSystemPrompt(professionName, mode as any) },
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
      },
    );

    const parsed = parseAIJSON(result.content);
    if (parsed?.question) return { question: parsed.question, model: chain2[0]?.model || null };
  } catch (e) {
    console.warn("[OralExam] Scenario generation failed:", e);
  }

  return {
    question: `Betrachten Sie folgendes Szenario: ${scenario?.slice(0, 200)}... Erläutern Sie als ${professionName}, wie Sie in dieser Situation vorgehen würden.`,
    model: null,
  };
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

// ── Generate Question (action handler) ─────────────────────────
async function generateQuestion(sbUser: any, sbAdmin: any, userId: string, params: any) {
  const { session_id } = params;

  const { data: session } = await sbUser
    .from("oral_exam_sessions")
    .select("*, curriculum_id, mode")
    .eq("id", session_id)
    .single();

  if (!session) throw new Error("Session not found");

  const question = await generateQuestionForSession(
    sbUser, sbAdmin, userId, session_id, session.curriculum_id, session.current_question_index, session.mode,
  );

  // ── FIX 4: Log turn ─────────────────────────────────────────
  await logTurn(sbAdmin, {
    sessionId: session_id,
    questionId: question.id,
    userId,
    phase: "ask",
    role: "examiner",
    payload: { question: question.question_text, blueprint_id: question.blueprint_id },
    sourceBlueprintId: question.blueprint_id,
    renderedQuestion: question.question_text,
    sourceBlueprintQuestion: question.source_blueprint_question || null,
    renderingModel: question.rendering_model || null,
  });

  return { question };
}

// ── Evaluate Answer (Elite Rubric + Server-side Scoring) ───────
async function evaluateAnswer(sbUser: any, sbAdmin: any, userId: string, params: any) {
  const { question_id, user_answer } = params;

  if (!user_answer?.trim()) throw new Error("Empty answer");

  const { data: question } = await sbUser
    .from("oral_exam_questions")
    .select("*")
    .eq("id", question_id)
    .single();

  if (!question) throw new Error("Question not found");

  // Log learner turn
  await logTurn(sbAdmin, {
    sessionId: question.session_id,
    questionId: question_id,
    userId,
    phase: "evaluate",
    role: "learner",
    payload: { answer: user_answer.slice(0, 5000) },
  });

  // Load session
  const { data: session } = await sbUser
    .from("oral_exam_sessions")
    .select("curriculum_id, mode, current_question_index, total_questions")
    .eq("id", question.session_id)
    .single();

  if (!session) throw new Error("Session not found");

  const professionName = await loadProfessionName(sbAdmin, session.curriculum_id);

  let competency: any = { title: "", bloom_level: "apply" };
  if (question.competency_id) {
    try {
      competency = await loadEnrichedCompetency(sbAdmin, question.competency_id);
    } catch { /* use defaults */ }
  }

  // Load blueprint rubric
  let blueprintData: any = {};
  if (question.blueprint_id) {
    const { data: bp } = await sbAdmin
      .from("oral_exam_blueprints")
      .select("rubric, followups, scoring_weights")
      .eq("id", question.blueprint_id)
      .maybeSingle();
    if (bp) blueprintData = bp;
  }

  // LLM evaluation
  const evalChain = await getModelChainAsync("oral_exam");
  const result = await callAIWithFailover(
    evalChain.map(c => ({ provider: c.provider, model: c.model })),
    {
      messages: [
        { role: "system", content: buildSystemPrompt(professionName, session.mode || "practice") },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Bewerte die mündliche Prüfungsantwort als IHK-Prüfer.",
            rules: [
              "Bewerte NUR anhand der übergebenen expected_points und rubric.",
              "Jede Bewertungsdimension 1-5 Punkte (1=mangelhaft, 5=sehr gut).",
              "Liefere NUR die Einzelscores – der Server berechnet overall_score.",
              "Stärken und Schwächen müssen konkret und berufsspezifisch sein.",
              "Musterantwort max 180-220 Wörter.",
            ],
            context: {
              profession: professionName,
              competency: competency.title,
              bloom_level: competency.bloom_level,
              question: question.question_text,
              learner_answer: user_answer,
              expected_points: question.expected_answer_points || [],
              rubric: blueprintData.rubric || null,
            },
            output_schema: {
              scores: { fachlichkeit: "1-5", struktur: "1-5", begriffssicherheit: "1-5", praxisbezug: "1-5" },
              covered_points: [], missed_points: [], detected_errors: [],
              feedback: "", strengths: [], improvements: [],
              sample_answer: "", follow_up_question: "",
            },
          }),
        },
      ],
      max_tokens: 1200,
    },
  );

  let evaluation = parseAIJSON(result.content);

  if (!evaluation?.scores) {
    evaluation = {
      scores: { fachlichkeit: 3, struktur: 3, begriffssicherheit: 3, praxisbezug: 3 },
      covered_points: [],
      missed_points: question.expected_answer_points || [],
      detected_errors: [],
      feedback: "Die automatische Bewertung konnte nicht vollständig durchgeführt werden.",
      strengths: [],
      improvements: ["Bitte versuchen Sie es erneut mit einer ausführlicheren Antwort."],
      sample_answer: "",
      follow_up_question: "",
    };
  }

  // ── FIX 5: Server-side scoring (LLM provides raw scores, server computes overall) ──
  const scores = evaluation.scores || {};
  const fach = clampScore(scores.fachlichkeit);
  const struk = clampScore(scores.struktur);
  const begrif = clampScore(scores.begriffssicherheit);
  const praxis = clampScore(scores.praxisbezug);

  const overallWeighted =
    fach * EVAL_WEIGHTS.fachlichkeit +
    struk * EVAL_WEIGHTS.struktur +
    begrif * EVAL_WEIGHTS.begriffssicherheit +
    praxis * EVAL_WEIGHTS.praxisbezug;

  const masterySignal = deriveMasterySignal(overallWeighted);

  // Persist to DB (0-1 scale for backwards compat)
  const { error } = await sbUser
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
  await sbUser
    .from("oral_exam_sessions")
    .update({ current_question_index: (session.current_question_index || 0) + 1 })
    .eq("id", question.session_id);

  const evaluationResult = {
    scores: { fachlichkeit: fach, struktur: struk, begriffssicherheit: begrif, praxisbezug: praxis },
    overall_score: Math.round(overallWeighted * 100) / 100,
    covered_points: evaluation.covered_points || [],
    missed_points: evaluation.missed_points || [],
    detected_errors: evaluation.detected_errors || [],
    feedback: evaluation.feedback || "",
    strengths: evaluation.strengths || [],
    improvements: evaluation.improvements || [],
    sample_answer: evaluation.sample_answer || "",
    follow_up_question: evaluation.follow_up_question || "",
    mastery_signal: masterySignal,
  };

  // Log examiner evaluation turn
  await logTurn(sbAdmin, {
    sessionId: question.session_id,
    questionId: question_id,
    userId,
    phase: "evaluate",
    role: "examiner",
    payload: evaluationResult,
    renderingModel: routed.model,
  });

  return {
    evaluation: evaluationResult,
    is_last: (session.current_question_index || 0) + 1 >= session.total_questions,
  };
}

// ── Clamp score to 1-5 integer scale ───────────────────────────
function clampScore(value: number | undefined): number {
  if (value === undefined || value === null) return 3;
  const n = Number(value);
  if (isNaN(n)) return 3;
  // Handle 0-1 scale from old prompts
  if (n > 0 && n <= 1) return Math.round(n * 5);
  return Math.min(5, Math.max(1, Math.round(n)));
}

// ── Derive mastery signal ──────────────────────────────────────
function deriveMasterySignal(overallScore: number): "not_mastered" | "partial" | "mastered" {
  if (overallScore >= 4.5) return "mastered";
  if (overallScore >= 3.0) return "partial";
  return "not_mastered";
}

// ── Finish Session ─────────────────────────────────────────────
async function finishSession(sbUser: any, sbAdmin: any, userId: string, params: any) {
  const { session_id } = params;

  const { data: questions } = await sbUser
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

  const { data: session, error } = await sbUser
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

  // Log finish turn
  await logTurn(sbAdmin, {
    sessionId: session_id,
    userId,
    phase: "finish",
    role: "examiner",
    payload: { overall_score: overallScore, passed: overallScore >= 50, questions_count: questions.length },
  });

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
