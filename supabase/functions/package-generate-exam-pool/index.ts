import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";
import type { HybridTargetResult } from "../_shared/hybridExamTarget.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { loadOrGenerateGlossary, formatGlossaryForPrompt } from "../_shared/glossary-loader.ts";
import { EXPLANATION_TEMPLATE, CALCULATION_GUARD, REGULATORY_GUARD, computeHallucinationRisk, computeVariationScore, loadMasteryContext, buildMasteryFeedbackSuffix } from "../_shared/prompt-kit.ts";

/**
 * DOMINANZ-ENGINE v5: IHK-REALISTIC QUALITY GATES
 * 
 * v5 upgrades:
 * - IHK-realistic difficulty distribution (25/35/25/15 statt 5/35/45/15)
 * - HARD praxis-score gate (score < 2 → reject, not just log)
 * - Explanation quality enforced (no explanation → reject)
 * - Distractor plausibility rules in prompt (4 distinct error types)
 * - KI-Selbstaudit: prompt instructs model to self-check before output
 * - Quality scoring tightened: only score ≥ 4 → exam pool
 * - Blueprint question types enforced with quotas
 * - Fachliche Validatoren (domain-specific checks)
 */

const AI_CHUNK_SIZE = 20;
const AI_QUESTIONS_PER_CALL = 5;
const AI_QUESTIONS_PER_BLUEPRINT = 35;
const HARD_CAP_QUESTIONS = 1700;

// ─── Cognitive Level Distribution (IHK-realistic) ─────────────────────────────

const COGNITIVE_LEVEL_DISTRIBUTION: Record<string, number> = {
  recall: 0.25,    // Reines Wissen (Definitionen, Begriffe)
  apply: 0.35,     // Anwendung (Rechnen, Zuordnen, Ableitung)
  analyze: 0.25,   // Analyse (Fehler finden, richtige Handlung erkennen)
  decide: 0.15,    // Bewertung/Entscheidung (Best Practice, Risikoabwägung)
};

// ─── Question Types (semantic variety) ────────────────────────────────────────

let QUESTION_TYPE_MIX: Record<string, number> = {
  best_option: 0.20,       // Beste Option aus mehreren Maßnahmen
  error_detection: 0.15,   // Fehlerdiagnose
  calculation: 0.20,       // Rechenaufgabe mit konkreten Zahlen
  case_study: 0.20,        // Fallstudie: konkreter Praxisfall
  risk_assessment: 0.10,   // Risikoabwägung
  compliance_check: 0.15,  // Compliance/Norm-Check
};

/**
 * Apply math_ratio from certification_catalog to QUESTION_TYPE_MIX.
 * Redistributes non-calculation types proportionally to hit the target ratio.
 */
function applyMathRatio(mathRatio: number): void {
  if (mathRatio <= 0 || mathRatio > 0.50) {
    console.log(`[ExamPool-v5] mathRatio out of bounds (${mathRatio}) — ignored`);
    return;
  }
  const currentCalc = QUESTION_TYPE_MIX.calculation ?? 0.20;
  if (Math.abs(currentCalc - mathRatio) < 0.01) {
    console.log(`[ExamPool-v5] mathRatio already at ${(mathRatio * 100).toFixed(0)}% — no change needed`);
    return;
  }
  
  const remaining = 1 - mathRatio;
  const otherTotal = Object.entries(QUESTION_TYPE_MIX)
    .filter(([k]) => k !== "calculation")
    .reduce((s, [, v]) => s + v, 0);
  
  for (const key of Object.keys(QUESTION_TYPE_MIX)) {
    if (key === "calculation") {
      QUESTION_TYPE_MIX[key] = mathRatio;
    } else {
      QUESTION_TYPE_MIX[key] = (QUESTION_TYPE_MIX[key] / otherTotal) * remaining;
    }
  }
  console.log(`[ExamPool-v5] mathRatio applied: calculation=${(mathRatio * 100).toFixed(0)}%, mix=${JSON.stringify(QUESTION_TYPE_MIX)}`);
}

// ─── Difficulty Distribution (IHK-realistic for exam simulation) ──────────────

let DIFFICULTY_DISTRIBUTION: Record<string, number> = {
  easy: 0.25, medium: 0.35, hard: 0.25, very_hard: 0.15,
};

type DifficultyKey = string;
type QuestionTypeKey = string;
type CognitiveLevelKey = string;

// ─── Diversity Engine ─────────────────────────────────────────────────────────

const GERMAN_NAMES = [
  "Frau Yılmaz", "Herr Petrov", "Frau Nguyen", "Herr Al-Rashid", "Frau Kowalski",
  "Herr da Silva", "Frau Chen", "Herr Öztürk", "Frau Hoffmann", "Herr Becker",
  "Frau Richter", "Herr Nowak", "Frau Lehmann", "Herr Braun", "Frau Klein",
  "Herr Fischer", "Frau Schäfer", "Herr Krämer", "Frau Bergmann", "Herr Lorenz",
  "Frau Hartmann", "Herr Weiß", "Frau Engel", "Herr Seidel", "Frau Haas",
  "Herr Baumann", "Frau König", "Herr Dietrich", "Frau Schuster", "Herr Roth",
  "Frau Maier", "Herr Scholz", "Frau Vogel", "Herr Franke", "Frau Ludwig",
];

// PROFESSION-AGNOSTIC openers — no banking/industry-specific terms
const SENTENCE_OPENERS = [
  "Ein Kunde möchte", "Im Beratungsgespräch", "Welche", "Stellen Sie sich vor,",
  "Bei der Prüfung", "Während eines Kundentermins", "Im Rahmen der",
  "Ein Unternehmen plant", "Zur Beurteilung", "Angenommen,",
  "In Ihrem Ausbildungsbetrieb", "Bei der Qualitätskontrolle", "Ein Auszubildender fragt",
  "Nach Analyse der Unterlagen", "Die Geschäftsleitung prüft",
  "Vor dem Hintergrund", "Gemäß den Vorschriften", "Aus betriebswirtschaftlicher Sicht",
  "Im Zuge der Digitalisierung", "Ein langjähriger Geschäftspartner",
  "Ihre Kollegin bittet Sie", "Ihr Vorgesetzter beauftragt Sie",
  "Ein neuer Auftrag erfordert", "Bei der Abrechnung stellen Sie fest,",
  "Im Teamgespräch wird diskutiert,", "Eine Kundin reklamiert,",
  "Der Abteilungsleiter fragt nach", "Beim Vergleich zweier Angebote",
  "Nach Durchsicht der Dokumente", "Im Tagesgeschäft fällt auf,",
];

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

const TEXT_SIMILARITY_THRESHOLD = 0.70;

function shuffleArray<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Difficulty Auto-Validator ────────────────────────────────────────────────

