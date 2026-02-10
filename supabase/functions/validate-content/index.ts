import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * validate-content – Opus 4.6 als Qualitätskontroll-Instanz
 * 
 * Validiert und verifiziert KI-generierte Inhalte (GPT-5.2 Output).
 * Einsatz: Nach Kursgenerierung, Lesson-Erstellung, Prüfungsfragen.
 * 
 * Modi:
 * - "lesson": Validiert einzelne Lektion
 * - "course": Validiert gesamten Kurs (Batch)
 * - "question": Validiert Prüfungsfragen
 * - "tutor_response": Validiert Tutor-Antwort in Echtzeit (leichtgewichtig)
 */

interface ValidationRequest {
  mode: "lesson" | "course" | "question" | "tutor_response";
  content: unknown;
  context?: {
    curriculumTitle?: string;
    competencyTitle?: string;
    taxonomyLevel?: string;
    lessonStep?: string;
  };
  courseId?: string;
  lessonId?: string;
}

interface ValidationResult {
  valid: boolean;
  score: number; // 0-100
  issues: Array<{
    severity: "critical" | "warning" | "info";
    category: string;
    message: string;
    suggestion?: string;
  }>;
  improvements?: string[];
  correctedContent?: unknown;
}

const VALIDATION_PROMPTS: Record<string, string> = {
  lesson: `Du bist ein erfahrener Didaktik-Experte und Qualitätsprüfer für berufliche Bildungsinhalte.
Deine Aufgabe: Validiere den folgenden KI-generierten Lerninhalt nach diesen Kriterien:

1. FACHLICHE KORREKTHEIT (30%): Sind alle Fakten korrekt? Keine Erfindungen?
2. DIDAKTISCHE QUALITÄT (25%): Ist der Inhalt lernförderlich strukturiert? Passt er zur Taxonomiestufe?
3. CURRICULUM-KONFORMITÄT (20%): Passt der Inhalt zur angegebenen Kompetenz?
4. SPRACHQUALITÄT (15%): Klare, verständliche Sprache für Azubis?
5. VOLLSTÄNDIGKEIT (10%): Sind alle nötigen Aspekte abgedeckt?

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt im folgenden Format:
{
  "valid": true/false,
  "score": 0-100,
  "issues": [{"severity": "critical|warning|info", "category": "string", "message": "string", "suggestion": "string"}],
  "improvements": ["Verbesserung 1", "Verbesserung 2"],
  "correctedContent": null oder korrigiertes JSON falls critical issues
}`,

  question: `Du bist ein IHK-Prüfungsexperte und validierst KI-generierte Prüfungsfragen.
Prüfe nach:
1. FACHLICHE KORREKTHEIT: Ist die richtige Antwort tatsächlich korrekt?
2. EINDEUTIGKEIT: Gibt es genau eine richtige Antwort?
3. DISTRAKTOREN: Sind Falschantworten plausibel aber eindeutig falsch?
4. IHK-KONFORMITÄT: Entspricht die Frage dem IHK-Prüfungsstil?
5. TAXONOMIE: Passt die Frage zur angegebenen Taxonomiestufe?

Antworte AUSSCHLIESSLICH mit JSON: {"valid": bool, "score": 0-100, "issues": [...], "improvements": [...]}`,

  tutor_response: `Du bist ein Qualitätsprüfer für KI-Tutor-Antworten in der beruflichen Bildung.
Prüfe SCHNELL und KNAPP:
1. Ist die Antwort fachlich korrekt?
2. Werden keine falschen Informationen vermittelt?
3. Ist die Antwort für Azubis verständlich?

Antworte AUSSCHLIESSLICH mit JSON: {"valid": bool, "score": 0-100, "issues": [...]}`,

  course: `Du bist ein Qualitätsauditor für KI-generierte Ausbildungskurse.
Prüfe den gesamten Kurs auf:
1. KOHÄRENZ: Bauen die Lektionen logisch aufeinander auf?
2. VOLLSTÄNDIGKEIT: Sind alle Kompetenzen abgedeckt?
3. DIDAKTISCHER AUFBAU: Folgt jede Kompetenz der 5-Schritte-Didaktik?
4. QUALITÄTSNIVEAU: Gesamtqualität der Inhalte

Antworte AUSSCHLIESSLICH mit JSON: {"valid": bool, "score": 0-100, "issues": [...], "improvements": [...]}`
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Auth check
  const auth = await validateAuth(req, false);
  if (auth.error) {
    return unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const { mode, content, context, courseId, lessonId }: ValidationRequest = await req.json();

    if (!mode || !content) {
      return new Response(
        JSON.stringify({ error: "mode and content are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const systemPrompt = VALIDATION_PROMPTS[mode] || VALIDATION_PROMPTS.lesson;

    // Build context string
    let contextStr = "";
    if (context) {
      if (context.curriculumTitle) contextStr += `\nCurriculum: ${context.curriculumTitle}`;
      if (context.competencyTitle) contextStr += `\nKompetenz: ${context.competencyTitle}`;
      if (context.taxonomyLevel) contextStr += `\nTaxonomiestufe: ${context.taxonomyLevel}`;
      if (context.lessonStep) contextStr += `\nLernschritt: ${context.lessonStep}`;
    }

    const userPrompt = `${contextStr ? `KONTEXT:${contextStr}\n\n` : ""}ZU VALIDIERENDER INHALT:\n${JSON.stringify(content, null, 2)}`;

    // Use lighter model for tutor_response (speed), full Opus for everything else
    const model = mode === "tutor_response" ? "claude-sonnet-4-20250514" : "claude-opus-4-20250514";
    const maxTokens = mode === "tutor_response" ? 1024 : 4096;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`[validate-content] Anthropic error ${status}:`, errText);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Bitte später erneut versuchen." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Anthropic API error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || "";

    // Parse JSON from response
    let result: ValidationResult;
    try {
      const cleanText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleanText);
    } catch {
      result = {
        valid: false,
        score: 0,
        issues: [{ severity: "critical", category: "parse_error", message: "Validierungsantwort konnte nicht geparst werden" }],
      };
    }

    // Log validation
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("ai_usage_log").insert({
      job_type: `validate_${mode}`,
      model,
      input_tokens: aiData.usage?.input_tokens || 0,
      output_tokens: aiData.usage?.output_tokens || 0,
      total_tokens: (aiData.usage?.input_tokens || 0) + (aiData.usage?.output_tokens || 0),
      cost_eur: 0,
      success: true,
      metadata: { mode, courseId, lessonId, score: result.score, valid: result.valid },
    });

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[validate-content] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Validation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
