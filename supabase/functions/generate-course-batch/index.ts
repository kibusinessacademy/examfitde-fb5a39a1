// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, AITool } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfession, ensureProfessionProfile } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { DEPTH_SELF_CHECK, REGULATORY_GUARD, ANTI_KI_RULES } from "../_shared/prompt-kit.ts";
import { validateLessonStep, getVariationSeed, type DbProfessionProfile } from "../_shared/content-validators.ts";

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;
type LessonStep = (typeof LESSON_STEPS)[number];

/**
 * Step prompts are now FUNCTIONS that receive professionName for deep profession context.
 * Every step must produce content that feels handcrafted for the specific Berufsbild.
 */
function getStepPrompt(step: string, professionName: string): string {
  const prompts: Record<string, string> = {
    einstieg: `Aktivierende Einstiegsaktivität für ${professionName}.
Praxisszenario (konkrete Zahlen/Rollen/Akteure) → 2-3 Reflexionsfragen (1 Hypothese) → ⭐ Prüfungstipp.
Kein passiver Einstieg, direkt ins Szenario.`,

    verstehen: `Lernmaterial für ${professionName}. Bloom: 30% Reproduktion, 40% Anwendung, 30% Transfer.
Definition + Gegenbeispiel → 1 Fallvignette → 2 Praxisbeispiele (Zahlen!) → ⭐ IHK-Tipp ×2 → ⚠️ 2 Fallen (Denkfehler erklären).
Transferzwang: 1 Aufgabe die 2 Kompetenzen kombiniert. Keine Definitionslisten ohne Kontext.`,

    anwenden: `Entscheidungsszenario für ${professionName} (keine Beschreibung!).
Fallbeispiel (Zahlen/Rollen/Parameter) → 2+ Optionen mit Pro-Contra + Begründungspflicht → ⚠️ Prüfungsfallen.
Jede Aufgabe ≥2 Denkschritte. Azubi muss HANDELN + ENTSCHEIDEN.`,

    wiederholen: `Prüfungsverdichtung mit Retrieval für ${professionName}. KEINE Erklärung!
3 Leitfragen → 3-5 Merksätze → 1 Abgrenzungstabelle → 3 Prüfungsfallen → 2 Formulierungsübungen → Prüfer-Hinweis.`,

    mini_check: `7-8 MC-Fragen (IHK-Niveau) für ${professionName}.
Verteilung: 2 leicht (Bloom 1-2), 3 mittel (Bloom 3), 2-3 anspruchsvoll (Bloom 4-5).
≥3 Szenariofragen, ≥1 Transferfrage, ≥1 Prüfungsfalle. Plausible Distraktoren mit Fehlertyp-Erklärung.`,
  };
  return prompts[step] || prompts.einstieg;
}

const MINI_CHECK_TOOL: AITool = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Erstelle 7-8 situative Multiple-Choice-Fragen auf IHK-Prüfungsniveau mit Schwierigkeitsspreizung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 6, maxItems: 8,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correct_answer: { type: "number" },
              explanation: { type: "string" },
              difficulty: { type: "string", enum: ["leicht", "mittel", "anspruchsvoll"] },
              bloom_level: { type: "string", enum: ["reproduktion", "anwendung", "transfer"] },
              trap_type: { type: "string", description: "Art der Prüfungsfalle, falls vorhanden (z.B. Normverwechslung, Rechenfehler, Prozessfehler)" }
            },
            required: ["question", "options", "correct_answer", "explanation", "difficulty", "bloom_level"]
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

