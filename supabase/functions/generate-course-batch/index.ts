import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, AITool } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;
type LessonStep = (typeof LESSON_STEPS)[number];

/**
 * Step prompts are now FUNCTIONS that receive professionName for deep profession context.
 * Every step must produce content that feels handcrafted for the specific Berufsbild.
 */
function getStepPrompt(step: string, professionName: string): string {
  const prompts: Record<string, string> = {
    einstieg: `Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt.
PFLICHT: Nutze ein konkretes Praxisszenario aus dem typischen Arbeitsalltag von ${professionName}.
Das Szenario muss eine realistische berufliche Situation beschreiben, die ${professionName} tatsächlich so erleben — mit konkreten Akteuren (Kunden, Vorgesetzte, Kollegen), Zahlen und branchenüblichen Fachbegriffen.
VERBOTEN: Generische Szenarien wie "in einem Unternehmen" oder "ein Mitarbeiter" ohne Berufsbezug.`,

    verstehen: `Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, die direkt auf den Berufsalltag von ${professionName} bezogen sind.
PFLICHT-ELEMENTE:
1. Fachliche Erklärung mit berufsspezifischen Beispielen aus dem Arbeitsalltag von ${professionName}
2. Nach JEDER Erklärung ein Gegenbeispiel, das typische Fehlannahmen von ${professionName} verdeutlicht
3. IHK-Prüfungsbezüge: Markiere prüfungsrelevante Inhalte mit ⭐ und formuliere, wie die IHK dieses Thema typischerweise abfragt
4. Fachbegriffe müssen so erklärt werden, wie sie im Berufsfeld ${professionName} tatsächlich verwendet werden
VERBOTEN: Akademische Definitionen ohne Praxisbezug. Jeder Absatz muss den Bezug zu ${professionName} herstellen.`,

    anwenden: `Erstelle ein Entscheidungsszenario (KEINE reine Beschreibung) aus dem Berufsalltag von ${professionName}.
PFLICHT-ELEMENTE:
1. Konkretes Fallbeispiel: Ein/e ${professionName} steht vor einer beruflichen Entscheidung mit realistischen Zahlen, Namen und Kontexten
2. Mindestens 2 Entscheidungsoptionen mit fachlicher Abwägung der Vor- und Nachteile
3. Typische Prüfungsfallen mit ⚠️ markiert — Fehler, die ${professionName} in der IHK-Prüfung häufig machen
4. Der Lernende muss die Entscheidung treffen UND fachlich begründen
VERBOTEN: Reine Beschreibungen ("So funktioniert X"). Der Lernende muss HANDELN und ENTSCHEIDEN.`,

    wiederholen: `Erstelle KEINE erneute Erklärung. Erstelle stattdessen eine PRÜFUNGSVERDICHTUNG für ${professionName}:
PFLICHT-ELEMENTE:
1. 3-5 kompakte Merksätze mit den Fachbegriffen, wie sie in der IHK-Prüfung für ${professionName} erwartet werden
2. Typische IHK-Prüfungsfallen: 3 häufige Fehler, die ${professionName} in der Prüfung machen, mit Erklärung warum sie falsch sind
3. Abgrenzungstabelle: Vergleich ähnlicher Begriffe/Konzepte, die ${professionName} verwechseln
4. 2 Formulierungsübungen: Sätze in IHK-Prüfungssprache umformulieren (vorher/nachher)
5. Prüfer-Hinweis: Was IHK-Prüfer bei ${professionName} besonders gern nachfragen
VERBOTEN: Erneute Erklärung des Stoffes. NUR Verdichtung und Prüfungsvorbereitung.`,

    mini_check: `Erstelle 4 situative Multiple-Choice-Fragen auf IHK-Prüfungsniveau für ${professionName}.
QUALITÄTSSTANDARD:
1. Mindestens 2 Fragen MÜSSEN ein konkretes Fallbeispiel/Szenario aus dem Berufsalltag von ${professionName} enthalten
2. Distraktoren müssen PLAUSIBEL sein — sie bilden typische Denkfehler von ${professionName} ab, nicht offensichtlichen Unsinn
3. Jede Frage muss berufsspezifisch formuliert sein (nicht generisch übertragbar auf andere Berufe)
4. Erklärungen müssen den KONKRETEN Denkfehler hinter jedem falschen Distraktor benennen
5. Mix: 1x leicht (Grundwissen), 2x mittel (Anwendung), 1x schwer (Transfer/Analyse)
VERBOTEN: Reine Wissensfragen wie "Was ist...?" ohne beruflichen Kontext.`,
  };
  return prompts[step] || prompts.einstieg;
}

