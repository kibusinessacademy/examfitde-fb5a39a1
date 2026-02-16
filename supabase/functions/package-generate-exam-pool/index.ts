import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";
import type { HybridTargetResult } from "../_shared/hybridExamTarget.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";

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

const AI_CHUNK_SIZE = 8;
const AI_QUESTIONS_PER_CALL = 2;
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

const QUESTION_TYPE_MIX: Record<string, number> = {
  best_option: 0.20,       // Beste Option aus mehreren Maßnahmen
  error_detection: 0.15,   // Fehlerdiagnose
  calculation: 0.20,       // Rechenaufgabe mit konkreten Zahlen
  case_study: 0.20,        // Fallstudie: konkreter Praxisfall
  risk_assessment: 0.10,   // Risikoabwägung
  compliance_check: 0.15,  // Compliance/Norm-Check
};

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

const SENTENCE_OPENERS = [
  "Ein Kunde möchte", "Im Beratungsgespräch", "Welche", "Stellen Sie sich vor,",
  "Bei der Prüfung", "Während eines Kundentermins", "Im Rahmen der",
  "Ein Unternehmen plant", "Zur Beurteilung", "Angenommen,",
  "In der Filiale", "Beim Jahresabschluss", "Ein Auszubildender fragt",
  "Nach Analyse der Unterlagen", "Das Kreditinstitut prüft",
  "Vor dem Hintergrund", "Gemäß den Vorschriften", "Aus betriebswirtschaftlicher Sicht",
  "Im Zuge der Digitalisierung", "Ein langjähriger Geschäftskunde",
  "Ihre Kollegin bittet Sie", "Der Filialleiter beauftragt Sie",
  "Ein Existenzgründer benötigt", "Bei der Kreditwürdigkeitsprüfung",
  "Im Jahresabschlussgespräch stellt sich heraus,", "Eine Kundin reklamiert,",
  "Der Vorgesetzte fragt nach", "Beim Vergleich zweier Angebote",
  "Nach Durchsicht der Bilanz", "Im Compliance-Bericht fällt auf,",
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

  const hasCalculation = /\d+[\s]*[×x*÷/+\-]\s*\d+|\d+[.,]\d+\s*(%|€|eur)|\bberechn|\bzins|\brate\b|\bbetrag\b/i.test(allText);
  const hasParagraph = /§\s*\d+|\bBGB\b|\bHGB\b|\bKWG\b|\bGwG\b|\bKSchG\b|\bAGB\b|\bMaBV\b/i.test(allText);
  const hasFachbegriff = /\b(Bonität|Liquidität|Solvabilität|Eigenkapitalquote|Deckungsbeitrag|Annuität|Effektivzins|Skonto|Disagio|Bilanz|GuV|Aktiva|Passiva|Rückstellung)\b/i.test(allText);
  const hasDecision = /\bwelche Maßnahme\b|\bbeste Option\b|\bempfehlen\b|\bRisiko\b|\bbeurteilen\b|\babwägen\b|\bentscheiden\b/i.test(allText);

  switch (q.difficulty) {
    case "easy":
      // Easy should NOT have complex calculations or paragraph references
      if (hasCalculation && hasParagraph) return false;
      return true;
    case "medium":
      // Medium should have at least one knowledge element
      return hasCalculation || hasFachbegriff || hasParagraph;
    case "hard":
      // Hard should have calculation OR paragraph + decision element
      return (hasCalculation || hasParagraph) && (hasFachbegriff || hasDecision);
    case "very_hard":
      // Very hard should have multiple complexity layers
      return (hasCalculation || hasParagraph) && hasDecision;
    default:
      return true;
  }
}

// ─── Praxis-Score (Realism Gate) ──────────────────────────────────────────────

function calculatePraxisScore(q: { question_text: string; options: string[] }): number {
  const text = q.question_text;
  let score = 0;

  // Has role/person (Kundenberater, Filialleiter, Azubi, etc.)
  if (/\b(Kundenberater|Filialleiter|Auszubildende|Sachbearbeiter|Kollegin|Vorgesetzte|Geschäftsführer|Prokuristen|Berater|Mitarbeiter)\b/i.test(text)) score++;

  // Has context (Beratungsgespräch, Filiale, Kreditprüfung, etc.)
  if (/\b(Beratungsgespräch|Filiale|Kreditprüfung|Jahresabschluss|Kontoauszug|Girokonto|Depot|Finanzierung|Antrag|Sitzung|Besprechung)\b/i.test(text)) score++;

  // Has realistic non-round numbers (not 1000, 10000, 100, etc.)
  const numbers = text.match(/\d{3,}/g);
  if (numbers) {
    const hasNonRound = numbers.some(n => {
      const num = parseInt(n);
      return num % 100 !== 0 || num > 99999;
    });
    if (hasNonRound) score++;
  }

  // Has concrete name (Herr/Frau + Name)
  if (/\b(Herr|Frau)\s+[A-ZÄÖÜ][a-zäöüß]+/i.test(text)) score++;

  return score; // 0-4, gate: >= 2
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
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4.1" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
];

