/**
 * prompt-kit.ts — Shared Prompt Library v2
 * 
 * Centralized prompt building blocks for consistent depth, quality
 * and profession-specificity across all AI edge functions.
 * 
 * VERSION: 2.0.0
 * 
 * v2 additions:
 *   - Adaptive Depth Engine (difficulty-aware requirements)
 *   - Hallucination Risk Guard (SSOT drift scoring)  
 *   - Didactic Impact Score (exam effectiveness)
 *   - Anti-Formelhaftigkeit Score (variation analysis)
 */

// ─── Depth Self-Check (invisible to output) ──────────────────────────────────

export const DEPTH_SELF_CHECK = `
SELBSTPRÜFUNG (intern, nicht ausgeben):
☐ ≥30% Transfer/Analyse ☐ ≥1 Fallvignette ☐ ≥1 ⚠️ Prüfungsfalle mit Denkfehler-Erklärung
☐ ≥1 ⭐ IHK-Tipp ☐ ≥1 Zahlenbeispiel (realistisch) ☐ ≥1 Transferfrage
☐ Keine KI-Floskeln, keine Definitionslisten ohne Kontext
Falls Pflicht fehlt → ergänzen.`;

/** Academic variant — no IHK references, uses Klausur/Modulprüfung framing */
export const DEPTH_SELF_CHECK_ACADEMIC = `
SELBSTPRÜFUNG (intern, nicht ausgeben):
☐ ≥40% Analyse/Transfer ☐ ≥1 Fallanalyse ☐ ≥1 ⚠️ Typischer Denkfehler mit wissenschaftlicher Korrektur
☐ ≥1 📌 Klausurtipp ☐ ≥1 Modellvergleich oder empirischer Bezug ☐ ≥1 Transferfrage
☐ Keine KI-Floskeln, keine Definitionslisten ohne Kontext
Falls Pflicht fehlt → ergänzen.`;

/** @deprecated Use DEPTH_SELF_CHECK — kept for reference only */
export const DEPTH_SELF_CHECK_V1 = DEPTH_SELF_CHECK;

// ─── Regulatory Hallucination Guard ──────────────────────────────────────────

export const REGULATORY_GUARD = `
§-REGEL: Nenne §§/Fristen NUR wenn sicher bekannt. Bei Unsicherheit: "Rechtsgrundlage im IHK-Merkblatt prüfen." Falsche §§ → Auto-Reject.`;

/** Academic variant — references academic sources instead of IHK */
export const REGULATORY_GUARD_ACADEMIC = `
§-REGEL: Nenne §§/Quellen/Modelle NUR wenn sicher bekannt. Bei Unsicherheit: "Primärquelle in der Fachliteratur prüfen." Falsche Zuschreibungen → Auto-Reject.`;

// ─── MiniCheck Taxonomy Template ─────────────────────────────────────────────

export function buildMiniCheckPrompt(professionName: string, context: string): string {
  return `7-8 IHK-Prüfungsfragen für ${professionName}.
${context}

VERTEILUNG: 2 leicht (Reproduktion), 3 mittel (Anwendung), 2-3 anspruchsvoll (Transfer).
Anspruchsvoll = ≥2 Denkschritte + implizite Info.

PFLICHT: ≥3 Szenariofragen, ≥1 Transferfrage, ≥1 Prüfungsfalle, ≥1 Entscheidungsaufgabe.

DISTRAKTOREN (je 1 Fehlertyp):
A: Norm/Frist-Verwechslung | B: Prozess-Verwechslung | C: Rechenfehler | D: Praxis-Fehleinschätzung

ERKLÄRUNG pro Frage: Warum richtig? + Warum jede Option falsch? (Fehlertyp + Denkfehler) + "Merke/Tipp:" (1 Satz).
Keine "Was ist...?"-Fragen ohne Kontext. Keine offensichtlich falschen Distraktoren.`;
}

// ─── Anti-KI Style Rules ─────────────────────────────────────────────────────

export const ANTI_KI_RULES = `
STIL: Keine Floskeln ("In der heutigen Geschäftswelt..."). Keine Wiederholungen. Direkt starten. Max 25 Wörter/Satz. Schreibe wie ein Ausbilder, nicht wie ein Lehrbuch.`;

