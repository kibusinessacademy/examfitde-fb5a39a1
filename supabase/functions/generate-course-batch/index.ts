import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * generate-course-batch – LLM Council Pipeline
 * 
 * GPT-5.2 Deep Thinking → Content Generation
 * Claude Opus 4.6 → Automatic Validation (per Lesson)
 * 
 * Status-Flow: draft → generated → validated → approved
 * Ohne validated kein approved. Ohne approved kein published.
 */

const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

interface MiniCheckQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

const stepPrompts: Record<string, string> = {
  einstieg: 'Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt. Nutze ein konkretes Praxisszenario aus dem Berufsalltag.',
  verstehen: 'Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Gegenbeispielen und IHK-Prüfungsbezügen. Markiere prüfungsrelevante Inhalte mit ⭐.',
  anwenden: 'Erstelle ein Entscheidungsszenario (KEINE reine Beschreibung). Der Lernende muss eine berufliche Entscheidung treffen und begründen. Zeige typische Prüfungsfallen mit ⚠️.',
  wiederholen: 'Erstelle Wiederholungsaktivitäten mit Zusammenfassung, Karteikarten und typischen IHK-Prüfungsfragen zum Thema.',
  mini_check: 'Erstelle strukturierte Prüfungsfragen zur Selbstüberprüfung.',
};

const miniCheckTool = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung mit je 4 Antwortoptionen.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correct_answer: { type: "number" },
              explanation: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation"],
            additionalProperties: false
          },
          minItems: 4, maxItems: 5
        },
        objectives: { type: "array", items: { type: "string" } }
      },
      required: ["questions", "objectives"],
      additionalProperties: false
    }
  }
};

interface AIProvider {
  url: string;
  headers: Record<string, string>;
  model: string;
}

function resolveProvider(provider?: string): AIProvider {
  if (provider === 'deepseek') {
    const key = Deno.env.get('DEEPSEEK_API_KEY');
    if (!key) throw new Error('DEEPSEEK_API_KEY not configured');
    return { url: 'https://api.deepseek.com/v1/chat/completions', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, model: 'deepseek-chat' };
  }
  // Default: GPT-5.2 via Lovable AI Gateway (Primary Generator)
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY is not configured');
  return { url: 'https://ai.gateway.lovable.dev/v1/chat/completions', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, model: 'openai/gpt-5.2' };
}

// Generate + track in ai_generations
async function generateAndTrack(
  supabase: ReturnType<typeof createClient>,
  ai: AIProvider,
  comp: { id: string; title: string; description?: string; taxonomy_level?: string; code?: string },
  step: string,
  courseId: string,
): Promise<{ content: Record<string, unknown> | null; generationId: string | null }> {
  
  const isMiniCheck = step === 'mini_check';
  
  // Create generation record
  const { data: genRecord } = await supabase.from("ai_generations").insert({
    entity_type: "lesson",
    generator_model: ai.model,
    input_context: { competency: comp.title, step, taxonomy: comp.taxonomy_level, courseId },
    output_content: {},
    status: "draft",
    metadata: { provider: ai.model, competencyCode: comp.code },
  }).select("id").single();
  
  const generationId = genRecord?.id || null;

  let content: Record<string, unknown> | null = null;

  if (isMiniCheck) {
    content = await generateMiniCheck(ai, comp);
  } else {
    content = await generateRegularContent(ai, comp, step);
  }

  // Update generation record
  if (generationId && content) {
    await supabase.from("ai_generations").update({
      output_content: content,
      status: "generated",
    }).eq("id", generationId);
  }

  return { content, generationId };
}

