import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, type AIProvider } from "../_shared/ai-client.ts";

/**
 * Course Upgrade to IHK Exam Level — 4-Phase Pipeline
 * Now uses _shared/ai-client.ts gateway for multi-provider routing.
 */

// ── Weighting presets per learning field category ──
const WEIGHT_CATEGORIES: Record<string, number> = {
  "beratung": 25, "kommunikation": 25, "kunden": 25,
  "recht": 20, "vorschrift": 20, "gesetz": 20,
  "organisation": 20, "ablauf": 20, "planung": 20, "geschäft": 20, "verwaltung": 20,
  "hygien": 15, "techni": 15, "werkzeug": 15, "gerät": 15, "maschine": 15,
  "wirtschaft": 20, "kalkulation": 20, "qualität": 20,
};

const VALID_DIDACTIC_INTENTS = ["transfer", "recognition", "error_detection", "comparison", "classification"];

function mapDidacticIntent(cogLevel: string): string {
  const map: Record<string, string> = { "remember": "recognition", "understand": "recognition", "apply": "transfer", "analyze": "comparison", "evaluate": "error_detection", "create": "transfer" };
  return map[cogLevel] || "transfer";
}
function mapKnowledgeType(aiType: string): string {
  const map: Record<string, string> = { "factual": "concept", "conceptual": "concept", "procedural": "procedure", "metacognitive": "regulation", "calculation": "calculation" };
  return map[aiType?.toLowerCase()] || "concept";
}
function mapCognitiveLevel(aiLevel: string): string {
  const valid = ["remember", "understand", "apply", "analyze"];
  const mapped: Record<string, string> = { "remember": "remember", "understand": "understand", "apply": "apply", "analyze": "analyze", "evaluate": "analyze", "create": "apply" };
  const result = mapped[aiLevel?.toLowerCase()] || "apply";
  return valid.includes(result) ? result : "apply";
}
function inferWeight(lfTitle: string, compTitle: string): number {
  const combined = (lfTitle + " " + compTitle).toLowerCase();
  for (const [keyword, weight] of Object.entries(WEIGHT_CATEGORIES)) { if (combined.includes(keyword)) return weight; }
  return 15;
}
function inferDifficulty(taxonomyLevel: string | null): string {
  const map: Record<string, string> = { "Erinnern": "easy", "Verstehen": "easy", "Anwenden": "medium", "Analysieren": "hard", "Bewerten": "hard", "Erschaffen": "hard" };
  return map[taxonomyLevel || ""] || "medium";
}
function inferExamRelevance(taxonomyLevel: string | null): string {
  return ["Analysieren", "Bewerten", "Anwenden"].includes(taxonomyLevel || "") ? "high" : "medium";
}

// ═══ TOOL SCHEMAS ═══
const BLUEPRINT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_blueprint",
    description: "Create an IHK exam blueprint for a competency.",
    parameters: {
      type: "object",
      properties: {
        canonical_statement: { type: "string" }, knowledge_type: { type: "string", enum: ["factual", "conceptual", "procedural", "metacognitive"] },
        cognitive_level: { type: "string", enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"] },
        exam_relevance: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        allowed_question_types: { type: "array", items: { type: "string", enum: ["single_choice", "multiple_choice", "situational", "open", "calculation"] } },
        typical_exam_trap: { type: "string" }, real_world_context: { type: "string" },
        question_template: { type: "string" }, explanation_template: { type: "string" }, didactic_intent: { type: "string" },
      },
      required: ["canonical_statement", "knowledge_type", "cognitive_level", "exam_relevance", "allowed_question_types", "typical_exam_trap", "real_world_context", "question_template", "explanation_template", "didactic_intent"]
    }
  }
};

