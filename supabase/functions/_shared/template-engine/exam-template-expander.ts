/**
 * template-engine/exam-template-expander.ts
 *
 * Template-first scaling for exam questions:
 * 1. LLM generates a "master template" with parameter placeholders
 * 2. Code expands the template into N concrete question variants
 *
 * This cuts LLM costs ~70% for high-volume exam pools by generating
 * 1 template → N questions purely in code.
 *
 * Template format:
 * {
 *   template_text: "Berechne den {{subject}} für einen Betrag von {{amount}} € bei einem Steuersatz von {{rate}} %.",
 *   param_sets: [
 *     { subject: "Nettobetrag", amount: "1.190", rate: "19" },
 *     { subject: "Bruttobetrag", amount: "500", rate: "7" },
 *   ],
 *   options_template: ["{{correct}}", "{{distractor1}}", "{{distractor2}}", "{{distractor3}}"],
 *   correct_answer_template: "{{correct}}",
 *   explanation_template: "{{explanation}}",
 *   param_values: {
 *     "0": { correct: "1.000,00 €", distractor1: "990,00 €", distractor2: "1.010,00 €", distractor3: "1.100,00 €", explanation: "1.190 / 1,19 = 1.000 €" },
 *     "1": { correct: "535,00 €", distractor1: "500,00 €", distractor2: "550,00 €", distractor3: "507,00 €", explanation: "500 × 1,07 = 535 €" },
 *   }
 * }
 */

export interface ExamTemplate {
  template_text: string;
  param_sets: Record<string, string>[];
  options_template: string[];
  correct_answer_template: string;
  explanation_template: string;
  /** Per-param-set overrides for options/correct/explanation */
  param_values: Record<string, Record<string, string>>;
  /** Metadata carried through */
  question_type?: string;
  difficulty?: string;
  cognitive_level?: string;
}

export interface ExpandedQuestion {
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  question_type: string;
  difficulty: string;
  cognitive_level: string;
  /** Index within the template expansion */
  variant_index: number;
  /** Whether this was template-expanded (not raw LLM) */
  is_template_expanded: boolean;
}

/**
 * Replace all {{placeholder}} tokens in a string with values from a params map.
 */
function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
}

/**
 * Expand a single ExamTemplate into N concrete questions.
 */
export function expandTemplate(
  template: ExamTemplate,
  defaults: { question_type: string; difficulty: string; cognitive_level: string },
): ExpandedQuestion[] {
  const results: ExpandedQuestion[] = [];

  for (let i = 0; i < template.param_sets.length; i++) {
    const baseParams = template.param_sets[i];
    const extraParams = template.param_values[String(i)] || {};
    const allParams = { ...baseParams, ...extraParams };

    const questionText = interpolate(template.template_text, allParams);
    const options = template.options_template.map(opt => interpolate(opt, allParams));
    const correctAnswer = interpolate(template.correct_answer_template, allParams);
    const explanation = interpolate(template.explanation_template, allParams);

    results.push({
      question_text: questionText,
      options,
      correct_answer: correctAnswer,
      explanation,
      question_type: template.question_type || defaults.question_type,
      difficulty: template.difficulty || defaults.difficulty,
      cognitive_level: template.cognitive_level || defaults.cognitive_level,
      variant_index: i,
      is_template_expanded: true,
    });
  }

  return results;
}

/**
 * Check if an LLM response contains template format (vs raw questions).
 * Templates have `template_text` and `param_sets` fields.
 */
export function isTemplateResponse(parsed: any): boolean {
  return (
    typeof parsed?.template_text === "string" &&
    Array.isArray(parsed?.param_sets) &&
    parsed.param_sets.length > 0
  );
}

/**
 * Try to extract templates from an LLM response.
 * Supports both single template and array of templates.
 */
export function extractTemplates(parsed: any): ExamTemplate[] {
  if (isTemplateResponse(parsed)) {
    return [parsed as ExamTemplate];
  }

  const arr = parsed?.templates || parsed?.items || parsed?.results;
  if (Array.isArray(arr)) {
    return arr.filter(isTemplateResponse) as ExamTemplate[];
  }

  return [];
}

/**
 * Full expansion pipeline: parse LLM output → detect templates → expand all.
 * Returns expanded questions, or empty array if no templates found.
 */
export function expandAllTemplates(
  parsed: any,
  defaults: { question_type: string; difficulty: string; cognitive_level: string },
): ExpandedQuestion[] {
  const templates = extractTemplates(parsed);
  if (templates.length === 0) return [];

  const all: ExpandedQuestion[] = [];
  for (const tpl of templates) {
    all.push(...expandTemplate(tpl, defaults));
  }
  return all;
}
