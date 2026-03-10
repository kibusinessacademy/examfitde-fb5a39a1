// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { resolveProfessionFromCourse } from "../_shared/profession-resolver.ts";
import { measureDepth } from "../_shared/prompt-kit.ts";
import { canonicalStepKey } from "../_shared/step-keys.ts";

/**
 * AI Lesson Improvement Agent (Council-Compliant, Profession-Aware)
 * 
 * Creates content_versions instead of direct lesson writes.
 * Content goes through Council pipeline before publishing.
 */

const IMPROVE_CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_improved_content",
    description: "Liefere den verbesserten HTML-Inhalt der Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "Verbesserter HTML-Inhalt" },
        objectives: { type: "array", items: { type: "string" } },
        improvements_applied: { type: "array", items: { type: "string" }, description: "Liste der angewandten Verbesserungen" }
      },
      required: ["html", "objectives", "improvements_applied"],
      additionalProperties: false
    }
  }
};

const IMPROVE_MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_improved_minicheck",
    description: "Liefere die verbesserten MiniCheck-Fragen.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 5,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation"],
            additionalProperties: false
          }
        },
        objectives: { type: "array", items: { type: "string" } },
        improvements_applied: { type: "array", items: { type: "string" } }
      },
      required: ["questions", "objectives", "improvements_applied"],
      additionalProperties: false
    }
  }
};

// ── SSOT Step-Key Mapping: German → English DB standard ──
// canonicalStepKey imported from _shared/step-keys.ts (SSOT)

function getImprovementInstructions(professionName: string): Record<string, string> {
  return {
    pruefungsbezug_ergaenzen: `FÜGE am Ende des Inhalts einen klar sichtbaren IHK-Prüfungsbezug-Block für ${professionName} hinzu:
<div class="pruefungsbezug" style="background:#f0f9ff;border-left:4px solid #0369a1;padding:16px;margin-top:24px;border-radius:4px">
<h4>🔍 IHK-Prüfungsbezug für ${professionName}</h4>
<ul>
<li><strong>So fragt die IHK:</strong> [Formuliere eine typische IHK-Prüfungsfrage zum Thema, wie sie ${professionName} gestellt wird]</li>
<li><strong>Häufige Prüfungsfalle:</strong> [Nenne einen typischen Fehler, den ${professionName} in der Prüfung machen]</li>
<li><strong>Prüfer achten auf:</strong> [Was erwarten IHK-Prüfer bei ${professionName} bei der Antwort?]</li>
</ul>
</div>`,

    anwenden_umformulieren: `ERSETZE rein beschreibende Anwenden-Abschnitte durch ENTSCHEIDUNGSBASIERTE Aufgaben für ${professionName}:
- Statt "So funktioniert X" → "Als ${professionName}: Was würdest du tun, wenn...? Warum?"
- Nutze realistische Szenarien aus dem Berufsalltag von ${professionName}
- Füge Abwägungsfragen ein: "Welche Option ist für ${professionName} sinnvoller – und warum?"
- Mindestens 1 Entscheidungsszenario mit 2 Optionen aus dem Arbeitsalltag`,

    betriebsbezug_ergaenzen: `ERGÄNZE mindestens 1 konkreten betrieblichen Bezug für ${professionName}:
- Statt "im Unternehmen" → "In deinem Ausbildungsbetrieb als ${professionName}..."
- Füge ein konkretes Praxisszenario aus dem Alltag von ${professionName} hinzu
- Verwende die Fachbegriffe, die ${professionName} im Betrieb verwenden`,

    gegenbeispiel_ergaenzen: `ERGÄNZE in der Verstehen-Phase mindestens 1 Gegenbeispiel für ${professionName}:
- Nach jeder Definition/Erklärung: "Beispiel im Berufsalltag: ... Gegenbeispiel: ..."
- Das Gegenbeispiel soll eine häufige Fehlannahme von ${professionName} verdeutlichen`,

    minicheck_verbessern: `VERBESSERE die MiniCheck-Fragen auf IHK-Prüfungsniveau für ${professionName}:
1. DISTRAKTOREN: Jeder Distraktor muss einen konkreten Denkfehler von ${professionName} abbilden
2. SITUATIONSAUFGABEN: Mindestens 2 Fragen müssen ein Fallbeispiel aus dem Alltag von ${professionName} enthalten
3. ABWÄGUNGSFRAGE: Mind. 1 Frage mit "Welche Aussage trifft für ${professionName} am EHESTEN zu?"
4. ERKLÄRUNGEN: Erkläre den KONKRETEN Denkfehler hinter jedem falschen Distraktor
5. SCHWIERIGKEIT: Mix aus easy (1), medium (2), hard (1)
6. Keine reinen Wissensfragen – berufsspezifische Entscheidungs- und Analysefragen`,

    wiederholen_verdichten: `ERSETZE reine Wiederholung durch PRÜFUNGSVERDICHTUNG für ${professionName}:
1. Merksätze: 3-5 kompakte Merksätze mit den Fachbegriffen von ${professionName}
2. Typische IHK-Prüfungsfallen für ${professionName}: 3 häufige Fehler mit Erklärung
3. Abgrenzungstabelle: Vergleich ähnlicher Begriffe, die ${professionName} verwechseln
4. Formulierungsübungen: 2 Sätze in IHK-Prüfungssprache für ${professionName} umformulieren
5. KEINE erneute Erklärung des Stoffes – nur Verdichtung`,
  };
}

