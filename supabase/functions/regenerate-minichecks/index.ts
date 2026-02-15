import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, type AIProvider } from "../_shared/ai-client.ts";

/**
 * Regenerate MiniChecks — Dual-LLM Pipeline, Profession-Aware:
 * 1. Generator: OpenAI (routed via ai-client)
 * 2. Validator: Anthropic (routed via ai-client)
 * 3. Output: content_version → Council review → publish
 */

const GENERATOR_PROVIDER: AIProvider = "openai";
const VALIDATOR_PROVIDER: AIProvider = "anthropic";

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
        }
      },
      required: ["questions"]
    }
  }
};

const VALIDATION_TOOL = {
  type: "function" as const,
  function: {
    name: "validate_mini_check",
    description: "Validate a mini-check quiz for IHK exam quality standards.",
    parameters: {
      type: "object",
      properties: {
        overall_valid: { type: "boolean" },
        score: { type: "integer", minimum: 0, maximum: 100 },
        issues: { type: "array", items: { type: "object", properties: { question_index: { type: "integer" }, issue_type: { type: "string" }, description: { type: "string" }, severity: { type: "string", enum: ["critical", "warning", "info"] } }, required: ["question_index", "issue_type", "description", "severity"] } },
        corrections: { type: "array", items: { type: "object", properties: { question_index: { type: "integer" }, corrected_question: { type: "string" }, corrected_options: { type: "array", items: { type: "string" } }, corrected_answer: { type: "integer" }, corrected_explanation: { type: "string" } }, required: ["question_index"] } }
      },
      required: ["overall_valid", "score", "issues"]
    }
  }
};

function toPlayerFormat(aiQuestions: any[]): any {
  return {
    type: "mini_check",
    questions: aiQuestions.map((q, qi) => ({
      id: `q${qi + 1}`, text: q.question,
      options: q.options.map((opt: string, oi: number) => ({ id: `q${qi + 1}_o${oi + 1}`, text: opt, is_correct: oi === q.correct_answer })),
      explanation_correct: q.explanation_correct || "Richtig!",
      explanation_wrong: q.explanation_wrong || "Leider falsch."
    })),
    generated_at: new Date().toISOString(),
    generator_provider: GENERATOR_PROVIDER,
    validator_provider: VALIDATOR_PROVIDER,
    version: 5
  };
}

function applyCorrections(questions: any[], corrections: any[]): any[] {
  if (!corrections?.length) return questions;
  const corrected = [...questions];
  for (const fix of corrections) {
    const idx = fix.question_index;
    if (idx >= 0 && idx < corrected.length) {
      if (fix.corrected_question) corrected[idx].question = fix.corrected_question;
      if (fix.corrected_options?.length === 4) corrected[idx].options = fix.corrected_options;
      if (typeof fix.corrected_answer === "number") corrected[idx].correct_answer = fix.corrected_answer;
      if (fix.corrected_explanation) corrected[idx].explanation_correct = fix.corrected_explanation;
    }
  }
  return corrected;
}

/**
 * Load profession name from lesson → module → course → curriculum → berufe
 */