Deno.serve(async (req) => {
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

    // ═══ LOAD OR AUTO-CREATE DB PROFESSION PROFILE ═══
    let dbProfessionProfile: DbProfessionProfile | null = null;
    if (curriculumId) {
      const { data: curriculum } = await supabase.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
      if (curriculum?.beruf_id) {
        const profile = await ensureProfessionProfile(supabase, curriculum.beruf_id, { professionName });
        if (profile) {
          dbProfessionProfile = profile as DbProfessionProfile;
          console.log(`[generate-course-batch] DB profession profile ready for beruf_id=${curriculum.beruf_id}`);
        }
      }
    }

    // ═══ DEPTH ENRICHMENT: Load granular curriculum topics ═══
    const topicDepth = curriculumId
      ? await loadTopicDepth(supabase, competency, curriculumId)
      : "";

    const routed = step === "mini_check" ? getModel("minicheck") : getModel("learning_course");

    const systemPrompt = `Du agierst als IHK-Prüfer, Ausbildungsleiter und Fachdidaktiker für den Beruf "${professionName}".
Ziel ist MAXIMALE PRÜFUNGSREIFE gemäß Ausbildungsrahmenplan — nicht reine Wissensvermittlung.
Inhalte müssen prüfungsnah, transferorientiert und fehleranalytisch aufgebaut sein.

IDENTITÄT: Du denkst, sprichst und erklärst wie jemand, der den Beruf ${professionName} von Grund auf kennt UND gleichzeitig IHK-Prüfungen konzipiert. Deine Beispiele stammen aus echten Arbeitssituationen, deine Fachbegriffe sind die, die ${professionName} täglich verwenden.

QUALITÄTSSTANDARD (9.5/10 — Elite-Niveau):
- Jeder Lernschritt MUSS die fachliche Tiefe des offiziellen Rahmenplans für ${professionName} abbilden
- Verwende die konkreten Fachbegriffe und berufsspezifischen Unterthemen aus dem Curriculum
- Praxisbeispiele MÜSSEN aus dem typischen Arbeitsalltag von ${professionName} stammen — mit realistischen Kunden, Produkten, Zahlen und Situationen
- Oberflächliche Erklärungen ohne Fachtiefe und konkreten Berufsbezug zu ${professionName} sind NICHT akzeptabel
- Beziehe dich auf spezifische Unterthemen des Rahmenplans, nicht nur auf das übergeordnete Lernfeld

KOGNITIVE TIEFE (PFLICHT für jede Lesson):
- Bloom-Verteilung: 30% Reproduktion, 40% Anwendung, 30% Analyse/Transfer
- Mindestens 40% der Anwendungs- und Transferaufgaben in realistischen betrieblichen Szenarien
- Jede Lesson muss mindestens 1 mehrstufige Fallvignette enthalten
- Jede Lesson muss mindestens 1 Entscheidungssituation mit Begründungspflicht enthalten
- Identifiziere mindestens 2 typische Prüfungsfehler und integriere sie in Distraktoren, Szenarien oder Transferfragen
- Erkläre im Feedback, WARUM der typische Denkfehler entsteht

REGULATORISCHE TIEFE (bei rechtlichen/regulatorischen Themen):
- Nenne §§, Fristen und Normen NUR, wenn sie dir aus dem SSOT-Kontext oder allgemeinem Fachwissen sicher bekannt sind
- Bei Unsicherheit: "Die genaue Rechtsgrundlage ist im Betrieb/IHK-Merkblatt nachzuprüfen"
- NIEMALS §§ halluzinieren

RECHENAUFGABEN-TIEFE (bei quantitativen Themen):
- Mehrstufige Berechnungen bevorzugen
- Realistische nicht-runde Zahlen verwenden (12.450 €, 3,75 %, 47 Tage)
- Vollständige Rechenwege mit Formeln zeigen
- Kombinationsaufgaben: mehrere Konzepte in einer Aufgabe verknüpfen

${ANTI_KI_RULES}

NEGATIV-CONSTRAINTS (VERBOTEN):
- Reine Definitionslisten ohne Kontextualisierung
- Aufzählungsdidaktik ohne Szenario-Einbettung
- Wiederholung ohne Retrieval-Mechanik (passives "Zusammenfassung lesen")
- Generische Beispiele ohne konkreten Berufsbezug zu ${professionName}
- Isolierte Wissensfragen ohne Situationsrahmen
- Mehr als 30 Wörter pro Satz
- KI-Floskeln ("In der heutigen Geschäftswelt...", "Es ist wichtig zu verstehen, dass...")

- Markiere prüfungsrelevante Stellen mit ⭐

INTERNE SELBSTPRÜFUNG (vor Ausgabe intern prüfen — nicht ausgeben):
☐ Sind mind. 30% Transfer/Analyse enthalten?
☐ Ist mindestens 1 Prüfungsfalle integriert?
☐ Enthält die Lesson eine mehrstufige Fallvignette?
☐ Ist die Wiederholungsphase retrieval-basiert (aktiv, nicht passiv)?
☐ Enthält mind. 1 ⭐ IHK-Prüfungstipp?
☐ Enthält mind. 1 ⚠️ Typische Prüfungsfalle mit Erklärung?
☐ Enthält mind. 1 echtes Zahlenbeispiel mit realistischen, nicht-runden Zahlen?
☐ Sind Distraktoren plausibel (typische Denkfehler, nicht offensichtlicher Unsinn)?
☐ Kein Satz über 30 Wörter?
Falls eine Pflicht fehlt: Ergänze intern vor der Ausgabe.`;

    // ═══ VARIATION SEED: Prevent template leakage / prompt drift ═══
    const variationSeed = getVariationSeed(competency.code || competency.title, step, professionName, dbProfessionProfile);

    const stepPrompt = getStepPrompt(step, professionName);
    const userPrompt = `Erstelle Lerninhalt für den Beruf "${professionName}":
Kompetenz: ${competency.title}
Beschreibung: ${competency.description}
Taxonomie: ${competency.taxonomy_level}
Lernschritt: ${step}

AUFGABE:
${stepPrompt}${topicDepth}
${variationSeed.promptSuffix}`;

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

    // ═══ STRUCTURAL HARD VALIDATION (pre-LLM gate) ═══
    const structuralCheck = validateLessonStep(step, result);
    if (!structuralCheck.passes) {
      console.warn(`[generate-course-batch] STRUCTURAL FAIL for step="${step}":`, structuralCheck.failures.map(f => f.message));
      // Attach validation metadata but don't block — let validate-content handle regeneration
      result._structural_validation = {
        passed: false,
        failures: structuralCheck.failures,
        metrics: structuralCheck.metrics,
      };
    } else {
      result._structural_validation = { passed: true, metrics: structuralCheck.metrics };
    }

    // Track generation
    const { data: genRec } = await supabase.from("ai_generations").insert({
      entity_type: "lesson", generator_model: routed.model,
      input_context: { competency: competency.title, step, taxonomy: competency.taxonomy_level, courseId, depth_enriched: !!topicDepth, profession: professionName, structural_passed: structuralCheck.passes },
      output_content: result, status: structuralCheck.passes ? "generated" : "structural_fail", metadata: { provider: routed.provider, competencyCode: competency.code, structural_failures: structuralCheck.failures }
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