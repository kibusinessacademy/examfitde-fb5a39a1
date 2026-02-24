/**
 * content-validators.ts — Structural Hard Validators v1
 * 
 * Programmatic validators that HARD FAIL content that doesn't meet
 * elite quality standards. No LLM needed — pure structural checks.
 * 
 * These run BEFORE LLM validation and trigger regeneration on failure.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationFailure {
  rule: string;
  message: string;
  severity: "hard_fail" | "soft_warn";
}

export interface StructuralValidationResult {
  passes: boolean;
  failures: ValidationFailure[];
  metrics: Record<string, number | boolean | string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countPattern(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

function hasScenarioMarkers(text: string): boolean {
  // Scenario = contains numbers + roles/actors + decision context
  const hasNumbers = /\d+[\.,]?\d*\s*[€%km²³]/.test(text) || /\b\d{2,}\b/.test(text);
  const hasRoles = /Kunde|Kolleg|Vorgesetzt|Ausbilder|Geschäftsführ|Lieferant|Mitarbeiter|Azubi|Filialleiter|Abteilungsleiter|Sachbearbeiter/i.test(text);
  const hasDecision = /entscheid|wähl|beurteilen|begründ|abwäg|empfehl|prüf|berechne/i.test(text);
  return hasNumbers && (hasRoles || hasDecision);
}

function hasRetrievalMechanics(text: string): boolean {
  const hasQuestions = countPattern(text, /\?\s/g) >= 2;
  const hasDelimitation = /Abgrenzung|Unterschied|Vergleich|Verwechslung|dagegen|im Gegensatz/i.test(text);
  const hasConnection = /zusammen mit|verknüpf|hängt.*zusammen|Bezug zu|siehe auch/i.test(text);
  return hasQuestions && (hasDelimitation || hasConnection);
}

function hasPassiveSummary(text: string): boolean {
  return /wir haben gelernt|in dieser lektion|zusammenfassend lässt sich|abschließend sei|zum abschluss/i.test(text);
}

// ─── Lesson Step Validators ─────────────────────────────────────────────────

export function validateEinstieg(html: string): StructuralValidationResult {
  const text = stripHtml(html);
  const failures: ValidationFailure[] = [];

  if (!hasScenarioMarkers(text)) {
    failures.push({ rule: "EINSTIEG_NO_SCENARIO", message: "Einstieg enthält kein Szenario mit Zahlen + Rollen + Parametern", severity: "hard_fail" });
  }

  const questionCount = countPattern(text, /\?\s/g);
  if (questionCount < 2) {
    failures.push({ rule: "EINSTIEG_FEW_QUESTIONS", message: `Nur ${questionCount} Reflexionsfrage(n) — mind. 2 nötig`, severity: "hard_fail" });
  }

  if (/heute lernen wir|in dieser lektion|willkommen zu/i.test(text)) {
    failures.push({ rule: "EINSTIEG_PASSIVE_OPENER", message: "Passiver Einstieg ('Heute lernen wir...') — muss aktivierend sein", severity: "hard_fail" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: { hasScenario: hasScenarioMarkers(text), questionCount, wordCount: text.split(/\s+/).length },
  };
}

export function validateVerstehen(html: string): StructuralValidationResult {
  const text = stripHtml(html);
  const failures: ValidationFailure[] = [];

  const starCount = countPattern(html, /⭐/g);
  const warnCount = countPattern(html, /⚠️/g);
  const hasFallvignette = /Fallbeispiel|Fallvignette|Szenario|Praxisfall/i.test(text) && hasScenarioMarkers(text);

  if (!hasFallvignette) {
    failures.push({ rule: "VERSTEHEN_NO_FALLVIGNETTE", message: "Verstehen enthält keine Fallvignette mit mehreren Variablen", severity: "hard_fail" });
  }

  if (starCount < 1) {
    failures.push({ rule: "VERSTEHEN_NO_STAR", message: "Keine ⭐ IHK-Prüfungstipps gefunden", severity: "hard_fail" });
  }

  if (warnCount < 2) {
    failures.push({ rule: "VERSTEHEN_FEW_TRAPS", message: `Nur ${warnCount} ⚠️ Prüfungsfalle(n) — mind. 2 nötig`, severity: "hard_fail" });
  }

  const wordCount = text.split(/\s+/).length;
  if (wordCount < 300) {
    failures.push({ rule: "VERSTEHEN_TOO_SHORT", message: `Nur ${wordCount} Wörter — mind. 300 nötig`, severity: "hard_fail" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: { starCount, warnCount, hasFallvignette, wordCount },
  };
}

export function validateAnwenden(html: string): StructuralValidationResult {
  const text = stripHtml(html);
  const failures: ValidationFailure[] = [];

  if (!hasScenarioMarkers(text)) {
    failures.push({ rule: "ANWENDEN_NO_SCENARIO", message: "Anwenden enthält kein Szenario mit Zahlen + Rollen + Parametern", severity: "hard_fail" });
  }

  const hasDecision = /entscheid|wähl|beurteilen|begründ|abwäg|Option|Alternative|Variante/i.test(text);
  if (!hasDecision) {
    failures.push({ rule: "ANWENDEN_NO_DECISION", message: "Anwenden enthält keine Entscheidungssituation", severity: "hard_fail" });
  }

  const warnCount = countPattern(html, /⚠️/g);
  if (warnCount < 1) {
    failures.push({ rule: "ANWENDEN_NO_TRAP", message: "Keine ⚠️ Prüfungsfalle in Anwenden", severity: "soft_warn" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: { hasScenario: hasScenarioMarkers(text), hasDecision, warnCount },
  };
}

export function validateWiederholen(html: string): StructuralValidationResult {
  const text = stripHtml(html);
  const failures: ValidationFailure[] = [];

  if (hasPassiveSummary(text)) {
    failures.push({ rule: "WIEDERHOLEN_PASSIVE", message: "Wiederholung ist passive Zusammenfassung ('Wir haben gelernt...') — muss retrieval-basiert sein", severity: "hard_fail" });
  }

  if (!hasRetrievalMechanics(text)) {
    failures.push({ rule: "WIEDERHOLEN_NO_RETRIEVAL", message: "Keine Retrieval-Mechanik (Leitfragen + Abgrenzung/Verknüpfung) gefunden", severity: "hard_fail" });
  }

  const hasTable = /<table/i.test(html);
  if (!hasTable) {
    failures.push({ rule: "WIEDERHOLEN_NO_TABLE", message: "Keine Abgrenzungstabelle gefunden", severity: "soft_warn" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: { hasPassiveSummary: hasPassiveSummary(text), hasRetrieval: hasRetrievalMechanics(text), hasTable },
  };
}

// ─── MiniCheck Validator (HÄRTESTER HEBEL) ──────────────────────────────────

export interface MiniCheckQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  difficulty?: string;
  bloom_level?: string;
  trap_type?: string;
}

export function validateMiniCheck(questions: MiniCheckQuestion[]): StructuralValidationResult {
  const failures: ValidationFailure[] = [];

  // 1. Item count
  if (questions.length < 6 || questions.length > 9) {
    failures.push({ rule: "MC_ITEM_COUNT", message: `${questions.length} Items — muss 6-8 sein`, severity: "hard_fail" });
  }

  // 2. Difficulty distribution
  const leicht = questions.filter(q => q.difficulty === "leicht").length;
  const mittel = questions.filter(q => q.difficulty === "mittel").length;
  const anspruchsvoll = questions.filter(q => q.difficulty === "anspruchsvoll").length;
  const untagged = questions.filter(q => !q.difficulty).length;

  if (untagged > 0) {
    failures.push({ rule: "MC_MISSING_DIFFICULTY", message: `${untagged} Items ohne difficulty-Tag`, severity: "hard_fail" });
  }

  if (leicht < 1 || leicht > 3) {
    failures.push({ rule: "MC_LEICHT_QUOTA", message: `${leicht} leichte Items — soll 2 sein (±1)`, severity: leicht === 0 ? "hard_fail" : "soft_warn" });
  }
  if (mittel < 2) {
    failures.push({ rule: "MC_MITTEL_QUOTA", message: `${mittel} mittlere Items — mind. 2 nötig`, severity: "hard_fail" });
  }
  if (anspruchsvoll < 2) {
    failures.push({ rule: "MC_ANSPRUCHSVOLL_QUOTA", message: `${anspruchsvoll} anspruchsvolle Items — mind. 2 nötig`, severity: "hard_fail" });
  }

  // 3. Bloom level distribution
  const transfer = questions.filter(q => q.bloom_level === "transfer").length;
  if (transfer < 2) {
    failures.push({ rule: "MC_TRANSFER_QUOTA", message: `Nur ${transfer} Transfer-Items — mind. 2 nötig (30% Ziel)`, severity: "hard_fail" });
  }

  // 4. Scenario items (questions containing numbers + roles)
  const scenarioItems = questions.filter(q => hasScenarioMarkers(q.question)).length;
  if (scenarioItems < 3) {
    failures.push({ rule: "MC_SCENARIO_QUOTA", message: `Nur ${scenarioItems} Szenario-Items — mind. 3 nötig`, severity: "hard_fail" });
  }

  // 5. Trap items
  const trapItems = questions.filter(q => q.trap_type && q.trap_type.length > 0).length;
  if (trapItems < 1) {
    failures.push({ rule: "MC_NO_TRAP", message: "Kein Prüfungsfallen-Item (trap_type) vorhanden", severity: "hard_fail" });
  }

  // 6. Explanation quality — must explain WHY each wrong answer is tempting
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.explanation || q.explanation.length < 80) {
      failures.push({ rule: "MC_WEAK_EXPLANATION", message: `Frage ${i + 1}: Erklärung zu kurz (${q.explanation?.length || 0} Zeichen — min 80)`, severity: "hard_fail" });
    }

    // Check option count
    if (!q.options || q.options.length !== 4) {
      failures.push({ rule: "MC_OPTION_COUNT", message: `Frage ${i + 1}: ${q.options?.length || 0} Optionen — muss exakt 4 sein`, severity: "hard_fail" });
    }

    // Check correct_answer range
    if (q.correct_answer < 0 || q.correct_answer > 3) {
      failures.push({ rule: "MC_CORRECT_RANGE", message: `Frage ${i + 1}: correct_answer=${q.correct_answer} außerhalb 0-3`, severity: "hard_fail" });
    }
  }

  // 7. No pure definition questions without context (detect "Was ist...?" pattern)
  const pureDefinition = questions.filter(q => /^was (ist|sind|bedeutet|versteht man)/i.test(q.question.trim())).length;
  if (pureDefinition > 2) {
    failures.push({ rule: "MC_TOO_MANY_DEFINITIONS", message: `${pureDefinition} reine "Was ist...?"-Fragen — max 2 erlaubt`, severity: "hard_fail" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: {
      itemCount: questions.length,
      leicht, mittel, anspruchsvoll, untagged,
      transferItems: transfer,
      scenarioItems,
      trapItems,
      pureDefinitionItems: pureDefinition,
    },
  };
}

// ─── Unified Step Validator ─────────────────────────────────────────────────

export function validateLessonStep(step: string, content: any): StructuralValidationResult {
  if (step === "mini_check") {
    const questions = content?.questions || content;
    if (!Array.isArray(questions)) {
      return { passes: false, failures: [{ rule: "MC_NO_QUESTIONS", message: "Keine questions-Array gefunden", severity: "hard_fail" }], metrics: {} };
    }
    return validateMiniCheck(questions);
  }

  const html = content?.html || (typeof content === "string" ? content : "");
  if (!html || html.length < 50) {
    return { passes: false, failures: [{ rule: "EMPTY_CONTENT", message: "Inhalt ist leer oder zu kurz", severity: "hard_fail" }], metrics: {} };
  }

  switch (step) {
    case "einstieg": return validateEinstieg(html);
    case "verstehen": return validateVerstehen(html);
    case "anwenden": return validateAnwenden(html);
    case "wiederholen": return validateWiederholen(html);
    default: return { passes: true, failures: [], metrics: {} };
  }
}

// ─── Prompt-Drift Protection: Variation Seed & Trap Types ───────────────────

const SCENARIO_SETTINGS = [
  "Wareneingang", "Reklamationsbearbeitung", "Inventur", "Kassensturz",
  "Lieferantenbewertung", "Preiskalkulation", "Qualitätsprüfung",
  "Bestellabwicklung", "Kundengespräch", "Jahresabschluss",
  "Personalplanung", "Lagerverwaltung", "Angebotsvergleich",
  "Rechnungsprüfung", "Budgetplanung", "Projektabnahme",
  "Betriebsratssitzung", "Ausbildungsplanung", "Marketingkampagne",
  "Beschwerdemanagement",
] as const;

const TRAP_TYPES = [
  "Normverwechslung (falscher §, falsche Rechtsgrundlage)",
  "Fristverwechslung (falsche Frist, falscher Zeitraum)",
  "Rechenfehler (falscher Faktor, vergessener Schritt)",
  "Reihenfolgefehler (falscher Prozessschritt)",
  "False Friend (ähnlicher Begriff, andere Bedeutung)",
  "Ausnahme übersehen (Regelfall vs. Sonderfall)",
  "Zuständigkeitsfehler (falsche Stelle, falsches Organ)",
  "Maßeinheitsfehler (brutto/netto, inkl./exkl.)",
  "Kausalitätsfehler (Ursache/Wirkung vertauscht)",
  "Kontextfehler (richtige Regel, falscher Anwendungsfall)",
] as const;

/**
 * Generate a deterministic variation seed for a lesson to prevent template leakage.
 * Uses competency code + step to select scenario settings and trap types.
 */
export function getVariationSeed(competencyCode: string, step: string): {
  scenarioSetting: string;
  requiredTrapTypes: string[];
  promptSuffix: string;
} {
  // Deterministic hash from competency code
  let hash = 0;
  const key = `${competencyCode}:${step}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash);

  const scenarioSetting = SCENARIO_SETTINGS[idx % SCENARIO_SETTINGS.length];
  const trap1 = TRAP_TYPES[idx % TRAP_TYPES.length];
  const trap2 = TRAP_TYPES[(idx + 3) % TRAP_TYPES.length];

  return {
    scenarioSetting,
    requiredTrapTypes: [trap1, trap2],
    promptSuffix: `
VARIATIONS-KONTEXT (für diesen spezifischen Inhalt):
- Bevorzugtes Szenario-Setting: "${scenarioSetting}" (wenn zum Thema passend)
- Pflicht-Fallentypen: ${trap1}; ${trap2}
- WICHTIG: ⭐ und ⚠️ nur bei ECHTER Prüfungsableitung setzen — keine inflationäre Nutzung ohne Substanz.
- Jede ⚠️-Markierung MUSS erklären: 1) Was ist der Fehler? 2) Warum passiert er? 3) Wie vermeidet man ihn?`,
  };
}