// ─── Role-Specific Output Templates (for AI Tutor) ──────────────────────────

export function getTutorOutputFormat(role: string, professionName: string): string {
  const formats: Record<string, string> = {
    explainer: `
ANTWORT-FORMAT als Erklärer:
1. 📖 Kurzdefinition (1 Satz, auf den Punkt)
2. 💼 Praxisbeispiel aus dem Arbeitsalltag von ${professionName}
3. ⚠️ Typische Prüfungsfalle, die ${professionName} kennen müssen
4. ✅ Mini-Check: 1 kurze Verständnisfrage zum Selbsttest
Halte die Gesamtantwort unter 200 Wörtern.`,
    
    coach: `
ANTWORT-FORMAT als Lern-Coach:
1. 📊 Aktuelle Einschätzung (1-2 Sätze basierend auf dem Kontext)
2. 📋 3-Schritt-Lernplan:
   - Heute: [konkrete Aufgabe]
   - Morgen: [Vertiefung]
   - Wiederholen: [Spaced Repetition Hinweis]
3. 💪 Motivations-Impuls (1 Satz)
Halte die Gesamtantwort unter 150 Wörtern.`,
    
    examiner: `
ANTWORT-FORMAT als Prüfungs-Trainer:
- Stelle EXAKT 1 Prüfungsfrage im IHK-Stil für ${professionName}
- Warte auf die Antwort des Nutzers
- Nach Antwort: Bewertung mit kurzer Rubrik (Stärke / Lücke / Tipp)
Halte die Frage unter 80 Wörtern.`,
    
    feedback: `
ANTWORT-FORMAT als Feedback-Geber:
- ✅ Stärke: [was gut war] (1-2 Sätze)
- ⚠️ Lücke: [was fehlt] (1-2 Sätze)  
- ➡️ Nächster Schritt: [konkrete Empfehlung] (1 Satz)
Maximal 5 Bullet Points. Unter 120 Wörtern.`,
  };
  return formats[role] || formats.explainer;
}

// ─── Source Citation Rule ────────────────────────────────────────────────────

export const SOURCE_CITATION_RULE = `
QUELLEN: Nur gesicherte §§/Normen zitieren. Bei Unsicherheit: "Im IHK-Merkblatt zu prüfen." Nie erfinden.`;

// ─── Explanation Template with Prüfungsanker ─────────────────────────────────

export const EXPLANATION_TEMPLATE = `
ERKLÄRUNG-TEMPLATE (PFLICHT für jede Prüfungsfrage):
1. "Richtig ist [Option], weil: ..." (fachliche Begründung, 1-2 Sätze)
2. "Falsch ist [Option A], weil: ..." (konkreter Fehler benennen)
3. "Falsch ist [Option B], weil: ..."
4. "Falsch ist [Option C], weil: ..."
5. "Prüfungsanker: Woran erkennt man im Text die richtige Antwort?" (1 Satz)
6. "Merke: ..." oder "Tipp: ..." (1 Satz Prüfungstipp)`;

// ─── Calculation Completeness Guard ──────────────────────────────────────────

export const CALCULATION_GUARD = `
RECHENAUFGABEN-VOLLSTÄNDIGKEIT (PFLICHT bei calculation-Typ):
- Die Aufgabenstellung MUSS alle Zahlen und Parameter enthalten, die zur Lösung nötig sind.
- KEINE impliziten Annahmen (z.B. "üblicher Zinssatz" ohne Zahl zu nennen).
- Der Rechenweg in der Erklärung: Formel → Einsetzen → Zwischenschritt → Ergebnis → Interpretation.
- Distraktoren bei Rechenaufgaben = typische Rechenfehler (falscher Faktor, vergessener Schritt, falsche Einheit).`;

// ─── Follow-Up Question Types (for Oral Exam) ───────────────────────────────

