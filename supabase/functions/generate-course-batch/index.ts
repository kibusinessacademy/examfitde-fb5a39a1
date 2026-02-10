import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * generate-course-batch – SSOT Blueprint Pipeline (FINAL)
 *
 * Generator:  GPT-5.2 via Lovable AI Gateway
 * Validator:  Claude Opus 4 (automatic, per lesson)
 *
 * Sort logic:
 *   Module  → learning_field.sort_order (fallback: parse LF-code → int)
 *   Lesson  → (competency.sort_order * 10) + stepIndex  (deterministic & unique)
 *
 * Status flow:  draft → generated → validated → approved → published
 *   - Opus approve  → status=validated, qc_status=passed, content.qc={…}
 *   - Opus revise   → status=draft, qc_status=needs_patch + patch_proposal
 *   - Opus reject   → status=draft, qc_status=rejected  + patch_proposal
 *
 * MiniCheck questions are persisted to `minicheck_questions` table.
 *
 * Modes:
 *   MODE 1 – single competency/step generation (1 AI call, fits 60 s)
 *   MODE 2 – finalize course (aggregate duration, trigger QC pipeline)
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;
type LessonStep = (typeof LESSON_STEPS)[number];

const STEP_INDEX: Record<LessonStep, number> = {
  einstieg: 0,
  verstehen: 1,
  anwenden: 2,
  wiederholen: 3,
  mini_check: 4,
};

const STEP_DURATION: Record<LessonStep, number> = {
  einstieg: 10,
  verstehen: 25,
  anwenden: 30,
  wiederholen: 15,
  mini_check: 10,
};

const STEP_PROMPTS: Record<string, string> = {
  einstieg:
    "Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt. Nutze ein konkretes Praxisszenario aus dem Berufsalltag.",
  verstehen:
    "Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Gegenbeispielen und IHK-Prüfungsbezügen. Markiere prüfungsrelevante Inhalte mit ⭐.",
  anwenden:
    "Erstelle ein Entscheidungsszenario (KEINE reine Beschreibung). Der Lernende muss eine berufliche Entscheidung treffen und begründen. Zeige typische Prüfungsfallen mit ⚠️.",
  wiederholen:
    "Erstelle Wiederholungsaktivitäten mit Zusammenfassung, Karteikarten und typischen IHK-Prüfungsfragen zum Thema.",
  mini_check: "Erstelle strukturierte Prüfungsfragen zur Selbstüberprüfung.",
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface MiniCheckQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

interface Competency {
  id: string;
  title: string;
  description?: string;
  taxonomy_level?: string;
  code?: string;
  sort_order?: number;
}

interface AIProvider {
  url: string;
  headers: Record<string, string>;
  model: string;
}

// ─── Tool definition for MiniCheck structured output ────────────────────────

const MINI_CHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description:
      "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung mit je 4 Antwortoptionen.",
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
              explanation: { type: "string" },
            },
            required: ["question", "options", "correct_answer", "explanation"],
            additionalProperties: false,
          },
          minItems: 4,
          maxItems: 5,
        },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["questions", "objectives"],
      additionalProperties: false,
    },
  },
};

// ─── AI provider resolution ─────────────────────────────────────────────────

function resolveProvider(provider?: string): AIProvider {
  if (provider === "deepseek") {
    const key = Deno.env.get("DEEPSEEK_API_KEY");
    if (!key) throw new Error("DEEPSEEK_API_KEY not configured");
    return {
      url: "https://api.deepseek.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      model: "deepseek-chat",
    };
  }
  // Default: GPT-5.2 via Lovable AI Gateway
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    model: "openai/gpt-5.2",
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse LF code like "LF05" → 5. Returns 999 as fallback. */
function parseLfSortOrder(code?: string | null): number {
  if (!code) return 999;
  const m = code.match(/LF(\d+)/i);
  return m ? parseInt(m[1], 10) : 999;
}

/** Safe JSON parse from AI output */
function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return null;
  }
}

/** Build a dedupe key for patch proposals */
function patchDedupeKey(lessonId: string, step: string): string {
  return `lesson_qc_${lessonId}_${step}`;
}

