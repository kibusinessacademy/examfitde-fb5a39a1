import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

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
  max_similarity_score?: number;
  status?: string;
  variables: BlueprintVariable[];
  constraints: BlueprintConstraint[];
  distractors: BlueprintDistractor[];
  correct_answers: { answer_template: string; calculation_formula?: string; expected_unit?: string }[];
}

// ─── Constraint Engine (enhanced) ──────────────────────────────────────────────

function validateConstraints(
  values: Record<string, unknown>,
  constraints: BlueprintConstraint[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const constraint of constraints) {
    switch (constraint.constraint_type) {
      case "forbidden": {
        const conditionKeys = Object.keys(constraint.condition_expression);
        const allMatch = conditionKeys.every(
          (key) => values[key] === constraint.condition_expression[key]
        );
        if (allMatch) {
          errors.push(`Verbotene Kombination: ${constraint.description || "Nicht erlaubt"}`);
        }
        break;
      }

      case "conditional": {
        const conditionKeys = Object.keys(constraint.condition_expression);
        const conditionMet = conditionKeys.every((key) => {
          return evaluateCondition(values[key], constraint.condition_expression[key] as string);
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
        break;
      }

      // NEW: range constraint – value must be within [min, max]
      case "range": {
        for (const [key, rangeExpr] of Object.entries(constraint.condition_expression)) {
          const val = values[key] as number;
          const range = rangeExpr as { min?: number; max?: number };
          if (typeof val === "number") {
            if (range.min !== undefined && val < range.min) {
              errors.push(`${key} unter Minimum ${range.min}: ${constraint.description || ""}`);
            }
            if (range.max !== undefined && val > range.max) {
              errors.push(`${key} über Maximum ${range.max}: ${constraint.description || ""}`);
            }
          }
        }
        break;
      }

      // NEW: in_list – value must be one of the allowed list
      case "in_list": {
        for (const [key, allowedExpr] of Object.entries(constraint.condition_expression)) {
          const allowed = allowedExpr as string[];
          if (Array.isArray(allowed) && !allowed.includes(String(values[key]))) {
            errors.push(`${key} nicht in erlaubter Liste: ${constraint.description || ""}`);
          }
        }
        break;
      }

      // NEW: regex – value must match pattern
      case "regex": {
        for (const [key, patternExpr] of Object.entries(constraint.condition_expression)) {
          const pattern = patternExpr as string;
          const val = String(values[key] || "");
          try {
            if (!new RegExp(pattern).test(val)) {
              errors.push(`${key} passt nicht auf Muster: ${constraint.description || ""}`);
            }
          } catch {
            errors.push(`Ungültiges Regex-Muster für ${key}`);
          }
        }
        break;
      }

      // NEW: implies_one_of – if condition met, action value must be one of list
      case "implies_one_of": {
        const condKeys = Object.keys(constraint.condition_expression);
        const condMet = condKeys.every((key) =>
          evaluateCondition(values[key], constraint.condition_expression[key] as string)
        );
        if (condMet) {
          for (const [key, allowedExpr] of Object.entries(constraint.action_expression)) {
            const allowed = allowedExpr as string[];
            if (Array.isArray(allowed) && !allowed.includes(String(values[key]))) {
              errors.push(`${key} muss einer von ${allowed.join(", ")} sein: ${constraint.description || ""}`);
            }
          }
        }
        break;
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

function evaluateCondition(value: unknown, condition: string): boolean {
  if (typeof condition === "string") {
    if (condition.startsWith(">=")) return (value as number) >= parseFloat(condition.slice(2).trim());
    if (condition.startsWith("<=")) return (value as number) <= parseFloat(condition.slice(2).trim());
    if (condition.startsWith(">")) return (value as number) > parseFloat(condition.slice(1).trim());
    if (condition.startsWith("<")) return (value as number) < parseFloat(condition.slice(1).trim());
    if (condition.startsWith("!=")) return String(value) !== condition.slice(2).trim();
    return value === condition;
  }
  return value === condition;
}

// ─── Variable Generation ───────────────────────────────────────────────────────

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

// ─── Deterministic RNG (Mulberry32) ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Template Rendering ────────────────────────────────────────────────────────

function renderTemplate(template: string, values: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    result = result.replace(regex, String(value));
  }
  return result;
}

// ─── Similarity (value-level) ──────────────────────────────────────────────────

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

// ─── Text Fingerprint (prevents textually near-identical variants) ────────────

function normalizeTextHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]/g, "")
    .trim();
  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

// ─── Text-Similarity (Jaccard n-gram) ─────────────────────────────────────────

function textNgrams(text: string, n = 3): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i <= norm.length - n; i++) grams.add(norm.slice(i, i + n));
  return grams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

const BLUEPRINT_TEXT_SIMILARITY_THRESHOLD = 0.70;

// ─── Unit Validation (NEW: checks €, %, Monate etc.) ──────────────────────────

function validateAnswerUnit(answerText: string, expectedUnit?: string): { valid: boolean; error?: string } {
  if (!expectedUnit) return { valid: true };

  const unitPatterns: Record<string, RegExp> = {
    "€": /\d+([.,]\d+)?\s*€/,
    "%": /\d+([.,]\d+)?\s*%/,
    "Monate": /\d+\s*Monat(e)?/i,
    "Jahre": /\d+\s*Jahr(e)?/i,
    "Tage": /\d+\s*Tag(e)?/i,
    "Stunden": /\d+\s*Stunde(n)?/i,
  };

  const pattern = unitPatterns[expectedUnit];
  if (pattern && !pattern.test(answerText)) {
    return { valid: false, error: `Antwort enthält nicht die erwartete Einheit: ${expectedUnit}` };
  }
  return { valid: true };
}

// ─── Safe Math Evaluator ───────────────────────────────────────────────────────

function safeEvaluateMath(expr: string): number | null {
  const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, "").trim();
  if (!sanitized) return null;

  let pos = 0;

  function skipSpaces() { while (pos < sanitized.length && sanitized[pos] === " ") pos++; }
  function isDigit(c: string) { return c >= "0" && c <= "9"; }

  function parseExpression(): number {
    let result = parseTerm();
    while (pos < sanitized.length) {
      skipSpaces();
      if (sanitized[pos] === "+") { pos++; result += parseTerm(); }
      else if (sanitized[pos] === "-") { pos++; result -= parseTerm(); }
      else break;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (pos < sanitized.length) {
      skipSpaces();
      if (sanitized[pos] === "*") { pos++; result *= parseFactor(); }
      else if (sanitized[pos] === "/") {
        pos++;
        const divisor = parseFactor();
        if (divisor === 0) throw new Error("Division by zero");
        result /= divisor;
      }
      else break;
    }
    return result;
  }

  function parseFactor(): number {
    skipSpaces();
    if (sanitized[pos] === "-") { pos++; return -parseFactor(); }
    if (sanitized[pos] === "(") {
      pos++;
      const result = parseExpression();
      if (sanitized[pos] === ")") pos++;
      skipSpaces();
      return result;
    }
    const start = pos;
    while (pos < sanitized.length && (isDigit(sanitized[pos]) || sanitized[pos] === ".")) {
      pos++;
    }
    if (pos === start) throw new Error("Unexpected token");
    skipSpaces();
    return parseFloat(sanitized.slice(start, pos));
  }

  try {
    const result = parseExpression();
    if (pos < sanitized.length) return null;
    return isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

// ─── Shuffle ───────────────────────────────────────────────────────────────────

function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const result = [...array];
  const random = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

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

    // 1. Blueprint laden
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

    // ──── NEW: Quality Gate – Blueprint must be approved ────
    if (blueprint.status !== "approved") {
      return new Response(
        JSON.stringify({
          error: "Blueprint nicht freigegeben",
          details: `Status ist '${blueprint.status}', erwartet 'approved'. Blueprints müssen vor der Varianten-Generierung freigegeben werden.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2-5. Parallel: load variables, constraints, distractors, correct answers, existing variants
    const [
      { data: variables },
      { data: constraints },
      { data: distractors },
      { data: correctAnswers },
      { data: existingVariants },
    ] = await Promise.all([
      supabase.from("blueprint_variables").select("*").eq("blueprint_id", blueprintId),
      supabase.from("blueprint_constraints").select("*").eq("blueprint_id", blueprintId).eq("is_active", true),
      supabase.from("blueprint_distractors").select("*").eq("blueprint_id", blueprintId).eq("is_active", true).order("sort_order"),
      supabase.from("blueprint_correct_answers").select("*").eq("blueprint_id", blueprintId),
      supabase.from("blueprint_variants").select("variable_values, question_text_hash").eq("blueprint_id", blueprintId),
    ]);

    const existingValues = (existingVariants || []).map(
      (v) => v.variable_values as Record<string, unknown>
    );
    const existingHashes = new Set(
      (existingVariants || []).map((v) => v.question_text_hash).filter(Boolean)
    );

    // 6. Generate variants
    const generatedVariants: {
      variableValues: Record<string, unknown>;
      questionText: string;
      questionTextHash: string;
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

      const values = generateVariableValues(variables || [], seed);

      // Validate constraints (now with range, in_list, regex, implies_one_of)
      const validation = validateConstraints(values, constraints || []);
      if (!validation.isValid) continue;

      // Value-level similarity check
      const allExisting = [...existingValues, ...generatedVariants.map((v) => v.variableValues)];
      const maxSimilarity = Math.max(
        0,
        ...allExisting.map((existing) => calculateSimilarity(values, existing))
      );
      if (maxSimilarity > (blueprint.max_similarity_score || 0.82)) continue;

      // Render question text
      const questionText = renderTemplate(blueprint.question_template, values);

      // ──── Text-level duplicate check via normalized hash ────
      const textHash = normalizeTextHash(questionText);
      const allHashes = new Set([...existingHashes, ...generatedVariants.map((v) => v.questionTextHash)]);
      if (allHashes.has(textHash)) continue;

      // ──── Text-similarity check (Jaccard n-gram, threshold 0.70) ────
      const qNgrams = textNgrams(questionText);
      const allExistingTexts = generatedVariants.map((v) => v.questionText);
      let nearDup = false;
      for (const existingText of allExistingTexts) {
        if (jaccardSimilarity(qNgrams, textNgrams(existingText)) > BLUEPRINT_TEXT_SIMILARITY_THRESHOLD) {
          nearDup = true;
          break;
        }
      }
      if (nearDup) continue;

      // Render correct answer
      const correctAnswerDef = correctAnswers?.[0];
      const correctAnswerTemplate = correctAnswerDef?.answer_template || "";
      let correctAnswerText = renderTemplate(correctAnswerTemplate, values);

      // Calculate formula if present
      if (correctAnswerDef?.calculation_formula) {
        try {
          const formula = renderTemplate(correctAnswerDef.calculation_formula, values);
          const result = safeEvaluateMath(formula);
          if (result !== null) {
            correctAnswerText = String(result);
            // ──── NEW: Append unit if expected ────
            if (correctAnswerDef.expected_unit) {
              correctAnswerText = `${result} ${correctAnswerDef.expected_unit}`;
            }
          }
        } catch {
          // Formula could not be evaluated
        }
      }

      // ──── NEW: Unit validation ────
      if (correctAnswerDef?.expected_unit) {
        const unitCheck = validateAnswerUnit(correctAnswerText, correctAnswerDef.expected_unit);
        if (!unitCheck.valid) continue;
      }

      // Render distractors
      const distractorTexts = (distractors || []).map((d) =>
        renderTemplate(d.distractor_template, values)
      );

      // Build options (shuffle)
      const allOptions = [correctAnswerText, ...distractorTexts.slice(0, 3)];
      const shuffledOptions = shuffleWithSeed(allOptions, seed);
      const correctIndex = shuffledOptions.indexOf(correctAnswerText);

      // Render explanation
      const explanation = blueprint.explanation_template
        ? renderTemplate(blueprint.explanation_template, values)
        : "";

      generatedVariants.push({
        variableValues: values,
        questionText,
        questionTextHash: textHash,
        options: shuffledOptions,
        correctAnswer: correctIndex,
        explanation,
        seed,
        similarityScore: maxSimilarity,
      });
    }

    // 7. Save to DB
    const savedQuestions: string[] = [];

    for (const variant of generatedVariants) {
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

        await supabase.from("blueprint_variants").insert({
          blueprint_id: blueprintId,
          exam_question_id: question.id,
          variable_values: variant.variableValues,
          generation_seed: variant.seed,
          similarity_score: variant.similarityScore,
          question_text_hash: variant.questionTextHash,
          validation_passed: true,
          generated_by: "system",
        });
      }
    }

    // 8. Audit-Log
    await supabase.from("blueprint_audit_log").insert({
      blueprint_id: blueprintId,
      action: "variant_generated",
      affected_variants_count: generatedVariants.length,
      changes: { count, baseSeed: seedBase, statusGateEnforced: true },
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