export function getFollowUpTypes(professionName: string): string {
  return `
NACHFRAGE-ACHSEN (wähle die passendste für ${professionName}):
- Risiko: "Welche Risiken sehen Sie dabei?"
- Norm/Recht: "Auf welcher rechtlichen Grundlage basiert das?"
- Prozess: "Beschreiben Sie den konkreten Ablauf Schritt für Schritt."
- Dokumentation: "Wie würden Sie das dokumentieren?"
- Qualitätssicherung: "Wie stellen Sie die Qualität sicher?"
- Kundenbeziehung: "Wie kommunizieren Sie das dem Kunden?"
Die Nachfrage muss berufsspezifisch für ${professionName} formuliert sein.`;
}

// ─── Dynamic Support Response Length ─────────────────────────────────────────

export function getSupportMaxLength(ticketType: string): { maxSentences: number; instruction: string } {
  const config: Record<string, { maxSentences: number; instruction: string }> = {
    technisch: { maxSentences: 10, instruction: "6–10 Sätze + nummerierte Schritte 1-3 zur Lösung" },
    abrechnung: { maxSentences: 8, instruction: "5–8 Sätze + konkreter Klickpfad zum Ziel" },
    pruefungsangst: { maxSentences: 5, instruction: "3–5 Sätze, kurz, empathisch, ermutigend" },
    verstaendnisfrage: { maxSentences: 7, instruction: "5–7 Sätze mit konkretem Beispiel" },
    lernstrategie: { maxSentences: 7, instruction: "5–7 Sätze mit 2–3 konkreten Tipps" },
  };
  return config[ticketType] || { maxSentences: 5, instruction: "3–5 Sätze — kurz und hilfreich" };
}

export const SUPPORT_CONTEXT_REQUEST = `
Wenn kein SSOT-Kontext vorhanden ist und die Frage fachspezifisch ist, antworte mit:
"Um dir besser helfen zu können, nenne mir bitte: 1) Welchen Kurs/welche Lektion betrifft es? 2) Was genau ist das Problem? Dann kann ich dir eine gezielte Antwort geben."`;

// ─── Oral Exam Evaluation Anchors ────────────────────────────────────────────