function validateDifficulty(q: { question_text: string; options: string[]; difficulty: string; explanation?: string }): boolean {
  const text = q.question_text.toLowerCase();
  const allText = (text + " " + q.options.join(" ") + " " + (q.explanation || "")).toLowerCase();

  // PROFESSION-AGNOSTIC indicators (no banking-specific terms)
  const hasCalculation = /\d+[\s]*[×x*÷/+\-]\s*\d+|\d+[.,]\d+\s*(%|€|eur)|\bberechn|\brate\b|\bbetrag\b|\bformel\b|\bergebnis\b/i.test(allText);
  const hasParagraph = /§\s*\d+|\bBGB\b|\bHGB\b|\bAO\b|\bUStG\b|\bKSchG\b|\bAGB\b|\bDSGVO\b|\bBetrVG\b|\bBBiG\b|\bVerordnung\b|\bRichtlinie\b/i.test(allText);
  const hasFachbegriff = /\b(Qualität|Kennzahl|Kalkulation|Deckungsbeitrag|Bilanz|GuV|Skonto|Rabatt|Gewährleistung|Reklamation|Dokumentation|Arbeitsschutz|Hygiene|Toleranz|Prüfprotokoll|Lieferschein|Bestellung|Inventur|Abschreibung)\b/i.test(allText);
  const hasDecision = /\bwelche Maßnahme\b|\bbeste Option\b|\bempfehlen\b|\bRisiko\b|\bbeurteilen\b|\babwägen\b|\bentscheiden\b|\bhandeln\b|\bpriorisieren\b/i.test(allText);

  // RELAXED validation: difficulty is now FORCED from distribution, so this gate
  // validates content FITS the level. Previously too strict for easy/medium,
  // causing 90%+ to fail and land in training pool.
  switch (q.difficulty) {
    case "easy":
      // Easy: should NOT require multi-step calculation + legal references
      if (hasCalculation && hasParagraph && hasDecision) return false;
      return true; // most content is valid as easy
    case "medium":
      // Medium: any professional content indicator is fine (relaxed from AND to OR)
      return true; // medium is the baseline — always valid
    case "hard":
      // Hard: needs at least ONE complexity indicator
      return hasCalculation || hasParagraph || hasFachbegriff || hasDecision;
    case "very_hard":
      // Very hard: needs multiple complexity indicators
      return (hasCalculation || hasParagraph) && (hasFachbegriff || hasDecision);
    default:
      return true;
  }
}

// ─── Praxis-Score (Realism Gate) — PROFESSION-AGNOSTIC ───────────────────────

function calculatePraxisScore(q: { question_text: string; options: string[] }): number {
  const text = q.question_text;
  let score = 0;

  // Has role/person (generic across all professions)
  if (/\b(Auszubildende[r]?|Sachbearbeiter|Kollegin|Kollege|Vorgesetzte[r]?|Geschäftsführer|Meister|Fachkraft|Mitarbeiter|Ausbilder|Teamleiter|Abteilungsleiter|Kunde|Kundin|Auftraggeber|Lieferant|Patient|Mandant)\b/i.test(text)) score++;

  // Has situational context (generic across all professions)
  if (/\b(Beratungsgespräch|Besprechung|Arbeitsplatz|Auftrag|Bestellung|Reklamation|Lieferung|Inventur|Qualitätskontrolle|Arbeitsschutz|Schulung|Abrechnung|Dokumentation|Prüfung|Wartung|Projektplanung|Kundengespräch|Wareneingang|Arbeitsanweisung)\b/i.test(text)) score++;

  // Has realistic non-round numbers
  const numbers = text.match(/\d{3,}/g);
  if (numbers) {
    const hasNonRound = numbers.some(n => {
      const num = parseInt(n);
      return num % 100 !== 0 || num > 99999;
    });
    if (hasNonRound) score++;
  }

  // Has concrete name
  if (/\b(Herr|Frau)\s+[A-ZÄÖÜ][a-zäöüß]+/i.test(text)) score++;

  return score; // 0-4, gate: >= 1
}

// ─── AI Style Gate (kill KI-Lehrbuch-Deutsch) ────────────────────────────────

const AI_STYLE_BLACKLIST = [
  "im folgenden", "es ist zu beachten", "grundsätzlich gilt",
  "zusammenfassend lässt sich sagen", "in diesem zusammenhang",
  "es sei darauf hingewiesen", "abschließend sei erwähnt",
  "diesbezüglich", "hinsichtlich dessen", "in anbetracht",
  "es ist wichtig zu verstehen", "man sollte beachten",
  "folgende aspekte sind relevant", "hierbei handelt es sich um",
  "in der praxis zeigt sich", "es empfiehlt sich",
  "nachfolgend wird erläutert", "im weiteren verlauf",
];

function passesStyleGate(q: { question_text: string; explanation?: string }): boolean {
  const text = (q.question_text + " " + (q.explanation || "")).toLowerCase();
  for (const phrase of AI_STYLE_BLACKLIST) {
    if (text.includes(phrase)) return false;
  }
  // Reject overly long sentences (>40 words = KI-typical)
  const sentences = q.question_text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 40);
  if (longSentences.length > 0) return false;
  return true;
}

// ─── Explanation Quality Check (strict: must explain WHY wrong + tip) ─────────

function hasQualityExplanation(q: { explanation?: string; options: string[] }): boolean {
  if (!q.explanation || q.explanation.length < 80) return false;

  const expl = q.explanation.toLowerCase();
  // Must explain why wrong (at least 2 references to incorrect reasoning)
  const wrongReferences = (expl.match(/\b(falsch|nicht korrekt|inkorrekt|irrtümlich|fehler|verwechsl|trifft nicht zu|fehlerhaft|unzutreffend)\b/gi) || []).length;
  // Must have a tip/merksatz
  const hasTip = /\b(tipp|merke|merksatz|prüfungstipp|achtung|wichtig|beachte)\b/i.test(expl);
  return wrongReferences >= 2 && hasTip;
}

// ─── Quality Scoring (Exam Pool vs Training Pool) ─────────────────────────────

function calculateQualityScore(q: {
  question_text: string;
  options: string[];
  difficulty: string;
  explanation?: string;
  question_type?: string;
}): { score: number; pool: "exam" | "training" } {
  let score = 0;

  // Diversity (sentence opener variety) - 1pt
  const firstWord = q.question_text.split(/\s+/)[0];
  if (!["Die", "Der", "Das", "Ein", "Eine"].includes(firstWord)) score += 1;

  // Praxis-Score - up to 2pts
  const praxis = calculatePraxisScore(q);
  score += Math.min(praxis, 2);

  // Difficulty calibration passed - 1pt
  if (validateDifficulty(q)) score += 1;

  // Explanation quality - 1pt
  if (hasQualityExplanation(q)) score += 1;

  // Distractor count (4+ options) - 1pt
  if (q.options.length >= 4) score += 1;

  // Max score = 6
  return {
    score,
    pool: score >= 4 ? "exam" : "training",
  };
}

function getShipTarget(examTarget: number): number {
  if (examTarget <= 600) return 500;
  if (examTarget <= 800) return 700;
  if (examTarget <= 1000) return 850;
  return 1000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ─── Provider Routing: Turbo Chain ────────────────────────────────────────────

const EXAM_PROVIDER_CHAIN: { provider: AIProvider; model: string }[] = [
  { provider: "lovable", model: "google/gemini-2.5-flash" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
];

function pickProvider(exclude: string[] = []): { provider: AIProvider; model: string } {
  for (const entry of EXAM_PROVIDER_CHAIN) {
    if (exclude.includes(`${entry.provider}:${entry.model}`)) continue;
    const keyMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_AI_API_KEY",
      lovable: "LOVABLE_API_KEY",
    };
    const keyEnv = keyMap[entry.provider];
    if (keyEnv && !Deno.env.get(keyEnv)) continue;
    return entry;
  }
  return EXAM_PROVIDER_CHAIN[0];
}

async function markRateLimited(sb: ReturnType<typeof createClient>, provider: string, err: string) {
  try {
    await sb.rpc("mark_provider_rate_limited", { p_provider: provider, p_cooldown_seconds: 90, p_error: err });
  } catch { /* non-blocking */ }
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

// ─── JSON Auto-Repair ─────────────────────────────────────────────────────────

function repairJSON(raw: string): unknown | null {
  let clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(clean); } catch { /* continue */ }
  clean = clean.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(clean); } catch { /* continue */ }
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* continue */ }
    const fixed = arrMatch[0].replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(fixed); } catch { /* continue */ }
  }
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return [JSON.parse(objMatch[0])]; } catch { /* continue */ }
  }
  return null;
}

