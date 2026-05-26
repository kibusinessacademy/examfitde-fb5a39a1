import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ── Types ──────────────────────────────────────────────────────
type DistractorType = "rechenfehler" | "denkfehler" | "normfehler" | "prozessfehler" | "priorisierungsfehler";

interface BlueprintV2 {
  blueprint_id: string;
  version: 2;
  certification_id?: string;
  learning_field_id: string;
  competency_id: string;
  exam_part?: string;
  exam_relevance_tier?: string;
  difficulty_target?: string;
  cognitive_level_target?: string;
  elite_level?: string;
  complexity_score_target?: number;
  decision_structure?: {
    multi_variable?: boolean;
    decision_dimensions?: string[];
    conflict_type?: string;
    requires_tradeoff?: boolean;
  };
  scenario_model?: {
    dynamic_scenario?: boolean;
    time_progression?: boolean;
    parameter_variation?: string[];
    transfer_variant_required?: boolean;
    transfer_context_type?: string;
  };
  distractor_taxonomy?: { type: DistractorType; beschreibung?: string }[];
  min_distractor_types?: number;
  generation_constraints?: {
    question_format?: string;
    min_context_length_tokens?: number;
    must_include_realistic_context?: boolean;
    forbid_pure_definition_questions?: boolean;
    require_practical_scenario?: boolean;
  };
}

