import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * validate-content – LLM Council Validation Engine
 * 
 * Claude Opus 4.6 als unabhängige Qualitätskontroll-Instanz.
 * Validiert und verifiziert KI-generierte Inhalte (GPT-5.2 Output).
 * 
 * Modi:
 * - "lesson": Validiert einzelne Lektion (5-Schritte-Didaktik, IHK-Bezug)
 * - "course": Validiert gesamten Kurs (Batch, Kohärenz)
 * - "question": Validiert Prüfungsfragen (Eindeutigkeit, Distraktoren)
 * - "tutor_response": Validiert Tutor-Antwort async (Halluzinations-Check)
 * - "blog_article": Validiert SEO/Marketing-Content (DeepSeek Output)
 * 
 * Jede Validierung erzeugt einen strukturierten Report mit:
 * - decision: approve | revise | reject
 * - dimension_scores: gewichtete Einzelbewertungen
 * - suggested_fixes: maschinenlesbare Korrekturvorschläge
 */

interface ValidationRequest {
  mode: "lesson" | "course" | "question" | "tutor_response" | "blog_article";
  content: unknown;
  context?: {
    curriculumTitle?: string;
    competencyTitle?: string;
    taxonomyLevel?: string;
    lessonStep?: string;
    blueprintId?: string;
  };
  generationId?: string; // FK to ai_generations
  courseId?: string;
  lessonId?: string;
  entityType?: string;
  entityId?: string;
  /** Which provider generated the content – validator will be the OTHER provider */
  generatorProvider?: "openai" | "anthropic";
}

interface ValidationResult {
  overall_score: number;
  decision: "approve" | "revise" | "reject";
  dimension_scores: Record<string, number>;
  critical_issues: Array<{
    severity: "critical" | "warning" | "info";
    category: string;
    message: string;
    suggestion?: string;
  }>;
  suggested_fixes: Array<{
    type: string;
    target?: string;
    reason: string;
    replacement?: string;
  }>;
  improvements?: string[];
  corrected_content?: unknown;
}

// Dimension weights per entity type (SSOT)
const DIMENSION_WEIGHTS: Record<string, Record<string, number>> = {
  lesson: { fachlichkeit: 30, didaktik: 25, pruefungsrelevanz: 20, klarheit: 15, vollstaendigkeit: 10 },
  question: { eindeutigkeit: 35, distraktoren: 25, ihk_konformitaet: 25, taxonomie: 15 },
  tutor_response: { fachlichkeit: 50, verstaendlichkeit: 30, keine_halluzination: 20 },
  blog_article: { seo_qualitaet: 40, fachlichkeit: 40, sprachqualitaet: 20 },
  course: { kohaerenz: 30, vollstaendigkeit: 25, didaktischer_aufbau: 25, qualitaetsniveau: 20 },
};

