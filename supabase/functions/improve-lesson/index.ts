import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * AI Lesson Improvement Agent
 * 
 * Targeted improvement of existing lessons based on IHK-Audit feedback.
 * Does NOT regenerate — it IMPROVES existing content (SSOT-safe).
 * 
 * Improvements:
 * 1. pruefungsbezug_ergaenzen – Add IHK exam relevance block
 * 2. anwenden_umformulieren – Make "Anwenden" phase decision-based
 * 3. minicheck_verbessern – Improve MiniCheck quality
 * 4. betriebsbezug_ergaenzen – Add concrete workplace references
 * 5. gegenbeispiel_ergaenzen – Add counter-examples in "Verstehen"
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

const IMPROVEMENT_INSTRUCTIONS: Record<string, string> = {
  pruefungsbezug_ergaenzen: `FÜGE am Ende des Inhalts einen klar sichtbaren IHK-Prüfungsbezug-Block hinzu:
<div class="pruefungsbezug" style="background:#f0f9ff;border-left:4px solid #0369a1;padding:16px;margin-top:24px;border-radius:4px">
<h4>🔍 IHK-Prüfungsbezug</h4>
<ul>
<li><strong>So fragt die IHK:</strong> [Formuliere eine typische IHK-Prüfungsfrage zum Thema]</li>
<li><strong>Häufige Prüfungsfalle:</strong> [Nenne einen typischen Fehler, den Prüflinge machen]</li>
<li><strong>Prüfer achten auf:</strong> [Was erwarten IHK-Prüfer bei der Antwort?]</li>
</ul>
</div>`,

  anwenden_umformulieren: `ERSETZE rein beschreibende Anwenden-Abschnitte durch ENTSCHEIDUNGSBASIERTE Aufgaben:
- Statt "So funktioniert X" → "Was würdest du tun, wenn...? Warum?"
- Füge Abwägungsfragen ein: "Welche Option ist sinnvoller – und warum?"
- Mindestens 1 Entscheidungsszenario mit 2 Optionen`,

  betriebsbezug_ergaenzen: `ERGÄNZE mindestens 1 konkreten betrieblichen Bezug:
- Statt "im Unternehmen" → "In deinem Ausbildungsbetrieb..."
- Füge ein konkretes Praxisszenario hinzu
- Verwende IHK-konforme Fachterminologie (kein Marketing-Deutsch)`,

  gegenbeispiel_ergaenzen: `ERGÄNZE in der Verstehen-Phase mindestens 1 Gegenbeispiel:
- Nach jeder Definition/Erklärung: "Beispiel: ... Gegenbeispiel: ..."
- Das Gegenbeispiel soll eine häufige Fehlannahme verdeutlichen`,

  minicheck_verbessern: `VERBESSERE die MiniCheck-Fragen:
1. Mache Distraktoren PLAUSIBEL (nicht offensichtlich falsch)
2. Füge mind. 1 Abwägungsfrage hinzu: "Welche Aussage trifft am ehesten zu?"
3. Erklärungen MÜSSEN begründen warum die falschen Optionen falsch sind
4. Keine reinen Wissensfragen – mehr Denkfragen`,
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const body = await req.json().catch(() => ({}));
    const { courseId, auditId, maxLessons = 3 } = body;

    if (!courseId) {
      return new Response(JSON.stringify({ error: "courseId required" }), { status: 400, headers: jsonHeaders });
    }

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

    // Find lessons needing improvement (score < 92 or with improvement flags)
    const needsWork = lessonAudits
      .filter(la => la.overall < 92 || Object.values(la.verbesserungspotenzial || {}).some(v => v))
      .sort((a, b) => a.overall - b.overall)
      .slice(0, maxLessons);

    if (needsWork.length === 0) {
      return new Response(JSON.stringify({
        improved: 0, message: "✅ Alle auditierten Lessons sind bereits auf sehr-gut-Niveau."
      }), { headers: jsonHeaders });
    }

    console.log(`[Improve] Improving ${needsWork.length} lessons for course ${courseId}`);

    const results: { lessonId: string; title: string; status: string; improvements: string[] }[] = [];

    for (const la of needsWork) {
      // Get current lesson content
      const { data: lesson } = await supabase.from('lessons')
        .select('id, title, step, content, competency_id').eq('id', la.lessonId).single();
      if (!lesson) { results.push({ lessonId: la.lessonId, title: la.title, status: 'not_found', improvements: [] }); continue; }

      // Get competency
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

      // Build improvement instructions
      const instructions = neededImprovements
        .map(key => IMPROVEMENT_INSTRUCTIONS[key])
        .filter(Boolean)
        .join('\n\n');

      const improved = await improveContent(API_KEY, {
        title: lesson.title,
        step: lesson.step,
        competencyCode: comp?.code || '',
        competencyTitle: comp?.title || '',
        taxonomyLevel: comp?.taxonomy_level || 'anwenden',
        currentContent,
        instructions: instructions || 'Verbessere die Qualität auf IHK-sehr-gut-Niveau.',
        isMiniCheck: isMC,
      });

      if (!improved) {
        results.push({ lessonId: la.lessonId, title: la.title, status: 'ai_failed', improvements: neededImprovements });
        continue;
      }

      // Update lesson with revision tracking
      const updatedContent = isMC
        ? { ...content, questions: improved.questions, objectives: improved.objectives, improved_at: new Date().toISOString(), improvements_applied: improved.improvements_applied, version: ((content?.version as number) || 4) + 1 }
        : { ...content, html: improved.html, objectives: improved.objectives, improved_at: new Date().toISOString(), improvements_applied: improved.improvements_applied, version: ((content?.version as number) || 4) + 1 };

      const { error } = await supabase.from('lessons').update({ content: updatedContent }).eq('id', lesson.id);
      if (error) {
        results.push({ lessonId: la.lessonId, title: la.title, status: 'db_error', improvements: neededImprovements });
      } else {
        // Write revision history (audit trail)
        await supabase.from('lesson_revisions').insert({
          lesson_id: lesson.id,
          old_content: content,
          new_content: updatedContent,
          reason: 'auto_improvement',
          improvements_applied: improved.improvements_applied || neededImprovements,
          score_before: la.overall,
        });

        // Mark suggestions as applied
        await supabase.from('lesson_improvement_suggestions')
          .update({ applied: true, applied_at: new Date().toISOString() })
          .eq('lesson_id', lesson.id)
          .eq('applied', false)
          .in('rule', neededImprovements);

        results.push({ lessonId: la.lessonId, title: la.title, status: 'improved', improvements: improved.improvements_applied || neededImprovements });
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    const improved = results.filter(r => r.status === 'improved').length;
    console.log(`[Improve] ✅ ${improved}/${needsWork.length} lessons improved`);

    return new Response(JSON.stringify({
      courseId,
      auditId: audit.id,
      auditScore: audit.overall_score,
      improved,
      total: needsWork.length,
      results,
      message: improved > 0
        ? `✅ ${improved} Lessons verbessert. Empfehlung: Erneutes IHK-Audit zur Validierung.`
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

async function improveContent(apiKey: string, ctx: {
  title: string; step: string; competencyCode: string; competencyTitle: string;
  taxonomyLevel: string; currentContent: string; instructions: string; isMiniCheck: boolean;
}): Promise<Record<string, unknown> | null> {
  const systemPrompt = `Du bist ein IHK-Prüfungsexperte, der bestehende Lerninhalte VERBESSERT (nicht neu erstellt).

WICHTIG:
- Behalte den Kern des bestehenden Inhalts bei
- Ergänze und verbessere gezielt
- Lösche KEINEN korrekten bestehenden Inhalt
- Der verbesserte Inhalt MUSS länger sein als der Originalinhalt
- Verwende HTML-Formatierung (<h3>, <strong>, <ul>, <li>, <blockquote>)
- Alle Verbesserungen müssen IHK-prüfungsniveau erreichen`;

  const userPrompt = `VERBESSERE diese Lektion:

**Lektion:** ${ctx.title}
**Step:** ${ctx.step}
**Kompetenz:** ${ctx.competencyCode} – ${ctx.competencyTitle}
**Taxonomiestufe:** ${ctx.taxonomyLevel}

**AKTUELLER INHALT:**
${ctx.currentContent.slice(0, 5000)}

**GEFORDERTE VERBESSERUNGEN:**
${ctx.instructions}

Liefere den VOLLSTÄNDIGEN verbesserten Inhalt (nicht nur die Änderungen).`;

  try {
    const tool = ctx.isMiniCheck ? IMPROVE_MINICHECK_TOOL : IMPROVE_CONTENT_TOOL;
    const toolName = ctx.isMiniCheck ? "submit_improved_minicheck" : "submit_improved_content";

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: toolName } },
        temperature: 0.4,
      }),
    });

    if (resp.status === 429 || resp.status === 402) {
      console.warn(`[Improve] Rate limited (${resp.status})`);
      return null;
    }
    if (!resp.ok) { console.error(`[Improve] AI error ${resp.status}`); return null; }

    const data = await resp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    return JSON.parse(args);
  } catch (e) {
    console.error(`[Improve] Error:`, e);
    return null;
  }
}