interface GenerateRequest {
  package_id?: string;
  curriculum_id: string;
  blueprint: BlueprintV2;
  competency_text: string;
  learning_field_name: string;
  count?: number;
  profession_name?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── System Prompt (fixed, not dynamic) ──────────────────────────
function buildSystemPrompt(professionName?: string): string {
  const lines = [
    `Du bist ein IHK-Prüfungsdesigner mit Elite-Didaktik-Standard${professionName ? ` für den Beruf "${professionName}"` : ""}.`,
    "",
    "Du generierst ausschließlich prüfungskonforme, berufsbezogene Fragen.",
    "Du darfst KEINE Inhalte erfinden, die nicht im übergebenen Kompetenzrahmen stehen.",
    "",
    "HARTE REGELN:",
    "- Keine reinen Definitionsfragen. Jede Frage muss einen realistischen Praxis-Kontext enthalten.",
    "- Distractoren müssen typische Denk-, Norm- oder Rechenfehler repräsentieren.",
    "- Wenn decision_structure.multi_variable=true → mindestens 3 Entscheidungsdimensionen einbauen.",
    "- Wenn conflict_type ≠ none → echter Zielkonflikt muss erkennbar sein.",
    "- Wenn transfer_variant_required=true → eine zweite Variante mit geändertem Parameter erzeugen.",
    "- Wenn cognitive_level_target=evaluate → Entscheidung mit Begründungslogik erzwingen.",
    "",
    "DISTRACTOR-INTELLIGENZ:",
    "- Jeder Distraktor braucht: error_tag, why_wrong, why_tempting",
    "- Mindestens 3 verschiedene Fehlertypen: rechenfehler, denkfehler, normfehler, prozessfehler, priorisierungsfehler",
    "- Keine offensichtlich falschen Antworten",
    "",
    "ERKLÄRUNG (Pflicht):",
    "- Warum ist die richtige Antwort korrekt?",
    "- Warum ist jeder Distraktor verlockend aber falsch?",
    "- Wie vermeidet man den Fehler künftig?",
    "",
    "Antwortformat: JSON exakt nach Schema. Keine zusätzliche Erklärung.",
  ];
  return lines.join("\n");
}

// ── User Prompt (dynamic from Blueprint) ────────────────────────
function buildUserPrompt(req: GenerateRequest, count: number): string {
  const bp = req.blueprint;
  const minContext = bp.generation_constraints?.min_context_length_tokens ?? 120;
  const fmt = bp.generation_constraints?.question_format ?? "mc_single";
  const minDistrTypes = bp.min_distractor_types ?? 3;
  const ds = bp.decision_structure;
  const sm = bp.scenario_model;

  const extras: string[] = [];
  if (ds?.multi_variable) {
    extras.push(`- Integriere mindestens 3 Entscheidungsdimensionen: ${(ds.decision_dimensions || []).join(", ")}`);
  }
  if (ds?.conflict_type && ds.conflict_type !== "none") {
    extras.push(`- Erzeuge einen klaren Zielkonflikt: ${ds.conflict_type.replace(/_/g, " ")}`);
  }
  if (ds?.requires_tradeoff) {
    extras.push("- Die Frage muss eine echte Abwägung erfordern (kein eindeutiger Gewinner)");
  }
  if (sm?.dynamic_scenario) {
    extras.push("- Baue eine sich verändernde Rahmenbedingung ein (z.B. Marktänderung, neue Info)");
  }
  if (sm?.transfer_variant_required) {
    extras.push(`- Erzeuge zusätzlich eine Transfer-Variante mit geändertem Parameter (Typ: ${sm.transfer_context_type || "parameteränderung"})`);
  }

  return [
    `Erzeuge exakt ${count} Prüfungsfrage(n) basierend auf folgendem Blueprint:`,
    "",
    "Kompetenz:", req.competency_text,
    "", "Learning Field:", req.learning_field_name,
    "", "Blueprint-Konfiguration:",
    JSON.stringify(bp, null, 2),
    "",
    "Vorgaben:",
    `- Mindestkontext: ${minContext} Tokens`,
    `- Frageformat: ${fmt}`,
    `- Schwierigkeit: ${bp.difficulty_target ?? "medium"}`,
    `- Kognitives Ziel: ${bp.cognitive_level_target ?? "apply"}`,
    `- Mindestens ${minDistrTypes} verschiedene Distractor-Fehlertypen`,
    ...(extras.length ? ["", "ZUSÄTZLICHE ELITE-ANFORDERUNGEN:", ...extras] : []),
    "",
    "Antworte NUR als JSON-Objekt:",
    JSON.stringify({
      questions: [{
        context: "Realistischer Praxis-Kontext (mind. 2-3 Sätze)...",
        question: "Die eigentliche Frage...",
        answers: [
          { id: "A", text: "...", is_correct: false, distractor_type: "denkfehler", why_wrong: "...", why_tempting: "..." },
          { id: "B", text: "...", is_correct: true, distractor_type: null, why_wrong: null, why_tempting: null },
          { id: "C", text: "...", is_correct: false, distractor_type: "normfehler", why_wrong: "...", why_tempting: "..." },
          { id: "D", text: "...", is_correct: false, distractor_type: "rechenfehler", why_wrong: "...", why_tempting: "..." },
        ],
        explanation: {
          correct_reasoning: "Warum B korrekt ist...",
          distractor_analysis: { A: "Verlockend weil... Falsch weil...", C: "...", D: "..." },
          prevention_tip: "So vermeidet man diesen Fehler..."
        },
        metadata: {
          difficulty: "medium",
          cognitive_level: "apply",
          multi_variable: false,
          conflict_type: "none",
          dynamic_scenario: false,
          transfer_variant: false,
          complexity_score: 3,
          distractor_types: ["denkfehler", "normfehler", "rechenfehler"],
        },
        transfer_variant: null,
      }],
    }, null, 2),
  ].join("\n");
}

// ── Validate AI response ──────────────────────────────────────
function validateAndExtract(raw: string): any[] {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const questions = Array.isArray(parsed) ? parsed : (parsed.questions || [parsed]);

  for (const q of questions) {
    if (!q.question || typeof q.question !== "string") throw new Error("MISSING_QUESTION_TEXT");
    if (!Array.isArray(q.answers) || q.answers.length < 4) throw new Error("ANSWERS_INVALID");
    const correct = q.answers.filter((a: any) => a.is_correct === true);
    if (correct.length !== 1) throw new Error("CORRECT_COUNT_NOT_1");
  }
  return questions;
}

// ── Map AI question to exam_questions row ─────────────────────
function mapToDbRow(q: any, req: GenerateRequest) {
  const meta = q.metadata || {};
  const distractorTypes = (q.answers || [])
    .filter((a: any) => !a.is_correct && a.distractor_type)
    .map((a: any) => a.distractor_type);

  const distractorMeta = Object.fromEntries(
    (q.answers || [])
      .filter((a: any) => !a.is_correct)
      .map((a: any) => [a.id, {
        error_tag: a.distractor_type || "unknown",
        why_wrong: a.why_wrong || "",
        why_tempting: a.why_tempting || "",
      }])
  );

  const correctIdx = (q.answers || []).findIndex((a: any) => a.is_correct === true);

  return {
    curriculum_id: req.curriculum_id,
    learning_field_id: req.blueprint.learning_field_id,
    competency_id: req.blueprint.competency_id,
    question_text: `${q.context || ""}\n\n${q.question}`.trim(),
    options: (q.answers || []).map((a: any) => a.text),
    correct_answer: correctIdx >= 0 ? correctIdx : 0,
    explanation: [
      q.explanation?.correct_reasoning || "",
      q.explanation?.prevention_tip ? `\n\n💡 Tipp: ${q.explanation.prevention_tip}` : "",
    ].join(""),
    difficulty: meta.difficulty || req.blueprint.difficulty_target || "medium",
    cognitive_level: meta.cognitive_level || req.blueprint.cognitive_level_target || "apply",
    ai_generated: true,
    status: "draft",
    blueprint_id: req.blueprint.blueprint_id || null,
    // Elite v2 columns (trigger auto-computes elite_score)
    multi_variable: meta.multi_variable ?? req.blueprint.decision_structure?.multi_variable ?? false,
    conflict_type: meta.conflict_type ?? req.blueprint.decision_structure?.conflict_type ?? "none",
    dynamic_scenario: meta.dynamic_scenario ?? req.blueprint.scenario_model?.dynamic_scenario ?? false,
    transfer_variant: meta.transfer_variant ?? req.blueprint.scenario_model?.transfer_variant_required ?? false,
    complexity_score: meta.complexity_score ?? req.blueprint.complexity_score_target ?? 3,
    distractor_types: distractorTypes,
    distractor_meta: distractorMeta,
    trap_tags: distractorTypes.length > 0 ? distractorTypes : null,
    question_type: req.blueprint.generation_constraints?.question_format || "mc_single",
    exam_part: req.blueprint.exam_part || null,
    scenario_type: meta.conflict_type && meta.conflict_type !== "none" ? "conflict" : (meta.dynamic_scenario ? "dynamic" : "standard"),
    metadata: {
      generator: "auto-generate-question-v2",
      blueprint_version: 2,
      elite_level_target: req.blueprint.elite_level || "standard",
      exam_relevance_tier: req.blueprint.exam_relevance_tier || null,
    },
  };
}

// ── Main Handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Admin-only: this function calls OpenAI at platform cost.
  const { requireAdmin } = await import("../_shared/adminGuard.ts");
  const adminCtx = await requireAdmin(req);
  if (adminCtx instanceof Response) {
    return new Response(adminCtx.body, {
      status: adminCtx.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY_V2 = Deno.env.get("OPENAI_API_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.curriculum_id) return json({ error: "curriculum_id required" }, 400);
  if (!body.blueprint) return json({ error: "blueprint required" }, 400);
  if (!body.competency_text) return json({ error: "competency_text required" }, 400);
  if (!body.learning_field_name) return json({ error: "learning_field_name required" }, 400);

  const count = Math.min(body.count || 1, 10);

  try {
    // Build prompts
    const systemPrompt = buildSystemPrompt(body.profession_name);
    const userPrompt = buildUserPrompt(body, count);

    // Call AI via OpenAI direct API
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const aiUrl = OPENAI_API_KEY
      ? "https://api.openai.com/v1/chat/completions"
      : `${SUPABASE_URL}/functions/v1/ai-tutor`;

    const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
    let aiBody: any;

    if (OPENAI_API_KEY) {
      aiHeaders["Authorization"] = `Bearer ${OPENAI_API_KEY}`;
      aiBody = {
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      };
    } else {
      aiHeaders["Authorization"] = `Bearer ${SERVICE_KEY}`;
      aiBody = {
        _direct_ai_call: true,
        provider: "openai",
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      };
    }

    const aiResp = await fetch(aiUrl, {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify(aiBody),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error(`[AutoGenV2] AI error ${aiResp.status}: ${errText.slice(0, 300)}`);
      return json({ error: "ai_call_failed", status: aiResp.status }, 502);
    }

    const aiData = await aiResp.json();
    const content = OPENAI_API_KEY_V2
      ? aiData.choices?.[0]?.message?.content || ""
      : aiData.content || aiData.choices?.[0]?.message?.content || "";

    // Parse & validate
    let questions: any[];
    try {
      questions = validateAndExtract(content);
    } catch (parseErr) {
      console.error(`[AutoGenV2] Parse error: ${(parseErr as Error).message}`);
      return json({ error: "parse_error", detail: (parseErr as Error).message, raw: content.slice(0, 300) }, 422);
    }

    // Map to DB rows
    const rows = questions.map(q => mapToDbRow(q, body));

    // Insert (elite_score computed by trigger)
    const { data: inserted, error: insErr } = await sb
      .from("exam_questions")
      .insert(rows)
      .select("id, elite_score, elite_level, complexity_score, distractor_types");

    if (insErr) {
      console.error(`[AutoGenV2] DB insert error: ${insErr.message}`);
      return json({ error: "db_insert_failed", detail: insErr.message }, 500);
    }

    // Build transfer variants if applicable
    const transferQuestions = questions.filter(q => q.transfer_variant && q.transfer_variant.new_question);
    if (transferQuestions.length > 0) {
      const transferRows = transferQuestions.map(q => {
        const base = mapToDbRow(q, body);
        return {
          ...base,
          question_text: q.transfer_variant.new_question,
          transfer_variant: true,
          variant_label: `transfer:${q.transfer_variant.modified_parameter || "param"}`,
          variant_group: inserted?.find((i: any) => true)?.id || null,
        };
      });

      const { error: tfErr } = await sb.from("exam_questions").insert(transferRows);
      if (tfErr) console.error(`[AutoGenV2] Transfer insert error: ${tfErr.message}`);
    }

    const eliteCount = (inserted || []).filter((i: any) => i.elite_level === "elite").length;
    const advancedCount = (inserted || []).filter((i: any) => i.elite_level === "advanced").length;

    console.log(`[AutoGenV2] Generated ${inserted?.length || 0} questions (${eliteCount} elite, ${advancedCount} advanced)`);

    return json({
      ok: true,
      generated: inserted?.length || 0,
      elite_count: eliteCount,
      advanced_count: advancedCount,
      transfer_variants: transferQuestions.length,
      questions: inserted,
    });
  } catch (e) {
    console.error(`[AutoGenV2] Error: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