const VALIDATION_PROMPTS: Record<string, string> = {
  lesson: `Du bist ein IHK-Prüfer und Didaktik-Experte. Du validierst KI-generierte Lerninhalte.
DEINE ROLLE: Unabhängiger Qualitätsvalidator. Du erfindest KEINE neuen Inhalte.

BEWERTUNGSDIMENSIONEN (gewichtet):
1. FACHLICHE KORREKTHEIT (30%): Fakten korrekt? Keine Halluzinationen? Fachbegriffe richtig?
2. DIDAKTISCHE QUALITÄT (25%): 5-Schritte-Didaktik? Anwenden = Entscheidungsszenario? Progressive Komplexität?
3. PRÜFUNGSRELEVANZ (20%): Explizite IHK-Prüfungsbezüge? Typische Prüfungsformulierungen? Prüfungsfallen benannt?
4. SPRACHLICHE KLARHEIT (15%): Azubi-Niveau? Klare Fachsprache? Keine akademische Überfrachtung?
5. VOLLSTÄNDIGKEIT (10%): Lernziele definiert? Alle Aspekte abgedeckt? Mindestumfang?

PFLICHT-PRÜFUNGEN (Auto-Reject bei Fehlen):
- Kein IHK-Prüfungsbezug → Score max 75
- Anwenden-Phase ohne Entscheidungsszenario → Score max 80
- Halluzination erkannt → Score max 50, decision=reject

Antworte AUSSCHLIESSLICH mit JSON:
{
  "overall_score": 0-100,
  "decision": "approve|revise|reject",
  "dimension_scores": {"fachlichkeit": 0-100, "didaktik": 0-100, "pruefungsrelevanz": 0-100, "klarheit": 0-100, "vollstaendigkeit": 0-100},
  "critical_issues": [{"severity": "critical|warning|info", "category": "string", "message": "string", "suggestion": "string"}],
  "suggested_fixes": [{"type": "replace_section|add_content|remove_content", "target": "step_name", "reason": "string", "replacement": "string"}],
  "improvements": ["Konkrete Verbesserung 1", "Konkrete Verbesserung 2"],
  "corrected_content": null
}

ENTSCHEIDUNGSLOGIK:
- score >= 85 → approve
- score 60-84 → revise (mit suggested_fixes)
- score < 60 → reject`,

  question: `Du bist ein IHK-Prüfungsexperte. Validiere KI-generierte Prüfungsfragen.

BEWERTUNGSDIMENSIONEN:
1. EINDEUTIGKEIT (35%): Genau eine richtige Antwort? Keine Interpretationsspielräume?
2. DISTRAKTOREN-QUALITÄT (25%): Plausibel aber eindeutig falsch? Typische Fehler abgebildet?
3. IHK-KONFORMITÄT (25%): IHK-Prüfungsstil? Realistische Aufgabenstellung?
4. TAXONOMIE-PASSUNG (15%): Passt zur Bloom-Stufe? Kognitive Anforderung korrekt?

AUTO-REJECT:
- Mehrere korrekte Antworten möglich → reject
- Offensichtlich falsche Distraktoren → revise
- Fachlicher Fehler in korrekter Antwort → reject

Antworte AUSSCHLIESSLICH mit JSON:
{"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {"eindeutigkeit": 0-100, "distraktoren": 0-100, "ihk_konformitaet": 0-100, "taxonomie": 0-100}, "critical_issues": [...], "suggested_fixes": [...]}`,

  tutor_response: `Du prüfst eine KI-Tutor-Antwort auf fachliche Korrektheit. SCHNELL und PRÄZISE.

PRÜFE:
1. FACHLICHE KORREKTHEIT (50%): Alle Fakten korrekt? Gesetze/Normen richtig zitiert?
2. VERSTÄNDLICHKEIT (30%): Für Azubis verständlich? Nicht zu komplex?
3. HALLUZINATIONS-CHECK (20%): Erfundene Fakten? Nicht existierende Paragraphen?

ENTSCHEIDUNG:
- Fachlich korrekt → {"decision": "approve", "correction_needed": false}
- Kleine Ungenauigkeit → {"decision": "revise", "correction_needed": true, "correction": "Korrekturtext"}
- Falsche Fakten → {"decision": "reject", "correction_needed": true, "correction": "Richtige Information"}

Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...], "correction_needed": bool, "correction": "string|null"}`,

  blog_article: `Du prüfst KI-generierten Marketing-/SEO-Content.

PRÜFE:
1. SEO-QUALITÄT (40%): Keywords, Struktur, Meta-Beschreibung?
2. FACHLICHE KORREKTHEIT (40%): Aussagen korrekt und belegbar?
3. SPRACHQUALITÄT (20%): Professionell, ansprechend, zielgruppengerecht?

Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...], "suggested_fixes": [...]}`,

  course: `Du bist ein Qualitätsauditor für KI-generierte Ausbildungskurse.

PRÜFE DEN GESAMTEN KURS:
1. KOHÄRENZ (30%): Logischer Aufbau? Module bauen aufeinander auf?
2. VOLLSTÄNDIGKEIT (25%): Alle Kompetenzen des Curriculums abgedeckt?
3. DIDAKTISCHER AUFBAU (25%): Jede Kompetenz folgt 5-Schritte-Modell?
4. QUALITÄTSNIVEAU (20%): Gesamtqualität konsistent?

Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...], "improvements": [...]}`,
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // Auth check – authenticated users can validate
  const auth = await validateAuth(req, false);
  if (auth.error) {
    return unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const body: ValidationRequest = await req.json();
    const { mode, content, context, generationId, courseId, lessonId, entityType, entityId, generatorProvider } = body;

    if (!mode || !content) {
      return new Response(
        JSON.stringify({ error: "mode and content are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = VALIDATION_PROMPTS[mode] || VALIDATION_PROMPTS.lesson;

    // Build SSOT context
    let contextStr = "";
    if (context) {
      if (context.curriculumTitle) contextStr += `\nCurriculum: ${context.curriculumTitle}`;
      if (context.competencyTitle) contextStr += `\nKompetenz: ${context.competencyTitle}`;
      if (context.taxonomyLevel) contextStr += `\nTaxonomiestufe: ${context.taxonomyLevel}`;
      if (context.lessonStep) contextStr += `\nLernschritt: ${context.lessonStep}`;
      if (context.blueprintId) contextStr += `\nBlueprint: ${context.blueprintId}`;
    }

    // Cross-provider validation: if anthropic generated → openai validates, and vice versa
    // Default (no generatorProvider): anthropic validates (legacy behavior)
    const validatorProvider = generatorProvider === "anthropic" ? "openai" : "anthropic";

    const generatorLabel = generatorProvider === "anthropic" ? "Claude Opus" : "GPT-5.2";
    const userPrompt = `${contextStr ? `SSOT-KONTEXT:${contextStr}\n\n` : ""}ZU VALIDIERENDER INHALT (generiert von ${generatorLabel}):\n${JSON.stringify(content, null, 2)}`;

    const startTime = Date.now();
    let rawText = "";
    let model = "";
    let inputTokens = 0;
    let outputTokens = 0;

    if (validatorProvider === "openai") {
      // GPT-5.2 validates Anthropic-generated content
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

      model = mode === "tutor_response" ? "gpt-5-mini" : "gpt-5.2";
      const maxTokens = mode === "tutor_response" ? 1024 : 4096;

      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        const errText = await aiResponse.text();
        console.error(`[validate-content] OpenAI error ${status}:`, errText);
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit. Bitte später erneut versuchen." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`OpenAI API error: ${status}`);
      }

      const aiData = await aiResponse.json();
      rawText = aiData.choices?.[0]?.message?.content || "";
      inputTokens = aiData.usage?.prompt_tokens || 0;
      outputTokens = aiData.usage?.completion_tokens || 0;
    } else {
      // Anthropic validates OpenAI-generated content (default/legacy path)
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

      model = mode === "tutor_response" ? "claude-sonnet-4-20250514" : "claude-opus-4-20250514";
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
      rawText = aiData.content?.[0]?.text || "";
      inputTokens = aiData.usage?.input_tokens || 0;
      outputTokens = aiData.usage?.output_tokens || 0;
    }

    const latencyMs = Date.now() - startTime;

    // Parse structured validation response
    let result: ValidationResult;
    try {
      const cleanText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleanText);
    } catch {
      result = {
        overall_score: 0,
        decision: "reject",
        dimension_scores: {},
        critical_issues: [{ severity: "critical", category: "parse_error", message: "Validierungsantwort konnte nicht geparst werden" }],
        suggested_fixes: [],
      };
    }

    // Apply decision logic based on score thresholds
    if (!result.decision) {
      if (result.overall_score >= 85) result.decision = "approve";
      else if (result.overall_score >= 60) result.decision = "revise";
      else result.decision = "reject";
    }

    // Persist to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // inputTokens and outputTokens already set above from provider response

    // Log to ai_validations if we have a generation reference
    if (generationId) {
      await supabase.from("ai_validations").insert({
        generation_id: generationId,
        validator_model: model,
        validation_mode: auth.user ? "manual" : "automatic",
        overall_score: result.overall_score,
        decision: result.decision,
        dimension_scores: result.dimension_scores,
        critical_issues: result.critical_issues,
        suggested_fixes: result.suggested_fixes,
        corrected_content: result.corrected_content || null,
        improvements: result.improvements || [],
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_eur: 0,
        latency_ms: latencyMs,
        validated_by: auth.user?.id || null,
      });

      // Update generation status based on decision
      const newStatus = result.decision === "approve" ? "validated" : result.decision === "reject" ? "rejected" : "draft";
      await supabase.from("ai_generations").update({
        validation_decision: result.decision,
        validation_score: result.overall_score,
        status: newStatus,
      }).eq("id", generationId);

      // Create quality gate entry
      await supabase.from("ai_quality_gates").insert({
        generation_id: generationId,
        gate_type: "auto_validation",
        gate_status: result.decision === "approve" ? "passed" : "failed",
        required_score: 85,
        actual_score: result.overall_score,
        decided_by: auth.user?.id || null,
        decided_at: new Date().toISOString(),
        reason: result.decision === "approve"
          ? "Automatische Validierung bestanden"
          : `Score ${result.overall_score}/100 – ${result.critical_issues?.length || 0} kritische Issues`,
      });
    }

    // Also log to ai_usage_log for cost tracking
    await supabase.from("ai_usage_log").insert({
      job_type: `validate_${mode}`,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cost_eur: 0,
      success: true,
      latency_ms: latencyMs,
      metadata: { mode, generationId, courseId, lessonId, score: result.overall_score, decision: result.decision },
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
