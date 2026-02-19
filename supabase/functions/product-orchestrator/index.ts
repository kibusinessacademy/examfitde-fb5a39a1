import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, type AIProvider } from "../_shared/ai-client.ts";

const MAX_ITERATIONS = 12;
const MAX_BATCH = 8;
const DELAY_MS = 800;
const LEASE_TTL_MS = 10 * 60 * 1000; // 10 min lease

// ── Lease guard to prevent parallel orchestrator chains ──
async function acquireLease(supabase: ReturnType<typeof createClient>, instanceId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString();
  // Only acquire if no active lease exists
  const { data, error } = await supabase
    .from('orchestrator_leases')
    .update({ locked_at: now, locked_by: instanceId, expires_at: expiresAt })
    .eq('function_name', 'product-orchestrator')
    .or(`locked_at.is.null,expires_at.lt.${now}`)
    .select()
    .maybeSingle();
  return !error && !!data;
}

async function releaseLease(supabase: ReturnType<typeof createClient>) {
  await supabase
    .from('orchestrator_leases')
    .update({ locked_at: null, locked_by: null, expires_at: null })
    .eq('function_name', 'product-orchestrator');
}

// ── Step prompts ──
const STEP_PROMPTS: Record<string, string> = {
  einstieg: `Erstelle eine Einführung (Step 1: Einstieg) für die Kompetenz. Die Einführung soll:
- Ein praxisnahes Szenario beschreiben
- Die Relevanz für die Ausbildung aufzeigen
- Neugier wecken
Antworte als JSON: { "html": "<h2>...</h2><p>...</p>...", "objectives": ["Lernziel 1", "Lernziel 2", ...] }`,

  verstehen: `Erstelle den Verstehen-Teil (Step 2). Der Teil soll:
- Den Fachinhalt klar erklären
- Definitionen und Zusammenhänge aufzeigen
- Beispiele aus der Praxis enthalten
Antworte als JSON: { "html": "<h2>...</h2><p>...</p>...", "objectives": ["..."] }`,

  anwenden: `Erstelle den Anwenden-Teil (Step 3). Der Teil soll:
- Praktische Übungsaufgaben enthalten
- Fallbeispiele aus dem Berufsalltag
- Handlungsanweisungen
Antworte als JSON: { "html": "<h2>...</h2><p>...</p>...", "objectives": ["..."] }`,

  wiederholen: `Erstelle den Wiederholen-Teil (Step 4). Der Teil soll:
- Kernpunkte zusammenfassen
- Merksätze hervorheben
- Transferaufgaben stellen
Antworte als JSON: { "html": "<h2>...</h2><p>...</p>...", "objectives": ["..."] }`,

  mini_check: `Erstelle 4 IHK-Prüfungsfragen. EXAKT 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.
Antworte als JSON: { "questions": [{ "question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation_correct": "...", "explanation_wrong": "..." }], "objectives": ["..."] }`,
};

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Create lesson content with HTML and learning objectives.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "The lesson content as valid semantic HTML" },
        objectives: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 }
      },
      required: ["html", "objectives"]
    }
  }
};

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Create a mini-check quiz with exactly 4 questions.",
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
              explanation_correct: { type: "string" },
              explanation_wrong: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation_correct", "explanation_wrong"]
          }
        },
        objectives: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 }
      },
      required: ["questions"]
    }
  }
};

function isLessonValid(content: Record<string, unknown>, step: string): boolean {
  if (step === 'mini_check') {
    return Array.isArray(content.questions) && (content.questions as unknown[]).length >= 3;
  }
  const html = String(content.html || '');
  return html.length > 100 &&
    !html.includes('wird generiert') && !html.includes('Inhalt wird') &&
    !html.includes('nachgeneriert') && !html.includes('TODO') &&
    Array.isArray(content.objectives) && (content.objectives as unknown[]).length >= 2;
}

// ─── AI generation via Gateway ───

