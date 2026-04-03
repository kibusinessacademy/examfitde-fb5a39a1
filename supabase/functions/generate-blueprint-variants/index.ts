import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type VariantType =
  | "parameter_shift"
  | "context_shift"
  | "trap_shift"
  | "structure_shift"
  | "transfer_shift";

interface Blueprint {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  cognitive_level: string;
  question_template: string;
  rubric: Record<string, number> | null;
  trap_definition: Record<string, unknown> | null;
  typical_errors: Array<{ error: string; frequency?: string }> | null;
}

interface GeneratedVariant {
  question_text: string;
  answer_text?: string;
  options?: Array<{ text: string; is_correct: boolean; source_error?: string }>;
  correct_answer?: unknown;
  trap_type?: string | null;
  trap_applied?: Record<string, unknown> | null;
  distractor_meta?: Array<{ option_text: string; derived_from?: string }> | null;
  variables?: Record<string, unknown> | null;
  scenario_context?: Record<string, unknown> | null;
}

function pickVariantTypes(count: number): VariantType[] {
  const pool: VariantType[] = [
    "parameter_shift", "parameter_shift", "parameter_shift", "parameter_shift",
    "context_shift", "context_shift", "context_shift", "context_shift",
    "trap_shift", "trap_shift", "trap_shift", "trap_shift",
    "structure_shift", "structure_shift", "structure_shift",
    "transfer_shift", "transfer_shift", "transfer_shift", "transfer_shift", "transfer_shift",
  ];
  const out: VariantType[] = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out.sort(() => Math.random() - 0.5);
}

function buildVariantPrompt(bp: Blueprint, variantType: VariantType, subjectName: string): string {
  return `
Erzeuge genau 1 neue Prüfungsvarianten-Frage aus diesem Blueprint.

FACH: ${subjectName}
BLUEPRINT: ${bp.name}
KERNLOGIK: ${bp.canonical_statement}
QUESTION_TYPE: ${bp.knowledge_type}
COGNITIVE_LEVEL: ${bp.cognitive_level}

TRAP-DEFINITION:
${JSON.stringify(bp.trap_definition ?? {}, null, 2)}

TYPICAL_ERRORS:
${JSON.stringify(bp.typical_errors ?? [], null, 2)}

RUBRIC:
${JSON.stringify(bp.rubric ?? {}, null, 2)}

VARIANTENTYP: ${variantType}

REGELN:
- Teste dieselbe Kompetenz wie der Blueprint.
- Halte das cognitive_level exakt konstant.
- Verändere NICHT nur Zahlen, sondern den Denkweg passend zum Variantentyp.
- Nutze eine plausible Klausur- oder Fallsituation.
- Wenn Antwortoptionen erzeugt werden, müssen die falschen Optionen aus typischen Fehlern abgeleitet sein.
- Keine Duplikate des Blueprint-Textes.
- Für higher_education: akademischer Stil, keine IHK-Begriffe.

VARIANTENTYP-LOGIK:
- parameter_shift: gleiche Struktur, andere Werte
- context_shift: gleiche Logik, anderer Anwendungskontext
- trap_shift: gleiche Kompetenz, andere typische Falle
- structure_shift: gleiche Logik, aber indirekter oder umgestellter Informationsaufbau
- transfer_shift: neue Situation, Wissen muss übertragen werden

Gib NUR valides JSON zurück:
{
  "question_text": "...",
  "answer_text": "...",
  "options": [{"text":"...","is_correct":true,"source_error":"..."}],
  "correct_answer": "...",
  "trap_type": "...",
  "trap_applied": {},
  "distractor_meta": [{"option_text":"...","derived_from":"..."}],
  "variables": {},
  "scenario_context": {}
}`.trim();
}

