import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// IHK-konforme Bewertungskriterien
const EVALUATION_CRITERIA = {
  fachlichkeit: {
    name: "Fachlichkeit",
    weight: 0.35,
    description: "Korrektheit und Vollständigkeit der fachlichen Inhalte"
  },
  struktur: {
    name: "Struktur",
    weight: 0.20,
    description: "Logischer Aufbau und Gliederung der Antwort"
  },
  begriffssicherheit: {
    name: "Begriffssicherheit",
    weight: 0.25,
    description: "Korrekter Einsatz von Fachbegriffen"
  },
  praxisbezug: {
    name: "Praxisbezug",
    weight: 0.20,
    description: "Bezug zur beruflichen Praxis und Anwendungsbeispiele"
  }
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { action, ...params } = await req.json();

    // Auth check
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

async function generateQuestionForSession(
  supabase: any, 
  sessionId: string, 
  curriculumId: string, 
  orderIndex: number
) {
  const { data: competencies } = await supabase
    .from('competencies')
    .select(`
      id,
      title,
      code,
      learning_field:learning_fields!inner(
        id,
        title,
        code,
        curriculum_id
      )
    `)
    .eq('learning_fields.curriculum_id', curriculumId)
    .limit(20);

  if (!competencies?.length) {
    throw new Error('No competencies found for curriculum');
  }

  const competency = competencies[Math.floor(Math.random() * competencies.length)];

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const prompt = `Du bist ein IHK-Prüfer für die mündliche Abschlussprüfung.

Generiere eine mündliche Prüfungsfrage zum Thema:
Lernfeld: ${competency.learning_field.title}
Kompetenz: ${competency.title}

Die Frage soll:
- Offen formuliert sein (keine Multiple Choice)
- Praxisbezug haben
- In 2-3 Minuten beantwortbar sein
- Dem IHK-Prüfungsniveau entsprechen

Antworte NUR im folgenden JSON-Format:
{
  "question": "Die Prüfungsfrage...",
  "expected_points": ["Punkt 1", "Punkt 2", "Punkt 3"],
  "follow_up_questions": ["Nachfrage 1", "Nachfrage 2"]
}`;

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Du bist ein erfahrener IHK-Prüfer. Antworte ausschließlich im angeforderten JSON-Format." },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
    }),
  });

  if (!aiResponse.ok) {
    throw new Error(`AI error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const responseText = aiData.choices?.[0]?.message?.content || '';
  
  let questionData;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      questionData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found');
    }
  } catch {
    questionData = {
      question: `Erläutern Sie die wesentlichen Aspekte von: ${competency.title}`,
      expected_points: ["Fachliche Definition", "Praktische Anwendung", "Relevanz im Berufsalltag"],
      follow_up_questions: ["Können Sie ein konkretes Beispiel nennen?"]
    };
  }

  const { data: question, error } = await supabase
    .from('oral_exam_questions')
    .insert({
      session_id: sessionId,
      competency_id: competency.id,
      learning_field_id: competency.learning_field.id,
      question_text: questionData.question,
      expected_answer_points: questionData.expected_points,
      follow_up_questions: questionData.follow_up_questions,
      order_index: orderIndex
    })
    .select()
    .single();

  if (error) throw error;
  return question;
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
    supabase, 
    session_id, 
    session.curriculum_id, 
    session.current_question_index
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

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const evaluationPrompt = `Du bist ein IHK-Prüfer und bewertest eine mündliche Prüfungsantwort.

FRAGE: ${question.question_text}

ERWARTETE KERNPUNKTE:
${question.expected_answer_points?.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n') || 'Keine spezifischen Punkte definiert'}

ANTWORT DES PRÜFLINGS:
${user_answer}

Bewerte die Antwort nach IHK-Kriterien (0.0 bis 1.0):
1. Fachlichkeit: Korrektheit und Vollständigkeit
2. Struktur: Logischer Aufbau
3. Begriffssicherheit: Korrekter Einsatz von Fachbegriffen
4. Praxisbezug: Anwendungsbeispiele und Bezug zur Praxis

Antworte NUR im folgenden JSON-Format:
{
  "fachlichkeit_score": 0.8,
  "struktur_score": 0.7,
  "begriffssicherheit_score": 0.75,
  "praxisbezug_score": 0.6,
  "covered_points": ["Punkt 1", "Punkt 3"],
  "missed_points": ["Punkt 2"],
  "feedback": "Detailliertes Feedback zur Antwort...",
  "strengths": ["Stärke 1"],
  "improvements": ["Verbesserungsvorschlag 1"],
  "sample_answer": "Eine optimale Musterantwort für diese Frage wäre...",
  "follow_up_question": "Eine mögliche Nachfrage des Prüfers wäre..."
}`;

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Du bist ein erfahrener IHK-Prüfer. Bewerte fair aber anspruchsvoll. Antworte nur im JSON-Format." },
        { role: "user", content: evaluationPrompt }
      ],
      max_tokens: 1000,
    }),
  });

  if (!aiResponse.ok) {
    throw new Error(`AI error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const responseText = aiData.choices?.[0]?.message?.content || '';
  
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
      fachlichkeit_score: 0.5,
      struktur_score: 0.5,
      begriffssicherheit_score: 0.5,
      praxisbezug_score: 0.5,
      covered_points: [],
      missed_points: question.expected_answer_points || [],
      feedback: "Die Bewertung konnte nicht automatisch durchgeführt werden.",
      strengths: [],
      improvements: ["Bitte versuche es erneut."],
      sample_answer: "",
      follow_up_question: ""
    };
  }

  const { data: updatedQuestion, error } = await supabase
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
    .eq('id', question_id)
    .select()
    .single();

  if (error) throw error;

  const { data: session } = await supabase
    .from('oral_exam_sessions')
    .select('current_question_index, total_questions')
    .eq('id', question.session_id)
    .single();

  if (session) {
    await supabase
      .from('oral_exam_sessions')
      .update({ current_question_index: session.current_question_index + 1 })
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
    is_last: session ? session.current_question_index + 1 >= session.total_questions : false
  };
}

async function finishSession(supabase: any, params: any) {
  const { session_id } = params;

  const { data: questions } = await supabase
    .from('oral_exam_questions')
    .select('*')
    .eq('session_id', session_id);

  if (!questions?.length) {
    throw new Error('No questions found');
  }

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