// ─── Content generation ─────────────────────────────────────────────────────

async function generateRegularContent(
  ai: AIProvider,
  comp: Competency,
  step: string,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(ai.url, {
      method: "POST",
      headers: ai.headers,
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: "system",
            content: `Du bist ein IHK-Experte für berufliche Ausbildungsinhalte.
Erstelle strukturierte, praxisnahe Lerninhalte im JSON-Format.
WICHTIG: Jede Lektion MUSS einen expliziten IHK-Prüfungsbezug enthalten.
Markiere prüfungsrelevante Stellen mit ⭐ und häufige Fehlerquellen mit ⚠️.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt.`,
          },
          {
            role: "user",
            content: `Erstelle Lerninhalt für:

Kompetenz: ${comp.title}
Beschreibung: ${comp.description || "Keine Beschreibung"}
Taxonomiestufe: ${comp.taxonomy_level || "Anwenden"}

Lernschritt: ${step}
Aufgabe: ${STEP_PROMPTS[step]}

Format (JSON):
{
  "type": "text",
  "html": "<h3>Titel</h3><p>Ausführlicher Inhalt mit IHK-Prüfungsbezug...</p>",
  "objectives": ["Lernziel 1", "Lernziel 2", "Lernziel 3"],
  "ihk_relevanz": "Beschreibung der Prüfungsrelevanz"
}`,
          },
        ],
        temperature: 0.7,
      }),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    const text = result.choices?.[0]?.message?.content;
    return text ? safeParseJson(text) : null;
  } catch (err) {
    console.error(`[AI] Regular content error for ${step}:`, err);
    return null;
  }
}

async function generateMiniCheck(
  ai: AIProvider,
  comp: Competency,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(ai.url, {
      method: "POST",
      headers: ai.headers,
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: "system",
            content: `Du bist ein IHK-Prüfungsexperte. Erstelle realistische Multiple-Choice-Fragen auf IHK-Prüfungsniveau.
Jede Frage muss praxisbezogen sein mit plausiblen Distraktoren.`,
          },
          {
            role: "user",
            content: `Erstelle 4 Multiple-Choice-Fragen für:
Kompetenz: ${comp.title}
Beschreibung: ${comp.description || "Keine Beschreibung"}
Taxonomiestufe: ${comp.taxonomy_level || "Anwenden"}`,
          },
        ],
        tools: [MINI_CHECK_TOOL],
        tool_choice: { type: "function", function: { name: "create_mini_check" } },
        temperature: 0.7,
      }),
    });
    if (!resp.ok) return null;

    const result = await resp.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) return null;

    const parsed = JSON.parse(toolCall.function.arguments);
    if (!Array.isArray(parsed.questions) || parsed.questions.length < 3) return null;

    const valid = parsed.questions.filter(
      (q: MiniCheckQuestion) =>
        q.question &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.correct_answer === "number" &&
        q.correct_answer >= 0 &&
        q.correct_answer <= 3 &&
        q.explanation,
    );
    if (valid.length < 3) return null;

    const html = valid
      .map(
        (q: MiniCheckQuestion, i: number) =>
          `<div class="question-preview"><strong>Frage ${i + 1}:</strong> ${q.question}</div>`,
      )
      .join("");

    return {
      type: "mini_check",
      html: `<h3>Wissensüberprüfung: ${comp.title}</h3><p>Teste dein Wissen mit ${valid.length} Multiple-Choice-Fragen.</p>${html}`,
      objectives: parsed.objectives || [`Wissen zu ${comp.title} überprüfen`],
      questions: valid,
    };
  } catch (err) {
    console.error("[AI] MiniCheck error:", err);
    return null;
  }
}

// ─── Generate + track in ai_generations ─────────────────────────────────────