export function getEvaluationRubric(professionName: string): string {
  return `
BEWERTUNGS-RUBRIK mit Ankerbeispielen für ${professionName}:

Fachlichkeit (35%):
- 1.0 = Nennt alle Kernpunkte korrekt, verwendet Fachbegriffe von ${professionName} präzise, zeigt tiefes Verständnis
- 0.5 = Nennt Hauptpunkte, aber unvollständig oder mit kleinen Ungenauigkeiten
- 0.0 = Grundlegende fachliche Fehler oder keine relevanten Inhalte

Struktur (20%):
- 1.0 = Logischer Aufbau: These → Begründung → Beispiel → Fazit
- 0.5 = Erkennbare Struktur, aber Sprünge oder fehlende Übergänge
- 0.0 = Unstrukturiert, zusammenhanglos

Begriffssicherheit (25%):
- 1.0 = Alle Fachbegriffe von ${professionName} korrekt und sicher verwendet
- 0.5 = Fachbegriffe teilweise korrekt, aber unsicher oder unvollständig
- 0.0 = Falsche Fachbegriffe oder Alltagssprache statt Fachsprache

Praxisbezug (20%):
- 1.0 = Konkrete Beispiele aus dem Arbeitsalltag von ${professionName}, mit Details
- 0.5 = Allgemeine Beispiele ohne spezifischen Bezug zu ${professionName}
- 0.0 = Kein Praxisbezug, rein theoretisch

MUSTERANTWORT-LIMIT: Max 180–220 Wörter (2–3 Minuten Redezeit).`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// v2 MODULES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Adaptive Depth Engine ────────────────────────────────────────────────

export type DifficultyLevel = "basic" | "intermediate" | "advanced";

export interface AdaptiveDepthRequirements {
  minExamples: number;
  minMistakes: number;
  requiresCalculation: boolean;
  requiresComparison: boolean;
  requiresEdgeCase: boolean;
  minWords: number;
  promptSuffix: string;
}

export function getRequiredDepth(difficulty: DifficultyLevel): AdaptiveDepthRequirements {
  switch (difficulty) {
    case "basic":
      return {
        minExamples: 1,
        minMistakes: 1,
        requiresCalculation: false,
        requiresComparison: false,
        requiresEdgeCase: false,
        minWords: 250,
        promptSuffix: `TIEFE-STUFE: GRUNDLAGEN
- 1 Praxisbeispiel aus dem Berufsalltag
- 1 typische Prüfungsfalle
- Klare Definitionen, einfache Sprache (B1-Niveau)`,
      };
    case "intermediate":
      return {
        minExamples: 1,
        minMistakes: 2,
        requiresCalculation: true,
        requiresComparison: true,
        requiresEdgeCase: false,
        minWords: 350,
        promptSuffix: `TIEFE-STUFE: ANWENDUNG + ABGRENZUNG
- 1 Praxisbeispiel mit konkreten Zahlen
- 2 typische Prüfungsfallen (verschiedene Fehlertypen)
- 1 Zahlenbeispiel mit vollständigem Rechenweg
- 1 Abgrenzungstabelle (ähnliche Begriffe/Verfahren gegenübergestellt)`,
      };
    case "advanced":
      return {
        minExamples: 2,
        minMistakes: 2,
        requiresCalculation: true,
        requiresComparison: true,
        requiresEdgeCase: true,
        minWords: 450,
        promptSuffix: `TIEFE-STUFE: GRENZFÄLLE + TRANSFER
- 2 Praxisfälle mit steigender Komplexität
- 1 Zahlenbeispiel mit mehrstufiger Berechnung
- 1 Grenzfall / Sonderfall ("Was passiert wenn...?")
- 1 Abgrenzungstabelle mit mindestens 4 Zeilen
- Typische Fehlinterpretationen und deren Konsequenzen
- Praxisvarianten: "Im Großunternehmen vs. im Handwerksbetrieb"`,
      };
  }
}

/**
 * Map a difficulty_tier or cognitive_level string to our AdaptiveDepthLevel.
 * Accepts various formats from the DB (easy/medium/hard, K1-K4, remember/apply/analyze).
 */
export function mapToDifficultyLevel(raw: string | null | undefined): DifficultyLevel {
  if (!raw) return "intermediate";
  const norm = raw.toLowerCase().trim();
  if (["easy", "basic", "k1", "remember", "einfach", "leicht"].includes(norm)) return "basic";
  if (["hard", "advanced", "k4", "k3", "analyze", "evaluate", "create", "schwer", "sehr_schwer", "very_hard"].includes(norm)) return "advanced";
  return "intermediate";
}

// ─── Pre-LLM Depth Metrics ──────────────────────────────────────────────────

export interface DepthMetrics {
  wordCount: number;
  hasTipp: boolean;
  hasFalle: boolean;
  hasTable: boolean;
  hasCalcExample: boolean;
  hasPraxisBeispiel: boolean;
  starCount: number;
  warningCount: number;
  exampleCount: number;
  edgeCaseCount: number;
}

export function measureDepth(html: string): DepthMetrics {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    hasTipp: /⭐|IHK-Prüfungstipp|Prüfungstipp/i.test(html),
    hasFalle: /⚠️|Prüfungsfalle|Typische Falle/i.test(html),
    hasTable: /<table/i.test(html),
    hasCalcExample: /\d+[\s]*[×x*÷\/+\-=]\s*\d+|Formel|Rechenweg|Berechnung/i.test(html),
    hasPraxisBeispiel: /Beispiel|Praxisfall|Fallbeispiel|Szenario/i.test(html),
    starCount: (html.match(/⭐/g) || []).length,
    warningCount: (html.match(/⚠️/g) || []).length,
    exampleCount: (html.match(/Beispiel|Praxisfall|Fallbeispiel|Szenario/gi) || []).length,
    edgeCaseCount: (html.match(/Grenzfall|Sonderfall|Ausnahme|Was passiert wenn|Was wäre wenn/gi) || []).length,
  };
}

/**
 * Check if depth metrics meet minimum requirements for a given step.
 * v2: now accepts optional difficulty for adaptive thresholds.
 */
