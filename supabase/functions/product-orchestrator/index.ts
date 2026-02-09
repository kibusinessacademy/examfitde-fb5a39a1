import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Product Orchestrator
 * 
 * Self-looping function that ensures ALL product components reach 100% quality.
 * 
 * Product 1 (Lerninhaltekurs): Kursinhalte + Oral-Exam-Trainer + AI-Tutor + Handbuch
 * Product 2 (Prüfungstrainer): Exam questions with full competency coverage
 * 
 * Call with: POST { courseId, maxIterations?: number }
 * The function loops internally, repairing batches per iteration until done.
 */

const MAX_BATCH = 2;        // lessons per iteration (must fit in 60s edge timeout)
const DELAY_MS = 800;       // delay between AI calls to avoid rate limits
const MAX_ITERATIONS = 50;  // safety cap

// ─── Tool definitions for structured AI output ───

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation"],
            additionalProperties: false
          }
        },
        objectives: { type: "array", items: { type: "string" } }
      },
      required: ["questions", "objectives"],
      additionalProperties: false
    }
  }
};

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt, mindestens 800 Zeichen" },
        objectives: { type: "array", items: { type: "string" }, description: "2-4 Lernziele" }
      },
      required: ["html", "objectives"],
      additionalProperties: false
    }
  }
};

const STEP_PROMPTS: Record<string, string> = {
  einstieg: `Erstelle eine aktivierende Einstiegsaktivität (800–1200 Zeichen HTML). Mit <h3>, Problemstellung, Reflexionsfragen als <ul><li>, Vorwissensbezug.`,
  verstehen: `Erstelle ausführliches Lernmaterial (1500–2500 Zeichen HTML). Mit <h3>, Definitionen, 2+ Beispiele, <strong> Fachbegriffe, <blockquote> Merksätze.`,
  anwenden: `Erstelle praktische Übungsaufgaben (1200–2000 Zeichen HTML). Mit <h3>, Arbeitsszenario, 2-3 Aufgaben steigend, IHK-Praxisbezug.`,
  wiederholen: `Erstelle Wiederholungsaktivitäten (1000–1500 Zeichen HTML). Mit <h3>, Top-5-Liste, Lückentext, Merkhilfen, "Ich kann jetzt..." Checkliste.`,
};

// ─── Validation ───

function isLessonValid(content: Record<string, unknown> | null, step: string): boolean {
  if (!content) return false;
  if (step === 'mini_check') {
    const qs = content.questions;
    return Array.isArray(qs) && qs.length >= 4 && (qs as Record<string, unknown>[]).every(q =>
      q.question && Array.isArray(q.options) && (q.options as unknown[]).length >= 4 &&
      typeof q.correct_answer === 'number' && q.correct_answer >= 0 && q.correct_answer <= 3 && q.explanation
    );
  }
  const html = content.html as string;
  return typeof html === 'string' && html.length >= 300 &&
    !html.includes('wird generiert') && !html.includes('Inhalt wird') &&
    !html.includes('nachgeneriert') && !html.includes('TODO') &&
    Array.isArray(content.objectives) && (content.objectives as unknown[]).length >= 2;
}

// ─── AI generation ───