// Opus validation for a single lesson
async function validateWithOpus(
  supabase: ReturnType<typeof createClient>,
  content: Record<string, unknown>,
  comp: { title: string; description?: string; taxonomy_level?: string; code?: string },
  step: string,
  generationId: string,
): Promise<{ score: number; decision: string }> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) return { score: 0, decision: "skip" };

  try {
    const startTime = Date.now();
    const valResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 2048,
        system: `Du bist ein IHK-Qualitätsprüfer. Validiere den KI-generierten Lerninhalt.
BEWERTUNG: fachlichkeit (30%), didaktik (25%), pruefungsrelevanz (20%), klarheit (15%), vollstaendigkeit (10%)
REGELN: Kein IHK-Bezug → max 75. Anwenden ohne Entscheidung → max 80. Halluzination → reject.
Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...], "suggested_fixes": [...]}`,
        messages: [{
          role: "user",
          content: `Kompetenz: ${comp.title}\nCode: ${comp.code}\nTaxonomie: ${comp.taxonomy_level || 'Anwenden'}\nSchritt: ${step}\n\nINHALT:\n${JSON.stringify(content)}`
        }],
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!valResp.ok) return { score: 0, decision: "error" };

    const valData = await valResp.json();
    const rawText = valData.content?.[0]?.text || "";

    let result;
    try {
      result = JSON.parse(rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      return { score: 0, decision: "parse_error" };
    }

    // Save validation
    await supabase.from("ai_validations").insert({
      generation_id: generationId,
      validator_model: "claude-opus-4-20250514",
      validation_mode: "automatic",
      overall_score: result.overall_score || 0,
      decision: result.decision || "revise",
      dimension_scores: result.dimension_scores || {},
      critical_issues: result.critical_issues || [],
      suggested_fixes: result.suggested_fixes || [],
      input_tokens: valData.usage?.input_tokens || 0,
      output_tokens: valData.usage?.output_tokens || 0,
      cost_eur: 0,
      latency_ms: latencyMs,
    });

    // Update generation status
    const newStatus = result.decision === "approve" ? "validated" : "draft";
    await supabase.from("ai_generations").update({
      validation_decision: result.decision,
      validation_score: result.overall_score,
      status: newStatus,
    }).eq("id", generationId);

    // Quality gate
    await supabase.from("ai_quality_gates").insert({
      generation_id: generationId,
      gate_type: "auto_validation",
      gate_status: result.decision === "approve" ? "passed" : "failed",
      required_score: 85,
      actual_score: result.overall_score,
      decided_at: new Date().toISOString(),
      reason: `Opus Score: ${result.overall_score}/100 → ${result.decision}`,
    });

    console.log(`[Opus] ${comp.code}/${step}: Score ${result.overall_score}, Decision: ${result.decision}`);
    return { score: result.overall_score || 0, decision: result.decision || "revise" };
  } catch (err) {
    console.error("[Opus] Validation error:", err);
    return { score: 0, decision: "error" };
  }
}

async function generateRegularContent(
  ai: AIProvider,
  comp: { title: string; description?: string; taxonomy_level?: string },
  step: string
): Promise<Record<string, unknown> | null> {
  try {
    const aiResponse = await fetch(ai.url, {
      method: 'POST',
      headers: ai.headers,
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: 'system',
            content: `Du bist ein IHK-Experte für berufliche Ausbildungsinhalte.
Erstelle strukturierte, praxisnahe Lerninhalte im JSON-Format.
WICHTIG: Jede Lektion MUSS einen expliziten IHK-Prüfungsbezug enthalten.
Markiere prüfungsrelevante Stellen mit ⭐ und häufige Fehlerquellen mit ⚠️.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt.`
          },
          {
            role: 'user',
            content: `Erstelle Lerninhalt für:

Kompetenz: ${comp.title}
Beschreibung: ${comp.description || 'Keine Beschreibung'}
Taxonomiestufe: ${comp.taxonomy_level || 'Anwenden'}

Lernschritt: ${step}
Aufgabe: ${stepPrompts[step]}

Format (JSON):
{
  "type": "text",
  "html": "<h3>Titel</h3><p>Ausführlicher Inhalt mit IHK-Prüfungsbezug...</p>",
  "objectives": ["Lernziel 1", "Lernziel 2", "Lernziel 3"],
  "ihk_relevanz": "Beschreibung der Prüfungsrelevanz"
}`
          }
        ],
        temperature: 0.7,
      }),
    });

    if (aiResponse.ok) {
      const result = await aiResponse.json();
      const content = result.choices?.[0]?.message?.content;
      if (content) {
        return JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      }
    }
  } catch (error) {
    console.error(`[AI] Regular content error for ${step}:`, error);
  }
  return null;
}

