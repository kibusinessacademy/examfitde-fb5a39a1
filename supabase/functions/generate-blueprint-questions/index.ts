import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BlueprintVariable {
  variable_name: string;
  variable_type: string;
  allowed_values?: string[];
  range_min?: number;
  range_max?: number;
  range_step?: number;
  default_value?: string;
}

interface BlueprintConstraint {
  constraint_type: string;
  condition_expression: Record<string, unknown>;
  action_expression: Record<string, unknown>;
  description?: string;
}

interface BlueprintDistractor {
  distractor_template: string;
  error_type: string;
  error_explanation?: string;
}

interface Blueprint {
  id: string;
  curriculum_id: string;
  learning_field_id?: string;
  competency_id?: string;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  cognitive_level: string;
  question_template: string;
  explanation_template?: string;
  max_variations: number;
  variables: BlueprintVariable[];
  constraints: BlueprintConstraint[];
  distractors: BlueprintDistractor[];
  correct_answers: { answer_template: string; calculation_formula?: string }[];
}

// Validiere Variablen-Werte gegen Constraints
function validateConstraints(
  values: Record<string, unknown>,
  constraints: BlueprintConstraint[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const constraint of constraints) {
    if (constraint.constraint_type === "forbidden") {
      // Prüfe ob verbotene Kombination vorliegt
      const conditionKeys = Object.keys(constraint.condition_expression);
      const allMatch = conditionKeys.every(
        (key) => values[key] === constraint.condition_expression[key]
      );
      if (allMatch) {
        errors.push(`Verbotene Kombination: ${constraint.description || "Nicht erlaubt"}`);
      }
    }

    if (constraint.constraint_type === "conditional") {
      // Wenn Bedingung erfüllt, muss Aktion auch erfüllt sein
      const conditionKeys = Object.keys(constraint.condition_expression);
      const conditionMet = conditionKeys.every((key) => {
        const condition = constraint.condition_expression[key] as string;
        const value = values[key] as number;
        if (condition.startsWith(">")) {
          return value > parseFloat(condition.slice(1).trim());
        }
        if (condition.startsWith("<")) {
          return value < parseFloat(condition.slice(1).trim());
        }
        return values[key] === condition;
      });

      if (conditionMet) {
        const actionKeys = Object.keys(constraint.action_expression);
        const actionMet = actionKeys.every(
          (key) => values[key] === constraint.action_expression[key]
        );
        if (!actionMet) {
          errors.push(`Constraint verletzt: ${constraint.description || "Bedingung nicht erfüllt"}`);
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// Generiere zufällige Werte für Variablen
function generateVariableValues(
  variables: BlueprintVariable[],
  seed: number
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const random = mulberry32(seed);

  for (const variable of variables) {
    switch (variable.variable_type) {
      case "entity":
      case "enum":
        if (variable.allowed_values && variable.allowed_values.length > 0) {
          const index = Math.floor(random() * variable.allowed_values.length);
          values[variable.variable_name] = variable.allowed_values[index];
        }
        break;

      case "number":
        if (variable.range_min !== undefined && variable.range_max !== undefined) {
          const step = variable.range_step || 1;
          const range = (variable.range_max - variable.range_min) / step;
          const steps = Math.floor(random() * range);
          values[variable.variable_name] = variable.range_min + steps * step;
        }
        break;

      case "text":
        values[variable.variable_name] = variable.default_value || "";
        break;
    }
  }

  return values;
}

// Deterministischer Zufallsgenerator (Mulberry32)
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Template-Rendering mit Variablen
function renderTemplate(template: string, values: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    result = result.replace(regex, String(value));
  }
  return result;
}

// Berechne Ähnlichkeit zwischen zwei Varianten
function calculateSimilarity(
  values1: Record<string, unknown>,
  values2: Record<string, unknown>
): number {
  const keys = Object.keys(values1);
  if (keys.length === 0) return 1;

  let matches = 0;
  for (const key of keys) {
    if (values1[key] === values2[key]) {
      matches++;
    }
  }
  return matches / keys.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { blueprintId, count = 5, baseSeed } = await req.json();

    if (!blueprintId) {
      return new Response(JSON.stringify({ error: "blueprintId ist erforderlich" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Blueprint laden mit allen Komponenten
    const { data: blueprint, error: blueprintError } = await supabase
      .from("question_blueprints")
      .select("*")
      .eq("id", blueprintId)
      .single();

    if (blueprintError || !blueprint) {
      return new Response(
        JSON.stringify({ error: "Blueprint nicht gefunden", details: blueprintError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Variablen laden
    const { data: variables } = await supabase
      .from("blueprint_variables")
      .select("*")
      .eq("blueprint_id", blueprintId);

    // 3. Constraints laden
    const { data: constraints } = await supabase
      .from("blueprint_constraints")
      .select("*")
      .eq("blueprint_id", blueprintId)
      .eq("is_active", true);

    // 4. Distraktoren laden
    const { data: distractors } = await supabase
      .from("blueprint_distractors")
      .select("*")
      .eq("blueprint_id", blueprintId)
      .eq("is_active", true)
      .order("sort_order");

    // 5. Korrekte Antworten laden
    const { data: correctAnswers } = await supabase
      .from("blueprint_correct_answers")
      .select("*")
      .eq("blueprint_id", blueprintId);

    // 6. Existierende Varianten laden (für Ähnlichkeitsprüfung)
    const { data: existingVariants } = await supabase
      .from("blueprint_variants")
      .select("variable_values")
      .eq("blueprint_id", blueprintId);

    const existingValues = (existingVariants || []).map(
      (v) => v.variable_values as Record<string, unknown>
    );

    // 7. Varianten generieren
    const generatedVariants: {
      variableValues: Record<string, unknown>;
      questionText: string;
      options: string[];
      correctAnswer: number;
      explanation: string;
      seed: number;
      similarityScore: number;
    }[] = [];

    const maxAttempts = count * 10;
    let attempts = 0;
    const seedBase = baseSeed || Date.now();

    while (generatedVariants.length < count && attempts < maxAttempts) {
      const seed = seedBase + attempts;
      attempts++;

      // Generiere Variablen-Werte
      const values = generateVariableValues(variables || [], seed);

      // Validiere gegen Constraints
      const validation = validateConstraints(values, constraints || []);
      if (!validation.isValid) {
        continue;
      }

      // Prüfe Ähnlichkeit zu existierenden Varianten
      const allExisting = [...existingValues, ...generatedVariants.map((v) => v.variableValues)];
      const maxSimilarity = Math.max(
        0,
        ...allExisting.map((existing) => calculateSimilarity(values, existing))
      );

      if (maxSimilarity > (blueprint.max_similarity_score || 0.82)) {
        continue;
      }

      // Render Frage
      const questionText = renderTemplate(blueprint.question_template, values);

      // Render korrekte Antwort
      const correctAnswerTemplate = correctAnswers?.[0]?.answer_template || "";
      let correctAnswerText = renderTemplate(correctAnswerTemplate, values);

      // Falls Formel vorhanden, berechnen
      if (correctAnswers?.[0]?.calculation_formula) {
        try {
          const formula = renderTemplate(correctAnswers[0].calculation_formula, values);
          // Sichere Auswertung (nur Zahlen und Operatoren)
          const result = eval(formula.replace(/[^0-9+\-*/.()]/g, ""));
          correctAnswerText = String(result);
        } catch {
          // Formel konnte nicht ausgewertet werden
        }
      }

      // Render Distraktoren
      const distractorTexts = (distractors || []).map((d) =>
        renderTemplate(d.distractor_template, values)
      );

      // Erstelle Optionen (shuffle)
      const allOptions = [correctAnswerText, ...distractorTexts.slice(0, 3)];
      const shuffledOptions = shuffleWithSeed(allOptions, seed);
      const correctIndex = shuffledOptions.indexOf(correctAnswerText);

      // Render Erklärung
      const explanation = blueprint.explanation_template
        ? renderTemplate(blueprint.explanation_template, values)
        : "";

      generatedVariants.push({
        variableValues: values,
        questionText,
        options: shuffledOptions,
        correctAnswer: correctIndex,
        explanation,
        seed,
        similarityScore: maxSimilarity,
      });
    }

    // 8. Varianten in DB speichern
    const savedQuestions: string[] = [];

    for (const variant of generatedVariants) {
      // Prüfungsfrage erstellen
      const { data: question, error: questionError } = await supabase
        .from("exam_questions")
        .insert({
          curriculum_id: blueprint.curriculum_id,
          learning_field_id: blueprint.learning_field_id,
          competency_id: blueprint.competency_id,
          question_text: variant.questionText,
          options: variant.options,
          correct_answer: variant.correctAnswer,
          explanation: variant.explanation,
          difficulty: blueprint.cognitive_level === "remember" ? "easy" : 
                      blueprint.cognitive_level === "analyze" ? "hard" : "medium",
          ai_generated: true,
          status: "draft",
        })
        .select("id")
        .single();

      if (question) {
        savedQuestions.push(question.id);

        // Variante speichern
        await supabase.from("blueprint_variants").insert({
          blueprint_id: blueprintId,
          exam_question_id: question.id,
          variable_values: variant.variableValues,
          generation_seed: variant.seed,
          similarity_score: variant.similarityScore,
          validation_passed: true,
          generated_by: "system",
        });
      }
    }

    // 9. Audit-Log
    await supabase.from("blueprint_audit_log").insert({
      blueprint_id: blueprintId,
      action: "variant_generated",
      affected_variants_count: generatedVariants.length,
      changes: { count, baseSeed: seedBase },
    });

    return new Response(
      JSON.stringify({
        success: true,
        generated: generatedVariants.length,
        questionIds: savedQuestions,
        attempts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Blueprint generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Shuffle mit deterministischem Seed
function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const result = [...array];
  const random = mulberry32(seed);

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
