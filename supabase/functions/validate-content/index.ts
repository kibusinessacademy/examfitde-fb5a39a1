import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfessionFromCourse } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";

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
  generationId?: string;
  courseId?: string;
  lessonId?: string;
  entityType?: string;
  entityId?: string;
  generatorProvider?: "openai" | "anthropic";
}

interface ValidationResult {
  overall_score: number;
  decision: "approve" | "revise" | "reject";
  dimension_scores: Record<string, number>;
  critical_issues: Array<{ severity: "critical" | "warning" | "info"; category: string; message: string; suggestion?: string }>;
  suggested_fixes: Array<{ type: string; target?: string; reason: string; replacement?: string }>;
  improvements?: string[];
  corrected_content?: unknown;
}

const VALIDATION_PROMPTS: Record<string, string> = {
  lesson: `Du bist ein IHK-Prüfer und Didaktik-Experte. Du validierst KI-generierte Lerninhalte.
DEINE ROLLE: Unabhängiger Qualitätsvalidator. Du erfindest KEINE neuen Inhalte.

BEWERTUNGSDIMENSIONEN (gewichtet):
1. FACHLICHE KORREKTHEIT (25%): Fakten korrekt? Keine Halluzinationen? Fachbegriffe richtig?
2. DIDAKTISCHE QUALITÄT (20%): 5-Schritte-Didaktik? Anwenden = Entscheidungsszenario? Progressive Komplexität?
3. PRÜFUNGSRELEVANZ (15%): Explizite IHK-Prüfungsbezüge? Typische Prüfungsformulierungen? Prüfungsfallen benannt?
4. SPRACHLICHE KLARHEIT (10%): Azubi-Niveau? Klare Fachsprache? Keine akademische Überfrachtung?
5. VOLLSTÄNDIGKEIT (10%): Lernziele definiert? Alle Aspekte abgedeckt? Mindestumfang?
6. BERUFSBEZUG & SSOT (20%): Konkreter Bezug zum spezifischen Beruf? Beispiele aus dem richtigen Berufsalltag? KEINE Fremdbranche-Inhalte?

PFLICHT-PRÜFUNGEN (Auto-Reject bei Fehlen):
- Kein IHK-Prüfungsbezug → Score max 75
- Anwenden-Phase ohne Entscheidungsszenario → Score max 80
- Halluzination erkannt → Score max 50, decision=reject
- FREMDBRANCHE-KONTAMINATION: Wenn Inhalte Fachbegriffe/Szenarien aus einem ANDEREN Beruf enthalten (z.B. Autohaus-Begriffe bei Bankkaufleuten), → Score max 30, decision=reject, critical_issue mit category="kontamination"
- Generische Inhalte OHNE konkreten Berufsbezug → Score max 70

Antworte AUSSCHLIESSLICH mit JSON:
{
  "overall_score": 0-100,
  "decision": "approve|revise|reject",
  "dimension_scores": {"fachlichkeit": 0-100, "didaktik": 0-100, "pruefungsrelevanz": 0-100, "klarheit": 0-100, "vollstaendigkeit": 0-100, "berufsbezug": 0-100},
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
1. EINDEUTIGKEIT (30%): Genau eine richtige Antwort? Keine Interpretationsspielräume?
2. DISTRAKTOREN-QUALITÄT (20%): Plausibel aber eindeutig falsch? Typische Fehler abgebildet?
3. IHK-KONFORMITÄT (20%): IHK-Prüfungsstil? Realistische Aufgabenstellung?
4. BERUFSBEZUG (15%): Konkreter Bezug zum spezifischen Beruf? Szenarien aus dem richtigen Berufsalltag? KEINE generischen Fragen ohne Berufsbezug? KEINE Fremdbranche-Begriffe?
5. TAXONOMIE-PASSUNG (15%): Passt zur Bloom-Stufe? Kognitive Anforderung korrekt?

AUTO-REJECT:
- Mehrere korrekte Antworten möglich → reject
- Offensichtlich falsche Distraktoren → revise
- Fachlicher Fehler in korrekter Antwort → reject
- FREMDBRANCHE-KONTAMINATION: Fachbegriffe aus einem anderen Beruf → reject mit category="kontamination"
- Generische Fragen OHNE jeglichen Berufsbezug → Score max 60

Antworte AUSSCHLIESSLICH mit JSON:
{"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {"eindeutigkeit": 0-100, "distraktoren": 0-100, "ihk_konformitaet": 0-100, "berufsbezug": 0-100, "taxonomie": 0-100}, "critical_issues": [...], "suggested_fixes": [...]}`,

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

  const auth = await validateAuth(req, false);
  if (auth.error) return unauthorizedResponse(auth.error, origin ?? undefined);

  try {
    const body: ValidationRequest = await req.json();
    const { mode, content, context, generationId, courseId, lessonId, generatorProvider } = body;

    if (!mode || !content) {
      return new Response(JSON.stringify({ error: "mode and content are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const systemPrompt = VALIDATION_PROMPTS[mode] || VALIDATION_PROMPTS.lesson;
    let contextStr = "";
    if (context) {
      if (context.curriculumTitle) contextStr += `\nCurriculum: ${context.curriculumTitle}`;
      if (context.competencyTitle) contextStr += `\nKompetenz: ${context.competencyTitle}`;
      if (context.taxonomyLevel) contextStr += `\nTaxonomiestufe: ${context.taxonomyLevel}`;
      if (context.lessonStep) contextStr += `\nLernschritt: ${context.lessonStep}`;
      if (context.blueprintId) contextStr += `\nBlueprint: ${context.blueprintId}`;
    }

    // Load profession name from SSOT via shared resolver
    let professionName = "";
    if (courseId) {
      try {
        const supabaseCtx = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const result = await resolveProfessionFromCourse(supabaseCtx, courseId, { allowGenericFallback: true });
        professionName = result.professionName;
      } catch { /* ignore for validation — it's not the generator */ }
    }

    // Pre-flight contamination check (before sending to LLM)
    if (professionName && typeof content === "object" && content !== null) {
      const contentStr = JSON.stringify(content).slice(0, 10000);
      const contam = checkContamination(contentStr, professionName);
      if (contam.isContaminated) {
        console.warn(`[validate-content] PRE-FLIGHT CONTAMINATION: ${contam.detectedIndustry} terms in content for "${professionName}"`);
        // Auto-reject without even calling the LLM
        const autoRejectResult: ValidationResult = {
          overall_score: 20,
          decision: "reject",
          dimension_scores: { berufsbezug: 0, fachlichkeit: 50, didaktik: 50, pruefungsrelevanz: 50, klarheit: 50, vollstaendigkeit: 50 },
          critical_issues: [{ severity: "critical", category: "kontamination", message: `Fremdbranche "${contam.detectedIndustry}" erkannt: [${contam.matchedTerms.join(", ")}]`, suggestion: "Inhalt muss für den Beruf " + professionName + " neu generiert werden." }],
          suggested_fixes: [{ type: "remove_content", reason: `Kontamination aus Branche "${contam.detectedIndustry}"` }],
        };

        if (generationId) {
          const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          await supabase.from("ai_generations").update({ validation_decision: "reject", validation_score: 20, status: "rejected" }).eq("id", generationId);
        }

        return new Response(JSON.stringify(autoRejectResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (professionName) {
      contextStr += `\nBeruf: ${professionName}`;
      contextStr += `\nWICHTIG: Alle Inhalte MÜSSEN zum Beruf "${professionName}" passen. Inhalte aus anderen Berufsfeldern = KONTAMINATION = Auto-Reject!`;
    }

    const generatorLabel = generatorProvider === "anthropic" ? "Claude Opus" : "GPT-5.2";
    const userPrompt = `${contextStr ? `SSOT-KONTEXT:${contextStr}\n\n` : ""}ZU VALIDIERENDER INHALT (generiert von ${generatorLabel}):\n${JSON.stringify(content, null, 2)}`;

    // Use routed model for validation (e.g. Claude Sonnet 4 via Gateway)
    const routed = getModel("quality_audit");
    const startTime = Date.now();

    const aiResult = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    });

    const latencyMs = Date.now() - startTime;
    let result: ValidationResult;
    try {
      const cleanText = aiResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleanText);
    } catch {
      result = { overall_score: 0, decision: "reject", dimension_scores: {}, critical_issues: [{ severity: "critical", category: "parse_error", message: "Validierungsantwort konnte nicht geparst werden" }], suggested_fixes: [] };
    }

    if (!result.decision) {
      if (result.overall_score >= 85) result.decision = "approve";
      else if (result.overall_score >= 60) result.decision = "revise";
      else result.decision = "reject";
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (generationId) {
      await supabase.from("ai_validations").insert({
        generation_id: generationId,
        validator_model: routed.model,
        validation_mode: auth.user ? "manual" : "automatic",
        overall_score: result.overall_score,
        decision: result.decision,
        dimension_scores: result.dimension_scores,
        critical_issues: result.critical_issues,
        suggested_fixes: result.suggested_fixes,
        corrected_content: result.corrected_content || null,
        improvements: result.improvements || [],
        input_tokens: aiResult.usage?.input_tokens || 0,
        output_tokens: aiResult.usage?.output_tokens || 0,
        cost_eur: 0,
        latency_ms,
        validated_by: auth.user?.id || null,
      });

      const newStatus = result.decision === "approve" ? "validated" : result.decision === "reject" ? "rejected" : "draft";
      await supabase.from("ai_generations").update({ validation_decision: result.decision, validation_score: result.overall_score, status: newStatus }).eq("id", generationId);

      await supabase.from("ai_quality_gates").insert({
        generation_id: generationId,
        gate_type: "auto_validation",
        gate_status: result.decision === "approve" ? "passed" : "failed",
        required_score: 85,
        actual_score: result.overall_score,
        decided_by: auth.user?.id || null,
        decided_at: new Date().toISOString(),
        reason: result.decision === "approve" ? "Automatische Validierung bestanden" : `Score ${result.overall_score}/100`,
      });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[validate-content] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Validation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
