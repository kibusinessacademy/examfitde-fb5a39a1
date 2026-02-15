import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Oral-Exam – Blueprint-basiert (SSOT-konform)
 * 
 * Fragen werden NICHT frei per LLM generiert, sondern aus
 * question_blueprints mit question_type='oral' abgeleitet.
 * Nur wenn keine Blueprints existieren → LLM-Fallback mit Logging.
 */

const EVALUATION_CRITERIA = {
  fachlichkeit: { name: "Fachlichkeit", weight: 0.35 },
  struktur: { name: "Struktur", weight: 0.20 },
  begriffssicherheit: { name: "Begriffssicherheit", weight: 0.25 },
  praxisbezug: { name: "Praxisbezug", weight: 0.20 }
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { action, ...params } = await req.json();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;

    switch (action) {
      case 'start_session':
        result = await startSession(supabase, user.id, params);
        break;
      case 'generate_question':
        result = await generateQuestion(supabase, params);
        break;
      case 'evaluate_answer':
        result = await evaluateAnswer(supabase, params);
        break;
      case 'finish_session':
        result = await finishSession(supabase, params);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Oral exam error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } }
    );
  }
});

/**
 * Load profession name from curriculum → berufe (reusable helper)
 */
async function loadProfessionName(supabase: any, curriculumId: string): Promise<string> {
  let professionName = "Auszubildende";
  try {
    const { data: curriculum } = await supabase
      .from("curricula")
      .select("title, beruf_id")
      .eq("id", curriculumId)
      .maybeSingle();
    if (curriculum?.beruf_id) {
      const { data: beruf } = await supabase
        .from("berufe")
        .select("bezeichnung_kurz, bezeichnung_lang")
        .eq("id", curriculum.beruf_id)
        .maybeSingle();
      if (beruf) professionName = beruf.bezeichnung_kurz || beruf.bezeichnung_lang || professionName;
    } else if (curriculum?.title) {
      const match = curriculum.title.replace(/^Rahmenlehrplan\s+/i, "").trim();
      if (match) professionName = match;
    }
  } catch (e) {
    console.error("[OralExam] Profession load failed:", e);
  }
  return professionName;
}

async function startSession(supabase: any, userId: string, params: any) {
  const { curriculum_id, blueprint_id, mode = 'practice', total_questions = 5 } = params;

  const { data: session, error } = await supabase
    .from('oral_exam_sessions')
    .insert({
      user_id: userId,
      curriculum_id,
      blueprint_id,
      mode,
      total_questions,
      time_limit_minutes: mode === 'simulation' ? 30 : null
    })
    .select()
    .single();

  if (error) throw error;

  const firstQuestion = await generateQuestionForSession(supabase, session.id, curriculum_id, 0);

  return { session, firstQuestion };
}

/**
 * Blueprint-based question generation (SSOT)
 */
async function generateQuestionForSession(
  supabase: any, 
  sessionId: string, 
  curriculumId: string, 
  orderIndex: number
) {
  const professionName = await loadProfessionName(supabase, curriculumId);

  // Load competencies for this curriculum
  const { data: competencies } = await supabase
    .from('competencies')
    .select(`
      id, title, code,
      learning_field:learning_fields!inner(
        id, title, code, curriculum_id
      )
    `)
    .eq('learning_fields.curriculum_id', curriculumId)
    .limit(50);

  if (!competencies?.length) {
    throw new Error('No competencies found for curriculum');
  }

  // Get already used competencies in this session to avoid repeats
  const { data: usedQuestions } = await supabase
    .from('oral_exam_questions')
    .select('competency_id')
    .eq('session_id', sessionId);

  const usedCompIds = new Set((usedQuestions || []).map((q: any) => q.competency_id));
  const availableComps = competencies.filter((c: any) => !usedCompIds.has(c.id));
  const targetComps = availableComps.length > 0 ? availableComps : competencies;

  // Pick a competency (weighted random, preferring unused)
  const competency = targetComps[Math.floor(Math.random() * targetComps.length)];

  // ── STEP 1: Try blueprint-based question ──
  const { data: blueprints } = await supabase
    .from('question_blueprints')
    .select(`
      id, question_template, question_type, difficulty,
      correct_answers:blueprint_correct_answers(answer_template),
      variables:blueprint_variables(variable_name, variable_type, allowed_values, range_min, range_max)
    `)
    .eq('competency_id', competency.id)
    .in('question_type', ['oral', 'open_ended', 'essay'])
    .eq('status', 'approved')
    .limit(10);

  let questionText: string;
  let expectedPoints: string[];
  let followUpQuestions: string[];
  let blueprintId: string | null = null;
  let source: 'blueprint' | 'llm_fallback' = 'blueprint';

  if (blueprints?.length) {
    const bp = blueprints[Math.floor(Math.random() * blueprints.length)];
    blueprintId = bp.id;

    questionText = renderTemplate(bp.question_template, bp.variables || []);
    expectedPoints = (bp.correct_answers || []).map((a: any) => a.answer_template);
    followUpQuestions = await generateFollowUps(competency, questionText, professionName);
    
    console.log(`[OralExam] Blueprint-derived question for ${competency.code} (blueprint: ${bp.id})`);
  } else {
    source = 'llm_fallback';
    console.warn(`[OralExam] ⚠️ No oral blueprints for competency ${competency.code} – using LLM fallback`);

    const llmResult = await generateQuestionViaLLM(competency, professionName);
    questionText = llmResult.question;
    expectedPoints = llmResult.expected_points;
    followUpQuestions = llmResult.follow_up_questions;
  }

  const { data: question, error } = await supabase
    .from('oral_exam_questions')
    .insert({
      session_id: sessionId,
      competency_id: competency.id,
      learning_field_id: competency.learning_field.id,
      question_text: questionText,
      expected_answer_points: expectedPoints,
      follow_up_questions: followUpQuestions,
      order_index: orderIndex,
      ...(blueprintId ? { metadata: { blueprint_id: blueprintId, source, profession: professionName } } : { metadata: { source, profession: professionName } }),
    })
    .select()
    .single();

  if (error) throw error;
  return question;
}