const EXAM_BLOCK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_exam_block",
    description: "Create an IHK exam block with situation, sub-questions, traps, and grading criteria.",
    parameters: {
      type: "object",
      properties: {
        situation: { type: "string" },
        sub_questions: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", properties: { category: { type: "string" }, question: { type: "string" }, expected_answer_outline: { type: "string" }, points: { type: "integer" } }, required: ["category", "question", "expected_answer_outline", "points"] } },
        typical_traps: { type: "array", items: { type: "string" } },
        grading_criteria: { type: "object", properties: { fachliche_richtigkeit: { type: "integer" }, antwortstruktur: { type: "integer" }, fachbegriffe: { type: "integer" }, praxisbezug: { type: "integer" } }, required: ["fachliche_richtigkeit", "antwortstruktur", "fachbegriffe", "praxisbezug"] },
        consolidation_block: { type: "object", properties: { key_statements: { type: "array", items: { type: "string" } }, common_mistakes: { type: "array", items: { type: "string" } }, distinction_questions: { type: "array", items: { type: "string" } }, mini_case: { type: "string" } }, required: ["key_statements", "common_mistakes", "distinction_questions", "mini_case"] }
      },
      required: ["situation", "sub_questions", "typical_traps", "grading_criteria", "consolidation_block"]
    }
  }
};