async function generateAndTrack(
  supabase: ReturnType<typeof createClient>,
  ai: AIProvider,
  comp: Competency,
  step: string,
  courseId: string,
): Promise<{ content: Record<string, unknown> | null; generationId: string | null }> {
  // Create tracking record
  const { data: genRec } = await supabase
    .from("ai_generations")
    .insert({
      entity_type: "lesson",
      generator_model: ai.model,
      input_context: { competency: comp.title, step, taxonomy: comp.taxonomy_level, courseId },
      output_content: {},
      status: "draft",
      metadata: { provider: ai.model, competencyCode: comp.code },
    })
    .select("id")
    .single();

  const generationId = genRec?.id || null;
  const content =
    step === "mini_check"
      ? await generateMiniCheck(ai, comp)
      : await generateRegularContent(ai, comp, step);

  if (generationId && content) {
    await supabase
      .from("ai_generations")
      .update({ output_content: content, status: "generated" })
      .eq("id", generationId);
  }

  return { content, generationId };
}

// ─── Opus Validation ────────────────────────────────────────────────────────

async function validateWithOpus(
  supabase: ReturnType<typeof createClient>,
  content: Record<string, unknown>,
  comp: Competency,
  step: string,
  generationId: string,
): Promise<{ score: number; decision: string; suggestedFixes: string[] }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { score: 0, decision: "skip", suggestedFixes: [] };

  try {
    const t0 = Date.now();
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 2048,
        system: `Du bist ein IHK-Qualitätsprüfer. Validiere den KI-generierten Lerninhalt.
BEWERTUNG: fachlichkeit (30%), didaktik (25%), pruefungsrelevanz (20%), klarheit (15%), vollstaendigkeit (10%)
REGELN: Kein IHK-Bezug → max 75. Anwenden ohne Entscheidung → max 80. Halluzination → reject.
Antworte NUR mit JSON: {"overall_score":0-100,"decision":"approve|revise|reject","dimension_scores":{...},"critical_issues":[...],"suggested_fixes":[...]}`,
        messages: [
          {
            role: "user",
            content: `Kompetenz: ${comp.title}\nCode: ${comp.code}\nTaxonomie: ${comp.taxonomy_level || "Anwenden"}\nSchritt: ${step}\n\nINHALT:\n${JSON.stringify(content)}`,
          },
        ],
      }),
    });

    const latencyMs = Date.now() - t0;
    if (!resp.ok) return { score: 0, decision: "error", suggestedFixes: [] };

    const valData = await resp.json();
    const rawText = valData.content?.[0]?.text || "";
    const result = safeParseJson(rawText);
    if (!result) return { score: 0, decision: "parse_error", suggestedFixes: [] };

    const score = (result.overall_score as number) || 0;
    const decision = (result.decision as string) || "revise";
    const suggestedFixes = (result.suggested_fixes as string[]) || [];

    // Persist validation result
    await supabase.from("ai_validations").insert({
      generation_id: generationId,
      validator_model: "claude-opus-4-20250514",
      validation_mode: "automatic",
      overall_score: score,
      decision,
      dimension_scores: result.dimension_scores || {},
      critical_issues: result.critical_issues || [],
      suggested_fixes: suggestedFixes,
      input_tokens: valData.usage?.input_tokens || 0,
      output_tokens: valData.usage?.output_tokens || 0,
      cost_eur: 0,
      latency_ms: latencyMs,
    });

    // Update generation status
    await supabase
      .from("ai_generations")
      .update({
        validation_decision: decision,
        validation_score: score,
        status: decision === "approve" ? "validated" : "draft",
      })
      .eq("id", generationId);

    // Quality gate record
    await supabase.from("ai_quality_gates").insert({
      generation_id: generationId,
      gate_type: "auto_validation",
      gate_status: decision === "approve" ? "passed" : "failed",
      required_score: 85,
      actual_score: score,
      decided_at: new Date().toISOString(),
      reason: `Opus ${score}/100 → ${decision}`,
    });

    console.log(`[Opus] ${comp.code}/${step}: Score ${score}, Decision: ${decision}`);
    return { score, decision, suggestedFixes };
  } catch (err) {
    console.error("[Opus] Validation error:", err);
    return { score: 0, decision: "error", suggestedFixes: [] };
  }
}

// ─── Patch Proposal (on revise/reject) ──────────────────────────────────────

