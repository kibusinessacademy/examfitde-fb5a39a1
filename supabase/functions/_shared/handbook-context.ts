/**
 * handbook-context.ts — Context loaders & prompt builder for handbook generation
 * Extracted from package-generate-handbook to reduce bundle size.
 */

type SB = any;

export interface CompetencyContext {
  name: string;
  bloom: string;
  misconceptions: string[];
}

export async function loadFieldCompetencies(
  sb: SB,
  fieldId: string,
): Promise<CompetencyContext[]> {
  try {
    const { data } = await sb
      .from("competencies")
      .select("competency_name, bloom_level, typical_misconceptions")
      .eq("learning_field_id", fieldId)
      .limit(30);
    return (data || []).map((c: any) => ({
      name: c.competency_name || "",
      bloom: c.bloom_level || "understand",
      misconceptions: Array.isArray(c.typical_misconceptions) ? c.typical_misconceptions : [],
    }));
  } catch { return []; }
}

export async function loadFieldTopicDepth(
  sb: SB,
  curriculumId: string,
  fieldTitle: string,
): Promise<string[]> {
  try {
    const { data: parentTopics } = await sb
      .from("curriculum_topics")
      .select("id, topic_name")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .ilike("topic_name", `%${fieldTitle.slice(0, 30)}%`)
      .limit(3);

    let parentIds: string[] = [];
    if (parentTopics?.length) {
      parentIds = parentTopics.map((t: any) => t.id);
    } else {
      const { data: allParents } = await sb
        .from("curriculum_topics")
        .select("id, topic_name")
        .eq("certification_id", curriculumId)
        .is("parent_topic_id", null)
        .limit(50);
      if (!allParents?.length) return [];
      parentIds = allParents.map((p: any) => p.id);
    }

    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level")
      .in("parent_topic_id", parentIds)
      .limit(50);

    return subtopics?.map((s: any) => s.topic_name) || [];
  } catch { return []; }
}

export async function loadExamQuestionSample(
  sb: SB,
  curriculumId: string,
  fieldId: string,
): Promise<string[]> {
  try {
    const { data } = await sb
      .from("exam_questions")
      .select("question_text")
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", fieldId)
      .in("status", ["approved"])
      .limit(5);
    return (data || []).map((q: any) => q.question_text || "").filter(Boolean);
  } catch { return []; }
}

export function buildElitePrompt(
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  competencies: CompetencyContext[],
  sampleQuestions: string[],
  wordTarget: number,
): string {
  const minWords = Math.round(wordTarget * 0.9);
  
  const topicContext = subtopics.length > 0
    ? `\n**Kernthemen aus dem Rahmenplan:**\n${subtopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const compContext = competencies.length > 0
    ? `\n**Kompetenzen (mit Bloom-Niveau):**\n${competencies.slice(0, 15).map(c => 
        `- ${c.name} [${c.bloom}]${c.misconceptions.length > 0 ? ` — Typische Fehler: ${c.misconceptions.slice(0, 2).join("; ")}` : ""}`
      ).join("\n")}`
    : "";

  const questionContext = sampleQuestions.length > 0
    ? `\n**Beispiel-Prüfungsfragen aus dem Pool (zum Einbetten als Übungsaufgaben):**\n${sampleQuestions.slice(0, 3).map((q, i) => `${i + 1}. ${q.slice(0, 200)}`).join("\n")}`
    : "";

  return `Du bist ein erfahrener IHK-Prüfungscoach und Fachexperte für "${professionName}".
Erstelle einen UMFASSENDEN, TIEFGEHENDEN Handbuch-Abschnitt für das Lernfeld "${fieldCode}: ${fieldTitle}".

${fieldDescription ? `**Lernfeld-Beschreibung:** ${fieldDescription}` : ""}
${topicContext}
${compContext}
${questionContext}

## QUALITÄTSANFORDERUNGEN (ELITE-STANDARD):

### 1. UMFANG & TIEFE
- Mindestumfang: **${minWords} Wörter** — schreibe AUSFÜHRLICH, nicht stichwortartig!
- Jedes Unterthema braucht 3–5 Absätze mit konkreten Erklärungen
- Verwende Fachbegriffe UND erkläre sie verständlich
- KEINE Platzhalter, KEINE "wird ergänzt", KEINE leeren Abschnitte

### 2. PFLICHT-STRUKTUR (alle Abschnitte MÜSSEN vorhanden sein):

#### 📚 Fachliche Grundlagen
- Systematische Erklärung aller Kernthemen des Lernfelds
- Definitionen mit Kontext (nicht nur Lexikon-Einträge)
- Zusammenhänge zwischen den Themen aufzeigen
- Rechtliche Grundlagen und Vorschriften (Paragraphen, Verordnungen)

#### 🔢 Formeln, Berechnungen & Methoden
- Alle relevanten Formeln mit AUSFÜHRLICHER Herleitung
- Mindestens 2 durchgerechnete Beispiele pro Formel
- Schritt-für-Schritt-Rechenweg zeigen
- Einheiten und typische Wertebereiche nennen

#### 🎯 Prüfungsstrategische Analyse
- "So denkt der IHK-Prüfer" — was wird erwartet?
- Welche Formulierungen bringen Punkte? Welche kosten Punkte?
- Typische Aufgabenformate in der schriftlichen Prüfung
- Zeitmanagement-Tipps für dieses Themengebiet

#### ⚠️ Prüfungsfallen & Typische Fehler (mindestens 5)
Für JEDE Falle detailliert:
| Falle | Warum passiert das? | Korrekte Antwort |
Format: Tabelle oder ausführliche Aufzählung mit konkreten Zahlen/Paragraphen

#### 📋 Merkschemata & Checklisten
- Mindestens 2 Merkregeln/Eselsbrücken
- Checklisten für typische Aufgabentypen (Schritt 1 → Schritt 2 → ...)
- Vergleichstabellen bei ähnlichen Konzepten
- "Wenn X, dann Y" — Entscheidungsbäume

#### 📝 Musteraufgaben mit Musterlösung (mindestens 2)
- 1× Berechnungsaufgabe (falls quantitatives Thema)
- 1× Fallstudie / Situationsaufgabe
- Jeweils: vollständiger Lösungsweg + Bewertungshinweise + häufige Fehler

#### 🔄 Transfer & Vertiefung
- "Was ändert sich, wenn...?" — 2–3 Variationsaufgaben
- Verbindungen zu anderen Lernfeldern
- Praxisbezug: Wie begegnet man diesem Thema im Berufsalltag?

#### 💡 Zusammenfassung & Schnell-Wiederholung
- Die 10 wichtigsten Fakten als nummerierte Liste
- "Das MUSS sitzen" — absolute Kernpunkte für die Prüfung

### 3. FORMATIERUNG
- Markdown mit ## und ### Überschriften
- Tabellen für Vergleiche und Übersichten
- Aufzählungen mit Spiegelstrichen für Strukturierung
- **Fettdruck** für Schlüsselbegriffe
- Formeln klar abgesetzt

Antworte NUR mit dem Markdown-Inhalt. Keine Meta-Kommentare.`;
}