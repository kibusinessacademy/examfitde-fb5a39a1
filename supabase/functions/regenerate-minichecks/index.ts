import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Regenerate MiniChecks — Dual-LLM Pipeline (Direct API):
 * 1. Generator: OpenAI GPT-5.2 (direct API)
 * 2. Validator: Anthropic Claude Opus 4.6 (direct API)
 * 
 * Output: MiniCheckPlayer-compatible JSON
 */

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GENERATOR_MODEL = "gpt-5.2";
const VALIDATOR_MODEL = "claude-opus-4-6";

const MINICHECK_TOOL = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Create a mini-check quiz with exactly 4 questions. Each question has exactly 4 options, one correct.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "Question text in German" },
              options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" }
              },
              correct_answer: {
                type: "integer",
                description: "Index 0-3 of the correct option",
                minimum: 0,
                maximum: 3
              },
              explanation_correct: { type: "string", description: "Why the correct answer is right" },
              explanation_wrong: { type: "string", description: "Common misconception / why others are wrong" }
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
  type: "function",
  function: {
    name: "validate_mini_check",
    description: "Validate a mini-check quiz for IHK exam quality standards.",
    parameters: {
      type: "object",
      properties: {
        overall_valid: { type: "boolean", description: "Whether the quiz passes IHK quality standards" },
        score: { type: "integer", description: "Quality score 0-100", minimum: 0, maximum: 100 },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_index: { type: "integer" },
              issue_type: { type: "string", enum: ["factual_error", "ambiguous", "wrong_answer", "weak_distractor", "off_topic", "taxonomy_mismatch"] },
              description: { type: "string" },
              severity: { type: "string", enum: ["critical", "warning", "info"] }
            },
            required: ["question_index", "issue_type", "description", "severity"]
          }
        },
        corrections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_index: { type: "integer" },
              corrected_question: { type: "string" },
              corrected_options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
              corrected_answer: { type: "integer", minimum: 0, maximum: 3 },
              corrected_explanation: { type: "string" }
            },
            required: ["question_index"]
          }
        }
      },
      required: ["overall_valid", "score", "issues"]
    }
  }
};

/** Convert AI output → MiniCheckPlayer format */
function toPlayerFormat(aiQuestions: any[]): any {
  return {
    type: "mini_check",
    questions: aiQuestions.map((q, qi) => ({
      id: `q${qi + 1}`,
      text: q.question,
      options: q.options.map((opt: string, oi: number) => ({
        id: `q${qi + 1}_o${oi + 1}`,
        text: opt,
        is_correct: oi === q.correct_answer
      })),
      explanation_correct: q.explanation_correct || "Richtig!",
      explanation_wrong: q.explanation_wrong || "Leider falsch."
    })),
    generated_at: new Date().toISOString(),
    generator_model: GENERATOR_MODEL,
    validator_model: VALIDATOR_MODEL,
    version: 4
  };
}