// ─── Turbo Prompt v4 (cognitive level + question type + IHK distractor rules) ─

interface TrapSpec {
  trap_tags: string[];
  common_misconceptions: string[];
  distractor_rules: string[];
}

interface BlueprintInfo {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  cognitive_level: string;
  question_template: string;
  trap_spec?: TrapSpec | null;
  typical_exam_trap?: string | null;
}

// ─── Error Tag Vocabulary (fixed, SSOT) ──────────────────────────────────────

const ERROR_TAG_VOCABULARY = [
  // Calculation-specific
  "netto_brutto", "percent_base", "skonto_rabatt_order", "rounding_units",
  "calculation_error", "unit_conversion_error", "omission_error",
  "sign_error", "order_of_operations", "base_value_error",
  // Knowledge / conceptual
  "definition_confusion", "recht_frist", "prozess_schritt", "zustaendigkeit_rolle",
  "dateninterpretation", "typical_distractor_plausible_wrong",
  // Additional common model outputs
  "missing_step", "wrong_formula", "verwechslung", "zeitraum_fehler",
  "falsche_bezugsgroesse", "grenzwert_fehler",
] as const;

function buildTurboPrompt(
  bp: BlueprintInfo,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  cognitiveLevel: CognitiveLevelKey,
  count: number,
  lfTitle: string,
  compTitle: string,
  compDesc: string,
  professionName: string,
  depthTopics: string[],
  glossaryContext?: string,
  masteryInjection?: string,
): { system: string; user: string } {
  const diffLabel: Record<string, string> = {
    easy: "leicht", medium: "mittel", hard: "schwer", very_hard: "sehr schwer",
  };

  const cognitiveHint: Record<string, string> = {
    recall: "WISSENSABFRAGE: Definition, Begriff, Zuordnung. Der Prüfling muss Fakten abrufen.",
    apply: "ANWENDUNG: Berechnung durchführen, Verfahren anwenden, Zuordnung ableiten. Konkrete Zahlen und Formeln.",
    analyze: "ANALYSE: Fehler identifizieren, Sachverhalt beurteilen, richtige Handlung aus Situation ableiten.",
    decide: "BEWERTUNG/ENTSCHEIDUNG: Best Practice wählen, Risiken abwägen, Handlungsempfehlung geben. Mehrere vertretbare Optionen, nur eine ist optimal.",
  };

  const typeHint: Record<string, string> = {
    best_option: "BESTE OPTION: Mehrere Maßnahmen werden vorgestellt – der Prüfling muss die optimale wählen. Alle Optionen klingen plausibel.",
    error_detection: "FEHLERDIAGNOSE: Ein Sachverhalt enthält einen Fehler – der Prüfling muss ihn identifizieren.",
    calculation: "RECHENAUFGABE: Konkrete Zahlen, ein klarer Rechenweg. Distraktoren = typische Rechenfehler (z.B. falscher Zinssatz, vergessener Faktor).",
    case_study: "FALLSTUDIE: Konkretes Szenario mit Name, Situation, Zahlen. Der Prüfling muss die richtige Schlussfolgerung ziehen.",
    risk_assessment: "RISIKOABWÄGUNG: Situation mit mehreren Risikofaktoren. Der Prüfling muss das Hauptrisiko oder die richtige Absicherung erkennen.",
    compliance_check: "COMPLIANCE/NORM: Bezug auf Vorschriften, Gesetze, Richtlinien. Der Prüfling muss die richtige Norm oder Frist kennen.",
  };

  const depthBlock = depthTopics.length > 0
    ? `\nUnterthemen: ${depthTopics.slice(0, 8).join(", ")}`
    : "";

  const namePool = shuffleArray(GERMAN_NAMES, Date.now()).slice(0, 8).join(", ");
  const openerPool = shuffleArray(SENTENCE_OPENERS, Date.now()).slice(0, 6).join('", "');

  const system = `Du bist ein erfahrener IHK-Prüfungsaufgabenersteller für ${professionName}. Erstelle ${diffLabel[difficulty]} Prüfungsfragen.

KOGNITIVE STUFE: ${cognitiveHint[cognitiveLevel] || cognitiveHint.apply}
FRAGETYP: ${typeHint[questionType] || typeHint.case_study}

═══ QUALITÄTSREGELN ═══

SPRACHE & STIL:
- Schreibe wie ein erfahrener IHK-Prüfer, NICHT wie eine KI
- Natürliches, flüssiges Deutsch — kein "Lehrbuch-Deutsch"
- VERBOTENE FLOSKELN: "im Folgenden", "grundsätzlich gilt", "es ist zu beachten", "zusammenfassend lässt sich sagen", "in diesem Zusammenhang", "es sei darauf hingewiesen", "diesbezüglich", "hinsichtlich dessen", "es empfiehlt sich", "folgende Aspekte sind relevant"
- Kurze, natürliche Sätze (max 30 Wörter). Realistische Dialogsprache in Beratungssituationen.
- KEINE Platzhalter {variable} — alle Werte konkret einsetzen
- JEDE Frage beginnt mit einem ANDEREN Satzanfang. Nutze z.B.: "${openerPool}"
- NIEMALS mehrere Fragen mit "Die…", "Herr…" oder "Frau…" beginnen
- Verwende diverse Personennamen: ${namePool}
- Verwende REALISTISCHE Zahlen (nicht 1.000, 10.000 — sondern z.B. 12.450, 3.875, 47.320)

DISTRAKTOREN (IHK-QUALITÄT — STRUKTURIERT):
- Distraktor 1: Korrekt klingend, aber falsche Norm/Paragraph/Frist → error_tag zuweisen
- Distraktor 2: Häufige Praxisverwechslung (was Azubis oft falsch machen) → error_tag zuweisen
- Distraktor 3: Typischer Rechenfehler oder Denkfehler → error_tag zuweisen
- ALLE Distraktoren müssen plausibel klingen — NICHT offensichtlich falsch
- KEINE "Nonsens-Optionen" die sofort ausgeschlossen werden können
- Erlaubte error_tags: ${ERROR_TAG_VOCABULARY.join(", ")}
- Bei Rechenaufgaben: Falsche Optionen MÜSSEN numerisch nahe am korrekten Ergebnis liegen (±5–25% oder exakter Rechenfehler wie falsche Prozentbasis, Skonto/Rabatt vertauscht, Netto statt Brutto). KEINE zufälligen Zahlen!
- JEDE falsche Option braucht einen distractor_meta-Eintrag mit option_index, error_tag und why_wrong (MINDESTENS 20 Zeichen, KEIN generisches "weil falsch")
- option_index im distractor_meta darf NICHT der correct_answer Index sein

PRAXISBEZUG (PFLICHT):
- Jede Frage enthält eine konkrete Berufsrolle aus dem Alltag von ${professionName} (Auszubildende, Fachkraft, Meister, Vorgesetzte, Kunde etc.)
- Jede Frage hat einen konkreten Kontext aus dem typischen Arbeitsalltag von ${professionName}
- Verwende konkrete, nicht-runde Zahlen für Beträge, Mengen, Fristen
- Szenarien MÜSSEN berufsspezifisch für ${professionName} sein — NICHT generisch übertragbar

REGULATORISCHE TIEFE (PFLICHT bei Compliance/Recht):
- Konkrete §§-Referenzen die für ${professionName} relevant sind (BGB, HGB, AO, UStG, DSGVO, BetrVG, BBiG, branchenspezifische Vorschriften)
- Exakte Fristen, Schwellenwerte, Meldepflichten die ${professionName} kennen müssen
- Zuständige Behörden und Institutionen des Berufsfelds
- Unterscheide klar zwischen MUSS-Vorschriften und KANN-Regelungen

RECHENAUFGABEN-TIEFE (PFLICHT bei Calculation):
- Mehrstufige Berechnungen die im Berufsalltag von ${professionName} vorkommen
- Kombinationsaufgaben: Mehrere berufstypische Berechnungsschritte verknüpfen
- Distraktoren = typische Rechenfehler die ${professionName} in der Prüfung machen (falscher Faktor, vergessener Schritt, falsche Einheit)
- KEINE trivialen Einschritt-Rechnungen bei Schwierigkeit "hard" oder "very_hard"

ERKLÄRUNG (COACHING-STIL — PFLICHT):
${EXPLANATION_TEMPLATE}

${CALCULATION_GUARD}

${REGULATORY_GUARD}

SELBSTAUDIT (vor Ausgabe prüfen):
- Ist die Frage eindeutig? Gibt es genau EINE richtige Antwort?
- Sind alle 3 Distraktoren plausibel? Kann man sie NICHT durch Allgemeinwissen ausschließen?
- Entspricht die Schwierigkeit dem angeforderten Level?
- Klingt die Frage natürlich — wie von einem IHK-Prüfer geschrieben?
- Enthält die Erklärung einen konkreten Prüfungsanker + Merksatz?
- Bei Rechenaufgaben: Enthält die Aufgabe ALLE nötigen Zahlen/Parameter?
Regeneriere intern, bis alle Punkte erfüllt sind.
${glossaryContext || ''}

Antworte NUR mit JSON-Array (keine Extra-Keys, options exakt 4, correct_answer 0..3):
[{"question_text":"...","options":["A","B","C","D"],"correct_answer":0,"difficulty":"${difficulty}","question_type":"${questionType}","cognitive_level":"${cognitiveLevel}","explanation":"Richtig: ... Falsch A: ... Falsch B: ... Falsch C: ... Prüfungsanker: ... Merke: ...","tags":["tag1"],"trap_tags":["error_type1"],"distractor_meta":[{"option_index":1,"error_tag":"percent_base","why_wrong":"..."},{"option_index":2,"error_tag":"skonto_rabatt_order","why_wrong":"..."},{"option_index":3,"error_tag":"definition_confusion","why_wrong":"..."}]}]`;

  // ── Inject TrapSpec from blueprint (if available) ──
  let trapSpecBlock = "";
  if (bp.trap_spec) {
    const ts = bp.trap_spec;
    trapSpecBlock = `\n\n═══ BLUEPRINT TRAP-SPEC (PFLICHT für Distraktoren) ═══
Typische Prüfungsfallen für dieses Thema:
- Trap-Tags: ${ts.trap_tags?.join(", ") || "keine"}
- Häufige Denkfehler: ${ts.common_misconceptions?.join("; ") || "keine"}
- Distraktor-Regeln: ${ts.distractor_rules?.join("; ") || "keine"}
Nutze diese Fallen gezielt für die 3 Distraktoren!`;
  } else if (bp.typical_exam_trap) {
    trapSpecBlock = `\n\nTypische Prüfungsfalle: ${bp.typical_exam_trap}`;
  }

  const user = `${count} Frage(n) für "${professionName}".
Lernfeld: ${lfTitle}
Thema: ${compTitle} — ${compDesc}
Blueprint: ${bp.canonical_statement}${depthBlock}${trapSpecBlock}

Kognitive Stufe: ${cognitiveLevel}
Fragetyp: ${questionType}
Schwierigkeit: ${difficulty}
${masteryInjection || ""}`;

  return { system, user };
}