export function depthMeetsMinimum(
  metrics: DepthMetrics,
  step: string,
  difficulty?: DifficultyLevel,
): { passes: boolean; missing: string[] } {
  const missing: string[] = [];
  const req = difficulty ? getRequiredDepth(difficulty) : null;

  const minWords: Record<string, number> = {
    einstieg: 250, verstehen: 400, anwenden: 350, wiederholen: 300,
  };
  const effectiveMinWords = req ? Math.max(req.minWords, minWords[step] || 200) : (minWords[step] || 200);

  if (metrics.wordCount < effectiveMinWords) {
    missing.push(`Zu wenig Wörter: ${metrics.wordCount} (min ${effectiveMinWords})`);
  }
  if (!metrics.hasTipp) missing.push("Kein ⭐ IHK-Prüfungstipp gefunden");
  if (!metrics.hasFalle) missing.push("Keine ⚠️ Prüfungsfalle gefunden");
  if (step === "wiederholen" && !metrics.hasTable) missing.push("Keine Abgrenzungstabelle gefunden");
  if (step === "verstehen" && !metrics.hasCalcExample && !metrics.hasPraxisBeispiel) {
    missing.push("Weder Rechenbeispiel noch Praxisbeispiel gefunden");
  }

  // v2 adaptive checks
  if (req) {
    if (metrics.exampleCount < req.minExamples) {
      missing.push(`Zu wenig Praxisbeispiele: ${metrics.exampleCount} (min ${req.minExamples})`);
    }
    if (metrics.warningCount < req.minMistakes) {
      missing.push(`Zu wenig Prüfungsfallen: ${metrics.warningCount} (min ${req.minMistakes})`);
    }
    if (req.requiresCalculation && !metrics.hasCalcExample) {
      missing.push("Rechenbeispiel fehlt (Pflicht für dieses Difficulty-Level)");
    }
    if (req.requiresComparison && !metrics.hasTable) {
      missing.push("Abgrenzungstabelle fehlt (Pflicht für dieses Difficulty-Level)");
    }
    if (req.requiresEdgeCase && metrics.edgeCaseCount === 0) {
      missing.push("Kein Grenzfall/Sonderfall gefunden (Pflicht für Advanced)");
    }
  }

  return { passes: missing.length === 0, missing };
}

// ─── 2. Hallucination Risk Guard (SSOT Drift Detection) ─────────────────────

export interface HallucinationRiskResult {
  riskScore: number; // 0.0–1.0
  unknownEntities: string[];
  suspiciousRegulatory: string[];
  verdict: "safe" | "review" | "regenerate";
}

/**
 * Heuristic hallucination risk scorer (no LLM call — fast + free).
 * Checks content against known SSOT terms and flags suspicious regulatory references.
 */