const MINI_CHECK_TOOL: AITool = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 5,
          items: {
            type: "object",
            properties: {
              question: { type: "string" }, options: { type: "array", items: { type: "string" } }, correct_answer: { type: "number" }, explanation: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation"]
          }
        },
        objectives: { type: "array", items: { type: "string" } }
      },
      required: ["questions", "objectives"]
    }
  }
};

/**
 * DEPTH ENRICHMENT: Load curriculum_topics for the competency's learning field
 * to inject granular sub-topic context into AI prompts.
 */
async function loadTopicDepth(
  supabase: ReturnType<typeof createClient>,
  competency: { id?: string; learning_field_id?: string },
  curriculumId: string,
): Promise<string> {
  try {
    // Find parent topic matching this learning field
    const { data: parentTopics } = await supabase
      .from("curriculum_topics")
      .select("id, topic_name, difficulty_level")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .limit(200);

    if (!parentTopics?.length) return "";

    // Find subtopics for ALL parent topics (we'll filter relevant ones)
    const parentIds = parentTopics.map((t: any) => t.id);
    const { data: subtopics } = await supabase
      .from("curriculum_topics")
      .select("topic_name, difficulty_level, parent_topic_id")
      .in("parent_topic_id", parentIds)
      .limit(500);

    if (!subtopics?.length) return "";

    // Build depth context string
    const topicMap = new Map<string, string[]>();
    for (const st of subtopics) {
      const parent = parentTopics.find((p: any) => p.id === st.parent_topic_id);
      if (!parent) continue;
      if (!topicMap.has(parent.topic_name)) topicMap.set(parent.topic_name, []);
      topicMap.get(parent.topic_name)!.push(`${st.topic_name} (${st.difficulty_level || "mittel"})`);
    }

    const lines: string[] = ["\n\n--- CURRICULUM-TIEFE (Unterthemen aus dem Rahmenplan) ---"];
    for (const [parent, subs] of topicMap) {
      lines.push(`\n📚 ${parent}:`);
      for (const s of subs.slice(0, 8)) lines.push(`  • ${s}`);
      if (subs.length > 8) lines.push(`  • ... und ${subs.length - 8} weitere`);
    }
    lines.push("\nNutze diese Unterthemen als fachliche Grundlage für tiefgehende, prüfungsrelevante Inhalte.");
    return lines.join("\n");
  } catch (e) {
    console.error("[generate-course-batch] Topic depth load failed:", e);
    return "";
  }
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { courseId, lessonId, step, competency } = await req.json();
    if (!competency || !step) throw new Error("Missing params");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load curriculum ID and profession name from course → curriculum → berufe
    const { data: course } = await supabase.from("courses").select("curriculum_id").eq("id", courseId).single();
    const curriculumId = course?.curriculum_id || "";

    // Load profession from SSOT — HARD GUARD
    const professionResult = await resolveProfession(supabase, {
      certificationId: (course as any)?.certification_id || null,
      curriculumId,
    });
    const professionName = professionResult.professionName;
    const certificationContext = "berufliche Ausbildung";
    console.log(`[generate-course-batch] Profession: "${professionName}" (${professionResult.source})`);

    // ═══ DEPTH ENRICHMENT: Load granular curriculum topics ═══
    const topicDepth = curriculumId
      ? await loadTopicDepth(supabase, competency, curriculumId)
      : "";

    const routed = step === "mini_check" ? getModel("minicheck") : getModel("learning_course");

    const systemPrompt = `Du bist ein erfahrener IHK-Fachexperte für den Beruf "${professionName}". Du erstellst Lerninhalte, die sich anfühlen, als wären sie von einem Fachlehrer mit 20 Jahren Berufserfahrung als ${professionName} geschrieben.

IDENTITÄT: Du denkst, sprichst und erklärst wie jemand, der den Beruf ${professionName} von Grund auf kennt. Deine Beispiele stammen aus echten Arbeitssituationen, deine Fachbegriffe sind die, die ${professionName} täglich verwenden.

QUALITÄTSSTANDARD:
- Jeder Lernschritt MUSS die fachliche Tiefe des offiziellen Rahmenplans für ${professionName} abbilden
- Verwende die konkreten Fachbegriffe und berufsspezifischen Unterthemen aus dem Curriculum
- Praxisbeispiele MÜSSEN aus dem typischen Arbeitsalltag von ${professionName} stammen — mit realistischen Kunden, Produkten, Zahlen und Situationen
- Oberflächliche Erklärungen ohne Fachtiefe und konkreten Berufsbezug zu ${professionName} sind NICHT akzeptabel
- Beziehe dich auf spezifische Unterthemen des Rahmenplans, nicht nur auf das übergeordnete Lernfeld
- Der Inhalt darf NICHT nach KI klingen — keine generischen Floskeln, keine akademische Überfrachtung

REGULATORISCHE TIEFE (bei rechtlichen/regulatorischen Themen):
- IMMER konkrete §§-Referenzen nennen (BGB, HGB, KWG, GwG, MaRisk, DSGVO etc.)
- Exakte Fristen, Schwellenwerte, Meldepflichten
- Aufsichtsbehörden (BaFin, EZB, IHK) und deren Rollen
- Unterscheide klar zwischen MUSS und KANN-Vorschriften

RECHENAUFGABEN-TIEFE (bei quantitativen Themen):
- Mehrstufige Berechnungen bevorzugen (Effektivzins + Disagio + Tilgungsplan, nicht nur einfache Zinsrechnung)
- Realistische nicht-runde Zahlen verwenden (12.450 €, 3,75 %, 47 Tage)
- Vollständige Rechenwege mit Formeln zeigen
- Kombinationsaufgaben: mehrere Konzepte in einer Aufgabe verknüpfen

ANTI-KI-REGELN:
- KEINE Sätze wie "In der heutigen Geschäftswelt..." oder "Es ist wichtig zu verstehen, dass..."
- KEINE generischen Aufzählungen ohne konkreten Bezug zu ${professionName}
- KEINE Wiederholung der Aufgabenstellung in der Antwort
- Schreibe so, wie ein erfahrener Ausbilder im Betrieb einem Azubi etwas erklärt
- Markiere prüfungsrelevante Stellen mit ⭐`;

    const stepPrompt = getStepPrompt(step, professionName);
    const userPrompt = `Erstelle Lerninhalt für den Beruf "${professionName}":
Kompetenz: ${competency.title}
Beschreibung: ${competency.description}
Taxonomie: ${competency.taxonomy_level}
Lernschritt: ${step}

AUFGABE:
${stepPrompt}${topicDepth}`;

    let result;
    if (step === "mini_check") {
      const aiRes = await callAIJSON({
        provider: routed.provider, model: routed.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        tools: [MINI_CHECK_TOOL], tool_choice: { type: "function", function: { name: "create_mini_check" } }
      });
      const args = aiRes.toolCalls?.[0]?.function?.arguments;
      if (!args) throw new Error("No tool args");
      const parsed = JSON.parse(args);
      result = {
        type: "mini_check",
        html: `<h3>Wissensüberprüfung: ${competency.title}</h3><p>Teste dein Wissen mit Multiple-Choice-Fragen.</p>`,
        objectives: parsed.objectives || [`Wissen zu ${competency.title} überprüfen`],
        questions: parsed.questions,
        _depth_enriched: !!topicDepth,
        _profession: professionName,
      };
    } else {
      const aiRes = await callAIJSON({
        provider: routed.provider, model: routed.model,
        messages: [{ role: "system", content: systemPrompt + " Antworte mit JSON: { type: 'text', html: '...', objectives: [], ihk_relevanz: '...' }" }, { role: "user", content: userPrompt }]
      });
      try {
        const jsonMatch = aiRes.content.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] || aiRes.content);
        result._depth_enriched = !!topicDepth;
        result._profession = professionName;
      } catch { throw new Error("Failed to parse AI response"); }
    }

    // Track generation
    const { data: genRec } = await supabase.from("ai_generations").insert({
      entity_type: "lesson", generator_model: routed.model,
      input_context: { competency: competency.title, step, taxonomy: competency.taxonomy_level, courseId, depth_enriched: !!topicDepth, profession: professionName },
      output_content: result, status: "generated", metadata: { provider: routed.provider, competencyCode: competency.code }
    }).select("id").single();

    // Trigger validation with full SSOT context
    try {
      await supabase.functions.invoke("validate-content", {
        body: {
          mode: "lesson",
          content: result,
          generationId: genRec?.id,
          courseId,
          lessonId,
          generatorProvider: routed.provider,
          context: {
            competencyTitle: competency.title,
            taxonomyLevel: competency.taxonomy_level,
            lessonStep: step,
          },
        }
      });
    } catch (e) { console.error("Validation trigger failed:", e); }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("generate-course-batch error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});