function extractToolArgs(result: { toolCalls?: Array<{ function: { name: string; arguments: string } }> }): any | null {
  const args = result.toolCalls?.[0]?.function?.arguments;
  if (!args) return null;
  try { return JSON.parse(args); } catch { return null; }
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const courseId = body.course_id;
    const phase = body.phase || "all";
    const batchSize = Math.min(body.batch_size || 5, 15);
    const provider = (body.provider || "openai") as AIProvider;

    if (!courseId) throw new Error("course_id required");

    const { data: course } = await supabase.from("courses").select("id, title, curriculum_id").eq("id", courseId).single();
    if (!course) throw new Error("Course not found");

    const { data: competencies } = await supabase.from("competencies")
      .select("id, code, title, taxonomy_level, sort_order, learning_field_id, learning_fields!inner(id, title, sort_order, curriculum_id)")
      .eq("learning_fields.curriculum_id", course.curriculum_id).order("sort_order");

    if (!competencies?.length) throw new Error("No competencies found");
    const results: any = { course: course.title, phases: {}, errors: [] };

    // PHASE 1: BLUEPRINT GENERATION
    if (phase === "all" || phase === "blueprints") {
      const { data: existing } = await supabase.from("question_blueprints").select("competency_id").eq("curriculum_id", course.curriculum_id);
      const existingIds = new Set((existing || []).map((e: any) => e.competency_id));
      const missing = competencies.filter((c: any) => !existingIds.has(c.id));
      let created = 0;
      const batch = missing.slice(0, batchSize);

      for (const comp of batch) {
        const lf = (comp as any).learning_fields;
        try {
          const res = await callAIJSON({
            provider,
            messages: [
              { role: "system", content: "Du bist ein IHK-Prüfungsexperte. Erstelle strukturierte Prüfungs-Blueprints." },
              { role: "user", content: `Erstelle einen IHK-Prüfungs-Blueprint für:\nKompetenz: ${comp.code} – ${comp.title}\nLernfeld: ${lf.title}\nTaxonomie: ${comp.taxonomy_level || "Anwenden"}\n\nNutze die Funktion create_blueprint.` }
            ],
            tools: [BLUEPRINT_TOOL],
            tool_choice: { type: "function", function: { name: "create_blueprint" } },
          });

          const args = extractToolArgs(res);
          if (!args) { results.errors.push(`${comp.code}: No blueprint output`); continue; }

          const { error: insertErr } = await supabase.from("question_blueprints").insert({
            curriculum_id: course.curriculum_id, learning_field_id: comp.learning_field_id, competency_id: comp.id,
            name: `BP-${comp.code}`, canonical_statement: args.canonical_statement,
            knowledge_type: mapKnowledgeType(args.knowledge_type), cognitive_level: mapCognitiveLevel(args.cognitive_level),
            exam_relevance: (args.exam_relevance || inferExamRelevance(comp.taxonomy_level)).toLowerCase(),
            allowed_question_types: args.allowed_question_types, typical_exam_trap: args.typical_exam_trap,
            real_world_context: true, question_template: args.question_template, explanation_template: args.explanation_template,
            didactic_intent: mapDidacticIntent(args.cognitive_level || "apply"), language_level: "B2", status: "approved", version: "1.0",
          });
          if (insertErr) { results.errors.push(`${comp.code}: DB ${insertErr.message}`); continue; }
          created++;
        } catch (e) { results.errors.push(`${comp.code}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      results.phases.blueprints = { created, remaining: missing.length - batch.length, total: competencies.length };
    }

    // PHASE 2: EXAM BLOCKS
    if (phase === "all" || phase === "exam_blocks") {
      const { data: lessons } = await supabase.from("lessons").select("id, title, step, competency_id, content, modules!inner(course_id)")
        .eq("modules.course_id", courseId).eq("step", "wiederholen").limit(batchSize);

      let upgraded = 0;
      for (const lesson of (lessons || [])) {
        const content = lesson.content as any;
        if (content?.exam_block?.situation) continue;
        const comp = competencies.find((c: any) => c.id === lesson.competency_id);
        if (!comp) continue;
        const lf = (comp as any).learning_fields;

        try {
          const res = await callAIJSON({
            provider,
            messages: [
              { role: "system", content: "Du bist ein IHK-Prüfungsexperte. Erstelle prüfungsnahe Aufgabenblöcke." },
              { role: "user", content: `Erstelle einen IHK-Prüfungsblock für:\nKompetenz: ${comp.code} – ${comp.title}\nLernfeld: ${lf.title}\n\nNutze die Funktion create_exam_block.` }
            ],
            tools: [EXAM_BLOCK_TOOL],
            tool_choice: { type: "function", function: { name: "create_exam_block" } },
          });

          const args = extractToolArgs(res);
          if (!args) { results.errors.push(`Exam ${comp.code}: No output`); continue; }

          const updatedContent = { ...(typeof content === "object" && content ? content : {}), exam_block: { situation: args.situation, sub_questions: args.sub_questions, typical_traps: args.typical_traps, grading_criteria: args.grading_criteria }, consolidation_block: args.consolidation_block, upgraded_at: new Date().toISOString(), upgrade_version: "ihk-v2", _placeholder: true };
          const { error: rpcErr } = await supabase.rpc("pipeline_write_lesson_content", { p_lesson_id: lesson.id, p_content: updatedContent });
          if (rpcErr) throw new Error(`RPC write failed: ${rpcErr.message}`);
          upgraded++;
        } catch (e) { results.errors.push(`Exam ${comp.code}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      results.phases.exam_blocks = { upgraded, total: (lessons || []).length };
    }

    // PHASE 3: WEIGHTING
    if (phase === "all" || phase === "weights") {
      const { data: blueprints } = await supabase.from("question_blueprints").select("id, competency_id, exam_relevance").eq("curriculum_id", course.curriculum_id);
      let weightUpdates = 0;
      for (const bp of (blueprints || [])) {
        const comp = competencies.find((c: any) => c.id === bp.competency_id);
        if (!comp) continue;
        const lf = (comp as any).learning_fields;
        const rawWeight = inferWeight(lf.title, comp.title);
        const difficulty = inferDifficulty(comp.taxonomy_level);
        const relevance = bp.exam_relevance || inferExamRelevance(comp.taxonomy_level);
        await supabase.from("question_blueprints").update({ variation_modes: { weight_percent: rawWeight, difficulty, relevance_tier: relevance } }).eq("id", bp.id);
        weightUpdates++;
      }
      results.phases.weights = { updated: weightUpdates };
    }

    // PHASE 4: TRIGGER MINICHECK REGENERATION
    if (phase === "all" || phase === "minichecks") {
      const { error: jobErr } = await supabase.from("job_queue").insert({ job_type: "regenerate_minichecks", payload: { course_id: courseId, limit: batchSize }, status: "pending", priority: 1 });
      results.phases.minichecks = { queued: !jobErr, error: jobErr?.message };
    }

    return new Response(JSON.stringify({ success: true, ...results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" }
    });
  }
});