async function createPatchProposal(
  supabase: ReturnType<typeof createClient>,
  lessonId: string,
  step: string,
  currentContent: Record<string, unknown>,
  suggestedFixes: string[],
  decision: string,
  score: number,
): Promise<void> {
  const dedupeKey = patchDedupeKey(lessonId, step);

  // Check for existing open proposal with same dedupe key → skip if exists
  const { data: existing } = await supabase
    .from("patch_proposals")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["draft", "validated"])
    .maybeSingle();

  if (existing) {
    console.log(`[Patch] Dedupe hit for ${dedupeKey}, skipping proposal`);
    return;
  }

  await supabase.from("patch_proposals").insert({
    council_id: "opus_qc",
    entity_type: "lesson",
    entity_id: lessonId,
    patch_type: "content_improvement",
    before: currentContent,
    after: { ...currentContent, _suggested_fixes: suggestedFixes },
    diff_summary: `Opus QC ${decision} (${score}/100): ${suggestedFixes.slice(0, 3).join("; ")}`,
    status: "draft",
    risk: decision === "reject" ? "high" : "medium",
    dedupe_key: dedupeKey,
  });

  console.log(`[Patch] Created proposal for lesson ${lessonId} (${decision}, ${score}/100)`);
}

// ─── Persist MiniCheck questions ────────────────────────────────────────────

async function persistMiniChecks(
  supabase: ReturnType<typeof createClient>,
  lessonId: string,
  questions: MiniCheckQuestion[],
  compCode: string,
): Promise<void> {
  if (!questions.length) return;

  const rows = questions.map((q, idx) => ({
    lesson_id: lessonId,
    question_text: q.question || `Frage ${idx + 1}`,
    options: q.options || [],
    correct_answer: q.correct_answer ?? 0,
    explanation: q.explanation || null,
  }));

  const { error } = await supabase.from("minicheck_questions").insert(rows);
  if (error) console.error(`[Batch] MiniCheck persist error for ${compCode}:`, error);
  else console.log(`[Batch] Persisted ${rows.length} MiniCheck questions for ${compCode}`);
}

// ─── Ensure module exists with correct sort ─────────────────────────────────