/**
 * Load profession name from SSOT — HARD GUARD
 */
async function loadProfessionFromCourse(supabase: any, courseId: string): Promise<string> {
  const result = await resolveProfessionFromCourse(supabase, courseId);
  return result.professionName;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const { courseId, auditId, maxLessons = 3 } = body;

    if (!courseId) {
      return new Response(JSON.stringify({ error: "courseId required" }), { status: 400, headers: jsonHeaders });
    }

    // Load profession name
    const professionName = await loadProfessionFromCourse(supabase, courseId);
    const IMPROVEMENT_INSTRUCTIONS = getImprovementInstructions(professionName);

    // Get the latest audit for this course
    let audit;
    if (auditId) {
      const { data } = await supabase.from('course_quality_audits').select('*').eq('id', auditId).single();
      audit = data;
    } else {
      const { data } = await supabase.from('course_quality_audits')
        .select('*').eq('course_id', courseId)
        .order('audited_at', { ascending: false }).limit(1).single();
      audit = data;
    }

    if (!audit) {
      return new Response(JSON.stringify({ error: "No audit found. Run ihk-quality-audit first." }), { status: 404, headers: jsonHeaders });
    }

    const lessonAudits = (audit.lesson_audits || []) as Array<{
      lessonId: string; title: string; step: string; competency: string;
      overall: number; verbesserungspotenzial?: Record<string, boolean>;
    }>;

    const needsWork = lessonAudits
      .filter(la => la.overall < 92 || Object.values(la.verbesserungspotenzial || {}).some(v => v))
      .sort((a, b) => a.overall - b.overall)
      .slice(0, maxLessons);

    if (needsWork.length === 0) {
      return new Response(JSON.stringify({
        improved: 0, message: "✅ Alle auditierten Lessons sind bereits auf sehr-gut-Niveau."
      }), { headers: jsonHeaders });
    }

    console.log(`[Improve] Creating ${needsWork.length} improvement versions for "${professionName}" course ${courseId}`);

    const results: { lessonId: string; title: string; status: string; improvements: string[]; versionId?: string }[] = [];

    for (const la of needsWork) {
      const { data: lesson } = await supabase.from('lessons')
        .select('id, title, step, content, competency_id').eq('id', la.lessonId).single();
      if (!lesson) { results.push({ lessonId: la.lessonId, title: la.title, status: 'not_found', improvements: [] }); continue; }

      const { data: comp } = await supabase.from('competencies')
        .select('code, title, description, taxonomy_level').eq('id', lesson.competency_id).single();

      const content = lesson.content as Record<string, unknown> | null;
      const improvements = la.verbesserungspotenzial || {};
      const neededImprovements = Object.entries(improvements).filter(([, v]) => v).map(([k]) => k);

      if (neededImprovements.length === 0 && la.overall >= 92) {
        results.push({ lessonId: la.lessonId, title: la.title, status: 'skipped', improvements: [] });
        continue;
      }

      const isMC = lesson.step === 'mini_check';
      const currentContent = isMC
        ? JSON.stringify((content?.questions || []), null, 2)
        : (content?.html as string || '');

      const instructions = neededImprovements
        .map(key => IMPROVEMENT_INSTRUCTIONS[key])
        .filter(Boolean)
        .join('\n\n');

      const improved = await improveContent({
        title: lesson.title,
        step: lesson.step,
        competencyCode: comp?.code || '',
        competencyTitle: comp?.title || '',
        taxonomyLevel: comp?.taxonomy_level || 'anwenden',
        currentContent,
        instructions: instructions || `Verbessere die Qualität auf IHK-sehr-gut-Niveau für ${professionName}.`,
        isMiniCheck: isMC,
        professionName,
      });

      if (!improved) {
        results.push({ lessonId: la.lessonId, title: la.title, status: 'ai_failed', improvements: neededImprovements });
        continue;
      }

      const contentJson = isMC
        ? { ...content, questions: improved.questions, objectives: improved.objectives, improved_at: new Date().toISOString(), improvements_applied: improved.improvements_applied }
        : { ...content, html: improved.html, objectives: improved.objectives, improved_at: new Date().toISOString(), improvements_applied: improved.improvements_applied };

      const entityType = isMC ? 'minicheck' : 'lesson_step';
      const stepKey = canonicalStepKey(lesson.step);

      const { data: existingVersions } = await supabase
        .from('content_versions')
        .select('council_round')
        .eq('lesson_id', lesson.id)
        .eq('step_key', stepKey)
        .eq('entity_type', entityType)
        .order('council_round', { ascending: false })
        .limit(1);

      const nextRound = (existingVersions?.[0]?.council_round || 0) + 1;

      const { data: newVersion, error: vErr } = await supabase
        .from('content_versions')
        .insert({
          course_id: courseId,
          lesson_id: lesson.id,
          step_key: stepKey,
          content_json: contentJson,
          created_by_agent: 'improve-lesson',
          status: 'under_review',
          council_round: nextRound,
          entity_type: entityType,
        })
        .select('id')
        .single();

      if (vErr) {
        console.error(`[Improve] Version creation failed:`, vErr);
        results.push({ lessonId: la.lessonId, title: la.title, status: 'version_error', improvements: neededImprovements });
        continue;
      }

      await supabase.from('council_messages').insert({
        content_version_id: newVersion!.id,
        agent_name: 'improve-lesson',
        message_type: 'proposal',
        message_json: {
          source: 'improve-lesson',
          audit_id: audit.id,
          score_before: la.overall,
          improvements_requested: neededImprovements,
          profession: professionName,
        },
      });

      results.push({
        lessonId: la.lessonId,
        title: la.title,
        status: 'version_created',
        improvements: improved.improvements_applied || neededImprovements,
        versionId: newVersion!.id,
      });

      await new Promise(r => setTimeout(r, 1200));
    }

    const versionsCreated = results.filter(r => r.status === 'version_created').length;
    console.log(`[Improve] ✅ ${versionsCreated}/${needsWork.length} improvement versions created for "${professionName}"`);

    return new Response(JSON.stringify({
      courseId,
      auditId: audit.id,
      auditScore: audit.overall_score,
      versionsCreated,
      total: needsWork.length,
      results,
      profession: professionName,
      message: versionsCreated > 0
        ? `✅ ${versionsCreated} Improvement-Versionen für ${professionName} erstellt → warten auf Council-Review.`
        : `⚠️ Keine Verbesserungen möglich. Prüfe AI-Credits.`
    }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[Improve] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } }
    );
  }
});