async function generateContent(
  comp: { code: string; title: string; description: string; taxonomy_level: string },
  step: string,
  provider: AIProvider = "openai"
): Promise<Record<string, unknown> | null> {
  const isMC = step === 'mini_check';
  const prompt = isMC
    ? `Erstelle 4 IHK-Prüfungsfragen (${comp.taxonomy_level}) für:\n${comp.code} – ${comp.title}\n${comp.description}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.`
    : `${STEP_PROMPTS[step]}\n\nKompetenz: ${comp.code} – ${comp.title}\n${comp.description}\nTaxonomie: ${comp.taxonomy_level}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callAIJSON({
        provider,
        messages: [
          { role: "system", content: "Du bist IHK-Ausbildungsexperte. Erstelle prüfungsrelevante Lerninhalte auf Deutsch. Nutze IMMER die bereitgestellte Funktion." },
          { role: "user", content: prompt },
        ],
        tools: [isMC ? MINICHECK_TOOL : CONTENT_TOOL],
        tool_choice: { type: "function", function: { name: isMC ? "create_mini_check" : "create_lesson_content" } },
        temperature: 0.7,
      });

      const args = result.toolCalls?.[0]?.function?.arguments;
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
  missingCompetencies: { id: string; code: string; title: string }[];
  overall: { complete: boolean; percent: number };
}

async function assessProduct(supabase: ReturnType<typeof createClient>, courseId: string): Promise<ProductStatus> {
  const { data: course } = await supabase.from('courses').select('id, title, curriculum_id').eq('id', courseId).single();
  if (!course) throw new Error(`Course ${courseId} not found`);

  const { data: learningFields } = await supabase.from('learning_fields').select('id').eq('curriculum_id', course.curriculum_id);
  const lfIds = (learningFields || []).map((lf: { id: string }) => lf.id);

  const { data: allCurriculumComps } = await supabase.from('competencies').select('id, code, title').in('learning_field_id', lfIds.length ? lfIds : ['__none__']);

  const { data: lessons } = await supabase.from('lessons').select('id, step, competency_id, content, modules!inner(course_id)').eq('modules.course_id', courseId);

  const validLessons = (lessons || []).filter((l: any) => isLessonValid(l.content || {}, l.step));
  const miniChecks = (lessons || []).filter((l: any) => l.step === 'mini_check');
  const validMiniChecks = miniChecks.filter((l: any) => isLessonValid(l.content || {}, 'mini_check'));

  const { data: examQs } = await supabase.from('exam_questions').select('competency_id').eq('course_id', courseId);
  const coveredCompIds = new Set((examQs || []).map((q: any) => q.competency_id));

  const allComps = allCurriculumComps || [];
  const lessonCompIds = new Set((lessons || []).map((l: any) => l.competency_id));
  const missingComps = allComps.filter((c: any) => !lessonCompIds.has(c.id));

  const totalSteps = allComps.length * 5;
  const validSteps = validLessons.length;
  const overallPercent = totalSteps > 0 ? Math.round((validSteps / totalSteps) * 100) : 0;

  return {
    courseId, courseTitle: course.title, curriculumId: course.curriculum_id,
    lessons: { total: (lessons || []).length, valid: validLessons.length, invalid: (lessons || []).length - validLessons.length, percent: (lessons || []).length > 0 ? Math.round((validLessons.length / (lessons || []).length) * 100) : 0 },
    miniChecks: { total: miniChecks.length, valid: validMiniChecks.length, percent: miniChecks.length > 0 ? Math.round((validMiniChecks.length / miniChecks.length) * 100) : 0 },
    examQuestions: { total: (examQs || []).length, competenciesCovered: coveredCompIds.size, totalCompetencies: allComps.length, percent: allComps.length > 0 ? Math.round((coveredCompIds.size / allComps.length) * 100) : 0 },
    missingCompetencies: missingComps.map((c: any) => ({ id: c.id, code: c.code, title: c.title })),
    overall: { complete: overallPercent >= 95 && missingComps.length === 0, percent: overallPercent },
  };
}

async function getCompetency(supabase: ReturnType<typeof createClient>, compId: string) {
  const { data } = await supabase.from('competencies').select('id, code, title, description, taxonomy_level').eq('id', compId).single();
  return data || { code: '?', title: '?', description: '', taxonomy_level: 'Anwenden' };
}

async function getInvalidLessons(supabase: ReturnType<typeof createClient>, courseId: string, limit: number) {
  const { data: lessons } = await supabase.from('lessons').select('id, title, step, competency_id, content, modules!inner(course_id)').eq('modules.course_id', courseId).limit(200);
  return (lessons || []).filter((l: any) => !isLessonValid(l.content || {}, l.step)).slice(0, limit);
}

async function scaffoldMissingCompetencies(supabase: ReturnType<typeof createClient>, courseId: string, missing: { id: string; code: string; title: string }[], curriculumId: string) {
  const { data: modules } = await supabase.from('modules').select('id').eq('course_id', courseId).limit(1);
  const moduleId = modules?.[0]?.id;
  if (!moduleId) return 0;

  const steps = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'];
  let created = 0;
  for (const comp of missing) {
    for (const step of steps) {
      const { error } = await supabase.from('lessons').insert({
        module_id: moduleId, competency_id: comp.id,
        title: `${comp.code}: ${comp.title} – ${step}`,
        step, sort_order: created,
        content: { type: step === 'mini_check' ? 'mini_check' : 'text', html: '<p>Inhalt wird generiert...</p>', objectives: [] },
      });
      if (!error) created++;
    }
  }
  return created;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const { courseId, dryRun = false, autoAll = false, _iteration = 0 } = body;
    const provider = (body.provider || "openai") as AIProvider;

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const instanceId = `iter-${_iteration}-${Date.now()}`;

    // Lease guard: prevent parallel orchestrator chains
    if (_iteration === 0) {
      const acquired = await acquireLease(supabase, instanceId);
      if (!acquired) {
        return new Response(JSON.stringify({
          complete: false, shouldContinue: false,
          message: '⏳ Another orchestrator chain is already running. Skipping.',
        }), { headers: jsonHeaders });
      }
    }

    if (_iteration >= MAX_ITERATIONS) {
      await releaseLease(supabase);
      return new Response(JSON.stringify({
        complete: false, shouldContinue: false,
        message: `⛔ Max iterations (${MAX_ITERATIONS}) reached. Manual review required.`
      }), { headers: jsonHeaders });
    }

    let targetCourseId = courseId;
    if (autoAll || !courseId) {
      const { data: courses } = await supabase.from('courses').select('id').in('status', ['draft', 'generating', 'published']);
      for (const c of (courses || [])) {
        const status = await assessProduct(supabase, c.id);
        if (!status.overall.complete) { targetCourseId = c.id; break; }
      }
      if (!targetCourseId) {
        await releaseLease(supabase);
        return new Response(JSON.stringify({ complete: true, shouldContinue: false, message: '✅ Alle Kurse vollständig!' }), { headers: jsonHeaders });
      }
    }

    if (!targetCourseId) {
      return new Response(JSON.stringify({ error: "courseId is required or use autoAll:true" }), { status: 400, headers: jsonHeaders });
    }

    // Compliance gate
    const { data: courseCheck } = await supabase.from("courses").select("compliance_blocked").eq("id", targetCourseId).single();
    if (courseCheck?.compliance_blocked) {
      const gateResult = await supabase.rpc("compute_compliance_release_gate");
      return new Response(JSON.stringify({ complete: false, shouldContinue: false, error: "Compliance block", courseId: targetCourseId, gate: gateResult.data ?? null }), { status: 409, headers: jsonHeaders });
    }

    const initialStatus = await assessProduct(supabase, targetCourseId);
    console.log(`[Orchestrator] Iteration ${_iteration} | Course: ${initialStatus.courseTitle} | Lessons: ${initialStatus.lessons.percent}%`);

    if (dryRun) {
      return new Response(JSON.stringify({ dryRun: true, status: initialStatus }), { headers: jsonHeaders });
    }

    // Scaffold missing competencies
    if (initialStatus.missingCompetencies.length > 0) {
      const scaffolded = await scaffoldMissingCompetencies(supabase, targetCourseId, initialStatus.missingCompetencies, initialStatus.curriculumId);
      const updatedStatus = await assessProduct(supabase, targetCourseId);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(`${supabaseUrl}/functions/v1/product-orchestrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ courseId: targetCourseId, autoAll, provider, _iteration: _iteration + 1 }),
      }).catch(e => console.error('[Orchestrator] Self-invoke failed:', e));

      return new Response(JSON.stringify({ complete: false, shouldContinue: true, iteration: _iteration, scaffolded, status: updatedStatus }), { headers: jsonHeaders });
    }

    if (initialStatus.overall.complete) {
      await logCompletion(supabase, targetCourseId, initialStatus);
      await releaseLease(supabase);
      return new Response(JSON.stringify({ complete: true, shouldContinue: false, status: initialStatus }), { headers: jsonHeaders });
    }

    // Process invalid lessons
    const invalidLessons = await getInvalidLessons(supabase, targetCourseId, MAX_BATCH);
    if (invalidLessons.length === 0) {
      const finalStatus = await assessProduct(supabase, targetCourseId);
      if (finalStatus.overall.complete) await logCompletion(supabase, targetCourseId, finalStatus);
      return new Response(JSON.stringify({ complete: finalStatus.overall.complete, shouldContinue: false, status: finalStatus }), { headers: jsonHeaders });
    }

    let fixed = 0, failed = 0;
    const details: { id: string; title: string; step: string; status: string }[] = [];

    for (const lesson of invalidLessons) {
      const comp = await getCompetency(supabase, lesson.competency_id);
      const content = await generateContent(comp, lesson.step as string, provider);

      if (!content) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'failed' });
        continue;
      }

      const finalContent = lesson.step === 'mini_check'
        ? { type: 'mini_check', questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 4, source: 'orchestrator' }
        : { type: 'text', html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 4, source: 'orchestrator' };

      const stepKey = lesson.step === 'mini_check' ? 'step_5_minicheck'
        : lesson.step === 'einstieg' ? 'step_1_introduction'
        : lesson.step === 'verstehen' ? 'step_2_understanding'
        : lesson.step === 'anwenden' ? 'step_3_application'
        : 'step_4_repetition';

      const { error } = await supabase.from('content_versions').insert({
        lesson_id: lesson.id, step_key: stepKey, content_json: finalContent,
        status: 'under_review', entity_type: lesson.step === 'mini_check' ? 'minicheck' : 'lesson_step',
        created_by: 'product-orchestrator',
      });
      if (error) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'db_error' });
      } else {
        fixed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'queued_for_council' });
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const finalStatus = await assessProduct(supabase, targetCourseId);
    const shouldContinue = !finalStatus.overall.complete && fixed > 0;

    if (finalStatus.overall.complete) {
      await logCompletion(supabase, targetCourseId, finalStatus);
      await releaseLease(supabase);
    }

    if (shouldContinue) {
      // Lease stays active — next iteration inherits it
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(`${supabaseUrl}/functions/v1/product-orchestrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ courseId: targetCourseId, autoAll, provider, _iteration: _iteration + 1 }),
      }).catch(e => console.error('[Orchestrator] Self-invoke failed:', e));
    } else {
      await releaseLease(supabase);
    }

    return new Response(JSON.stringify({ complete: finalStatus.overall.complete, shouldContinue, iteration: _iteration, fixed, failed, details, status: finalStatus }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[Orchestrator] Fatal:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" }
    });
  }
});

async function logCompletion(supabase: ReturnType<typeof createClient>, courseId: string, status: ProductStatus) {
  console.log(`[Orchestrator] 🎉 COMPLETION: ${status.courseTitle}`);

  const { data: courseCheck } = await supabase.from('courses').select('autopilot_status, quality_score').eq('id', courseId).single();
  if (courseCheck?.autopilot_status !== 'sealed' || (courseCheck?.quality_score ?? 0) < 85) {
    console.warn(`[Orchestrator] ⛔ PUBLISH BLOCKED: status=${courseCheck?.autopilot_status}, score=${courseCheck?.quality_score}`);
    await supabase.from('courses').update({ publishing_status: 'quality_failed', updated_at: new Date().toISOString() }).eq('id', courseId);
    return;
  }

  await supabase.from('courses').update({ status: 'published', publishing_status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', courseId);

  // Auto-trigger IHK audit
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auditResp = await fetch(`${supabaseUrl}/functions/v1/ihk-quality-audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
      body: JSON.stringify({ courseId, sampleSize: 15 }),
    });
    if (auditResp.ok) {
      const auditResult = await auditResp.json();
      if (auditResult.needsImprovement) {
        await fetch(`${supabaseUrl}/functions/v1/improve-lesson`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
          body: JSON.stringify({ courseId, maxLessons: 5 }),
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error(`[Orchestrator] IHK-Audit trigger failed:`, e);
  }
}