export function computeHallucinationRisk(
  content: string,
  ssotTerms: string[],
  knownLaws: string[],
): HallucinationRiskResult {
  const unknownEntities: string[] = [];
  const suspiciousRegulatory: string[] = [];

  // Extract all §-references from content
  const paragraphRefs = content.match(/§\s*\d+[a-z]?(?:\s*(?:Abs\.|Absatz)\s*\d+)?(?:\s*(?:S\.|Satz)\s*\d+)?(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+(?:GB|StG|SchG|VG|BiG|GVO|VO|G)\b)?/g) || [];
  
  // Known law abbreviations that are safe
  const KNOWN_LAWS = new Set([
    "BGB", "HGB", "AO", "UStG", "EStG", "KStG", "GewStG",
    "KSchG", "ArbZG", "BetrVG", "BBiG", "DSGVO", "BDSG",
    "GewO", "SGB", "StGB", "InsO", "GmbHG", "AktG",
    "MuSchG", "JArbSchG", "AGG", "TzBfG", "ArbSchG",
    "ProdHaftG", "UWG", "GWB", "PatG", "MarkenG",
    ...knownLaws,
  ]);

  for (const ref of paragraphRefs) {
    // Extract law name from reference
    const lawMatch = ref.match(/[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+(?:GB|StG|SchG|VG|BiG|GVO|VO|G)\b/);
    if (lawMatch && !KNOWN_LAWS.has(lawMatch[0])) {
      suspiciousRegulatory.push(ref.trim());
    }
  }

  // Check for potentially fictitious institutions
  const institutionPatterns = [
    /(?:Bundesamt|Bundesanstalt|Bundesinstitut|Landesamt)\s+für\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[a-zäöüß]+){0,3}/g,
  ];
  for (const pat of institutionPatterns) {
    const matches = content.match(pat) || [];
    for (const m of matches) {
      const KNOWN_INSTITUTIONS = [
        "Bundesamt für Wirtschaft", "Bundesanstalt für Arbeit", "Bundesanstalt für Finanzdienstleistungsaufsicht",
        "Bundesinstitut für Berufsbildung", "Bundesamt für Justiz",
      ];
      if (!KNOWN_INSTITUTIONS.some(ki => m.includes(ki))) {
        unknownEntities.push(m);
      }
    }
  }

  // Check for specific numbers that look invented (very specific percentages, amounts without context)
  const suspiciousNumbers = content.match(/\b\d{1,2},\d{3,}%|\b\d+\.\d{3,}\s*€/g) || [];
  // Only flag if there's no SSOT context for the number
  if (ssotTerms.length > 0 && suspiciousNumbers.length > 3) {
    unknownEntities.push(`${suspiciousNumbers.length} spezifische Zahlenangaben ohne SSOT-Referenz`);
  }

  // Compute risk score
  const regulatoryRisk = Math.min(suspiciousRegulatory.length * 0.15, 0.6);
  const entityRisk = Math.min(unknownEntities.length * 0.1, 0.4);
  const riskScore = Math.min(regulatoryRisk + entityRisk, 1.0);

  return {
    riskScore: Math.round(riskScore * 100) / 100,
    unknownEntities,
    suspiciousRegulatory,
    verdict: riskScore > 0.5 ? "regenerate" : riskScore > 0.25 ? "review" : "safe",
  };
}

// ─── 3. Didactic Impact Score ────────────────────────────────────────────────

/**
 * LLM prompt fragment for didactic impact evaluation.
 * Used by validate-content to assess exam effectiveness.
 */
export function buildImpactScorePrompt(professionName: string, difficulty: DifficultyLevel): string {
  return `
DIDAKTISCHER IMPACT-SCORE (zusätzliche Bewertungsdimension):

Bewerte auf einer Skala von 0.0 bis 1.0:
"Wie wahrscheinlich ist es, dass ein durchschnittlicher Azubi für ${professionName} dieses Thema 
nach Durcharbeiten dieser Lektion in einer echten IHK-Prüfung sicher anwenden kann?"

Schwierigkeitsstufe des Inhalts: ${difficulty}

BEWERTUNGSKRITERIEN:
- Klarheit (0.25): Ist die Erklärung verständlich ohne Vorwissen jenseits des Curriculums?
- Praxisnähe (0.25): Sind die Beispiele aus dem echten Berufsalltag von ${professionName}?
- Transferfähigkeit (0.25): Kann der Azubi das Gelernte auf neue Situationen übertragen?
- Kognitive Aktivierung (0.25): Wird der Azubi zum Mitdenken/Entscheiden gezwungen (nicht nur Lesen)?

SCHWELLENWERTE:
- >= 0.9 → exzellent (Elite-Niveau)
- 0.75–0.89 → prüfungstauglich (Standard)
- 0.6–0.74 → mittelmäßig (Verbesserung nötig)
- < 0.6 → unzureichend → REGENERIEREN

Gib das Ergebnis als Teil deines JSON zurück:
"didactic_impact": { "score": 0.0-1.0, "klarheit": 0.0-1.0, "praxisnaehe": 0.0-1.0, "transferfaehigkeit": 0.0-1.0, "kognitive_aktivierung": 0.0-1.0, "weak_areas": ["..."], "suggested_improvements": ["..."] }`;
}

// ─── 4. Anti-Formelhaftigkeit Score (Variation Analysis) ─────────────────────

export interface VariationResult {
  score: number; // 0.0–1.0 (higher = more varied)
  repetitiveOpeners: string[];
  duplicatePatterns: string[];
  verdict: "ok" | "rewrite_needed";
}

/**
 * Heuristic variation scorer — detects repetitive patterns in generated content.
 * No LLM call needed.
 */
