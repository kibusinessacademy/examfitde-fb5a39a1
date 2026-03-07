import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { canonicalStepKey } from "../_shared/step-keys.ts";

const STEP_PROMPTS: Record<string, string> = {
  einstieg: `Erstelle eine **aktivierende Einstiegsaktivität** (ca. 1000–1500 Zeichen HTML).
Struktur:
- <h3>Motivierender Titel</h3>
- Konkretes Praxisszenario mit realistischen Zahlen, Rollen und Entscheidungsparametern (KEIN generisches "Ein Kunde kommt...")
- 2-3 Reflexionsfragen, davon mind. 1 Hypothesen-Frage ("Was glaubst du, warum...?")
- Bezug zum Vorwissen der Azubis
- Kognitive Aktivierung: Problem muss zum Nachdenken zwingen, nicht nur zum Lesen
VERBOTEN: Passive Einstiege ("Heute lernen wir..."), reine Definitionseinstiege`,

  verstehen: `Erstelle **ausführliches Lernmaterial** (ca. 2000–3000 Zeichen HTML).
Bloom-Verteilung: 30% Reproduktion, 40% Anwendung, 30% Analyse/Transfer
Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition UND Gegenbeispiel (was es NICHT ist)
- Mindestens 1 mehrstufige Fallvignette mit mehreren Variablen
- Mindestens 2 praxisnahe Beispiele mit konkreten Zahlen aus dem Berufsalltag
- Wichtige Fachbegriffe als <strong>
- ⭐ IHK-Prüfungstipp + ⚠️ 2 typische Prüfungsfallen mit Erklärung WARUM der Denkfehler entsteht
- Abgrenzungstabelle bei vergleichbaren Begriffen
VERBOTEN: Reine Definitionslisten, Aufzählungsdidaktik ohne Kontext`,

  anwenden: `Erstelle **praktische Übungsaufgaben** (ca. 1500–2500 Zeichen HTML).
Struktur:
- <h3>Praxis-Titel</h3>
- Realistische Arbeitssituation als Szenario mit konkreten Zahlen, Rollen und Entscheidungsparametern
- 2-3 konkrete Aufgaben mit steigendem Schwierigkeitsgrad
- Mindestens 1 Entscheidungssituation mit Begründungspflicht
- Mindestens 1 Aufgabe mit Mehrschritt-Denken (mind. 2 Denkschritte)
- ⚠️ Typische Prüfungsfallen markiert
- Bezug zur beruflichen Praxis (IHK-relevant)
VERBOTEN: Generische Szenarien, Aufgaben die mit 1 Faktenkenntnis lösbar sind`,

  wiederholen: `Erstelle **Retrieval-basierte Wiederholungsaktivitäten** (ca. 1200–1800 Zeichen HTML).
KEINE bloße Zusammenfassung — aktives Erinnern erzwingen!
Struktur:
- <h3>Prüfungsverdichtung & aktive Wiederholung</h3>
- 3 strukturierte Leitfragen (Azubi muss selbst antworten bevor Lösung sichtbar)
- Die 5 wichtigsten Punkte als nummerierte Merksätze
- 1 Abgrenzungstabelle (ähnliche Begriffe/Konzepte)
- 1 Verknüpfung zu anderer Kompetenz ("Hängt zusammen mit...")
- 1 typische Verwechslungsgefahr mit Erklärung
- Checkliste: "Ich kann jetzt..."
VERBOTEN: Passive Zusammenfassungen ("Wir haben gelernt..."), Wiederholung ohne Retrieval-Mechanik`,
};