async function improveContent(ctx: {
  title: string; step: string; competencyCode: string; competencyTitle: string;
  taxonomyLevel: string; currentContent: string; instructions: string; isMiniCheck: boolean;
  professionName: string;
}): Promise<Record<string, unknown> | null> {
  const systemPrompt = `Du bist ein erfahrener IHK-Fachexperte für ${ctx.professionName}, der bestehende Lerninhalte VERBESSERT (nicht neu erstellt).

DEINE EXPERTISE: Du kennst den Berufsalltag von ${ctx.professionName} aus erster Hand und verbesserst Inhalte so, dass sie authentisch und praxisnah für diesen Beruf sind.

WICHTIG:
- Behalte den Kern des bestehenden Inhalts bei
- Ergänze und verbessere gezielt mit Bezug zu ${ctx.professionName}
- Lösche KEINEN korrekten bestehenden Inhalt
- Der verbesserte Inhalt MUSS länger sein als der Originalinhalt (mind. 15% mehr)
- Verwende HTML-Formatierung (<h3>, <strong>, <ul>, <li>, <blockquote>)
- Alle Verbesserungen müssen IHK-Prüfungsniveau für ${ctx.professionName} erreichen
- Beispiele und Szenarien MÜSSEN aus dem Arbeitsalltag von ${ctx.professionName} stammen
- Für wiederholen-Step: Ersetze Erklärpassagen durch Verdichtung; behalte Kernfakten, kürze Wiederholungen`;

  const userPrompt = `VERBESSERE diese Lektion für ${ctx.professionName}:

**Lektion:** ${ctx.title}
**Step:** ${ctx.step}
**Kompetenz:** ${ctx.competencyCode} – ${ctx.competencyTitle}
**Taxonomiestufe:** ${ctx.taxonomyLevel}
**Beruf:** ${ctx.professionName}

**AKTUELLER INHALT:**
${ctx.currentContent.slice(0, 5000)}

**GEFORDERTE VERBESSERUNGEN:**
${ctx.instructions}

Liefere den VOLLSTÄNDIGEN verbesserten Inhalt (nicht nur die Änderungen).`;

  try {
    const tool = ctx.isMiniCheck ? IMPROVE_MINICHECK_TOOL : IMPROVE_CONTENT_TOOL;
    const toolName = ctx.isMiniCheck ? "submit_improved_minicheck" : "submit_improved_content";

    const result = await callAIJSON({
      provider: "openai",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [tool] as any,
      tool_choice: { type: "function", function: { name: toolName } },
      temperature: 0.4,
    });

    const args = result.toolCalls?.[0]?.function?.arguments;
    if (!args) return null;
    const parsed = JSON.parse(args);

    // Post-AI measurement gate: improved content must be longer
    if (!ctx.isMiniCheck && parsed.html) {
      const originalLength = ctx.currentContent.replace(/<[^>]+>/g, " ").trim().length;
      const improvedLength = parsed.html.replace(/<[^>]+>/g, " ").trim().length;
      if (improvedLength < originalLength * 1.15) {
        console.warn(`[Improve] Content not significantly improved: ${improvedLength} vs ${originalLength} chars (need 15% more)`);
      }
      // Depth metrics validation
      const metrics = measureDepth(parsed.html);
      if (!metrics.hasTipp) console.warn(`[Improve] Missing ⭐ IHK-Prüfungstipp in improved content`);
      if (!metrics.hasFalle) console.warn(`[Improve] Missing ⚠️ Prüfungsfalle in improved content`);
    }

    return parsed;
  } catch (e) {
    console.error(`[Improve] Error:`, e);
    return null;
  }
}