export function computeVariationScore(html: string): VariationResult {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);

  if (sentences.length < 3) {
    return { score: 1.0, repetitiveOpeners: [], duplicatePatterns: [], verdict: "ok" };
  }

  // Check sentence openers (first 3 words)
  const openers = sentences.map(s => s.split(/\s+/).slice(0, 3).join(" ").toLowerCase());
  const openerCounts = new Map<string, number>();
  for (const o of openers) {
    openerCounts.set(o, (openerCounts.get(o) || 0) + 1);
  }
  const repetitiveOpeners = [...openerCounts.entries()]
    .filter(([_, count]) => count >= 3)
    .map(([opener, count]) => `"${opener}" (${count}×)`);

  // Check for duplicate structural patterns (e.g., repeated bullet point templates)
  const structures = sentences.map(s => {
    return s.replace(/\d+/g, "N")
            .replace(/"[^"]+"/g, "STR")
            .replace(/[A-ZÄÖÜ][a-zäöüß]+/g, "W")
            .slice(0, 40);
  });
  const structCounts = new Map<string, number>();
  for (const s of structures) {
    structCounts.set(s, (structCounts.get(s) || 0) + 1);
  }
  const duplicatePatterns = [...structCounts.entries()]
    .filter(([_, count]) => count >= 4)
    .map(([pattern, count]) => `Pattern wiederholt ${count}×`);

  // Calculate score
  const uniqueOpeners = openerCounts.size;
  const openerVariety = Math.min(uniqueOpeners / Math.max(sentences.length * 0.6, 1), 1.0);
  const patternPenalty = Math.min(duplicatePatterns.length * 0.15, 0.4);
  const repetitivePenalty = Math.min(repetitiveOpeners.length * 0.1, 0.3);

  const score = Math.max(0, Math.min(1.0, openerVariety - patternPenalty - repetitivePenalty));

  return {
    score: Math.round(score * 100) / 100,
    repetitiveOpeners,
    duplicatePatterns,
    verdict: score < 0.4 ? "rewrite_needed" : "ok",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// v3 MODULES — Mastery-Feedback-Loop
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 5. Mastery Feedback Injection ──────────────────────────────────────────

export interface MasteryContext {
  failRate: number;
  avgScore: number;
  commonErrors: string[];
  fragilityLevel: "stable" | "fragile" | "critical";
  regenerationCount: number;
}

/**
 * Builds a prompt suffix that injects real user performance data
 * into content generation prompts. This creates a self-learning loop:
 * areas where learners struggle get automatically deeper content.
 */
export function buildMasteryFeedbackSuffix(ctx: MasteryContext | null): string {
  if (!ctx || ctx.fragilityLevel === "stable") return "";

  const lines: string[] = ["\n═══ MASTERY-FEEDBACK (echte Lernerdaten) ═══"];

  if (ctx.fragilityLevel === "critical") {
    lines.push(`⚠️ KRITISCHE KOMPETENZ: Fehlerrate ${(ctx.failRate * 100).toFixed(0)}%, Ø Score ${ctx.avgScore.toFixed(0)}%`);
    lines.push("VERSTÄRKE PFLICHT:");
    lines.push("- Mehr Schritt-für-Schritt-Erklärungen (jeden Denkschritt einzeln)");
    lines.push("- Zusätzliche Rechenweg-Darstellungen mit Zwischenschritten");
    lines.push("- Explizite Erklärung der häufigsten Fehler (siehe unten)");
    lines.push("- 2 zusätzliche Praxisbeispiele mit steigender Komplexität");
    lines.push("- Abgrenzungstabelle für häufig verwechselte Konzepte");
  } else if (ctx.fragilityLevel === "fragile") {
    lines.push(`📊 FRAGILE KOMPETENZ: Fehlerrate ${(ctx.failRate * 100).toFixed(0)}%, Ø Score ${ctx.avgScore.toFixed(0)}%`);
    lines.push("VERSTÄRKE:");
    lines.push("- 1 zusätzliches Praxisbeispiel");
    lines.push("- Häufige Norm-Verwechslungen adressieren");
    lines.push("- Rechenweg mit häufigstem Fehler als Gegenbeispiel");
  }

  if (ctx.commonErrors.length > 0) {
    lines.push(`\nHÄUFIGSTE FEHLERTYPEN der Lernenden:`);
    for (const err of ctx.commonErrors.slice(0, 5)) {
      lines.push(`  • ${err}`);
    }
    lines.push("Adressiere diese Fehler DIREKT mit Gegenbeispielen und Merksätzen.");
  }

  return lines.join("\n");
}

/**
 * Adjusts the adaptive depth level based on mastery performance data.
 * If learners struggle with a competency, we treat it as higher difficulty.
 */
export function adjustDifficultyByMastery(
  baseDifficulty: DifficultyLevel,
  mastery: MasteryContext | null,
): DifficultyLevel {
  if (!mastery) return baseDifficulty;
  if (mastery.fragilityLevel === "critical" && baseDifficulty !== "advanced") {
    return "advanced";
  }
  if (mastery.fragilityLevel === "fragile" && baseDifficulty === "basic") {
    return "intermediate";
  }
  return baseDifficulty;
}

// ─── 6. Performance Aggregation Helper ──────────────────────────────────────

/**
 * Loads mastery context for a given curriculum + learning field from DB.
 * Used by generators to inject feedback into prompts.
 */
export async function loadMasteryContext(
  sb: any,
  curriculumId: string,
  learningFieldId?: string | null,
): Promise<MasteryContext | null> {
  const query = sb.from("competency_performance_stats")
    .select("fail_rate, avg_score, common_error_patterns, fragility_level, regeneration_count")
    .eq("curriculum_id", curriculumId);

  if (learningFieldId) {
    query.eq("learning_field_id", learningFieldId);
  }

  query.in("fragility_level", ["fragile", "critical"])
    .order("fail_rate", { ascending: false })
    .limit(5);

  const { data } = await query;
  if (!data || data.length === 0) return null;

  // Aggregate across matching rows
  const totalAttempts = data.length;
  const avgFailRate = data.reduce((a: number, r: any) => a + (r.fail_rate || 0), 0) / totalAttempts;
  const avgScore = data.reduce((a: number, r: any) => a + (r.avg_score || 0), 0) / totalAttempts;
  const allErrors: string[] = data.flatMap((r: any) => (r.common_error_patterns || []));
  const worstLevel = data.some((r: any) => r.fragility_level === "critical") ? "critical" : "fragile";
  const totalRegens = data.reduce((a: number, r: any) => a + (r.regeneration_count || 0), 0);

  return {
    failRate: avgFailRate,
    avgScore: avgScore,
    commonErrors: [...new Set(allErrors)].slice(0, 8),
    fragilityLevel: worstLevel,
    regenerationCount: totalRegens,
  };
}

// ─── Combined v2/v3 Quality Gate ─────────────────────────────────────────────

export interface V2QualityResult {
  depthPasses: boolean;
  depthMissing: string[];
  hallucinationRisk: HallucinationRiskResult;
  variationScore: VariationResult;
  overallVerdict: "pass" | "warn" | "fail";
}

/**
 * Run all v2/v3 quality checks in one call (no LLM — pure heuristics).
 * Impact score requires LLM and is handled separately in validate-content.
 */
export function runV2QualityGate(
  html: string,
  step: string,
  difficulty: DifficultyLevel,
  ssotTerms: string[] = [],
  knownLaws: string[] = [],
): V2QualityResult {
  const metrics = measureDepth(html);
  const depth = depthMeetsMinimum(metrics, step, difficulty);
  const hallucination = computeHallucinationRisk(html, ssotTerms, knownLaws);
  const variation = computeVariationScore(html);

  let overallVerdict: "pass" | "warn" | "fail" = "pass";
  if (hallucination.verdict === "regenerate" || !depth.passes) {
    overallVerdict = "fail";
  } else if (hallucination.verdict === "review" || variation.verdict === "rewrite_needed") {
    overallVerdict = "warn";
  }

  return {
    depthPasses: depth.passes,
    depthMissing: depth.missing,
    hallucinationRisk: hallucination,
    variationScore: variation,
    overallVerdict,
  };
}