async function generateContent(
  apiKey: string, comp: { code: string; title: string; description: string; taxonomy_level: string }, step: string
): Promise<Record<string, unknown> | null> {
  const isMC = step === 'mini_check';
  const prompt = isMC
    ? `Erstelle 4 IHK-Prüfungsfragen (${comp.taxonomy_level}) für:\n${comp.code} – ${comp.title}\n${comp.description}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.`
    : `${STEP_PROMPTS[step]}\n\nKompetenz: ${comp.code} – ${comp.title}\n${comp.description}\nTaxonomie: ${comp.taxonomy_level}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "Du bist IHK-Ausbildungsexperte. Erstelle prüfungsrelevante Lerninhalte auf Deutsch. Nutze IMMER die bereitgestellte Funktion." },
            { role: "user", content: prompt }
          ],
          tools: [isMC ? MINICHECK_TOOL : CONTENT_TOOL],
          tool_choice: { type: "function", function: { name: isMC ? "create_mini_check" : "create_lesson_content" } },
          temperature: 0.7,
        }),
      });

      if (resp.status === 429 || resp.status === 402) {
        console.warn(`[Orchestrator] Rate limited (${resp.status}), waiting 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      if (!resp.ok) { console.error(`[Orchestrator] AI ${resp.status}`); return null; }

      const data = await resp.json();
      const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) return null;

      const parsed = JSON.parse(args);
      if (isLessonValid(parsed, step)) return parsed;
      console.warn(`[Orchestrator] Validation failed attempt ${attempt + 1} for ${comp.code}/${step}`);
    } catch (e) {
      console.error(`[Orchestrator] Error:`, e);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ─── Quality assessment for all product components ───

interface ProductStatus {
  courseId: string;
  courseTitle: string;
  curriculumId: string;
  lessons: { total: number; valid: number; invalid: number; percent: number };
  miniChecks: { total: number; valid: number; percent: number };
  examQuestions: { total: number; competenciesCovered: number; totalCompetencies: number; percent: number };
  overall: { complete: boolean; percent: number };
}

async function assessProduct(supabase: ReturnType<typeof createClient>, courseId: string): Promise<ProductStatus> {
  // Course info
  const { data: course } = await supabase.from('courses').select('id, title, curriculum_id').eq('id', courseId).single();
  if (!course) throw new Error(`Course ${courseId} not found`);

  // All lessons
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, title, step, content, competency_id, modules!inner(course_id)')
    .eq('modules.course_id', courseId);

  const allLessons = lessons || [];
  let validLessons = 0;
  let validMiniChecks = 0;
  const miniCheckLessons = allLessons.filter(l => l.step === 'mini_check');

  for (const l of allLessons) {
    if (isLessonValid(l.content as Record<string, unknown> | null, l.step as string)) validLessons++;
  }
  for (const l of miniCheckLessons) {
    if (isLessonValid(l.content as Record<string, unknown> | null, 'mini_check')) validMiniChecks++;
  }

  // Exam questions coverage
  const { data: competencies } = await supabase
    .from('competencies')
    .select('id')
    .in('learning_field_id', 
      (await supabase.from('learning_fields').select('id').eq('curriculum_id', course.curriculum_id)).data?.map((lf: { id: string }) => lf.id) || []
    );
  const totalComps = competencies?.length || 0;

  const { data: examQs } = await supabase
    .from('exam_questions')
    .select('id, competency_id')
    .eq('curriculum_id', course.curriculum_id);
  const coveredComps = new Set((examQs || []).map((q: { competency_id: string }) => q.competency_id).filter(Boolean)).size;

  const lessonPercent = allLessons.length > 0 ? Math.round((validLessons / allLessons.length) * 100) : 0;
  const mcPercent = miniCheckLessons.length > 0 ? Math.round((validMiniChecks / miniCheckLessons.length) * 100) : 100;
  const examPercent = totalComps > 0 ? Math.round((coveredComps / totalComps) * 100) : 0;

  // Overall: lessons (60%) + minichecks (20%) + exam (20%)
  const overallPercent = Math.round(lessonPercent * 0.6 + mcPercent * 0.2 + examPercent * 0.2);
  const complete = lessonPercent === 100 && mcPercent === 100;

  return {
    courseId: course.id,
    courseTitle: course.title,
    curriculumId: course.curriculum_id,
    lessons: { total: allLessons.length, valid: validLessons, invalid: allLessons.length - validLessons, percent: lessonPercent },
    miniChecks: { total: miniCheckLessons.length, valid: validMiniChecks, percent: mcPercent },
    examQuestions: { total: examQs?.length || 0, competenciesCovered: coveredComps, totalCompetencies: totalComps, percent: examPercent },
    overall: { complete, percent: overallPercent },
  };
}

// ─── Find invalid lessons ───

async function getInvalidLessons(supabase: ReturnType<typeof createClient>, courseId: string, limit: number) {
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, title, step, content, competency_id, modules!inner(course_id)')
    .eq('modules.course_id', courseId)
    .limit(500);

  const invalid: typeof lessons = [];
  for (const l of (lessons || [])) {
    if (!isLessonValid(l.content as Record<string, unknown> | null, l.step as string)) {
      invalid.push(l);
      if (invalid.length >= limit) break;
    }
  }
  return invalid;
}

// ─── Get competency info ───

async function getCompetency(supabase: ReturnType<typeof createClient>, compId: string) {
  const { data } = await supabase
    .from('competencies')
    .select('code, title, description, taxonomy_level')
    .eq('id', compId)
    .single();
  return data || { code: '', title: '', description: '', taxonomy_level: 'anwenden' };
}

// ─── Main orchestrator ───

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const { courseId, dryRun = false, autoAll = false } = body;

    // Auto-all mode: find all incomplete courses and process the first one
    let targetCourseId = courseId;
    if (autoAll || !courseId) {
      const { data: courses } = await supabase.from('courses').select('id').in('status', ['draft', 'generating', 'published']);
      for (const c of (courses || [])) {
        const status = await assessProduct(supabase, c.id);
        if (!status.overall.complete) { targetCourseId = c.id; break; }
      }
      if (!targetCourseId) {
        return new Response(JSON.stringify({
          complete: true, shouldContinue: false,
          message: '✅ Alle Kurse vollständig! Keine weiteren Reparaturen nötig.'
        }), { headers: jsonHeaders });
      }
    }

    if (!targetCourseId) {
      return new Response(JSON.stringify({ error: "courseId is required or use autoAll:true" }), { status: 400, headers: jsonHeaders });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Initial assessment
    const initialStatus = await assessProduct(supabase, targetCourseId);
    console.log(`[Orchestrator] Course: ${initialStatus.courseTitle}`);
    console.log(`[Orchestrator] Lessons: ${initialStatus.lessons.percent}% | MiniChecks: ${initialStatus.miniChecks.percent}% | Exam: ${initialStatus.examQuestions.percent}%`);

    if (dryRun) {
      return new Response(JSON.stringify({ dryRun: true, status: initialStatus }), { headers: jsonHeaders });
    }

    // Already complete?
    if (initialStatus.overall.complete) {
      await logCompletion(supabase, targetCourseId, initialStatus);
      return new Response(JSON.stringify({
        complete: true, shouldContinue: false, status: initialStatus,
        message: `✅ Produkt "${initialStatus.courseTitle}" ist vollständig! Alle ${initialStatus.lessons.total} Lessons validiert.`
      }), { headers: jsonHeaders });
    }

    // ─── SINGLE ITERATION (to stay within 60s edge function limit) ───
    const invalidLessons = await getInvalidLessons(supabase, targetCourseId, MAX_BATCH);

    if (invalidLessons.length === 0) {
      const finalStatus = await assessProduct(supabase, targetCourseId);
      if (finalStatus.overall.complete) await logCompletion(supabase, targetCourseId, finalStatus);
      return new Response(JSON.stringify({
        complete: finalStatus.overall.complete, shouldContinue: false,
        status: finalStatus,
        message: `✅ Alle Lessons validiert. Kurs: ${finalStatus.lessons.percent}%`
      }), { headers: jsonHeaders });
    }

    console.log(`[Orchestrator] Repairing ${invalidLessons.length} lessons`);
    let fixed = 0, failed = 0;
    const details: { id: string; title: string; step: string; status: string }[] = [];

    for (const lesson of invalidLessons) {
      const comp = await getCompetency(supabase, lesson.competency_id);
      const content = await generateContent(API_KEY, comp, lesson.step as string);

      if (!content) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'failed' });
        continue;
      }

      const finalContent = lesson.step === 'mini_check'
        ? { type: 'mini_check', questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 4, source: 'orchestrator' }
        : { type: 'text', html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 4, source: 'orchestrator' };

      const { error } = await supabase.from('lessons').update({ content: finalContent }).eq('id', lesson.id);
      if (error) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'db_error' });
      } else {
        fixed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'fixed' });
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    // Re-assess
    const finalStatus = await assessProduct(supabase, targetCourseId);
    const shouldContinue = !finalStatus.overall.complete && fixed > 0;

    if (finalStatus.overall.complete) await logCompletion(supabase, targetCourseId, finalStatus);

    return new Response(JSON.stringify({
      complete: finalStatus.overall.complete,
      shouldContinue,
      fixed, failed, details,
      status: finalStatus,
      message: finalStatus.overall.complete
        ? `✅ FERTIG: "${finalStatus.courseTitle}" vollständig!`
        : `⏳ ${finalStatus.lessons.percent}% valid (${finalStatus.lessons.invalid} verbleibend). ${shouldContinue ? 'Automatisch fortsetzen...' : 'Manuell erneut aufrufen.'}`
    }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[Orchestrator] Fatal:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } }
    );
  }
});