function pickProvider(exclude: string[] = []): { provider: AIProvider; model: string } {
  for (const entry of EXAM_PROVIDER_CHAIN) {
    if (exclude.includes(`${entry.provider}:${entry.model}`)) continue;
    const keyEnv = entry.provider === "openai" ? "OPENAI_API_KEY"
      : entry.provider === "anthropic" ? "ANTHROPIC_API_KEY" : null;
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
  const { data, error } = await sb.from("package_steps").select("status").eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
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

interface BlueprintInfo {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  cognitive_level: string;
  question_template: string;
}

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
- KEINE Platzhalter {variable} — alle Werte konkret einsetzen
- JEDE Frage beginnt mit einem ANDEREN Satzanfang. Nutze z.B.: "${openerPool}"
- NIEMALS mehrere Fragen mit "Die…", "Herr…" oder "Frau…" beginnen
- Verwende diverse Personennamen: ${namePool}
- Verwende REALISTISCHE Zahlen (nicht 1.000, 10.000 — sondern z.B. 12.450, 3.875, 47.320)

DISTRAKTOREN (IHK-QUALITÄT):
- Distraktor 1: Korrekt klingend, aber falsche Norm/Paragraph/Frist
- Distraktor 2: Häufige Praxisverwechslung (was Azubis oft falsch machen)
- Distraktor 3: Typischer Rechenfehler oder Denkfehler
- ALLE Distraktoren müssen plausibel klingen — NICHT offensichtlich falsch
- KEINE "Nonsens-Optionen" die sofort ausgeschlossen werden können

PRAXISBEZUG (PFLICHT):
- Jede Frage enthält eine konkrete Berufsrolle (Kundenberater, Filialleiter, Sachbearbeiter, etc.)
- Jede Frage hat einen konkreten Kontext (Beratungsgespräch, Kreditprüfung, Jahresabschluss, etc.)
- Verwende konkrete, nicht-runde Zahlen für Beträge, Zinssätze, Fristen

ERKLÄRUNG (PFLICHT):
- Erkläre WARUM die richtige Antwort richtig ist (mit Fachbegriff/Norm)
- Erkläre WARUM JEDER falsche Distraktor falsch ist (konkreter Fehler benennen)
- Füge einen kurzen PRÜFUNGSTIPP oder MERKSATZ hinzu

SELBSTAUDIT (vor Ausgabe prüfen):
- Ist die Frage eindeutig? Gibt es genau EINE richtige Antwort?
- Sind alle 3 Distraktoren plausibel? Kann man sie NICHT durch Allgemeinwissen ausschließen?
- Entspricht die Schwierigkeit dem angeforderten Level?
- Klingt die Frage natürlich — wie von einem IHK-Prüfer geschrieben?
- Enthält die Erklärung einen konkreten Prüfungstipp/Merksatz?
Regeneriere intern, bis alle Punkte erfüllt sind.

Antworte NUR mit JSON-Array:
[{"question_text":"...","options":["A","B","C","D"],"correct_answer":0,"difficulty":"${difficulty}","question_type":"${questionType}","cognitive_level":"${cognitiveLevel}","explanation":"Richtig: ... Falsch A: ... Falsch B: ... Falsch C: ... Tipp: ...","tags":["tag1"]}]`;

  const user = `${count} Frage(n) für "${professionName}".
Lernfeld: ${lfTitle}
Thema: ${compTitle} — ${compDesc}
Blueprint: ${bp.canonical_statement}${depthBlock}

Kognitive Stufe: ${cognitiveLevel}
Fragetyp: ${questionType}
Schwierigkeit: ${difficulty}`;

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

  const { system, user } = buildTurboPrompt(bp, difficulty, questionType, cognitiveLevel, count, lfTitle, compTitle, compDesc, professionName, depthTopics);

  const maxTokens = count <= 1 ? 2000 : count <= 2 ? 3000 : 4500; // v5: more tokens for quality explanation + self-audit

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
      return { saved: 0, training: 0 };
    }
  }

  if (!result?.content) return { saved: 0, training: 0 };

  const parsed = repairJSON(result.content);
  if (!parsed) {
    console.log(`[ExamPool-v5] JSON repair failed for BP ${bp.id.slice(0, 8)}`);
    return { saved: 0, training: 0 };
  }

  const questions = Array.isArray(parsed) ? parsed : [parsed];
  let saved = 0;
  let training = 0;

  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) continue;

    // Reject unresolved placeholders
    if (/\{[a-z_]+\}/i.test(q.question_text)) continue;

    // Contamination guard
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
    if (praxisScore < 2) {
      console.log(`[ExamPool-v5] REJECTED LOW_PRAXIS (${praxisScore}): "${q.question_text.slice(0, 40)}…"`);
      continue; // HARD gate: regenerate
    }

    if (!hasQualityExplanation(q)) {
      console.log(`[ExamPool-v5] REJECTED WEAK_EXPLANATION: "${q.question_text.slice(0, 40)}…"`);
      continue; // HARD gate: must have quality explanation with tip
    }

    const difficultyValid = validateDifficulty(q);
    if (!difficultyValid) {
      console.log(`[ExamPool-v5] REJECTED DIFFICULTY_MISMATCH: ${q.difficulty} — "${q.question_text.slice(0, 40)}…"`);
      continue; // HARD gate: difficulty must match content complexity
    }

    const qualityResult = calculateQualityScore(q);
    const assignedPool = qualityResult.pool;
    const status = assignedPool === "exam" ? "draft" : "training";

    const { error } = await sb.from("exam_questions").insert({
      curriculum_id: bp.curriculum_id,
      learning_field_id: bp.learning_field_id,
      competency_id: bp.competency_id,
      blueprint_id: bp.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: Array.isArray(q.correct_answer) ? q.correct_answer[0] : (q.correct_answer ?? 0),
      explanation: q.explanation || "",
      difficulty: q.difficulty || difficulty,
      ai_generated: true,
      status,
    });

    if (error) {
      if (error.code === "23505") { /* duplicate, skip */ }
      else console.log(`[ExamPool-v5] Insert error: ${error.message}`);
    } else {
      if (status === "draft") saved++;
      else training++;
    }
  }
  return { saved, training };
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

// ─── Fan-out by learning field ────────────────────────────────────────────────

async function enqueueLearningFieldJobs(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
  bps: BlueprintInfo[],
  examTarget: number,
): Promise<{ enqueued: number; learningFields: number }> {
  const lfGroups = new Map<string, BlueprintInfo[]>();
  for (const bp of bps) {
    const lfId = bp.learning_field_id || "unknown";
    if (!lfGroups.has(lfId)) lfGroups.set(lfId, []);
    lfGroups.get(lfId)!.push(bp);
  }

  const perLf = Math.ceil(examTarget / lfGroups.size);
  const nowIso = new Date().toISOString();
  const jobs = [];

  for (const [lfId, lfBps] of lfGroups) {
    jobs.push({
      job_type: "package_generate_exam_pool",
      status: "pending",
      attempts: 0,
      max_attempts: 100,
      run_after: nowIso,
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        learning_field_filter: lfId,
        lf_target: perLf,
        blueprint_ids: lfBps.map(b => b.id),
        options: { exam_target: examTarget },
        _fan_out: true,
      },
    });
  }

  if (jobs.length > 0) {
    const { error } = await sb.from("job_queue").insert(jobs);
    if (error) {
      console.log(`[ExamPool-v5] Fan-out enqueue error: ${error.message}`);
      return { enqueued: 0, learningFields: lfGroups.size };
    }
  }

  return { enqueued: jobs.length, learningFields: lfGroups.size };
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
      if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
        const jobId = p.job_id || body.job_id;
        if (jobId) {
          await sb.from("job_queue").update({
            status: "pending",
            run_after: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
            locked_at: null, locked_by: null,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);
          return json({ ok: true, delayed: true, reason: "PREREQ_NOT_DONE: scaffold_learning_course" });
        }
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
      }
    }

    // Resolve profession
    const certificationId = p.certification_id || null;
    const professionResult = await resolveProfession(sb, { certificationId, curriculumId });
    const professionName = professionResult.professionName;

    if (generatedSoFar === 0 && !isFanOut) {
      console.log(`[ExamPool-v5] Start "${professionName}": target=${examTarget}, engine=v5-ihk-quality`);
    }

    // Get blueprints
    let bpQuery = sb.from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template")
      .eq("curriculum_id", curriculumId).eq("status", "approved").order("created_at", { ascending: true });

    if (blueprintIds?.length) bpQuery = bpQuery.in("id", blueprintIds);

    const { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum.");

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

    const effectiveTarget = isFanOut ? lfTarget : examTarget;
    const perBlueprint = Math.max(3, Math.ceil(effectiveTarget / bps.length));
    let questionsThisChunk = 0;
    let trainingThisChunk = 0;
    let currentBpIndex = bpIndex;
    let bpsProcessed = 0;

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
          const { saved, training } = await generateTurboQuestions(
            sb, bp, AI_QUESTIONS_PER_CALL, difficulty, questionType, cognitiveLevel, existingHashes, existingNgramSets, professionName
          );
          questionsThisChunk += saved;
          trainingThisChunk += training;
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