async function loadProfessionForLesson(supabase: any, lesson: any): Promise<string> {
  let professionName = "Auszubildende";
  try {
    if (!lesson.module_id) return professionName;
    const { data: moduleData } = await supabase.from("modules").select("course_id").eq("id", lesson.module_id).single();
    if (!moduleData?.course_id) return professionName;
    const { data: course } = await supabase.from("courses").select("curriculum_id").eq("id", moduleData.course_id).single();
    if (!course?.curriculum_id) return professionName;
    const { data: curriculum } = await supabase.from("curricula").select("title, beruf_id").eq("id", course.curriculum_id).maybeSingle();
    if (curriculum?.beruf_id) {
      const { data: beruf } = await supabase.from("berufe").select("bezeichnung_kurz, bezeichnung_lang").eq("id", curriculum.beruf_id).maybeSingle();
      if (beruf) professionName = beruf.bezeichnung_kurz || beruf.bezeichnung_lang || professionName;
    } else if (curriculum?.title) {
      const match = curriculum.title.replace(/^Rahmenlehrplan\s+/i, "").trim();
      if (match) professionName = match;
    }
  } catch { /* fallback */ }
  return professionName;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let batchLimit = 10;
    try { const body = await req.json(); if (body?.limit) batchLimit = Math.min(body.limit, 30); } catch { /* defaults */ }

    const { data: allMiniChecks, error: fetchErr } = await supabase
      .from("lessons")
      .select(`id, title, step, competency_id, content, module_id, competencies!inner(code, title, description)`)
      .eq("step", "mini_check").limit(batchLimit);

    if (fetchErr) throw fetchErr;

    const lessonsToFix = (allMiniChecks || []).filter((l: any) => {
      const c = l.content as any;
      if (!c?.questions || !Array.isArray(c.questions)) return true;
      const valid = c.questions.filter((q: any) => q?.text && q?.options?.length >= 4 && q.options.some((o: any) => o.is_correct === true));
      return valid.length < 3;
    });

    if (lessonsToFix.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All MiniChecks valid", fixed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let versionsCreated = 0, failed = 0, validated = 0, corrected = 0;
    const errors: string[] = [];

    for (const lesson of lessonsToFix) {
      const comp = (lesson as any).competencies;
      const code = comp?.code || "?";
      const title = comp?.title || lesson.title;
      const desc = comp?.description || "";

      // Load profession name for this lesson's course
      const professionName = await loadProfessionForLesson(supabase, lesson);

      try {
        // STEP 1: GENERATE via Gateway with profession context
        const genResult = await callAIJSON({
          provider: GENERATOR_PROVIDER,
          messages: [
            { role: "system", content: `Du bist ein erfahrener IHK-Prüfungsexperte für ${professionName}. Erstelle ausschließlich fachlich korrekte, prüfungsrelevante Fragen mit konkretem Bezug zum Berufsalltag von ${professionName}. Nutze IMMER die bereitgestellte Funktion.` },
            { role: "user", content: `Erstelle einen Mini-Check Quiz für ${professionName}:\n**Kompetenz:** ${code} – ${title}\n**Beschreibung:** ${desc}\n\nEXAKT 4 Multiple-Choice-Fragen mit je 4 Optionen.\nJede Frage muss ein berufsspezifisches Szenario für ${professionName} enthalten.\nDistraktoren müssen typische Denkfehler von ${professionName} abbilden.\nNutze die Funktion create_mini_check.` }
          ],
          tools: [MINICHECK_TOOL],
          tool_choice: { type: "function", function: { name: "create_mini_check" } },
          temperature: 0.7,
        });

        const genArgs = genResult.toolCalls?.[0]?.function?.arguments;
        const parsed = genArgs ? JSON.parse(genArgs) : null;
        if (!parsed?.questions || parsed.questions.length < 3) { errors.push(`${code}: Generator returned ${parsed?.questions?.length ?? 0} questions`); failed++; continue; }

        const structValid = parsed.questions.every((q: any) => q?.question && q?.options?.length === 4 && typeof q?.correct_answer === "number");
        if (!structValid) { errors.push(`${code}: Structural validation failed`); failed++; continue; }

        // STEP 2: VALIDATE via Gateway (Anthropic) with profession context
        const valResult = await callAIJSON({
          provider: VALIDATOR_PROVIDER,
          messages: [
            { role: "system", content: `Du bist ein unabhängiger Qualitätsprüfer für IHK-Prüfungsinhalte im Bereich ${professionName}. Prüfe ob die Fragen fachlich korrekt, berufsspezifisch und auf IHK-Prüfungsniveau für ${professionName} sind. Sei streng aber fair. Nutze IMMER die bereitgestellte Funktion.` },
            { role: "user", content: `Bewerte den folgenden Mini-Check Quiz für "${professionName}" (${code} – ${title}):\n${JSON.stringify(parsed.questions, null, 2)}\n\nNutze validate_mini_check.` }
          ],
          tools: [VALIDATION_TOOL],
          tool_choice: { type: "function", function: { name: "validate_mini_check" } },
          max_tokens: 3000,
        });

        const valArgs = valResult.toolCalls?.[0]?.function?.arguments;
        const valParsed = valArgs ? JSON.parse(valArgs) : null;
        validated++;

        if (valParsed) {
          const criticalIssues = (valParsed.issues || []).filter((i: any) => i.severity === "critical");
          if (criticalIssues.length > 0 && !valParsed.overall_valid && valParsed.score < 60) {
            errors.push(`${code}: Rejected by validator (score=${valParsed.score})`); failed++;
            await supabase.from("ai_generations").insert({ entity_type: "minicheck_validation", entity_id: lesson.id, generator_model: GENERATOR_PROVIDER, status: "rejected", output_content: parsed, validation_score: valParsed.score, validation_decision: "rejected", metadata: { validator_model: VALIDATOR_PROVIDER, issues: valParsed.issues, profession: professionName } });
            continue;
          }
          if (valParsed.corrections?.length > 0) { parsed.questions = applyCorrections(parsed.questions, valParsed.corrections); corrected++; }
        }

        // STEP 3: CREATE CONTENT VERSION
        const playerContent = toPlayerFormat(parsed.questions.slice(0, 4));
        playerContent.validation_score = valParsed?.score ?? null;
        playerContent.validation_status = valParsed?.overall_valid ? "approved" : "approved_with_corrections";

        const { data: moduleData } = await supabase.from("modules").select("course_id").eq("id", lesson.module_id).single();
        const courseId = moduleData?.course_id;
        if (!courseId) { errors.push(`${code}: No course_id found`); failed++; continue; }

        const { data: newVersion, error: vErr } = await supabase.from("content_versions").insert({
          course_id: courseId, lesson_id: lesson.id, step_key: "step_5_minicheck", content_json: playerContent,
          created_by_agent: `dual-llm:${GENERATOR_PROVIDER}+${VALIDATOR_PROVIDER}`, status: "under_review", council_round: 1,
          entity_type: "minicheck", quality_score: valParsed?.score ?? null,
        }).select("id").single();

        if (vErr) { errors.push(`${code}: Version creation error`); failed++; continue; }

        await supabase.from("council_messages").insert({ content_version_id: newVersion!.id, agent_name: `dual-llm:${GENERATOR_PROVIDER}`, message_type: "proposal", message_json: { source: "regenerate-minichecks", generator: GENERATOR_PROVIDER, validator: VALIDATOR_PROVIDER, validation_score: valParsed?.score, issues_count: valParsed?.issues?.length ?? 0, profession: professionName } });

        supabase.from("minicheck_questions").upsert(
          playerContent.questions.map((pq: any) => ({ lesson_id: lesson.id, question_text: pq.text, options: pq.options.map((o: any) => o.text), correct_option_index: pq.options.findIndex((o: any) => o.is_correct), explanation: pq.explanation_correct, difficulty: "medium", competency_id: lesson.competency_id })),
          { onConflict: "lesson_id,question_text" }
        ).then(() => {}).catch(e => console.warn(`[AUDIT] ${code}: minicheck_questions upsert failed:`, e));

        versionsCreated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        errors.push(`${code}: ${msg}`); failed++;
      }
    }

    return new Response(JSON.stringify({ success: true, pipeline: { generator: GENERATOR_PROVIDER, validator: VALIDATOR_PROVIDER }, versionsCreated, failed, validated, corrected, total: lessonsToFix.length, errors: errors.length ? errors : undefined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" }
    });
  }
});