// ─── Completion logger ───

async function logCompletion(supabase: ReturnType<typeof createClient>, courseId: string, status: ProductStatus) {
  console.log(`[Orchestrator] 🎉 COMPLETION: ${status.courseTitle}`);
  console.log(`  Lessons: ${status.lessons.total} (100%)`);
  console.log(`  MiniChecks: ${status.miniChecks.total} (${status.miniChecks.percent}%)`);
  console.log(`  Exam Questions: ${status.examQuestions.total} covering ${status.examQuestions.competenciesCovered}/${status.examQuestions.totalCompetencies} competencies`);

  // Update course status
  await supabase.from('courses').update({
    status: 'published',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', courseId);

  // ─── Auto-trigger IHK-Prüfer Quality Audit → Improvement Loop ───
  console.log(`[Orchestrator] 🔍 Triggering IHK-Prüfer audit for "${status.courseTitle}"...`);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Step 1: Run IHK Audit
    const auditResp = await fetch(`${supabaseUrl}/functions/v1/ihk-quality-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
      body: JSON.stringify({ courseId, sampleSize: 15 }),
    });

    if (auditResp.ok) {
      const auditResult = await auditResp.json();
      console.log(`[Orchestrator] ✅ IHK-Audit: ${auditResult.overallScore}/100 (${auditResult.grade})`);

      // Step 2: If below "sehr gut" (< 92), trigger improvement agent
      if (auditResult.needsImprovement) {
        console.log(`[Orchestrator] 🔧 Score < 92 → Triggering AI improvement agent...`);
        const improveResp = await fetch(`${supabaseUrl}/functions/v1/improve-lesson`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
          body: JSON.stringify({ courseId, maxLessons: 5 }),
        });
        if (improveResp.ok) {
          const improveResult = await improveResp.json();
          console.log(`[Orchestrator] ✅ Improved ${improveResult.improved} lessons. Re-audit in next cycle.`);
        } else {
          console.warn(`[Orchestrator] Improve agent returned ${improveResp.status}`);
        }
      } else {
        console.log(`[Orchestrator] 🏆 Score ≥ 92 → IHK-sehr-gut erreicht! Keine Verbesserung nötig.`);
      }
    } else {
      console.warn(`[Orchestrator] IHK-Audit returned ${auditResp.status}`);
    }
  } catch (e) {
    console.error(`[Orchestrator] IHK-Audit/Improve trigger failed:`, e);
  }
}