const MINICHECK_TOOL = {
  type: "function" as const,
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
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" },
              difficulty: { type: "string", enum: ["leicht", "mittel", "anspruchsvoll"] },
              bloom_level: { type: "string", enum: ["reproduktion", "anwendung", "transfer"] }
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

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt, mindestens 800 Zeichen" },
        objectives: { type: "array", items: { type: "string" }, description: "2-4 konkrete Lernziele" }
      },
      required: ["html", "objectives"]
    }
  }
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const courseId = body.courseId || null;
    const dryRun = body.dryRun === true;
    const batchSize = Math.min(body.batchSize || 10, 20);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: toFix, error: rpcErr } = await supabase.rpc('get_placeholder_lessons', { p_course_id: courseId, p_limit: batchSize });
    if (rpcErr) throw rpcErr;

    const { data: stats } = await supabase.rpc('get_content_quality_stats');
    const currentStats = stats?.[0] || { total_lessons: 0, valid_lessons: 0, placeholder_count: 0, quality_percent: 0 };

    if (dryRun || !toFix || toFix.length === 0) {
      return new Response(JSON.stringify({
        dryRun, ...currentStats, lessonsToFix: toFix?.length || 0, lessons: toFix || [],
        message: (toFix?.length || 0) === 0 ? `✅ Quality Gate: ${currentStats.quality_percent}%` : `⚠️ ${toFix?.length} Lessons mit Platzhaltern`
      }), { headers: jsonHeaders });
    }

    console.log(`[Repair] Creating ${toFix.length} content versions (Council pipeline)`);
    let versionsCreated = 0, failed = 0;
    const details: any[] = [];

    for (const lesson of toFix) {
      const isMiniCheck = lesson.step === 'mini_check';
      const prompt = isMiniCheck
        ? `Erstelle 7-8 IHK-Prüfungsfragen für:\n${lesson.competency_title}\n${lesson.competency_description}\n\nSchwierigkeitsverteilung: 2 leicht (Reproduktion), 3 mittel (Anwendung), 2-3 anspruchsvoll (Transfer/Analyse).\nMindestens 3 Szenariofragen, 1 Prüfungsfalle, 1 Transferfrage.\nDistraktoren: plausible Denkfehler, nicht offensichtlich falsch. Jeder Distraktor mit Fehlertyp-Erklärung.\nVERBOTEN: Reine "Was ist...?"-Fragen ohne Kontext.`
        : `${STEP_PROMPTS[lesson.step]}\n\nKompetenz: ${lesson.competency_title}\n${lesson.competency_description}\nTaxonomie: ${lesson.competency_taxonomy_level || 'anwenden'}`;

      try {
        const routed = isMiniCheck ? getModel("minicheck") : getModel("repair_content");
        const result = await callAIJSON({
          provider: routed.provider,
          model: routed.model,
          messages: [
            { role: "system", content: `Du agierst als IHK-Prüfer, Ausbildungsleiter und Fachdidaktiker.
Ziel ist MAXIMALE PRÜFUNGSREIFE — nicht reine Wissensvermittlung. Inhalte müssen prüfungsnah, transferorientiert und fehleranalytisch sein.
Bloom-Verteilung: 30% Reproduktion, 40% Anwendung, 30% Transfer.
VERBOTEN: Reine Definitionslisten, Aufzählungsdidaktik ohne Kontext, passive Zusammenfassungen, KI-Floskeln, generische Beispiele.
Nutze IMMER die Funktion.` },
            { role: "user", content: prompt }
          ],
          tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
          tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
          temperature: 0.7,
        });

        const args = result.toolCalls?.[0]?.function?.arguments;
        if (!args) throw new Error("No tool args");
        const content = JSON.parse(args);

        // P0-A: Sanitize double-serialized html before persist
        if (!isMiniCheck && content.html && typeof content.html === "string") {
          const trimmed = content.html.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
            const cleaned = trimmed.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            try { const inner = JSON.parse(cleaned); if (inner.html) { content.html = inner.html; content.objectives = content.objectives || inner.objectives || []; } } catch { /* not JSON */ }
          }
        }

        const finalContent = isMiniCheck
          ? { type: 'mini_check', questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 }
          : { type: 'text', html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 };

        const { data: newVersion, error: vErr } = await supabase.from('content_versions').insert({
          course_id: courseId || lesson.course_id, lesson_id: lesson.id, step_key: canonicalStepKey(lesson.step),
          content_json: finalContent, created_by_agent: 'repair-lessons', status: 'under_review', council_round: 1, entity_type: isMiniCheck ? 'minicheck' : 'lesson_step'
        }).select('id').single();

        if (vErr) throw vErr;
        await supabase.from('council_messages').insert({ content_version_id: newVersion!.id, agent_name: 'repair-lessons', message_type: 'proposal', message_json: { source: 'repair-lessons', reason: 'placeholder_replacement' } });
        versionsCreated++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'version_created', versionId: newVersion!.id });

      } catch (e) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'failed', error: String(e) });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    return new Response(JSON.stringify({ success: true, versionsCreated, failed, details, message: `✅ ${versionsCreated} Content-Versionen erstellt.` }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[Repair] Fatal:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: jsonHeaders });
  }
});
