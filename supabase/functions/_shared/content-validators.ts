/**
 * content-validators.ts — Structural Hard Validators v2
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

/**
 * Score-based scenario detection (v2) — avoids false-fails.
 * Score ≥ 3 = valid scenario. Possible points:
 *   +1 any 2+ digit number
 *   +2 number with unit (€, %, Stk, kg, …)
 *   +1 role/actor mention
 *   +1 decision/action verb
 */
function scenarioScore(text: string): number {
  let score = 0;
  if (/\b\d{2,}\b/.test(text)) score += 1;
  if (/\d+[.,]?\d*\s*(€|%|Stk|kg|g|ml|l|Std|Min|mm|cm|m²|m³|Wochen|Monate|Tage)\b/i.test(text)) score += 2;
  if (/(Kunde|Kundin|Patient|Kolleg|Vorgesetzt|Ausbilder|Geschäftsführ|Lieferant|Mitarbeiter|Azubi|Filialleiter|Abteilungsleiter|Sachbearbeiter|Teamleitung|Teamleiter|Meister|Dozent|Betreuer)/i.test(text)) score += 1;
  if (/(Option|Alternative|Variante|entscheid|abwäg|begründ|empfehl|prüf|berechne|wähl|beurteilen)/i.test(text)) score += 1;
  return score;
}