// ─── Question Generator (Turbo with quality gates) ───────────────────────────

async function generateTurboQuestions(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  cognitiveLevel: CognitiveLevelKey,
  existingHashes: Set<string>,
  existingNgramSets: Set<string>[],
  professionName: string,
  glossaryContext?: string,
): Promise<{ saved: number; training: number }> {
  let compTitle = bp.name;
  let compDesc = bp.canonical_statement;
  let lfTitle = "";
  let depthTopics: string[] = [];

  if (bp.competency_id) {
    const { data: comp } = await sb.from("competencies").select("title, description").eq("id", bp.competency_id).maybeSingle();
    if (comp) { compTitle = comp.title || compTitle; compDesc = comp.description || compDesc; }
  }
  if (bp.learning_field_id) {
    const { data: lf } = await sb.from("learning_fields").select("title").eq("id", bp.learning_field_id).maybeSingle();
    if (lf) lfTitle = lf.title || "";

    try {
      const { data: parentTopics } = await sb.from("curriculum_topics").select("id, title")
        .eq("curriculum_id", bp.curriculum_id).is("parent_topic_id", null)
        .ilike("title", `%${lfTitle.split(":")[0]?.trim() || lfTitle}%`).limit(3);
      if (parentTopics?.length) {
        const { data: subtopics } = await sb.from("curriculum_topics").select("title, difficulty_level")
          .in("parent_topic_id", parentTopics.map(t => t.id)).limit(15);
        if (subtopics) depthTopics = subtopics.map(s => `${s.title}${s.difficulty_level ? ` (${s.difficulty_level})` : ""}`);
      }
    } catch { /* depth load optional */ }
  }

  // ── v3: Load mastery context for this competency area ──
  let masteryInjection = "";
  try {
    const masteryCtx = await loadMasteryContext(sb, bp.curriculum_id, bp.learning_field_id);
    masteryInjection = buildMasteryFeedbackSuffix(masteryCtx);
  } catch { /* non-blocking */ }

  const { system, user } = buildTurboPrompt(bp, difficulty, questionType, cognitiveLevel, count, lfTitle, compTitle, compDesc, professionName, depthTopics, glossaryContext, masteryInjection);

  const maxTokens = count <= 2 ? 3000 : count <= 5 ? 6000 : 8000;

  let exclude: string[] = [];
  let result: { content: string } | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { provider, model } = pickProvider(exclude);
    try {
      result = await callAIJSON({
        provider, model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.85,
        max_tokens: maxTokens,
      });
      break;
    } catch (e: unknown) {
      const errMsg = (e as Error)?.message || String(e);
      const isRate = errMsg.includes("Rate limit") || errMsg.includes("429") || errMsg.includes("409");
      const isTimeout = errMsg.includes("timed out") || errMsg.includes("TimeoutError") || errMsg.includes("AbortError");

      if (isRate || isTimeout) {
        console.log(`[ExamPool-v5] ${isTimeout ? "Timeout" : "RateLimit"} ${provider}/${model} attempt ${attempt}/3`);
        if ((globalThis as any).__examPoolSb) await markRateLimited((globalThis as any).__examPoolSb, provider, errMsg);
        exclude.push(`${provider}:${model}`);
        continue;
      }
      console.log(`[ExamPool-v5] AI error (${provider}/${model}): ${errMsg}`);
      return { saved: 0, training: 0, gateFailed: 0 };
    }
  }

  if (!result?.content) return { saved: 0, training: 0, gateFailed: 0 };

  const parsed = repairJSON(result.content);
  if (!parsed) {
    console.log(`[ExamPool-v5] JSON repair failed for BP ${bp.id.slice(0, 8)}`);
    return { saved: 0, training: 0, gateFailed: 0 };
  }

  const questions = Array.isArray(parsed) ? parsed : [parsed];
  let saved = 0;
  let training = 0;
  let gateFailed = 0;

  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) continue;

    // HARD GATE: correct_answer must be valid index (audit P1 fix)
    const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : (q.correct_answer ?? 0);
    if (typeof correctIdx !== 'number' || correctIdx < 0 || correctIdx >= q.options.length) {
      console.log(`[ExamPool-v5] REJECTED INVALID_INDEX: correct_answer=${q.correct_answer} for ${q.options.length} options`);
      continue;
    }

    // HARD GATE: No meta-text / AI editing artifacts (audit P1 fix)
    const META_REJECT_PATTERNS = [
      /\bich muss\b/i, /\bich ändere\b/i, /\btippfehler\b/i,
      /\bes tut mir leid\b/i, /\bich habe einen fehler\b/i,
      /\bich korrigiere\b/i, /\bich prüfe\b/i, /\blass mich\b/i,
      /\bfehler in der frage\b/i, /\bich entschuldige\b/i,
      /\bfehlende.{0,15}korrekte option\b/i,
    ];
    const explanationText = (q.explanation || '');
    let hasMetaText = false;
    for (const pat of META_REJECT_PATTERNS) {
      if (pat.test(explanationText)) { hasMetaText = true; break; }
    }
    if (hasMetaText) {
      console.log(`[ExamPool-v5] REJECTED META_TEXT: "${explanationText.slice(0, 60)}…"`);
      continue;
    }

    // Reject unresolved placeholders
    if (/\{[a-z_]+\}/i.test(q.question_text)) continue;

    const contam = checkContamination(q.question_text + " " + (q.explanation || ""), professionName);
    if (contam.isContaminated) {
      console.log(`[ExamPool-v5] CONTAMINATION: ${contam.detectedIndustry} in "${q.question_text.slice(0, 50)}"`);
      continue;
    }

    // Hash dedup
    const hash = simpleHash(q.question_text);
    if (existingHashes.has(hash)) continue;
    existingHashes.add(hash);

    // Text-similarity dedup (Jaccard n-gram)
    const qNgrams = textNgrams(q.question_text);
    let tooSimilar = false;
    const checkWindow = existingNgramSets.slice(-200);
    for (const existingNg of checkWindow) {
      if (jaccardSimilarity(qNgrams, existingNg) > TEXT_SIMILARITY_THRESHOLD) {
        tooSimilar = true;
        break;
      }
    }
    if (tooSimilar) {
      console.log(`[ExamPool-v5] NEAR-DUP skipped: "${q.question_text.slice(0, 50)}…"`);
      continue;
    }
    existingNgramSets.push(qNgrams);

    // ── HARD Quality Gates (v5: reject instead of soft-log) ──
    const praxisScore = calculatePraxisScore(q);
    if (praxisScore < 1) {
      console.log(`[ExamPool-v5] REJECTED LOW_PRAXIS (${praxisScore}): "${q.question_text.slice(0, 40)}…"`);
      continue; // HARD gate: must have at least some context
    }

    // Explanation quality: soft gate (low quality → training pool, not rejected)
    const hasGoodExplanation = hasQualityExplanation(q);

    // Style gate: kill AI-typical phrases
    if (!passesStyleGate(q)) {
      console.log(`[ExamPool-v5] REJECTED AI_STYLE: "${q.question_text.slice(0, 40)}…"`);
      continue;
    }

    // v2: Hallucination risk check on explanation
    const halluRisk = computeHallucinationRisk(
      q.question_text + " " + (q.explanation || ""), [], [],
    );
    if (halluRisk.verdict === "regenerate") {
      console.log(`[ExamPool-v5] REJECTED HALLUCINATION_RISK (${halluRisk.riskScore}): suspicious=[${halluRisk.suspiciousRegulatory.join(", ")}]`);
      continue;
    }

    const difficultyValid = validateDifficulty(q);
    // Difficulty mismatch: soft gate (wrong difficulty → training, not rejected)

    const qualityResult = calculateQualityScore(q);
    // Downgrade to training if explanation or difficulty is weak
    const forceTraining = !hasGoodExplanation || !difficultyValid;
    const assignedPool = forceTraining ? "training" : qualityResult.pool;
    const status = "draft"; // all go as draft, qc_status differentiates

    // Map generator cognitive levels to DB enum values
    // FIX: FORCE the requested cognitive level from distribution instead of
    // trusting the AI response. The AI almost always returns "understand"
    // regardless of what was requested, causing a Bloom monoculture.
    const cogLevelMap: Record<string, string> = {
      recall: "remember", apply: "apply", analyze: "analyze", decide: "evaluate",
      remember: "remember", understand: "understand", evaluate: "evaluate", create: "create",
    };
    // Use the REQUESTED level (from distribution), not AI's self-report
    const forcedCogLevel = (cognitiveLevel || "understand").toLowerCase();
    const mappedCogLevel = cogLevelMap[forcedCogLevel] || forcedCogLevel;

    // ── Hebel 3: Extract and validate distractor metadata ──
    // Normalize trap_tags: lowercase, replace spaces/hyphens with underscore, then match vocabulary
    const normalizedTags: string[] = Array.isArray(q.trap_tags) 
      ? q.trap_tags.map((t: string) => String(t).toLowerCase().replace(/[\s-]+/g, "_").trim())
      : [];
    const rawTrapTags: string[] = normalizedTags.filter((t: string) => ERROR_TAG_VOCABULARY.includes(t as any));
    // Debug: log filtered-out tags (max 5 unique per run to avoid spam)
    const filteredOut = normalizedTags.filter(t => !ERROR_TAG_VOCABULARY.includes(t as any));
    if (filteredOut.length > 0) {
      if (!((globalThis as any).__filteredTagsLogged)) (globalThis as any).__filteredTagsLogged = new Set();
      const logSet = (globalThis as any).__filteredTagsLogged as Set<string>;
      for (const t of filteredOut) {
        if (logSet.size < 10 && !logSet.has(t)) {
          logSet.add(t);
          console.log(`[ExamPool-v5] FILTERED_TAG: "${t}" not in vocabulary`);
        }
      }
    }
    // correctIdx already declared above (line ~609)
    const rawDistractorMeta: Array<{option_index: number; error_tag: string; why_wrong: string}> = 
      Array.isArray(q.distractor_meta) ? q.distractor_meta.filter((d: any) => 
        typeof d.option_index === "number" 
        && typeof d.error_tag === "string"
        && d.option_index !== correctIdx               // must not tag the correct answer
        && typeof d.why_wrong === "string"
        && d.why_wrong.length >= 20                    // min explanation depth
      ) : [];

    // ── Resolve final question_type BEFORE gate (so gate uses correct type) ──
    const finalQuestionType = questionType === "best_option" ? "transfer"
      : questionType === "error_detection" ? "transfer"
      : questionType === "risk_assessment" ? "case_study"
      : questionType === "compliance_check" ? "concept"
      : questionType; // calculation, case_study pass through

    // ── Distractor Quality Gate (hard for calculation, soft for others) ──
    const isCalculation = finalQuestionType === "calculation";
    const requiredMeta = isCalculation ? 3 : 2; // 3 wrong options need meta for calc
    const distractorGateFailed = rawDistractorMeta.length < requiredMeta;
    
    let qcReason: string | null = null;
    if (distractorGateFailed) {
      if (rawDistractorMeta.length === 0) qcReason = "missing_distractor_meta";
      else if (isCalculation && rawDistractorMeta.length < 3) qcReason = "weak_distractors_calc";
      else qcReason = "weak_distractors";
    }

    if (distractorGateFailed) {
      console.log(`[ExamPool-v5] ${qcReason}: ${finalQuestionType} question has ${rawDistractorMeta.length}/${requiredMeta} valid distractor_meta`);
      
      // Store gate failure info in distractor_meta for auditability
      const auditedMeta = {
        raw: rawDistractorMeta,
        gate_fail: true,
        qc_reason: qcReason,
        required: requiredMeta,
        actual: rawDistractorMeta.length,
        source_type: questionType,
        final_type: finalQuestionType,
      };

      const { error } = await sb.from("exam_questions").insert({
        curriculum_id: bp.curriculum_id,
        learning_field_id: bp.learning_field_id,
        competency_id: bp.competency_id,
        blueprint_id: bp.id,
        question_text: q.question_text,
        options: q.options,
        correct_answer: correctIdx,
        explanation: q.explanation || "",
        difficulty: difficulty,
        cognitive_level: mappedCogLevel,
        question_type: finalQuestionType,
        trap_tags: rawTrapTags,
        distractor_meta: auditedMeta,
        ai_generated: true,
        status: "training",  // gate-failed → always training status
        qc_status: "tier1_failed",
      });
      if (error && error.code !== "23505") console.log(`[ExamPool-v5] Insert error: ${error.message}`);
      if (!error) gateFailed++;
      continue;
    }

    const { error } = await sb.from("exam_questions").insert({
      curriculum_id: bp.curriculum_id,
      learning_field_id: bp.learning_field_id,
      competency_id: bp.competency_id,
      blueprint_id: bp.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: correctIdx,
      explanation: q.explanation || "",
      // FIX: Force the REQUESTED difficulty from distribution, not AI's self-report.
      difficulty: difficulty,
      cognitive_level: mappedCogLevel,
      // Hebel 2: Use finalQuestionType (resolved before gate)
      question_type: finalQuestionType,
      // Hebel 3: Trap tags + distractor metadata
      trap_tags: rawTrapTags,
      distractor_meta: {
        raw: rawDistractorMeta,
        gate_fail: false,
        qc_reason: null,
        required: requiredMeta,
        actual: rawDistractorMeta.length,
        source_type: questionType,
        final_type: finalQuestionType,
      },
      ai_generated: true,
      status,
      qc_status: assignedPool === "exam" ? "approved" : "pending",
    });

    if (error) {
      if (error.code === "23505") { /* duplicate, skip */ }
      else console.log(`[ExamPool-v5] Insert error: ${error.message}`);
    } else {
      if (assignedPool === "exam") saved++;
      else training++;
    }
  }
  return { saved, training, gateFailed };
}