async function ensureModule(
  supabase: ReturnType<typeof createClient>,
  courseId: string,
  learningFieldId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("modules")
    .select("id")
    .eq("course_id", courseId)
    .eq("learning_field_id", learningFieldId)
    .maybeSingle();

  if (existing) {
    // Sync sort_order + learning_field_code from LF
    const { data: lf } = await supabase
      .from("learning_fields")
      .select("sort_order, code")
      .eq("id", learningFieldId)
      .single();
    if (lf) {
      const sortOrder = lf.sort_order || parseLfSortOrder(lf.code);
      await supabase
        .from("modules")
        .update({ sort_order: sortOrder, learning_field_code: lf.code || null })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  // Create new module
  const { data: lf } = await supabase
    .from("learning_fields")
    .select("*")
    .eq("id", learningFieldId)
    .single();
  if (!lf) throw new Error("Learning field not found");

  const sortOrder = lf.sort_order || parseLfSortOrder(lf.code);
  const { data: mod, error } = await supabase
    .from("modules")
    .insert({
      course_id: courseId,
      learning_field_id: learningFieldId,
      title: `${lf.code}: ${lf.title}`,
      description: lf.description,
      sort_order: sortOrder,
      learning_field_code: lf.code || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return mod.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Main handler ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const {
      courseId,
      curriculumId,
      learningFieldId,
      competencyId,
      provider,
      skipValidation = false,
      step: requestedStep,
      autoPilot = false,
      _iteration = 0,
    } = body;

    if (!courseId || !curriculumId) {
      return new Response(
        JSON.stringify({ error: "courseId and curriculumId are required" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ai = resolveProvider(provider);

    // ── MODE 1: Single competency/step generation ───────────────────────

    if (learningFieldId && competencyId) {
      const targetStep = requestedStep as LessonStep | undefined;
      const moduleId = await ensureModule(supabase, courseId, learningFieldId);

      // Load competency
      const { data: comp } = await supabase
        .from("competencies")
        .select("*")
        .eq("id", competencyId)
        .single();
      if (!comp) throw new Error("Competency not found");

      // Determine step to generate
      let stepToGen: LessonStep | null = null;

      if (targetStep && LESSON_STEPS.includes(targetStep)) {
        const { data: ex } = await supabase
          .from("lessons")
          .select("id")
          .eq("module_id", moduleId)
          .eq("competency_id", comp.id)
          .eq("step", targetStep)
          .maybeSingle();
        if (ex) {
          return new Response(
            JSON.stringify({
              success: true,
              skipped: true,
              step: targetStep,
              competencyCode: comp.code,
              message: "Step already exists",
            }),
            { headers: jsonHeaders },
          );
        }
        stepToGen = targetStep;
      } else {
        for (const s of LESSON_STEPS) {
          const { data: ex } = await supabase
            .from("lessons")
            .select("id")
            .eq("module_id", moduleId)
            .eq("competency_id", comp.id)
            .eq("step", s)
            .maybeSingle();
          if (!ex) {
            stepToGen = s;
            break;
          }
        }
        if (!stepToGen) {
          return new Response(
            JSON.stringify({
              success: true,
              complete: true,
              competencyCode: comp.code,
              message: "All steps already exist",
            }),
            { headers: jsonHeaders },
          );
        }
      }

      console.log(`[Batch] Generating ${comp.code} / ${stepToGen}`);

      // Deterministic sort_order
      const lessonSortOrder = (comp.sort_order || 0) * 10 + STEP_INDEX[stepToGen];

      // Generate content
      const { content: lessonContent, generationId } = await generateAndTrack(
        supabase,
        ai,
        comp,
        stepToGen,
        courseId,
      );

      // Fallback placeholder if AI failed
      const finalContent =
        lessonContent ||
        (stepToGen === "mini_check"
          ? {
              type: "mini_check",
              html: `<h3>${comp.title}</h3><p>⚠️ Inhalt wird nachgeneriert.</p>`,
              objectives: [],
              questions: [],
              _needs_repair: true,
            }
          : {
              type: "text",
              html: `<h3>${comp.title} – ${stepToGen}</h3><p>⚠️ Inhalt wird nachgeneriert.</p>`,
              objectives: [],
              _needs_repair: true,
            });

      // ── Opus Validation Gate ────────────────────────────────────────

      let valDecision = "skip";
      let valScore = 0;
      let suggestedFixes: string[] = [];

      if (!skipValidation && generationId && lessonContent) {
        const val = await validateWithOpus(supabase, lessonContent, comp, stepToGen, generationId);
        valDecision = val.decision;
        valScore = val.score;
        suggestedFixes = val.suggestedFixes;
        console.log(`[Opus Gate] ${comp.code}/${stepToGen}: ${valDecision} (${valScore})`);
      }

      // Enrich content with QC metadata
      const contentWithQc = {
        ...finalContent,
        qc:
          valDecision !== "skip"
            ? { decision: valDecision, score: valScore, at: new Date().toISOString() }
            : undefined,
      };

      // Determine statuses
      const lessonStatus = valDecision === "approve" ? "validated" : "draft";
      const qcStatus =
        valDecision === "approve"
          ? "passed"
          : valDecision === "revise"
            ? "needs_patch"
            : valDecision === "reject"
              ? "rejected"
              : null;

      // Insert lesson
      const { data: inserted } = await supabase
        .from("lessons")
        .insert({
          module_id: moduleId,
          competency_id: comp.id,
          title: `${comp.code}: ${comp.title}`,
          step: stepToGen,
          content: contentWithQc,
          duration_minutes: STEP_DURATION[stepToGen],
          sort_order: lessonSortOrder,
          status: lessonStatus,
          qc_status: qcStatus,
        })
        .select("id")
        .single();

      // Persist MiniCheck questions
      if (
        stepToGen === "mini_check" &&
        inserted?.id &&
        Array.isArray((finalContent as any).questions) &&
        (finalContent as any).questions.length > 0
      ) {
        await persistMiniChecks(
          supabase,
          inserted.id,
          (finalContent as any).questions,
          comp.code || comp.id,
        );
      }

      // Auto-create patch proposal on revise/reject
      if (
        inserted?.id &&
        (valDecision === "revise" || valDecision === "reject") &&
        suggestedFixes.length > 0
      ) {
        await createPatchProposal(
          supabase,
          inserted.id,
          stepToGen,
          contentWithQc,
          suggestedFixes,
          valDecision,
          valScore,
        );
      }

      // Remaining steps
      const { data: doneLessons } = await supabase
        .from("lessons")
        .select("step")
        .eq("module_id", moduleId)
        .eq("competency_id", comp.id);
      const doneSteps = (doneLessons || []).map((l: any) => l.step);
      const remaining = LESSON_STEPS.filter((s) => !doneSteps.includes(s));

      return new Response(
        JSON.stringify({
          success: true,
          step: stepToGen,
          competencyCode: comp.code,
          generationId,
          hasContent: !!lessonContent,
          validation: { decision: valDecision, score: valScore },
          remaining: remaining.length,
          nextStep: remaining.length > 0 ? remaining[0] : null,
        }),
        { headers: jsonHeaders },
      );
    }

    // ── MODE 3: Auto-pilot – iterate all competencies via self-invocation ──

    if (autoPilot && !learningFieldId && !competencyId) {
      const MAX_ITERATIONS = 300; // 47 comps × 5 steps + safety margin
      if (_iteration >= MAX_ITERATIONS) {
        console.warn(`[AutoPilot] Hit max iterations (${MAX_ITERATIONS}), stopping`);
        return new Response(
          JSON.stringify({ success: true, autoPilot: true, stopped: "max_iterations", iteration: _iteration }),
          { headers: jsonHeaders },
        );
      }

      // Load all competencies for this curriculum
      const { data: allComps } = await supabase
        .from("competencies")
        .select("id, code, sort_order, learning_field_id, learning_fields!inner(id, curriculum_id)")
        .eq("learning_fields.curriculum_id", curriculumId)
        .order("sort_order");

      if (!allComps?.length) {
        return new Response(
          JSON.stringify({ error: "No competencies found for curriculum" }),
          { status: 404, headers: jsonHeaders },
        );
      }

      // Find next competency+step that doesn't have a lesson yet
      let nextComp: any = null;
      let nextStep: LessonStep | null = null;

      for (const comp of allComps) {
        const moduleId = await ensureModule(supabase, courseId, comp.learning_field_id);
        for (const s of LESSON_STEPS) {
          const { data: ex } = await supabase
            .from("lessons")
            .select("id")
            .eq("module_id", moduleId)
            .eq("competency_id", comp.id)
            .eq("step", s)
            .maybeSingle();
          if (!ex) {
            nextComp = comp;
            nextStep = s;
            break;
          }
        }
        if (nextComp) break;
      }

      if (!nextComp || !nextStep) {
        // All done – auto-finalize
        console.log(`[AutoPilot] All lessons generated after ${_iteration} iterations, finalizing...`);
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const finalizeRes = await fetch(`${supabaseUrl}/functions/v1/generate-course-batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ courseId, curriculumId }),
        });
        const finalizeBody = await finalizeRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({
            success: true,
            autoPilot: true,
            complete: true,
            iteration: _iteration,
            finalize: finalizeBody,
          }),
          { headers: jsonHeaders },
        );
      }

      // Generate this step
      console.log(`[AutoPilot] Iteration ${_iteration}: ${nextComp.code} / ${nextStep}`);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Self-invoke for single step (MODE 1)
      const stepRes = await fetch(`${supabaseUrl}/functions/v1/generate-course-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          courseId,
          curriculumId,
          learningFieldId: nextComp.learning_field_id,
          competencyId: nextComp.id,
          step: nextStep,
          provider,
          skipValidation,
        }),
      });
      const stepBody = await stepRes.json().catch(() => ({}));
      console.log(`[AutoPilot] Step result: ${JSON.stringify({ status: stepRes.status, step: nextStep, code: nextComp.code })}`);

      // Calculate progress
      const totalSteps = allComps.length * 5;
      const { count: doneCount } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .in("module_id", (await supabase.from("modules").select("id").eq("course_id", courseId)).data?.map((m: any) => m.id) || []);

      const progress = Math.round(((doneCount || 0) / totalSteps) * 100);

      // Self-invoke for next iteration (fire-and-forget style but awaited to chain)
      fetch(`${supabaseUrl}/functions/v1/generate-course-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          courseId,
          curriculumId,
          autoPilot: true,
          _iteration: _iteration + 1,
          provider,
          skipValidation,
        }),
      }).catch((e) => console.error("[AutoPilot] Self-invoke error:", e));

      return new Response(
        JSON.stringify({
          success: true,
          autoPilot: true,
          iteration: _iteration,
          currentStep: { comp: nextComp.code, step: nextStep },
          stepResult: stepBody,
          progress: `${progress}%`,
          totalSteps,
        }),
        { headers: jsonHeaders },
      );
    }



    if (!learningFieldId && !competencyId) {
      const { data: lessons } = await supabase
        .from("lessons")
        .select("duration_minutes, status, qc_status, module_id!inner(course_id)")
        .eq("module_id.course_id", courseId);

      const totalDuration = lessons?.reduce((sum, l) => sum + (l.duration_minutes || 0), 0) || 0;
      const totalLessons = lessons?.length || 0;
      const validatedCount = lessons?.filter((l: any) => l.status === "validated").length || 0;
      const needsPatchCount = lessons?.filter((l: any) => l.qc_status === "needs_patch").length || 0;

      await supabase
        .from("courses")
        .update({ estimated_duration: Math.ceil(totalDuration / 60), status: "draft" })
        .eq("id", courseId);

      // Auto-QC pipeline (best-effort, non-blocking)
      let qcResult: any = null;
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const svcHeaders = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        };

        // 1) QC Snapshot
        const snapRes = await fetch(`${supabaseUrl}/functions/v1/qc-snapshot`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({ scope: "course", courseId }),
        });
        console.log(`[Finalize] qc-snapshot status=${snapRes.status}`);

        // 2) Validate content – course level
        const valRes = await fetch(`${supabaseUrl}/functions/v1/validate-content`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({
            mode: "course",
            entityType: "course",
            entityId: courseId,
            content: { courseId, totalLessons, totalDuration },
          }),
        });
        const valBody = await valRes.json().catch(() => ({}));
        console.log(
          `[Finalize] validate-content status=${valRes.status}, decision=${valBody?.decision}`,
        );

        // 3) IHK Quality Audit
        const auditRes = await fetch(`${supabaseUrl}/functions/v1/ihk-quality-audit`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({ courseId }),
        });
        const auditBody = await auditRes.json().catch(() => ({}));
        console.log(
          `[Finalize] ihk-quality-audit status=${auditRes.status}, score=${auditBody?.overallScore}`,
        );

        qcResult = {
          snapshotOk: snapRes.ok,
          validation: { decision: valBody?.decision, score: valBody?.overall_score },
          audit: { score: auditBody?.overallScore, grade: auditBody?.grade },
          lessonStats: { total: totalLessons, validated: validatedCount, needsPatch: needsPatchCount },
        };

        // If audit < 85 or validation says revise/reject → keep draft
        const isGood =
          valBody?.decision !== "revise" &&
          valBody?.decision !== "reject" &&
          (!auditBody?.overallScore || auditBody.overallScore >= 85);

        if (isGood && validatedCount === totalLessons && totalLessons > 0) {
          await supabase.from("courses").update({ status: "generated" }).eq("id", courseId);
        }
      } catch (qcErr) {
        console.error("[Finalize] Auto-QC error (non-blocking):", qcErr);
        qcResult = { error: String((qcErr as Error)?.message || qcErr) };
      }

      return new Response(
        JSON.stringify({ success: true, complete: true, totalLessons, totalDuration, qc: qcResult }),
        { headers: jsonHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Invalid request: provide learningFieldId+competencyId or neither (to finalize)",
      }),
      { status: 400, headers: jsonHeaders },
    );
  } catch (error) {
    console.error("Batch generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } },
    );
  }
});