function hasScenarioMarkers(text: string): boolean {
  return scenarioScore(text) >= 3;
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

// ─── Elite Helpers (v3) ─────────────────────────────────────────────────────

/** Count <strong> or <b> tagged technical terms */
function countFachbegriffe(html: string): number {
  return countPattern(html, /<(strong|b)>[^<]{3,}<\/(strong|b)>/gi);
}

/** Check if content has concrete examples (Beispiel, z.B., etc.) */
function countExamples(text: string): number {
  return countPattern(text, /\b(Beispiel|z\.?\s?B\.?|beispielsweise|etwa|konkret|in der Praxis)\b/gi);
}

/** Check for Prüfungsbezug markers */
function hasPruefungsbezug(text: string): boolean {
  return /(IHK|Prüfung|Abschlussprüfung|Klausur|Prüfungsaufgabe|prüfungsrelevant|Prüfer|Prüfungsfrage)/i.test(text);
}

/** Check for structured content (headings, lists, blockquotes) */
function hasStructuredContent(html: string): boolean {
  const hasHeadings = /<h[2-4][\s>]/i.test(html);
  const hasLists = /<(ul|ol)[\s>]/i.test(html);
  return hasHeadings && hasLists;
}

/** Check for typical errors / common mistakes coverage */
function hasTypicalErrors(text: string): boolean {
  return /(typischer Fehler|häufiger Fehler|Denkfehler|Prüfungsfalle|Achtung|Vorsicht|oft verwechselt|nicht verwechseln|Irrtum)/i.test(text);
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
    metrics: { hasScenario: hasScenarioMarkers(text), scenarioScore: scenarioScore(text), questionCount, wordCount: text.split(/\s+/).length },
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
  const charCount = text.length;
  // Use both word AND char count to avoid false-fails on structured HTML
  if (wordCount < 300 && charCount < 1500) {
    failures.push({ rule: "VERSTEHEN_TOO_SHORT", message: `Nur ${wordCount} Wörter / ${charCount} Zeichen — mind. 300 Wörter oder 1500 Zeichen nötig`, severity: "hard_fail" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: { starCount, warnCount, hasFallvignette, wordCount, charCount },
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
    metrics: { hasScenario: hasScenarioMarkers(text), scenarioScore: scenarioScore(text), hasDecision, warnCount },
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

  // Table detection on raw HTML (not stripped text) — Bug A fix
  const hasTable = /<table[\s>]/i.test(html);
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
  const n = questions.length;

  // 1. Item count — hard: 7-8, soft_warn: 6 or 9, hard_fail: <=5 or >=10
  if (n < 6 || n > 9) {
    failures.push({ rule: "MC_ITEM_COUNT", message: `${n} Items — muss 7–8 sein (6/9 = Warnung, ≤5/≥10 = Fail)`, severity: "hard_fail" });
  } else if (n !== 7 && n !== 8) {
    failures.push({ rule: "MC_ITEM_COUNT_SOFT", message: `${n} Items — Ziel ist 7–8`, severity: "soft_warn" });
  }

  // 2. Difficulty distribution — deterministic quotas
  const leicht = questions.filter(q => q.difficulty === "leicht").length;
  const mittel = questions.filter(q => q.difficulty === "mittel").length;
  const anspruchsvoll = questions.filter(q => q.difficulty === "anspruchsvoll").length;
  const untagged = questions.filter(q => !q.difficulty).length;

  if (untagged > 0) {
    failures.push({ rule: "MC_MISSING_DIFFICULTY", message: `${untagged} Items ohne difficulty-Tag`, severity: "hard_fail" });
  }

  // Deterministic quotas based on item count
  if (n >= 7 && n <= 8) {
    const expectedLeicht = 2;
    const expectedMittel = 3;
    const expectedAnspruchsvoll = n - expectedLeicht - expectedMittel; // 2 or 3

    if (leicht !== expectedLeicht) {
      failures.push({ rule: "MC_LEICHT_QUOTA", message: `${leicht} leichte Items — exakt ${expectedLeicht} nötig`, severity: leicht === 0 ? "hard_fail" : "soft_warn" });
    }
    if (mittel !== expectedMittel) {
      failures.push({ rule: "MC_MITTEL_QUOTA", message: `${mittel} mittlere Items — exakt ${expectedMittel} nötig`, severity: mittel < 2 ? "hard_fail" : "soft_warn" });
    }
    if (anspruchsvoll !== expectedAnspruchsvoll) {
      failures.push({ rule: "MC_ANSPRUCHSVOLL_QUOTA", message: `${anspruchsvoll} anspruchsvolle Items — exakt ${expectedAnspruchsvoll} nötig`, severity: anspruchsvoll < 2 ? "hard_fail" : "soft_warn" });
    }
  } else {
    // Fallback for 6/9 items — looser but still enforced
    if (leicht < 1) failures.push({ rule: "MC_LEICHT_QUOTA", message: `${leicht} leichte Items — mind. 1 nötig`, severity: "hard_fail" });
    if (mittel < 2) failures.push({ rule: "MC_MITTEL_QUOTA", message: `${mittel} mittlere Items — mind. 2 nötig`, severity: "hard_fail" });
    if (anspruchsvoll < 2) failures.push({ rule: "MC_ANSPRUCHSVOLL_QUOTA", message: `${anspruchsvoll} anspruchsvolle Items — mind. 2 nötig`, severity: "hard_fail" });
  }

  // 3. Bloom level distribution
  const transfer = questions.filter(q =>
    q.bloom_level === "transfer" || q.bloom_level === "analyze" ||
    q.bloom_level === "evaluate" || q.bloom_level === "create"
  ).length;
  if (transfer < 2) {
    failures.push({ rule: "MC_TRANSFER_QUOTA", message: `Nur ${transfer} Transfer/Analyse-Items — mind. 2 nötig (30% Ziel)`, severity: "hard_fail" });
  }

  const untaggedBloom = questions.filter(q => !q.bloom_level).length;
  if (untaggedBloom > 0) {
    failures.push({ rule: "MC_MISSING_BLOOM", message: `${untaggedBloom} Items ohne bloom_level-Tag`, severity: "hard_fail" });
  }

  // 4. Scenario items — score-based, check question stem + options
  const scenarioItems = questions.filter(q =>
    hasScenarioMarkers(q.question) || (q.options?.some(o => hasScenarioMarkers(o)) && scenarioScore(q.question) >= 1)
  ).length;
  if (scenarioItems < 3) {
    failures.push({ rule: "MC_SCENARIO_QUOTA", message: `Nur ${scenarioItems} Szenario-Items — mind. 3 nötig`, severity: "hard_fail" });
  }

  // 5. Trap items — must exist AND have substance (anti-cheating: no generic stubs)
  const trapItems = questions.filter(q => q.trap_type && q.trap_type.length >= 8).length;
  const genericTraps = questions.filter(q => q.trap_type && q.trap_type.length > 0 && q.trap_type.length < 8).length;
  if (trapItems < 1) {
    failures.push({ rule: "MC_NO_TRAP", message: "Kein Prüfungsfallen-Item (trap_type mit ≥8 Zeichen) vorhanden", severity: "hard_fail" });
  }
  if (genericTraps > 0) {
    failures.push({ rule: "MC_GENERIC_TRAP", message: `${genericTraps} Items mit zu kurzem trap_type (<8 Zeichen) — Substanz nötig`, severity: "hard_fail" });
  }

  // 6. Per-question validation
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    // 6a. Explanation length
    if (!q.explanation || q.explanation.length < 80) {
      failures.push({ rule: "MC_WEAK_EXPLANATION", message: `Frage ${i + 1}: Erklärung zu kurz (${q.explanation?.length || 0} Zeichen — min 80)`, severity: "hard_fail" });
    }

    // 6b. Explanation structure — must contain "why tempting" AND "why wrong"
    if (q.explanation && q.explanation.length >= 80) {
      const hasTempting = /verlockend|klingt richtig|typischer fehler|fangfrage|häufiger irrtum|scheint korrekt|naheliegend/i.test(q.explanation);
      const hasWhyWrong = /falsch weil|korrekt ist|richtig ist|tatsächlich|in wirklichkeit|der fehler liegt|nicht zutreffend/i.test(q.explanation);
      if (!hasTempting || !hasWhyWrong) {
        failures.push({ rule: "MC_EXPLANATION_STRUCTURE", message: `Frage ${i + 1}: Erklärung muss "verlockend/warum falsch"-Struktur enthalten`, severity: "hard_fail" });
      }
    }

    // 6c. Option count
    if (!q.options || q.options.length !== 4) {
      failures.push({ rule: "MC_OPTION_COUNT", message: `Frage ${i + 1}: ${q.options?.length || 0} Optionen — muss exakt 4 sein`, severity: "hard_fail" });
    }

    // 6d. correct_answer range
    if (q.correct_answer < 0 || q.correct_answer > 3) {
      failures.push({ rule: "MC_CORRECT_RANGE", message: `Frage ${i + 1}: correct_answer=${q.correct_answer} außerhalb 0-3`, severity: "hard_fail" });
    }
  }

  // 7. Pure definition check — only flag if NO scenario context
  const pureDefinition = questions.filter(q => {
    const stem = q.question.trim();
    const defStart = /^was (ist|sind|bedeutet|versteht man)/i.test(stem);
    return defStart && scenarioScore(stem) < 2;
  }).length;
  if (pureDefinition > 2) {
    failures.push({ rule: "MC_TOO_MANY_DEFINITIONS", message: `${pureDefinition} reine "Was ist...?"-Fragen ohne Kontext — max 2 erlaubt`, severity: "hard_fail" });
  }

  return {
    passes: !failures.some(f => f.severity === "hard_fail"),
    failures,
    metrics: {
      itemCount: n,
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

const SCENARIO_SETTINGS_DEFAULT = [
  "Wareneingang", "Reklamationsbearbeitung", "Inventur", "Kassensturz",
  "Lieferantenbewertung", "Preiskalkulation", "Qualitätsprüfung",
  "Bestellabwicklung", "Kundengespräch", "Jahresabschluss",
  "Personalplanung", "Lagerverwaltung", "Angebotsvergleich",
  "Rechnungsprüfung", "Budgetplanung", "Projektabnahme",
  "Betriebsratssitzung", "Ausbildungsplanung", "Marketingkampagne",
  "Beschwerdemanagement",
] as const;

const TRAP_TYPES_DEFAULT = [
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

// ─── Profession-specific overrides ──────────────────────────────────────────

interface ProfessionProfile {
  scenarios: readonly string[];
  traps: readonly string[];
}

const PROFESSION_PROFILES: Record<string, ProfessionProfile> = {
  pka: {
    scenarios: [
      "Wareneingang Apotheke", "Rezeptbearbeitung", "Retourenmanagement",
      "Rabattvertrags-Prüfung", "Mindestbestandskontrolle", "Lieferantenvergleich Pharma",
      "Inventur Apotheke", "Reklamation Arzneimittel", "Kassensturz Offizin",
      "Preiskalkulation Freiwahlbereich", "Bestellung beim Großhandel",
      "Verfallsdaten-Kontrolle", "Kühlketten-Dokumentation", "Kundengespräch OTC",
      "Rechnungsprüfung Großhandel", "Skontoberechnung Pharma",
      "BtM-Dokumentation", "Lageroptimierung Saisonware",
      "Datenschutz Patientendaten", "QMS-Dokumentation Apotheke",
    ],
    traps: [
      "Brutto/Netto-Verwechslung (EK netto vs. VK brutto, Spannenberechnung)",
      "Falscher Zuschlagsfaktor (Aufschlag vs. Abschlag, Kassenrabatt vergessen)",
      "ApBetrO-Zuständigkeit falsch (Apotheker vs. PKA vs. PTA Befugnisse)",
      "Datenschutz: Einwilligung vs. Informationspflicht verwechselt",
      "Soll/Haben-Vertauschung (Buchungssätze Wareneinkauf/-verkauf)",
      "Mindestbestand falsch berechnet (Verbrauch × Lieferzeit + Sicherheit)",
      "Rabattvertrag: Austauschpflicht vs. Aut-idem-Kreuz verwechselt",
      "Verfallsdatum: MHD vs. Verwendbar bis vs. Anbruchsdatum",
      "Retaxation: Formfehler Rezept vs. pharmazeutischer Fehler",
      "BtM-Dokumentation: Karteikarte vs. digitale Erfassung Pflichtfelder",
    ],
  },
  industriekaufmann: {
    scenarios: [
      "Angebotskalkulation", "Lieferantenauswahl", "Beschaffungslogistik",
      "Personalbedarfsplanung", "Deckungsbeitragsrechnung", "Vertriebssteuerung",
      "Reklamationsmanagement", "Investitionsrechnung", "Außenhandel Zoll",
      "Budgetplanung Abteilung", "Kosten- und Leistungsrechnung",
      "Vertragsgestaltung", "Projektcontrolling", "Marketing-Mix Analyse",
      "Jahresabschluss Bilanzanalyse", "Qualitätsmanagement Audit",
      "Arbeitszeitmodelle", "Finanzierungsvergleich",
      "Supply-Chain-Optimierung", "Betriebsrat-Anhörung",
    ],
    traps: [
      "Skonto auf Brutto statt Netto berechnet",
      "Bezugskalkulation: Transportkosten vergessen",
      "BAB: Gemeinkosten falsch zugeordnet (Material vs. Verwaltung)",
      "Deckungsbeitrag vs. Gewinn verwechselt",
      "Lieferbedingungen: FOB vs. CIF Risikoübergang",
      "Kündigungsfristen: gesetzlich vs. tariflich vs. vertraglich",
      "Bilanz: Aktiva/Passiva-Zuordnung bei Rückstellungen",
      "Zuschlagskalkulation: Reihenfolge der Zuschläge vertauscht",
      "Umsatzsteuer: Vorsteuerabzug bei nicht abzugsfähigen Ausgaben",
      "Personalkosten: Arbeitgeber-Brutto vs. Arbeitnehmer-Brutto",
    ],
  },
  bueromanagement: {
    scenarios: [
      "Terminkoordination Geschäftsleitung", "Reisekostenabrechnung",
      "Protokollführung Betriebsversammlung", "Posteingang Priorisierung",
      "Veranstaltungsorganisation", "Beschaffung Büromaterial",
      "Kundenkorrespondenz Beschwerdebrief", "Rechnungseingang Kontierung",
      "Personalakte Führung", "Datenschutz Bewerbungsunterlagen",
      "Archivierung Aufbewahrungsfristen", "Präsentationserstellung",
      "Zahlungsverkehr Mahnwesen", "Bestellwesen Angebotsvergleich",
      "Kassenführung Handvorschuss", "Meeting-Vorbereitung international",
      "Telefonnotiz Eskalationsmanagement", "Inventarverwaltung",
      "Urlaubsplanung Vertretungsregelung", "QM-Dokumentation Prozesse",
    ],
    traps: [
      "Aufbewahrungsfristen: 6 Jahre vs. 10 Jahre verwechselt",
      "Mahnverfahren: gerichtlich vs. außergerichtlich Reihenfolge",
      "Buchungssatz: Aufwand vs. Bestandskonto verwechselt",
      "Datenschutz: Löschfrist Bewerbungsunterlagen (6 Monate)",
      "Vollmacht: Prokura vs. Handlungsvollmacht Umfang",
      "Reisekosten: Verpflegungsmehraufwand Stundengrenzen",
      "Protokoll: Ergebnis- vs. Verlaufsprotokoll Pflichtinhalte",
      "Zahlungsbedingungen: Skonto-Frist vs. Zahlungsziel",
      "Personalakte: was rein darf vs. was verboten ist",
      "Schriftformerfordernis: wann nötig vs. formfrei",
    ],
  },
};

/**
 * Resolve profession key from curriculum/course metadata.
 * Falls back to default lists if no match.
 */
function resolveProfessionKey(professionHint?: string): string | null {
  if (!professionHint) return null;
  const hint = professionHint.toLowerCase();
  if (hint.includes("pka") || hint.includes("pharma")) return "pka";
  if (hint.includes("industriekauf")) return "industriekaufmann";
  if (hint.includes("büromanagement") || hint.includes("bueromanagement") || hint.includes("bürokauf")) return "bueromanagement";
  return null;
}

/**
 * DB profession profile shape from profession_profiles.profile JSONB
 */
export interface DbProfessionProfile {
  common_error_patterns?: Array<{ error: string; domain?: string; severity?: string }>;
  preferred_scenario_types?: Array<{ type: string; description?: string; frequency?: string }>;
  exam_style_hints?: string[];
  [key: string]: unknown;
}

/**
 * Generate a deterministic variation seed for a lesson to prevent template leakage.
 * Uses competency code + step to select scenario settings and trap types.
 * 
 * Priority: dbProfile (from profession_profiles table) > hardcoded profiles > defaults
 */
export function getVariationSeed(
  competencyCode: string,
  step: string,
  professionHint?: string,
  dbProfile?: DbProfessionProfile | null,
): {
  scenarioSetting: string;
  requiredTrapTypes: string[];
  promptSuffix: string;
} {
  let hash = 0;
  const key = `${competencyCode}:${step}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash);

  // Priority 1: DB profile from profession_profiles table
  let scenarios: readonly string[] = SCENARIO_SETTINGS_DEFAULT;
  let traps: readonly string[] = TRAP_TYPES_DEFAULT;

  if (dbProfile) {
    if (dbProfile.preferred_scenario_types?.length) {
      scenarios = dbProfile.preferred_scenario_types.map(s => s.description ? `${s.type}: ${s.description}` : s.type);
    }
    if (dbProfile.common_error_patterns?.length) {
      traps = dbProfile.common_error_patterns.map(e => e.error);
    }
  } else {
    // Priority 2: Hardcoded fallback profiles (legacy, for backward compat)
    const profKey = resolveProfessionKey(professionHint);
    const profile = profKey ? PROFESSION_PROFILES[profKey] : null;
    if (profile) {
      scenarios = profile.scenarios;
      traps = profile.traps;
    }
  }

  const scenarioSetting = scenarios[idx % scenarios.length];
  const trap1 = traps[idx % traps.length];
  const trap2 = traps[(idx + 3) % traps.length];

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

// ─── Exported helper for external use ───────────────────────────────────────
export { scenarioScore, hasScenarioMarkers as checkScenarioMarkers };