function renderTemplate(template: string, variables: any[]): string {
  let rendered = template;
  for (const v of variables) {
    const placeholder = `{{${v.variable_name}}}`;
    let value: string;

    if (v.allowed_values?.length) {
      value = v.allowed_values[Math.floor(Math.random() * v.allowed_values.length)];
    } else if (v.variable_type === 'number' && v.range_min !== null && v.range_max !== null) {
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

/**
 * Generate follow-up questions with profession context
 */
async function generateFollowUps(competency: any, mainQuestion: string, professionName: string): Promise<string[]> {
  try {
    const result = await callAIJSON({
      provider: "deepseek",
      messages: [
        { role: "system", content: `Du bist ein erfahrener IHK-Prüfer für ${professionName}. Generiere 2 präzise Nachfragen, die ein echter Prüfer im Fachgespräch stellen würde. Die Nachfragen müssen fachlich tief und berufsspezifisch für ${professionName} sein. NUR JSON-Array: ["Frage1", "Frage2"]` },
        { role: "user", content: `Beruf: ${professionName}\nKompetenz: ${competency.title}\nHauptfrage: ${mainQuestion}` }
      ],
      max_tokens: 300,
    });

    const match = result.content.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch { /* ignore */ }
  return [
    `Können Sie ein konkretes Beispiel aus Ihrem Arbeitsalltag als ${professionName} nennen?`,
    `Wie würden Sie als ${professionName} das in der Praxis umsetzen?`
  ];
}

/**
 * LLM Fallback for question generation (when no blueprints exist)
 */
async function generateQuestionViaLLM(competency: any, professionName: string): Promise<{
  question: string;
  expected_points: string[];
  follow_up_questions: string[];
}> {
  const prompt = `Du bist ein erfahrener IHK-Prüfer, der das Fachgespräch in der Abschlussprüfung für ${professionName} führt. Du kennst den Berufsalltag von ${professionName} genau und stellst Fragen, die nur jemand beantworten kann, der diesen Beruf wirklich gelernt hat.

Generiere eine mündliche Prüfungsfrage:
Beruf: ${professionName}
Lernfeld: ${competency.learning_field.title}
Kompetenz: ${competency.title}

ANFORDERUNGEN an die Frage:
- Offen formuliert (keine Multiple Choice)
- Konkreter Praxisbezug zum täglichen Arbeitsalltag von ${professionName} — mit realistischem Szenario
- In 2-3 Minuten beantwortbar
- IHK-Prüfungsniveau: So wie ein echter Prüfer sie formulieren würde
- Berufsspezifische Fachbegriffe und Arbeitsprozesse von ${professionName} verwenden
- Die Frage darf NICHT generisch auf andere Berufe übertragbar sein

ANFORDERUNGEN an die erwarteten Antwortpunkte:
- Konkrete Fachbegriffe und Arbeitsprozesse, die ${professionName} kennen müssen
- Bezug zu realen Werkzeugen, Software, Materialien oder Vorschriften im Beruf

Antworte NUR im folgenden JSON-Format:
{
  "question": "Die Prüfungsfrage...",
  "expected_points": ["Punkt 1", "Punkt 2", "Punkt 3"],
  "follow_up_questions": ["Nachfrage 1", "Nachfrage 2"]
}`;

  try {
    const result = await callAIJSON({
      provider: "openai",
      messages: [
        { role: "system", content: `Du bist ein erfahrener IHK-Prüfer für den Beruf ${professionName}. Du führst das Fachgespräch in der Abschlussprüfung. Antworte ausschließlich im angeforderten JSON-Format.` },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000,
    });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[OralExam] LLM fallback error:", e);
  }

  return {
    question: `Erläutern Sie als ${professionName} die wesentlichen Aspekte von "${competency.title}" und beschreiben Sie einen konkreten Fall aus Ihrem Arbeitsalltag.`,
    expected_points: ["Fachliche Definition mit berufsspezifischen Begriffen", "Praktische Anwendung im Berufsalltag", "Relevanz für die tägliche Arbeit"],
    follow_up_questions: [`Können Sie ein konkretes Beispiel aus Ihrem Arbeitsalltag als ${professionName} nennen?`]
  };
}

async function generateQuestion(supabase: any, params: any) {
  const { session_id } = params;

  const { data: session } = await supabase
    .from('oral_exam_sessions')
    .select('*, curriculum_id')
    .eq('id', session_id)
    .single();

  if (!session) throw new Error('Session not found');

  const question = await generateQuestionForSession(
    supabase, session_id, session.curriculum_id, session.current_question_index
  );

  return { question };
}

async function evaluateAnswer(supabase: any, params: any) {
  const { question_id, user_answer } = params;

  const { data: question } = await supabase
    .from('oral_exam_questions')
    .select(`
      *,
      competency:competencies(title, code),
      learning_field:learning_fields(title, code)
    `)
    .eq('id', question_id)
    .single();

  if (!question) throw new Error('Question not found');

  // Load profession name for evaluation context
  const { data: session } = await supabase
    .from('oral_exam_sessions')
    .select('curriculum_id')
    .eq('id', question.session_id)
    .single();

  const professionName = session?.curriculum_id
    ? await loadProfessionName(supabase, session.curriculum_id)
    : "Auszubildende";

  const evaluationPrompt = `Du bist ein erfahrener IHK-Prüfer für ${professionName} und bewertest eine mündliche Prüfungsantwort im Fachgespräch der Abschlussprüfung.

BERUF: ${professionName}
KOMPETENZ: ${question.competency?.title || ""}

FRAGE: ${question.question_text}

ERWARTETE KERNPUNKTE:
${question.expected_answer_points?.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n') || 'Keine spezifischen Punkte definiert'}

ANTWORT DES PRÜFLINGS:
${user_answer}

Bewerte die Antwort nach IHK-Kriterien für ${professionName} (0.0 bis 1.0):
1. Fachlichkeit (35%): Fachliche Korrektheit und Vollständigkeit — kennt der Prüfling die berufsspezifischen Zusammenhänge?
2. Struktur (20%): Logischer Aufbau der Antwort — argumentiert der Prüfling nachvollziehbar?
3. Begriffssicherheit (25%): Korrekter Einsatz der Fachbegriffe, die ${professionName} beherrschen müssen
4. Praxisbezug (20%): Konkrete Beispiele aus dem Berufsalltag von ${professionName}

BEWERTUNGSSTIL: Bewerte wie ein wohlwollender aber anspruchsvoller IHK-Prüfer. Gib konstruktives Feedback, das dem Prüfling hilft, sich zu verbessern.

Antworte NUR im folgenden JSON-Format:
{
  "fachlichkeit_score": 0.8,
  "struktur_score": 0.7,
  "begriffssicherheit_score": 0.75,
  "praxisbezug_score": 0.6,
  "covered_points": ["Punkt 1", "Punkt 3"],
  "missed_points": ["Punkt 2"],
  "feedback": "Detailliertes Feedback mit Bezug zu ${professionName}...",
  "strengths": ["Stärke 1"],
  "improvements": ["Konkreter Verbesserungsvorschlag für ${professionName}"],
  "sample_answer": "Eine optimale Musterantwort, wie sie ein/e ${professionName} geben sollte...",
  "follow_up_question": "Eine mögliche Nachfrage des Prüfers..."
}`;

  const result = await callAIJSON({
    provider: "openai",
    messages: [
      { role: "system", content: `Du bist ein erfahrener IHK-Prüfer für den Beruf ${professionName}. Du bewertest fair aber anspruchsvoll, immer mit Bezug zum konkreten Berufsalltag. Antworte nur im JSON-Format.` },
      { role: "user", content: evaluationPrompt }
    ],
    max_tokens: 1200,
  });

  const responseText = result.content;
  
  let evaluation;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      evaluation = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found');
    }
  } catch {
    evaluation = {
      fachlichkeit_score: 0.5, struktur_score: 0.5,
      begriffssicherheit_score: 0.5, praxisbezug_score: 0.5,
      covered_points: [], missed_points: question.expected_answer_points || [],
      feedback: "Die Bewertung konnte nicht automatisch durchgeführt werden.",
      strengths: [], improvements: ["Bitte versuche es erneut."],
      sample_answer: "", follow_up_question: ""
    };
  }

  const { error } = await supabase
    .from('oral_exam_questions')
    .update({
      user_answer,
      answer_submitted_at: new Date().toISOString(),
      fachlichkeit_score: evaluation.fachlichkeit_score,
      struktur_score: evaluation.struktur_score,
      begriffssicherheit_score: evaluation.begriffssicherheit_score,
      praxisbezug_score: evaluation.praxisbezug_score,
      covered_points: evaluation.covered_points,
      missed_points: evaluation.missed_points,
      ai_feedback: evaluation.feedback
    })
    .eq('id', question_id);

  if (error) throw error;

  const { data: sessionData } = await supabase
    .from('oral_exam_sessions')
    .select('current_question_index, total_questions')
    .eq('id', question.session_id)
    .single();

  if (sessionData) {
    await supabase
      .from('oral_exam_sessions')
      .update({ current_question_index: sessionData.current_question_index + 1 })
      .eq('id', question.session_id);
  }

  return { 
    evaluation: {
      ...evaluation,
      overall_score: (
        evaluation.fachlichkeit_score * EVALUATION_CRITERIA.fachlichkeit.weight +
        evaluation.struktur_score * EVALUATION_CRITERIA.struktur.weight +
        evaluation.begriffssicherheit_score * EVALUATION_CRITERIA.begriffssicherheit.weight +
        evaluation.praxisbezug_score * EVALUATION_CRITERIA.praxisbezug.weight
      )
    },
    is_last: sessionData ? sessionData.current_question_index + 1 >= sessionData.total_questions : false
  };
}

async function finishSession(supabase: any, params: any) {
  const { session_id } = params;

  const { data: questions } = await supabase
    .from('oral_exam_questions')
    .select('*')
    .eq('session_id', session_id);

  if (!questions?.length) throw new Error('No questions found');

  const avgFachlichkeit = questions.reduce((sum: number, q: any) => sum + (q.fachlichkeit_score || 0), 0) / questions.length;
  const avgStruktur = questions.reduce((sum: number, q: any) => sum + (q.struktur_score || 0), 0) / questions.length;
  const avgBegriffe = questions.reduce((sum: number, q: any) => sum + (q.begriffssicherheit_score || 0), 0) / questions.length;
  const avgPraxis = questions.reduce((sum: number, q: any) => sum + (q.praxisbezug_score || 0), 0) / questions.length;

  const overallScore = (
    avgFachlichkeit * EVALUATION_CRITERIA.fachlichkeit.weight +
    avgStruktur * EVALUATION_CRITERIA.struktur.weight +
    avgBegriffe * EVALUATION_CRITERIA.begriffssicherheit.weight +
    avgPraxis * EVALUATION_CRITERIA.praxisbezug.weight
  ) * 100;

  const allStrengths = new Set<string>();
  const allWeaknesses = new Set<string>();
  
  questions.forEach((q: any) => {
    if (q.covered_points) q.covered_points.forEach((p: string) => allStrengths.add(p));
    if (q.missed_points) q.missed_points.forEach((p: string) => allWeaknesses.add(p));
  });

  const { data: session, error } = await supabase
    .from('oral_exam_sessions')
    .update({
      finished_at: new Date().toISOString(),
      overall_score: overallScore,
      passed: overallScore >= 50,
      fachlichkeit_score: avgFachlichkeit * 100,
      struktur_score: avgStruktur * 100,
      begriffssicherheit_score: avgBegriffe * 100,
      praxisbezug_score: avgPraxis * 100,
      strengths: Array.from(allStrengths).slice(0, 5),
      weaknesses: Array.from(allWeaknesses).slice(0, 5),
      improvement_suggestions: Array.from(allWeaknesses).slice(0, 3).map(w => `Vertiefen Sie: ${w}`)
    })
    .eq('id', session_id)
    .select()
    .single();

  if (error) throw error;

  return { 
    session,
    questions,
    summary: {
      overall_score: overallScore,
      passed: overallScore >= 50,
      criteria: {
        fachlichkeit: avgFachlichkeit * 100,
        struktur: avgStruktur * 100,
        begriffssicherheit: avgBegriffe * 100,
        praxisbezug: avgPraxis * 100
      }
    }
  };
}