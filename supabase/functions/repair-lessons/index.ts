import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Universal Lesson Repair Function (Council-Compliant)
 * 
 * Finds placeholder/invalid lessons and creates content_versions
 * for Council review instead of writing directly to lessons.
 */

const STEP_PROMPTS: Record<string, string> = {
  einstieg: `Erstelle eine **aktivierende Einstiegsaktivität** (ca. 800–1200 Zeichen HTML).
Struktur:
- <h3>Motivierender Titel</h3>
- Kurze Problemstellung oder Alltagsszenario das neugierig macht
- 2-3 Reflexionsfragen als <ul><li>
- Bezug zum Vorwissen der Azubis`,

  verstehen: `Erstelle **ausführliches Lernmaterial** (ca. 1500–2500 Zeichen HTML).
Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition und Erklärung der Kernkonzepte
- Mindestens 2 praxisnahe Beispiele
- Wichtige Fachbegriffe als <strong>
- Optionale Merksätze als <blockquote>
- Tabelle oder Liste zur Übersicht wenn sinnvoll`,

  anwenden: `Erstelle **praktische Übungsaufgaben** (ca. 1200–2000 Zeichen HTML).
Struktur:
- <h3>Praxis-Titel</h3>
- Realistische Arbeitssituation als Szenario
- 2-3 konkrete Aufgaben mit steigendem Schwierigkeitsgrad
- Hinweise zur Lösung (ohne Lösung zu verraten)
- Bezug zur beruflichen Praxis (IHK-relevant)`,

  wiederholen: `Erstelle **Wiederholungsaktivitäten** (ca. 1000–1500 Zeichen HTML).
Struktur:
- <h3>Zusammenfassung & Wiederholung</h3>
- Die 5 wichtigsten Punkte als nummerierte Liste
- Lückentext oder Zuordnungsübung
- Eselsbrücken oder Merkhilfen
- Kurze Checkliste: "Ich kann jetzt..."`,
};

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" }
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

function validateContent(content: Record<string, unknown>, step: string): boolean {
  if (step === 'mini_check') {
    const qs = content.questions;
    if (!Array.isArray(qs) || qs.length < 4) return false;
    return qs.every((q: Record<string, unknown>) =>
      q?.question && Array.isArray(q.options) && q.options.length >= 4 &&
      typeof q.correct_answer === 'number' && q.correct_answer >= 0 && q.correct_answer <= 3 && q.explanation
    );
  }
  const html = content.html as string;
  if (!html || html.length < 300 || html.includes('wird generiert') || html.includes('Inhalt wird')) return false;
  return Array.isArray(content.objectives) && (content.objectives as unknown[]).length >= 2;
}

async function generateContent(
  apiKey: string,
  comp: { code: string; title: string; description: string; taxonomy_level: string },
  step: string
): Promise<Record<string, unknown> | null> {
  const isMiniCheck = step === 'mini_check';
  const prompt = isMiniCheck
    ? `Erstelle 4 IHK-Prüfungsfragen (${comp.taxonomy_level}) für:\n${comp.code} – ${comp.title}\n${comp.description}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.`
    : `${STEP_PROMPTS[step]}\n\nKompetenz: ${comp.code} – ${comp.title}\n${comp.description}\nTaxonomie: ${comp.taxonomy_level}`;

  try {
    const result = await callAIJSON({
      provider: "openai",
      messages: [
        { role: "system", content: "Du bist IHK-Ausbildungsexperte. Erstelle prüfungsrelevante Inhalte auf Deutsch. Nutze IMMER die Funktion." },
        { role: "user", content: prompt }
      ],
      tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
      tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
      temperature: 0.7,
    });

    const args = result.toolCalls?.[0]?.function?.arguments;
    if (!args) return null;

    const parsed = JSON.parse(args);
    if (validateContent(parsed, step)) return parsed;
    console.warn(`[Repair] Validation failed for ${comp.code}/${step}`);
  } catch (e) {
    console.error(`[Repair] Error:`, e);
  }
  return null;
}

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
    const API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Use RPC to find placeholder lessons
    const { data: toFix, error: rpcErr } = await supabase.rpc('get_placeholder_lessons', {
      p_course_id: courseId,
      p_limit: batchSize
    });
    if (rpcErr) throw rpcErr;

    // Get overall stats
    const { data: stats } = await supabase.rpc('get_content_quality_stats');
    const currentStats = stats?.[0] || { total_lessons: 0, valid_lessons: 0, placeholder_count: 0, quality_percent: 0 };

    if (dryRun || !toFix || toFix.length === 0) {
      return new Response(JSON.stringify({
        dryRun,
        ...currentStats,
        lessonsToFix: toFix?.length || 0,
        lessons: toFix?.map((l: Record<string, unknown>) => ({ id: l.id, title: l.title, step: l.step })) || [],
        message: (toFix?.length || 0) === 0
          ? `✅ Quality Gate: ${currentStats.quality_percent}% — Keine Platzhalter gefunden`
          : `⚠️ ${toFix?.length} Lessons mit Platzhaltern gefunden`
      }), { headers: jsonHeaders });
    }

    console.log(`[Repair] Creating ${toFix.length} content versions (Council pipeline)`);
    let versionsCreated = 0, failed = 0;
    const details: { id: string; title: string; step: string; status: string; versionId?: string }[] = [];

    for (const lesson of toFix) {
      const content = await generateContent(API_KEY, {
        code: lesson.competency_code || '',
        title: lesson.competency_title || lesson.title,
        description: lesson.competency_description || '',
        taxonomy_level: lesson.competency_taxonomy_level || 'anwenden',
      }, lesson.step);

      if (!content) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'failed' });
        continue;
      }

      const finalContent = lesson.step === 'mini_check'
        ? { type: 'mini_check', questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 }
        : { type: 'text', html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 };

      const entityType = lesson.step === 'mini_check' ? 'minicheck' : 'lesson_step';
      const stepKey = `step_${lesson.step}`;

      // ═══ COUNCIL-COMPLIANT: Create content_version instead of direct write ═══
      const { data: newVersion, error: vErr } = await supabase
        .from('content_versions')
        .insert({
          course_id: courseId || lesson.course_id,
          lesson_id: lesson.id,
          step_key: stepKey,
          content_json: finalContent,
          created_by_agent: 'repair-lessons',
          status: 'under_review',
          council_round: 1,
          entity_type: entityType,
        })
        .select('id')
        .single();

      if (vErr) {
        failed++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'version_error' });
      } else {
        // Audit trail
        await supabase.from('council_messages').insert({
          content_version_id: newVersion!.id,
          agent_name: 'repair-lessons',
          message_type: 'proposal',
          message_json: { source: 'repair-lessons', reason: 'placeholder_replacement' },
        });

        versionsCreated++;
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: 'version_created', versionId: newVersion!.id });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    return new Response(JSON.stringify({
      success: true, versionsCreated, failed,
      ...currentStats,
      details,
      message: `✅ ${versionsCreated} Content-Versionen erstellt → Council-Review ausstehend.`
    }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[Repair] Fatal:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