/** Call OpenAI API directly */
async function callOpenAI(apiKey: string, model: string, messages: any[], tools?: any[], toolChoice?: any, maxTokens = 3000): Promise<any> {
  const body: any = { model, messages, max_completion_tokens: maxTokens };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const resp = await fetch(OPENAI_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/** Call Anthropic API directly */
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string, tools?: any[], toolChoice?: any, maxTokens = 3000): Promise<any> {
  const body: any = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  };
  if (tools) {
    // Convert OpenAI tool format to Anthropic format
    body.tools = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }
  if (toolChoice) {
    body.tool_choice = { type: "tool", name: toolChoice.function?.name || toolChoice };
  }

  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/** Extract tool call arguments from OpenAI response */
function extractOpenAIToolArgs(aiResponse: any): any | null {
  const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return null;
  try { return JSON.parse(toolCall.function.arguments); } catch { return null; }
}

/** Extract tool call arguments from Anthropic response */
function extractAnthropicToolArgs(aiResponse: any): any | null {
  const toolBlock = aiResponse.content?.find((b: any) => b.type === "tool_use");
  if (!toolBlock?.input) return null;
  return toolBlock.input;
}

/** Apply validator corrections to questions */
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

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let batchLimit = 10; // Smaller batches for dual-LLM (more API calls per item)
    try {
      const body = await req.json();
      if (body?.limit) batchLimit = Math.min(body.limit, 30);
    } catch { /* defaults */ }

    // Find empty MiniChecks
    const { data: allMiniChecks, error: fetchErr } = await supabase
      .from("lessons")
      .select(`id, title, step, competency_id, content, competencies!inner(code, title, description)`)
      .eq("step", "mini_check")
      .limit(batchLimit);

    if (fetchErr) throw fetchErr;

    const lessonsToFix = (allMiniChecks || []).filter((l: any) => {
      const c = l.content as any;
      if (!c?.questions || !Array.isArray(c.questions)) return true;
      const valid = c.questions.filter((q: any) =>
        q?.text && q?.options?.length >= 4 && q.options.some((o: any) => o.is_correct === true)
      );
      return valid.length < 3;
    });

    if (lessonsToFix.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All MiniChecks valid", fixed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`[MiniCheck Pipeline] ${lessonsToFix.length} to process (Generator: ${GENERATOR_MODEL}, Validator: ${VALIDATOR_MODEL})`);

    let fixed = 0, failed = 0, validated = 0, corrected = 0;
    const errors: string[] = [];

    for (const lesson of lessonsToFix) {
      const comp = (lesson as any).competencies;
      const code = comp?.code || "?";
      const title = comp?.title || lesson.title;
      const desc = comp?.description || "";

      try {
        // ═══════════════════════════════════════
        // STEP 1: GENERATE (GPT-5.2)
        // ═══════════════════════════════════════
        console.log(`[GEN] ${code}: ${title}`);

        const genPrompt = `Du bist ein erfahrener IHK-Prüfungsexperte für den Beruf Bestattungsfachkraft. 
Erstelle einen Mini-Check Quiz für folgende Kompetenz:

**Kompetenz:** ${code} – ${title}
**Beschreibung:** ${desc}

QUALITÄTSANFORDERUNGEN (IHK-sehr-gut Standard):
1. EXAKT 4 Multiple-Choice-Fragen auf IHK-Prüfungsniveau
2. Jede Frage hat EXAKT 4 Antwortmöglichkeiten
3. Nur EINE Antwort ist korrekt
4. Alle Distraktoren müssen fachlich plausibel klingen (typische Denkfehler/Verwechslungen)
5. Fragen müssen EXAKT zur Kompetenz passen – keine fachfremden Inhalte
6. Praxisbezug: mindestens 2 Fragen mit Fallbeispiel/Situationsbeschreibung
7. Taxonomie: Mischung aus Wissen (1 Frage), Verstehen (1), Anwenden (2)
8. explanation_correct: Fachlich fundiert, warum die Antwort stimmt (mit Rechtsgrundlage wenn relevant)
9. explanation_wrong: Häufigster Denkfehler und warum die Distraktoren falsch sind

VERBOTEN:
- Generische Fragen ohne Bezug zur Bestattungsbranche
- Offensichtlich falsche Distraktoren
- Fragen zu CNC, Metallbearbeitung oder branchenfremden Themen

Nutze die Funktion create_mini_check.`;

        const genResult = await callOpenAI(
          OPENAI_KEY,
          GENERATOR_MODEL,
          [
            { role: "system", content: "Du bist ein deutscher IHK-Prüfungsexperte für Bestattungsfachkräfte. Erstelle ausschließlich fachlich korrekte, prüfungsrelevante Inhalte. Nutze IMMER die bereitgestellte Funktion." },
            { role: "user", content: genPrompt }
          ],
          [MINICHECK_TOOL],
          { type: "function", function: { name: "create_mini_check" } }
        );

        const genArgs = extractOpenAIToolArgs(genResult);
        if (!genArgs?.questions || genArgs.questions.length < 3) {
          errors.push(`${code}: Generator returned ${genArgs?.questions?.length ?? 0} questions`);
          failed++;
          continue;
        }

        // Basic structural validation
        const structValid = genArgs.questions.every((q: any) =>
          q?.question && q?.options?.length === 4 &&
          typeof q?.correct_answer === "number" && q.correct_answer >= 0 && q.correct_answer <= 3
        );
        if (!structValid) {
          errors.push(`${code}: Structural validation failed`);
          failed++;
          continue;
        }

        // ═══════════════════════════════════════
        // STEP 2: VALIDATE (Independent model)
        // ═══════════════════════════════════════
        console.log(`[VAL] ${code}: Validating ${genArgs.questions.length} questions...`);

        const valPrompt = `Du bist ein unabhängiger IHK-Qualitätsprüfer. Bewerte den folgenden Mini-Check Quiz für die Kompetenz "${code} – ${title}" (Bestattungsfachkraft).

QUIZ ZUR PRÜFUNG:
${JSON.stringify(genArgs.questions, null, 2)}

PRÜFKRITERIEN (gewichtet):
1. Fachliche Korrektheit (30%): Stimmen alle Antworten faktisch? Ist die als korrekt markierte Antwort tatsächlich richtig?
2. Kompetenz-Passung (25%): Passen ALLE Fragen zur angegebenen Kompetenz? Keine branchenfremden Inhalte?
3. Distraktoren-Qualität (20%): Sind falsche Antworten plausibel aber eindeutig falsch?
4. Prüfungsrelevanz (15%): IHK-Niveau? Praxisbezug vorhanden?
5. Didaktische Qualität (10%): Sind Erklärungen hilfreich und korrekt?

WICHTIG:
- Markiere factual_error als CRITICAL wenn die korrekte Antwort falsch ist
- Markiere off_topic als CRITICAL wenn Fragen nicht zur Bestattungsbranche passen
- Bei korrigierbaren Fehlern: Liefere corrections mit

Nutze validate_mini_check.`;

        const valResult = await callAnthropic(
          ANTHROPIC_KEY,
          VALIDATOR_MODEL,
          "Du bist ein unabhängiger Qualitätsprüfer für IHK-Prüfungsinhalte. Deine Aufgabe ist die objektive, kritische Bewertung. Sei streng aber fair. Nutze IMMER die bereitgestellte Funktion.",
          valPrompt,
          [VALIDATION_TOOL],
          { function: { name: "validate_mini_check" } }
        );

        const valArgs = extractAnthropicToolArgs(valResult);
        validated++;

        if (!valArgs) {
          console.warn(`[VAL] ${code}: Validator returned no structured output, using generator output as-is`);
        } else {
          console.log(`[VAL] ${code}: Score=${valArgs.score}, Valid=${valArgs.overall_valid}, Issues=${valArgs.issues?.length || 0}`);

          // Check for critical issues
          const criticalIssues = (valArgs.issues || []).filter((i: any) => i.severity === "critical");
          
          if (criticalIssues.length > 0 && !valArgs.overall_valid && valArgs.score < 60) {
            // Too many critical issues — reject entirely
            errors.push(`${code}: Rejected by validator (score=${valArgs.score}, ${criticalIssues.length} critical issues)`);
            failed++;

            // Log rejection for audit
            await supabase.from("ai_generations").insert({
              entity_type: "minicheck_validation",
              entity_id: lesson.id,
              generator_model: GENERATOR_MODEL,
              status: "rejected",
              output_content: genArgs,
              validation_score: valArgs.score,
              validation_decision: "rejected",
              metadata: { validator_model: VALIDATOR_MODEL, issues: valArgs.issues }
            });

            continue;
          }

          // Apply corrections if validator provided them
          if (valArgs.corrections?.length > 0) {
            console.log(`[VAL] ${code}: Applying ${valArgs.corrections.length} corrections`);
            genArgs.questions = applyCorrections(genArgs.questions, valArgs.corrections);
            corrected++;
          }
        }

        // ═══════════════════════════════════════
        // STEP 3: SAVE (validated content) — fast path, single write first
        // ═══════════════════════════════════════
        const playerContent = toPlayerFormat(genArgs.questions.slice(0, 4));
        playerContent.validation_score = valArgs?.score ?? null;
        playerContent.validation_status = valArgs?.overall_valid ? "approved" : "approved_with_corrections";

        // Critical write first — save to lessons table immediately
        const { error: updErr } = await supabase
          .from("lessons")
          .update({ content: playerContent })
          .eq("id", lesson.id);

        if (updErr) {
          errors.push(`${code}: DB error`);
          failed++;
          continue;
        }

        console.log(`✅ ${code}: Generated + Validated (score=${valArgs?.score ?? "N/A"})`);
        fixed++;

        // Non-critical writes — fire and forget (don't block on these)
        const mcRows = playerContent.questions.map((pq: any) => ({
          lesson_id: lesson.id,
          question_text: pq.text,
          options: pq.options.map((o: any) => o.text),
          correct_option_index: pq.options.findIndex((o: any) => o.is_correct),
          explanation: pq.explanation_correct,
          difficulty: "medium",
          competency_id: lesson.competency_id
        }));

        // Batch upsert + audit log in parallel, non-blocking
        Promise.all([
          supabase.from("minicheck_questions").upsert(mcRows, { onConflict: "lesson_id,question_text" }),
          supabase.from("ai_generations").insert({
            entity_type: "minicheck",
            entity_id: lesson.id,
            generator_model: GENERATOR_MODEL,
            status: "approved",
            output_content: playerContent,
            validation_score: valArgs?.score ?? null,
            validation_decision: valArgs?.overall_valid ? "approved" : "approved_with_corrections",
            metadata: { validator_model: VALIDATOR_MODEL, issues_count: valArgs?.issues?.length ?? 0, corrections_applied: valArgs?.corrections?.length ?? 0, competency_code: code }
          })
        ]).catch(e => console.warn(`[AUDIT] ${code}: non-critical write failed:`, e));

      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        console.error(`❌ ${code}: ${msg}`);
        errors.push(`${code}: ${msg}`);
        failed++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pipeline: { generator: GENERATOR_MODEL, validator: VALIDATOR_MODEL },
      fixed,
      failed,
      validated,
      corrected,
      total: lessonsToFix.length,
      errors: errors.length ? errors : undefined
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("regenerate-minichecks error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