async function generateMiniCheck(
  ai: AIProvider,
  comp: { title: string; description?: string; taxonomy_level?: string }
): Promise<Record<string, unknown> | null> {
  try {
    const aiResponse = await fetch(ai.url, {
      method: 'POST',
      headers: ai.headers,
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: 'system',
            content: `Du bist ein IHK-Prüfungsexperte. Erstelle realistische Multiple-Choice-Fragen auf IHK-Prüfungsniveau.
Jede Frage muss praxisbezogen sein mit plausiblen Distraktoren.`
          },
          {
            role: 'user',
            content: `Erstelle 4 Multiple-Choice-Fragen für:
Kompetenz: ${comp.title}
Beschreibung: ${comp.description || 'Keine Beschreibung'}
Taxonomiestufe: ${comp.taxonomy_level || 'Anwenden'}`
          }
        ],
        tools: [miniCheckTool],
        tool_choice: { type: "function", function: { name: "create_mini_check" } },
        temperature: 0.7,
      }),
    });

    if (aiResponse.ok) {
      const result = await aiResponse.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
          const validQuestions = parsed.questions.filter((q: MiniCheckQuestion) =>
            q.question && Array.isArray(q.options) && q.options.length === 4 &&
            typeof q.correct_answer === 'number' && q.correct_answer >= 0 && q.correct_answer <= 3 && q.explanation
          );
          if (validQuestions.length >= 3) {
            const questionsHtml = validQuestions.map((q: MiniCheckQuestion, i: number) =>
              `<div class="question-preview"><strong>Frage ${i + 1}:</strong> ${q.question}</div>`
            ).join('');
            return {
              type: 'mini_check',
              html: `<h3>Wissensüberprüfung: ${comp.title}</h3><p>Teste dein Wissen mit ${validQuestions.length} Multiple-Choice-Fragen.</p>${questionsHtml}`,
              objectives: parsed.objectives || [`Wissen zu ${comp.title} überprüfen`],
              questions: validQuestions
            };
          }
        }
      }
    }
  } catch (error) {
    console.error(`[AI] MiniCheck error:`, error);
  }
  return null;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { courseId, curriculumId, learningFieldId, competencyId, provider, skipValidation = false, step: requestedStep } = await req.json();

    if (!courseId || !curriculumId) {
      return new Response(
        JSON.stringify({ error: 'courseId and curriculumId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const ai = resolveProvider(provider);

    // MODE 1: Single step generation (1 AI call per invocation = fits in 60s)
    if (learningFieldId && competencyId) {
      // Determine which step to generate
      const targetStep = requestedStep as typeof LESSON_STEPS[number] | undefined;

      // Ensure module exists
      const { data: existingModule } = await supabase
        .from('modules').select('id').eq('course_id', courseId).eq('learning_field_id', learningFieldId).maybeSingle();

      let moduleId = existingModule?.id;
      if (!moduleId) {
        const { data: lf } = await supabase.from('learning_fields').select('*').eq('id', learningFieldId).single();
        if (!lf) throw new Error('Learning field not found');
        const { data: mod, error: modErr } = await supabase.from('modules').insert({
          course_id: courseId, learning_field_id: learningFieldId,
          title: `${lf.code}: ${lf.title}`, description: lf.description, sort_order: lf.sort_order || 0,
        }).select().single();
        if (modErr) throw modErr;
        moduleId = mod.id;
      } else {
        // Ensure existing module has correct sort_order from learning_field
        const { data: lf } = await supabase.from('learning_fields').select('sort_order').eq('id', learningFieldId).single();
        if (lf) {
          await supabase.from('modules').update({ sort_order: lf.sort_order || 0 }).eq('id', moduleId);
        }
      }

      // Get competency
      const { data: comp } = await supabase.from('competencies').select('*').eq('id', competencyId).single();
      if (!comp) throw new Error('Competency not found');

      // Find the next step to generate (or use requested step)
      let stepToGen: typeof LESSON_STEPS[number] | null = null;

      if (targetStep && LESSON_STEPS.includes(targetStep)) {
        // Check if already exists
        const { data: existing } = await supabase
          .from('lessons').select('id').eq('module_id', moduleId).eq('competency_id', comp.id).eq('step', targetStep).maybeSingle();
        if (existing) {
          return new Response(
            JSON.stringify({ success: true, skipped: true, step: targetStep, competencyCode: comp.code, message: 'Step already exists' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        stepToGen = targetStep;
      } else {
        // Auto-detect next missing step
        for (const s of LESSON_STEPS) {
          const { data: existing } = await supabase
            .from('lessons').select('id').eq('module_id', moduleId).eq('competency_id', comp.id).eq('step', s).maybeSingle();
          if (!existing) { stepToGen = s; break; }
        }
        if (!stepToGen) {
          return new Response(
            JSON.stringify({ success: true, complete: true, competencyCode: comp.code, message: 'All steps already exist' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      console.log(`[Batch] Generating ${comp.code} / ${stepToGen}`);

      // Compute deterministic sort_order: (competency_sort * 10) + step_index
      const stepIndex = { einstieg: 0, verstehen: 1, anwenden: 2, wiederholen: 3, mini_check: 4 }[stepToGen] ?? 5;
      const lessonSortOrder = ((comp.sort_order || 0) * 10) + stepIndex;

      const stepDuration = stepToGen === 'mini_check' ? 10 : stepToGen === 'verstehen' ? 25 : stepToGen === 'anwenden' ? 30 : stepToGen === 'wiederholen' ? 15 : 10;

      const { content: lessonContent, generationId } = await generateAndTrack(supabase, ai, comp, stepToGen, courseId);

      const finalContent = lessonContent || (stepToGen === 'mini_check'
        ? { type: 'mini_check', html: `<h3>${comp.title}</h3><p>⚠️ Inhalt wird nachgeneriert.</p>`, objectives: [], questions: [], _needs_repair: true }
        : { type: 'text', html: `<h3>${comp.title} - ${stepToGen}</h3><p>⚠️ Inhalt wird nachgeneriert.</p>`, objectives: [], _needs_repair: true });

      // --- OPUS VALIDATION GATE (active!) ---
      let validationDecision = 'skip';
      let validationScore = 0;
      if (!skipValidation && generationId && lessonContent) {
        const valResult = await validateWithOpus(supabase, lessonContent, comp, stepToGen, generationId);
        validationDecision = valResult.decision;
        validationScore = valResult.score;
        console.log(`[Opus Gate] ${comp.code}/${stepToGen}: ${validationDecision} (${validationScore})`);
      }

      // Status: validated if Opus approves, otherwise draft (needs repair)
      const lessonStatus = validationDecision === 'approve' ? 'validated' : 'draft';

      await supabase.from('lessons').insert({
        module_id: moduleId, competency_id: comp.id,
        title: `${comp.code}: ${comp.title}`, step: stepToGen,
        content: finalContent,
        duration_minutes: stepDuration, sort_order: lessonSortOrder,
        status: lessonStatus,
      });

      // Count remaining steps for this competency
      const { data: doneLessons } = await supabase
        .from('lessons').select('step').eq('module_id', moduleId).eq('competency_id', comp.id);
      const doneSteps = (doneLessons || []).map((l: any) => l.step);
      const remaining = LESSON_STEPS.filter(s => !doneSteps.includes(s));

      return new Response(
        JSON.stringify({
          success: true,
          step: stepToGen,
          competencyCode: comp.code,
          generationId,
          hasContent: !!lessonContent,
          remaining: remaining.length,
          nextStep: remaining.length > 0 ? remaining[0] : null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // MODE 2: Finalize course (update duration & status + Auto-QC)
    if (!learningFieldId && !competencyId) {
      const { data: lessons } = await supabase
        .from('lessons')
        .select('duration_minutes, module_id!inner(course_id)')
        .eq('module_id.course_id', courseId);

      const totalDuration = lessons?.reduce((sum, l) => sum + (l.duration_minutes || 0), 0) || 0;
      const totalLessons = lessons?.length || 0;

      await supabase.from('courses').update({
        estimated_duration: Math.ceil(totalDuration / 60),
        status: 'draft',
      }).eq('id', courseId);

      // --- Auto-QC Pipeline ---
      let qcResult: any = null;
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // 1) QC Snapshot
        const snapRes = await fetch(`${supabaseUrl}/functions/v1/qc-snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ scope: 'course', courseId }),
        });
        const snapBody = await snapRes.text();
        console.log(`[Finalize] qc-snapshot status=${snapRes.status}`);

        // 2) Validate content (Opus) – course level
        const valRes = await fetch(`${supabaseUrl}/functions/v1/validate-content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ mode: 'course', entityType: 'course', entityId: courseId, content: { courseId, totalLessons, totalDuration } }),
        });
        const valBody = await valRes.json().catch(() => ({}));
        console.log(`[Finalize] validate-content status=${valRes.status}, decision=${valBody?.decision}`);

        // 3) IHK Quality Audit (best-effort)
        const auditRes = await fetch(`${supabaseUrl}/functions/v1/ihk-quality-audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ courseId }),
        });
        const auditBody = await auditRes.json().catch(() => ({}));
        console.log(`[Finalize] ihk-quality-audit status=${auditRes.status}, score=${auditBody?.overallScore}`);

        qcResult = {
          snapshotOk: snapRes.ok,
          validation: { decision: valBody?.decision, score: valBody?.overall_score },
          audit: { score: auditBody?.overallScore, grade: auditBody?.grade },
        };

        // Mark course ready/needs_patch based on validation
        const needsPatch = valBody?.decision === 'revise' || valBody?.decision === 'reject'
          || (auditBody?.overallScore && auditBody.overallScore < 85);

        if (needsPatch) {
          await supabase.from('courses').update({ status: 'draft' }).eq('id', courseId);
        }
      } catch (qcErr) {
        console.error('[Finalize] Auto-QC error (non-blocking):', qcErr);
        qcResult = { error: String((qcErr as Error)?.message || qcErr) };
      }

      return new Response(
        JSON.stringify({ success: true, complete: true, totalLessons, totalDuration, qc: qcResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid request: provide learningFieldId+competencyId or neither (to finalize)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Batch generation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
    );
  }
});
