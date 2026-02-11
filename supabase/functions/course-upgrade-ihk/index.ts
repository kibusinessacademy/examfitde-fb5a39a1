import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Course Upgrade to IHK Exam Level — 4-Phase Pipeline:
 * Phase 1: Blueprint Generation (per competency)
 * Phase 2: MiniCheck Upgrade (case-based, IHK-level)
 * Phase 3: Exam Block Injection (per competency)
 * Phase 4: Weighting & Difficulty Logic
 *
 * Uses GPT-5.2 for generation, runs per-course.
 */

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5.2";

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
  const map: Record<string, string> = {
    "remember": "recognition", "understand": "recognition",
    "apply": "transfer", "analyze": "comparison",
    "evaluate": "error_detection", "create": "transfer",
  };
  return map[cogLevel] || "transfer";
}

function mapKnowledgeType(aiType: string): string {
  const map: Record<string, string> = {
    "factual": "concept", "conceptual": "concept",
    "procedural": "procedure", "metacognitive": "regulation",
    "calculation": "calculation",
  };
  return map[aiType?.toLowerCase()] || "concept";
}

function mapCognitiveLevel(aiLevel: string): string {
  const valid = ["remember", "understand", "apply", "analyze"];
  const mapped: Record<string, string> = {
    "remember": "remember", "understand": "understand",
    "apply": "apply", "analyze": "analyze",
    "evaluate": "analyze", "create": "apply",
  };
  const result = mapped[aiLevel?.toLowerCase()] || "apply";
  return valid.includes(result) ? result : "apply";
}

function inferWeight(lfTitle: string, compTitle: string): number {
  const combined = (lfTitle + " " + compTitle).toLowerCase();
  for (const [keyword, weight] of Object.entries(WEIGHT_CATEGORIES)) {
    if (combined.includes(keyword)) return weight;
  }
  return 15;
}

function inferDifficulty(taxonomyLevel: string | null): string {
  const map: Record<string, string> = {
    "Erinnern": "easy", "Verstehen": "easy",
    "Anwenden": "medium",
    "Analysieren": "hard", "Bewerten": "hard", "Erschaffen": "hard",
  };
  return map[taxonomyLevel || ""] || "medium";
}

function inferExamRelevance(taxonomyLevel: string | null): string {
  const high = ["Analysieren", "Bewerten", "Anwenden"];
  if (high.includes(taxonomyLevel || "")) return "high";
  return "medium";
}