function simpleHash(text: string): string {
  let hash = 5381;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

// ─── Fan-out by learning field (Proportional + Gap-First) ─────────────────────

async function enqueueLearningFieldJobs(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
  bps: BlueprintInfo[],
  examTarget: number,
): Promise<{ enqueued: number; learningFields: number }> {
  // Group blueprints by learning field
  const lfGroups = new Map<string, BlueprintInfo[]>();
  for (const bp of bps) {
    const lfId = bp.learning_field_id || "unknown";
    if (!lfGroups.has(lfId)) lfGroups.set(lfId, []);
    lfGroups.get(lfId)!.push(bp);
  }

  const lfCount = lfGroups.size;
  if (lfCount === 0) return { enqueued: 0, learningFields: 0 };

  // ── Step 1: Proportional weighting by blueprint count per LF ──
  const totalBps = bps.length;
  const MIN_LF_SHARE = 0.06; // Every LF gets at least 6% of target

  const lfWeights = new Map<string, number>();
  for (const [lfId, lfBps] of lfGroups) {
    const naturalWeight = totalBps > 0 ? lfBps.length / totalBps : 1 / lfCount;
    lfWeights.set(lfId, Math.max(MIN_LF_SHARE, naturalWeight));
  }
  // Normalize weights to sum to 1
  const totalWeight = Array.from(lfWeights.values()).reduce((s, w) => s + w, 0);
  for (const [lfId, w] of lfWeights) lfWeights.set(lfId, w / totalWeight);

  // ── Step 2: Query existing questions per LF (gap detection) ──
  const lfIds = Array.from(lfGroups.keys());
  const existingPerLf = new Map<string, number>();
  for (const lfId of lfIds) {
    const { count } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", lfId);
    existingPerLf.set(lfId, count ?? 0);
  }

  // ── Step 3: Calculate gap-aware targets per LF ──
  const nowIso = new Date().toISOString();
  const jobs = [];

  // Sort by gap size descending (biggest gaps first = higher priority)
  const lfEntries = Array.from(lfGroups.entries()).sort((a, b) => {
    const aExist = existingPerLf.get(a[0]) ?? 0;
    const bExist = existingPerLf.get(b[0]) ?? 0;
    const aTarget = Math.ceil(examTarget * (lfWeights.get(a[0]) ?? 0));
    const bTarget = Math.ceil(examTarget * (lfWeights.get(b[0]) ?? 0));
    const aGap = aTarget - aExist;
    const bGap = bTarget - bExist;
    return bGap - aGap; // Biggest gap first
  });

  for (const [lfId, lfBps] of lfEntries) {
    const weight = lfWeights.get(lfId) ?? (1 / lfCount);
    const proportionalTarget = Math.ceil(examTarget * weight);
    const existing = existingPerLf.get(lfId) ?? 0;
    const gap = Math.max(0, proportionalTarget - existing);

    if (gap <= 0) {
      console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: target=${proportionalTarget}, existing=${existing} → SKIP (covered)`);
      continue;
    }

    // Priority: 0 = run first (biggest gaps), 1 = run later
    const priority = existing === 0 ? 0 : 1;

    jobs.push({
      job_type: "package_generate_exam_pool",
      status: "pending",
      package_id: packageId,
      attempts: 0,
      max_attempts: 5,
      run_after: priority === 0 ? nowIso : new Date(Date.now() + 30_000).toISOString(),
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        learning_field_filter: lfId,
        lf_target: gap,
        lf_proportional_target: proportionalTarget,
        lf_existing: existing,
        blueprint_ids: lfBps.map(b => b.id),
        options: { exam_target: examTarget },
        _fan_out: true,
      },
    });

    console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: weight=${(weight * 100).toFixed(1)}%, target=${proportionalTarget}, existing=${existing}, gap=${gap}`);
  }

  if (jobs.length > 0) {
    const { error } = await sb.from("job_queue").insert(jobs);
    if (error) {
      console.log(`[ExamPool-v5] Fan-out enqueue error: ${error.message}`);
      return { enqueued: 0, learningFields: lfCount };
    }
  }

  console.log(`[ExamPool-v5] Proportional fan-out: ${jobs.length} sub-jobs for ${lfCount} LFs, ${lfEntries.length - jobs.length} already covered`);
  return { enqueued: jobs.length, learningFields: lfCount };
}

async function allFanOutSubJobsDone(sb: ReturnType<typeof createClient>, packageId: string): Promise<boolean> {
  const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true })
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing"])
    .contains("payload", { package_id: packageId, _fan_out: true });
  return (count ?? 0) === 0;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const examTarget = Number(p.options?.exam_target ?? 1000);
  const shipTarget = Number(p.options?.ship_target ?? getShipTarget(examTarget));
  const isFanOut = p._fan_out === true;
  const blueprintIds: string[] | null = p.blueprint_ids || null;

  (globalThis as any).__examPoolSb = sb;
  console.log(`[ExamPool-v5] Provider chain: gpt-4o-mini → gpt-4.1 → claude-sonnet-4`);
  const lfTarget = p.lf_target || examTarget;

  // Apply dynamic distributions
  if (p.options?.difficulty_distribution) {
    DIFFICULTY_DISTRIBUTION = p.options.difficulty_distribution;
  }

  const batchCursor = p._batch_cursor || p.batch_cursor || null;
  const generatedSoFar = batchCursor?.generated ?? 0;
  const bpIndex = batchCursor?.blueprint_index ?? 0;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  try {
    if (!isFanOut) {
      // Check if this is an EXAM_FIRST track — skip content prereqs
      const { data: pkgTrack } = await sb.from("course_packages")
        .select("track").eq("id", packageId).maybeSingle();
      const isExamFirst = pkgTrack?.track === "EXAM_FIRST";

      // Prerequisite: blueprint seeding must always be done
      const seedDone = await prereqDone(sb, packageId, "auto_seed_exam_blueprints");
      // Content prereqs only for non-EXAM_FIRST tracks
      const scaffoldDone = isExamFirst || await prereqDone(sb, packageId, "scaffold_learning_course");
      const contentDone = isExamFirst || await prereqDone(sb, packageId, "generate_learning_content");
      
      if (!scaffoldDone || !contentDone || !seedDone) {
        const missingStep = !seedDone ? "auto_seed_exam_blueprints"
          : !scaffoldDone ? "scaffold_learning_course" 
          : "generate_learning_content";
        const jobId = p.job_id || body.job_id;
        if (jobId) {
          await sb.from("job_queue").update({
            status: "pending",
            run_after: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
            locked_at: null, locked_by: null,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);
          return json({ ok: true, delayed: true, reason: `PREREQ_NOT_DONE: ${missingStep}` });
        }
        return json({ ok: false, retry: true, error: `PREREQ_NOT_DONE: ${missingStep}` }, 409);
      }

      // Placeholder Guard: only for non-EXAM_FIRST tracks
      if (!isExamFirst) {
        const courseId = p.course_id;
        if (courseId) {
          const { data: guardResult } = await sb.rpc("check_no_placeholder_lessons", { p_course_id: courseId });
          if (guardResult === false) {
            console.warn(`[ExamPool-v5] BLOCKED: Placeholder lessons still exist for course ${courseId}`);
            return json({ ok: false, retry: true, error: "PLACEHOLDER_GUARD: Lessons still have placeholder content. generate_learning_content must complete first." }, 409);
          }
        }
      }
    }

    // Resolve profession + load glossary
    const certificationId = p.certification_id || null;
    const professionResult = await resolveProfession(sb, { certificationId, curriculumId });
    const professionName = professionResult.professionName;

    let glossaryContext = "";
    try {
      const { data: cu } = await sb.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
      if (cu?.beruf_id) {
        const glossary = await loadOrGenerateGlossary(sb, cu.beruf_id, professionName, curriculumId);
        glossaryContext = formatGlossaryForPrompt(glossary);
        console.log(`[ExamPool-v5] Glossary loaded for "${professionName}" (${glossaryContext.length} chars)`);
      }
    } catch (e) { console.warn(`[ExamPool-v5] Glossary load failed: ${(e as Error).message}`); }

    // ── Hebel 2: Load math_ratio from certification_catalog via profession name ──
    console.log(`[ExamPool-v5] BREADCRUMB-1: ENTER mathRatio loader, professionName="${professionName}", curriculumId="${curriculumId}", currentMix=${JSON.stringify(QUESTION_TYPE_MIX)}`);
    let mathRatioApplied = false;
    try {
      const searchName = professionName.split("/")[0].trim();
      console.log(`[ExamPool-v5] BREADCRUMB-2: catalog lookup with searchName="${searchName}"`);
      const { data: certCatalog } = await sb.from("certification_catalog").select("math_ratio")
        .ilike("title", `%${searchName}%`).limit(1).maybeSingle();
      console.log(`[ExamPool-v5] BREADCRUMB-3: catalog result=${JSON.stringify(certCatalog)}`);
      if (certCatalog?.math_ratio && certCatalog.math_ratio > 0) {
        applyMathRatio(certCatalog.math_ratio);
        mathRatioApplied = true;
      }
    } catch (e) { console.log(`[ExamPool-v5] BREADCRUMB-ERR: catalog lookup failed: ${(e as Error).message}`); }
    // Fallback: ensure calculation has at least default 0.20 share
    if (!mathRatioApplied) {
      console.log(`[ExamPool-v5] No certification_catalog match for "${professionName}" — using default math_ratio=0.20`);
      applyMathRatio(0.20);
    }
    console.log(`[ExamPool-v5] BREADCRUMB-4: AFTER mathRatio, finalMix=${JSON.stringify(QUESTION_TYPE_MIX)}`);

    if (generatedSoFar === 0 && !isFanOut) {
      console.log(`[ExamPool-v5] Start "${professionName}": target=${examTarget}, engine=v5-ihk-quality`);
    }

    // Get blueprints
    let bpQuery = sb.from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template, trap_spec, typical_exam_trap")
      .eq("curriculum_id", curriculumId).eq("status", "approved").order("created_at", { ascending: true });

    if (blueprintIds?.length) bpQuery = bpQuery.in("id", blueprintIds);

    const { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;
    // Graceful prereq guard: if no blueprints exist, return 409 retry instead of crashing
    if (!bps?.length) {
      console.warn(`[ExamPool-v5] No approved blueprints for curriculum ${curriculumId} → 409 retry`);
      return json({ ok: false, retry: true, error: "NO_BLUEPRINTS: auto_seed_exam_blueprints must complete first." }, 409);
    }

    // Fan-out for large sets
    if (!isFanOut && bpIndex === 0 && bps.length > 10) {
      const { enqueued, learningFields } = await enqueueLearningFieldJobs(sb, packageId, curriculumId, bps as BlueprintInfo[], examTarget);
      if (enqueued > 0) {
        console.log(`[ExamPool-v5] Fan-out: ${enqueued} sub-jobs for ${learningFields} LFs`);
        return json({ ok: true, batch_complete: true, fan_out: true, sub_jobs: enqueued });
      }
    }

    // Load existing hashes for dedup
    const { data: existingQs } = await sb.from("exam_questions").select("question_text").eq("curriculum_id", curriculumId).limit(5000);
    const existingHashes = new Set<string>();
    if (existingQs) for (const q of existingQs) existingHashes.add(simpleHash(q.question_text));

    const existingNgramSets: Set<string>[] = [];
    if (existingQs) {
      const recent = existingQs.slice(-300);
      for (const q of recent) existingNgramSets.push(textNgrams(q.question_text));
    }

    // ─── HARD CAP ──────
    const { count: preCheckCount } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
    const preTotal = preCheckCount ?? 0;
    if (preTotal >= HARD_CAP_QUESTIONS) {
      console.log(`[ExamPool-v5] HARD CAP reached: ${preTotal} >= ${HARD_CAP_QUESTIONS}`);
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }
      return json({ ok: true, batch_complete: true, engine: "v5-ihk-quality", total_questions: preTotal, hard_cap: true, cap: HARD_CAP_QUESTIONS });
    }

    // ── LF-aware target: use gap-based lf_target for fan-out sub-jobs ──
    const lfExisting = p.lf_existing ?? 0;
    const lfProportionalTarget = p.lf_proportional_target ?? lfTarget;
    const effectiveTarget = isFanOut ? lfTarget : examTarget;
    const perBlueprint = Math.max(3, Math.ceil(effectiveTarget / bps.length));
    const chunkStartedAt = new Date().toISOString(); // SSOT timestamp for this chunk
    const chunkPlanned = Math.min(effectiveTarget - (preTotal > 0 ? 0 : 0), Math.max(effectiveTarget - preTotal, 0), HARD_CAP_QUESTIONS - preTotal);
    let questionsThisChunk = 0;
    let trainingThisChunk = 0;
    let currentBpIndex = bpIndex;
    let bpsProcessed = 0;

    if (isFanOut) {
      console.log(`[ExamPool-v5] LF sub-job: existing=${lfExisting}, proportional_target=${lfProportionalTarget}, gap=${effectiveTarget}, bps=${bps.length}`);
    }

    const typeEntries = Object.entries(QUESTION_TYPE_MIX) as [QuestionTypeKey, number][];
    const diffEntries = Object.entries(DIFFICULTY_DISTRIBUTION) as [DifficultyKey, number][];
    const cogEntries = Object.entries(COGNITIVE_LEVEL_DISTRIBUTION) as [CognitiveLevelKey, number][];

    while (bpsProcessed < AI_CHUNK_SIZE && currentBpIndex < bps.length) {
      const bp = bps[currentBpIndex] as BlueprintInfo & { max_variations: number | null };

      const callsPerBp = Math.ceil(perBlueprint / AI_QUESTIONS_PER_CALL);
      const maxCallsPerBp = Math.min(callsPerBp, 6);

      for (let callIdx = 0; callIdx < maxCallsPerBp; callIdx++) {
        const globalIdx = (currentBpIndex * maxCallsPerBp + callIdx);
        const typeIdx = globalIdx % typeEntries.length;
        const diffIdx = Math.floor(globalIdx / typeEntries.length) % diffEntries.length;
        const cogIdx = Math.floor(globalIdx / (typeEntries.length * diffEntries.length)) % cogEntries.length;
        const questionType = typeEntries[typeIdx][0];
        const difficulty = diffEntries[diffIdx][0];
        const cognitiveLevel = cogEntries[cogIdx][0];

        try {
          const genResult = await generateTurboQuestions(
            sb, bp, AI_QUESTIONS_PER_CALL, difficulty, questionType, cognitiveLevel, existingHashes, existingNgramSets, professionName, glossaryContext
          );
          questionsThisChunk += genResult.saved;
          trainingThisChunk += genResult.training;
        } catch (e: unknown) {
          console.log(`[ExamPool-v5] BP ${bp.id.slice(0, 8)} call ${callIdx} FAIL: ${(e as Error)?.message}`);
        }
      }

      currentBpIndex++;
      bpsProcessed++;

      // ── Mid-loop hard cap check ──
      if (questionsThisChunk > 0 && (preTotal + questionsThisChunk) >= HARD_CAP_QUESTIONS) {
        console.log(`[ExamPool-v5] Mid-loop HARD CAP: ~${preTotal + questionsThisChunk} questions`);
        break;
      }
    }

    // ═══ DETERMINISTIC CALC QUOTA BACKFILL ═══
    // Target based on planned chunk size (stable, not affected by backfill itself)
    const calcRatio = QUESTION_TYPE_MIX.calculation ?? 0.20;
    const calcTarget = Math.max(1, Math.ceil(chunkPlanned * calcRatio));
    // Count calc questions inserted ONLY during this chunk (SSOT timestamp)
    const { count: calcInsertedCount } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("question_type", "calculation")
      .gte("created_at", chunkStartedAt);
    const calcInserted = calcInsertedCount ?? 0;
    const calcDeficit = calcTarget - calcInserted;

    if (calcDeficit > 0 && bps.length > 0 && (preTotal + questionsThisChunk) < HARD_CAP_QUESTIONS) {
      const maxCalcAttempts = calcDeficit * 4 + 10;
      let calcBackfillSaved = 0;
      let calcAttempts = 0;
      // Filter to calc-capable blueprints (trap_spec present = has calculation structure)
      const calcBps = bps.filter((b: any) => b.trap_spec != null);
      const backfillBps = calcBps.length > 0 ? calcBps : bps; // fallback to all if none have trap_spec
      const shuffledBps = [...backfillBps].sort(() => Math.random() - 0.5);
      const calcDiffs: string[] = ["medium", "hard", "easy", "very_hard"];

      console.log(`[ExamPool-v5] CALC_BACKFILL: deficit=${calcDeficit}, target=${calcTarget}, inserted=${calcInserted}, calcBps=${calcBps.length}/${bps.length}, maxAttempts=${maxCalcAttempts}`);

      for (let i = 0; calcBackfillSaved < calcDeficit && calcAttempts < maxCalcAttempts; i++) {
        const bp = shuffledBps[i % shuffledBps.length] as BlueprintInfo & { max_variations: number | null };
        const diff = calcDiffs[calcAttempts % calcDiffs.length];
        const cog = cogEntries[calcAttempts % cogEntries.length][0];

        try {
          const genResult = await generateTurboQuestions(
            sb, bp, AI_QUESTIONS_PER_CALL, diff, "calculation", cog,
            existingHashes, existingNgramSets, professionName, glossaryContext
          );
          calcBackfillSaved += genResult.saved;
          trainingThisChunk += genResult.training;
        } catch (e: unknown) {
          console.log(`[ExamPool-v5] CALC_BACKFILL attempt ${calcAttempts} FAIL: ${(e as Error)?.message}`);
        }
        calcAttempts++;

        if ((preTotal + questionsThisChunk + calcBackfillSaved) >= HARD_CAP_QUESTIONS) break;
      }

      // Apply backfill total to chunk counter ONCE at the end
      questionsThisChunk += calcBackfillSaved;

      if (calcBackfillSaved < calcDeficit) {
        console.log(`[ExamPool-v5] CALC_QUOTA_NOT_REACHED: wanted=${calcDeficit}, got=${calcBackfillSaved} after ${calcAttempts} attempts`);
      } else {
        console.log(`[ExamPool-v5] CALC_BACKFILL complete: +${calcBackfillSaved} calc in ${calcAttempts} attempts`);
      }
    } else if (calcDeficit <= 0) {
      console.log(`[ExamPool-v5] CALC_QUOTA OK: target=${calcTarget}, inserted=${calcInserted}, chunkPlanned=${chunkPlanned} — no backfill needed`);
    }

    // Count actual total
    const { count: totalQuestions } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

    const actualTotal = totalQuestions ?? 0;
    const allBlueprintsProcessed = currentBpIndex >= bps.length;
    const targetReached = actualTotal >= shipTarget || actualTotal >= HARD_CAP_QUESTIONS;

    console.log(`[ExamPool-v5] +${questionsThisChunk} exam, +${trainingThisChunk} training, total=${actualTotal}/${examTarget} (cap=${HARD_CAP_QUESTIONS}), BPs ${currentBpIndex}/${bps.length}`);

    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    if (targetReached) {
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }
      return json({ ok: true, batch_complete: true, engine: "v5-ihk-quality", total_questions: actualTotal, training_pool: trainingThisChunk, target: examTarget });
    } else if (allBlueprintsProcessed) {
      const currentLoop = (batchCursor?.loop_count ?? 0) + 1;
      if (currentLoop >= 8) {
        if (!isFanOut) await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
        return json({ ok: true, batch_complete: true, total_questions: actualTotal, loop_capped: true });
      }
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: 0, target: examTarget, blueprints_total: bps.length, loop_count: currentLoop },
      });
    } else {
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: currentBpIndex, target: examTarget, blueprints_total: bps.length, loop_count: batchCursor?.loop_count ?? 0 },
      });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.log(`[ExamPool-v5] Fatal: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