function scoreVariant(bp: Blueprint, variant: GeneratedVariant, variantType: VariantType): { score: number; flags: string[] } {
  const flags: string[] = [];

  // Gate: Trap vorhanden
  if (!variant.trap_type && !variant.trap_applied) flags.push("MISSING_TRAP");

  // Gate: Distraktoren
  if (variant.options && variant.options.length >= 4) {
    const wrong = variant.options.filter(o => !o.is_correct);
    if (wrong.length < 3) flags.push("TOO_FEW_DISTRACTORS");
    if (wrong.filter(o => !o.source_error).length > 1) flags.push("DISTRACTOR_WITHOUT_ERROR_MODEL");
  }

  // Gate: Transfer braucht Kontext
  if (variantType === "transfer_shift" && !variant.scenario_context) {
    flags.push("TRANSFER_WITHOUT_NEW_CONTEXT");
  }

  // Gate: Mindestlänge
  if ((variant.question_text?.length ?? 0) < 30) flags.push("QUESTION_TOO_SHORT");

  const score = Math.max(0, 100 - flags.length * 20);
  return { score, flags };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { blueprintId, count = 20, subjectName = "Wirtschaftsinformatik" } = body;

    if (!blueprintId) {
      return new Response(JSON.stringify({ error: "blueprintId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load blueprint
    const { data: bp, error: bpErr } = await sb
      .from("question_blueprints")
      .select("*")
      .eq("id", blueprintId)
      .single();

    if (bpErr || !bp) {
      return new Response(JSON.stringify({ error: "Blueprint not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blueprint = bp as Blueprint;
    const variantTypes = pickVariantTypes(count);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ variant_type: string; quality_score: number; status: string }> = [];
    const rows: unknown[] = [];

    for (const variantType of variantTypes) {
      const prompt = buildVariantPrompt(blueprint, variantType, subjectName);

      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Du bist ein Prüfungsfragen-Generator für akademische Klausuren. Antworte ausschließlich mit validem JSON." },
              { role: "user", content: prompt },
            ],
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`AI error for variant ${variantType}:`, aiResp.status, errText);
          if (aiResp.status === 429 || aiResp.status === 402) {
            // Stop generating on rate limit / payment
            break;
          }
          continue;
        }

        const aiData = await aiResp.json();
        const content = aiData.choices?.[0]?.message?.content ?? "";

        // Extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("No JSON in AI response for", variantType);
          continue;
        }

        const variant: GeneratedVariant = JSON.parse(jsonMatch[0]);
        const { score, flags } = scoreVariant(blueprint, variant, variantType);

        const row = {
          blueprint_id: blueprint.id,
          curriculum_id: blueprint.curriculum_id,
          learning_field_id: blueprint.learning_field_id,
          competency_id: blueprint.competency_id,
          variant_type: variantType,
          question_type: blueprint.knowledge_type,
          cognitive_level: blueprint.cognitive_level,
          title: blueprint.name,
          question_text: variant.question_text,
          answer_text: variant.answer_text ?? null,
          options: variant.options ?? null,
          correct_answer: variant.correct_answer ?? null,
          trap_type: variant.trap_type ?? (blueprint.trap_definition as any)?.trap_type ?? null,
          trap_applied: variant.trap_applied ?? null,
          distractor_meta: variant.distractor_meta ?? null,
          variables: variant.variables ?? null,
          scenario_context: variant.scenario_context ?? null,
          quality_score: score,
          quality_flags: flags,
          status: score >= 80 ? "review" : "draft",
        };

        rows.push(row);
        results.push({ variant_type: variantType, quality_score: score, status: row.status });
      } catch (e) {
        console.error(`Error generating ${variantType}:`, e);
        continue;
      }
    }

    // Batch insert
    if (rows.length > 0) {
      const { error: insertErr } = await sb.from("exam_question_variants").insert(rows);
      if (insertErr) {
        console.error("Insert error:", insertErr);
        return new Response(JSON.stringify({ error: "Failed to save variants", detail: insertErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      blueprint_id: blueprintId,
      blueprint_name: blueprint.name,
      generated: rows.length,
      requested: count,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-blueprint-variants error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