async function callOpenAI(apiKey: string, messages: any[], tools?: any[], toolChoice?: any): Promise<any> {
  const body: any = { model: MODEL, messages, max_completion_tokens: 4000 };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const resp = await fetch(OPENAI_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

function extractToolArgs(resp: any): any | null {
  const tc = resp.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) return null;
  try { return JSON.parse(tc.function.arguments); } catch { return null; }
}

// ═══════════════════════════════════════════════════
// TOOL SCHEMAS
// ═══════════════════════════════════════════════════

const BLUEPRINT_TOOL = {
  type: "function",
  function: {
    name: "create_blueprint",
    description: "Create an IHK exam blueprint for a competency.",
    parameters: {
      type: "object",
      properties: {
        canonical_statement: { type: "string", description: "The core exam-relevant statement this competency tests" },
        knowledge_type: { type: "string", enum: ["factual", "conceptual", "procedural", "metacognitive"] },
        cognitive_level: { type: "string", enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"] },
        exam_relevance: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        allowed_question_types: { type: "array", items: { type: "string", enum: ["single_choice", "multiple_choice", "situational", "open", "calculation"] } },
        typical_exam_trap: { type: "string", description: "Common exam trap/mistake for this competency" },
        real_world_context: { type: "string", description: "Typical real-world scenario where this is tested" },
        question_template: { type: "string", description: "Template for generating exam questions from this blueprint" },
        explanation_template: { type: "string", description: "Template for explanations" },
        didactic_intent: { type: "string", description: "What the examiner wants to test" },
      },
      required: ["canonical_statement", "knowledge_type", "cognitive_level", "exam_relevance", "allowed_question_types", "typical_exam_trap", "real_world_context", "question_template", "explanation_template", "didactic_intent"]
    }
  }
};

const EXAM_BLOCK_TOOL = {
  type: "function",
  function: {
    name: "create_exam_block",
    description: "Create an IHK exam block for a competency with situation, sub-questions, traps, and grading criteria.",
    parameters: {
      type: "object",
      properties: {
        situation: { type: "string", description: "Half-page realistic exam situation description in German" },
        sub_questions: {
          type: "array", minItems: 3, maxItems: 5,
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["fachlich", "rechtlich", "organisatorisch", "ethisch", "wirtschaftlich"] },
              question: { type: "string" },
              expected_answer_outline: { type: "string" },
              points: { type: "integer" }
            },
            required: ["category", "question", "expected_answer_outline", "points"]
          }
        },
        typical_traps: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
        grading_criteria: {
          type: "object",
          properties: {
            fachliche_richtigkeit: { type: "integer", description: "Weight in percent" },
            antwortstruktur: { type: "integer" },
            fachbegriffe: { type: "integer" },
            praxisbezug: { type: "integer" }
          },
          required: ["fachliche_richtigkeit", "antwortstruktur", "fachbegriffe", "praxisbezug"]
        },
        consolidation_block: {
          type: "object",
          properties: {
            key_statements: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
            common_mistakes: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
            distinction_questions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
            mini_case: { type: "string", description: "A 3-5 sentence mini case study" }
          },
          required: ["key_statements", "common_mistakes", "distinction_questions", "mini_case"]
        }
      },
      required: ["situation", "sub_questions", "typical_traps", "grading_criteria", "consolidation_block"]
    }
  }
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const courseId = body.course_id;
    const phase = body.phase || "all"; // "blueprints", "exam_blocks", "weights", "all"
    const batchSize = Math.min(body.batch_size || 5, 15);

    if (!courseId) throw new Error("course_id required");

    // Fetch course + curriculum
    const { data: course } = await supabase
      .from("courses")
      .select("id, title, curriculum_id")
      .eq("id", courseId)
      .single();
    if (!course) throw new Error("Course not found");

    // Fetch all competencies for this course's curriculum
    const { data: competencies } = await supabase
      .from("competencies")
      .select("id, code, title, taxonomy_level, sort_order, learning_field_id, learning_fields!inner(id, title, sort_order, curriculum_id)")
      .eq("learning_fields.curriculum_id", course.curriculum_id)
      .order("sort_order");

    if (!competencies?.length) throw new Error("No competencies found");

    const results: any = { course: course.title, phases: {}, errors: [] };

    // ═══════════════════════════════════════
    // PHASE 1: BLUEPRINT GENERATION
    // ═══════════════════════════════════════
    if (phase === "all" || phase === "blueprints") {
      console.log(`[PHASE 1] Blueprint generation for ${competencies.length} competencies`);

      // Check existing blueprints
      const { data: existing } = await supabase
        .from("question_blueprints")
        .select("competency_id")
        .eq("curriculum_id", course.curriculum_id);

      const existingIds = new Set((existing || []).map((e: any) => e.competency_id));
      const missing = competencies.filter((c: any) => !existingIds.has(c.id));

      let created = 0;
      const batch = missing.slice(0, batchSize);

      for (const comp of batch) {
        const lf = (comp as any).learning_fields;
        try {
          const res = await callOpenAI(OPENAI_KEY, [
            { role: "system", content: "Du bist ein IHK-Prüfungsexperte für Bestattungsfachkräfte. Erstelle strukturierte Prüfungs-Blueprints." },
            { role: "user", content: `Erstelle einen IHK-Prüfungs-Blueprint für:
Kompetenz: ${comp.code} – ${comp.title}
Lernfeld: ${lf.title}
Taxonomie: ${comp.taxonomy_level || "Anwenden"}

Der Blueprint muss:
- Die exakte IHK-Prüfungsrelevanz widerspiegeln
- Typische Prüfungsfallen identifizieren
- Reale Berufssituationen als Kontext nutzen
- Als Vorlage für Prüfungsfragen-Varianten dienen

Nutze die Funktion create_blueprint.` }
          ], [BLUEPRINT_TOOL], { type: "function", function: { name: "create_blueprint" } });

          const args = extractToolArgs(res);
          if (!args) { results.errors.push(`${comp.code}: No blueprint output`); continue; }

          const weight = inferWeight(lf.title, comp.title);
          const difficulty = inferDifficulty(comp.taxonomy_level);

          const { error: insertErr } = await supabase.from("question_blueprints").insert({
            curriculum_id: course.curriculum_id,
            learning_field_id: comp.learning_field_id,
            competency_id: comp.id,
            name: `BP-${comp.code}`,
            canonical_statement: args.canonical_statement,
            knowledge_type: mapKnowledgeType(args.knowledge_type),
            cognitive_level: mapCognitiveLevel(args.cognitive_level),
            exam_relevance: (args.exam_relevance || inferExamRelevance(comp.taxonomy_level)).toLowerCase(),
            allowed_question_types: args.allowed_question_types,
            typical_exam_trap: args.typical_exam_trap,
            real_world_context: true,
            question_template: args.question_template,
            explanation_template: args.explanation_template,
            didactic_intent: mapDidacticIntent(args.cognitive_level || "apply"),
            language_level: "B2",
            status: "approved",
            version: "1.0",
          });

          if (insertErr) { results.errors.push(`${comp.code}: DB ${insertErr.message}`); continue; }
          created++;
          console.log(`✅ Blueprint: ${comp.code}`);
        } catch (e) {
          results.errors.push(`${comp.code}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }

      results.phases.blueprints = { created, remaining: missing.length - batch.length, total: competencies.length };
    }

    // ═══════════════════════════════════════
    // PHASE 2: EXAM BLOCKS + CONSOLIDATION
    // ═══════════════════════════════════════
    if (phase === "all" || phase === "exam_blocks") {
      console.log(`[PHASE 2] Exam block injection`);

      // Find lessons that need exam blocks (wiederholen steps without exam_block)
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, title, step, competency_id, content, modules!inner(course_id)")
        .eq("modules.course_id", courseId)
        .eq("step", "wiederholen")
        .limit(batchSize);

      let upgraded = 0;
      for (const lesson of (lessons || [])) {
        const content = lesson.content as any;
        if (content?.exam_block?.situation) continue; // Already has exam block

        const comp = competencies.find((c: any) => c.id === lesson.competency_id);
        if (!comp) continue;
        const lf = (comp as any).learning_fields;

        try {
          const res = await callOpenAI(OPENAI_KEY, [
            { role: "system", content: "Du bist ein IHK-Prüfungsexperte für Bestattungsfachkräfte. Erstelle prüfungsnahe Aufgabenblöcke mit Situationsbeschreibung, Unterfragen und Bewertungskriterien." },
            { role: "user", content: `Erstelle einen IHK-Prüfungsblock für:
Kompetenz: ${comp.code} – ${comp.title}
Lernfeld: ${lf.title}

Der Block muss enthalten:
1. SITUATIONSBESCHREIBUNG (½ Seite): Realistisches Szenario aus dem Bestattungsalltag
2. 3-5 UNTERFRAGEN: Mix aus fachlich, rechtlich, organisatorisch, ethisch
3. TYPISCHE FALLEN: 2-5 häufige Prüfungsfehler
4. BEWERTUNGSKRITERIEN: Prozentuale Gewichtung
5. VERDICHTUNGSBLOCK: Merksätze, typische Fehler, Abgrenzungsfragen, Mini-Fall

Nutze die Funktion create_exam_block.` }
          ], [EXAM_BLOCK_TOOL], { type: "function", function: { name: "create_exam_block" } });

          const args = extractToolArgs(res);
          if (!args) { results.errors.push(`Exam ${comp.code}: No output`); continue; }

          // Merge exam block into existing lesson content
          const updatedContent = {
            ...(typeof content === "object" && content ? content : {}),
            exam_block: {
              situation: args.situation,
              sub_questions: args.sub_questions,
              typical_traps: args.typical_traps,
              grading_criteria: args.grading_criteria,
            },
            consolidation_block: args.consolidation_block,
            upgraded_at: new Date().toISOString(),
            upgrade_version: "ihk-v2"
          };

          await supabase.from("lessons").update({ content: updatedContent }).eq("id", lesson.id);
          upgraded++;
          console.log(`✅ Exam Block: ${comp.code}`);
        } catch (e) {
          results.errors.push(`Exam ${comp.code}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }

      results.phases.exam_blocks = { upgraded, total: (lessons || []).length };
    }

    // ═══════════════════════════════════════
    // PHASE 3: WEIGHTING & DIFFICULTY
    // ═══════════════════════════════════════
    if (phase === "all" || phase === "weights") {
      console.log(`[PHASE 3] Weighting & difficulty assignment`);

      // Update blueprints with computed weights
      const { data: blueprints } = await supabase
        .from("question_blueprints")
        .select("id, competency_id, exam_relevance")
        .eq("curriculum_id", course.curriculum_id);

      let weightUpdates = 0;
      for (const bp of (blueprints || [])) {
        const comp = competencies.find((c: any) => c.id === bp.competency_id);
        if (!comp) continue;
        const lf = (comp as any).learning_fields;

        // Compute normalized weight
        const rawWeight = inferWeight(lf.title, comp.title);
        const difficulty = inferDifficulty(comp.taxonomy_level);
        const relevance = bp.exam_relevance || inferExamRelevance(comp.taxonomy_level);

        // Update variation modes with weight info
        await supabase.from("question_blueprints").update({
          variation_modes: { weight_percent: rawWeight, difficulty, relevance_tier: relevance },
        }).eq("id", bp.id);
        weightUpdates++;
      }

      results.phases.weights = { updated: weightUpdates };
    }

    // ═══════════════════════════════════════
    // PHASE 4: TRIGGER MINICHECK REGENERATION
    // ═══════════════════════════════════════
    if (phase === "all" || phase === "minichecks") {
      console.log(`[PHASE 4] Triggering MiniCheck regeneration`);

      // Enqueue a job for minicheck regeneration
      const { error: jobErr } = await supabase.from("job_queue").insert({
        job_type: "regenerate_minichecks",
        payload: { course_id: courseId, limit: batchSize },
        status: "pending",
        priority: 1,
      });

      results.phases.minichecks = { queued: !jobErr, error: jobErr?.message };
    }

    console.log(`[UPGRADE] Complete:`, JSON.stringify(results.phases));

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("course-upgrade-ihk error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" }
    });
  }
});
