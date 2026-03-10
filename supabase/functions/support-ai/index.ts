// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfessionFromCourse } from "../_shared/profession-resolver.ts";
import { getSupportMaxLength, SUPPORT_CONTEXT_REQUEST, SOURCE_CITATION_RULE } from "../_shared/prompt-kit.ts";

const ANSWER_TYPES: Record<string, string> = {
  verstaendnisfrage: "explanation",
  technisch: "technical_help",
  pruefungsangst: "reassurance",
  lernstrategie: "strategy",
  abrechnung: "billing_help",
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { question, ticketType, contextCourseId, contextLessonId, contextCompetencyId, userId } = await req.json();

    if (!question || !userId) {
      return new Response(JSON.stringify({ error: "Missing question or userId" }), {
        status: 400, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Load SSOT context server-side, including profession name
    let contextParts: string[] = [];
    let professionName = "";

    if (contextCourseId) {
      const { data: course } = await adminClient
        .from("courses")
        .select("title, description, curriculum_id")
        .eq("id", contextCourseId)
        .maybeSingle();
      if (course) {
        contextParts.push(`Kurs: ${course.title}. ${course.description || ""}`);
        // Load profession from SSOT resolver
        if (course.curriculum_id || contextCourseId) {
          try {
            const result = await resolveProfessionFromCourse(adminClient, contextCourseId, { allowGenericFallback: true });
            professionName = result.professionName;
          } catch { /* support-ai is user-facing, tolerate missing profession */ }
        }
      }
    }

    if (contextLessonId) {
      const { data: lesson } = await adminClient
        .from("lessons")
        .select("title, content_json, competency_id, competencies(title, code)")
        .eq("id", contextLessonId)
        .maybeSingle();
      if (lesson) {
        contextParts.push(`Lektion: ${lesson.title}`);
        const comp = (lesson as any).competencies;
        if (comp) contextParts.push(`Kompetenz: ${comp.code} - ${comp.title}`);
      }
    }

    if (contextCompetencyId && !contextLessonId) {
      const { data: comp } = await adminClient
        .from("competencies")
        .select("title, code, description")
        .eq("id", contextCompetencyId)
        .maybeSingle();
      if (comp) contextParts.push(`Kompetenz: ${comp.code} - ${comp.title}. ${comp.description || ""}`);
    }

    // Detect emotional state
    const lower = question.toLowerCase();
    const isAnxious = ["angst", "unsicher", "panik", "überfordert", "stress", "sorge"].some(w => lower.includes(w));
    const isFrustrated = ["frustri", "nerv", "geht nicht", "funktioniert nicht", "kaputt", "schlecht"].some(w => lower.includes(w));

    let emotionalContext = "";
    if (isAnxious) {
      emotionalContext = "\n\nWICHTIG: Der Nutzer zeigt Anzeichen von Prüfungsangst. Antworte besonders einfühlsam, beruhigend und ermutigend. Verwende kurze Sätze. Betone, dass Prüfungsangst normal ist und dass gute Vorbereitung Sicherheit gibt.";
    } else if (isFrustrated) {
      emotionalContext = "\n\nWICHTIG: Der Nutzer scheint frustriert. Antworte sachlich, lösungsorientiert und validiere das Gefühl kurz. Zeige einen konkreten nächsten Schritt auf.";
    }

    const answerType = ANSWER_TYPES[ticketType] || "explanation";
    const contextStr = contextParts.length > 0 ? `\n\nKontext aus dem Lernsystem (SSOT):\n${contextParts.join("\n")}` : "";
    const professionContext = professionName ? `\nDer Nutzer lernt für den Beruf: ${professionName}. Beziehe dich in deinen Antworten auf diesen Beruf.` : "";

    const lengthConfig = getSupportMaxLength(ticketType || "verstaendnisfrage");

    const guardrailRules = [
      professionName
        ? `Du bist ein freundlicher Lern-Assistent für angehende ${professionName}. Du hilfst bei Fragen rund um die Ausbildung und IHK-Prüfung.`
        : "Du bist ein freundlicher IHK-Prüfungsassistent. Du hilfst bei Fragen rund um die Ausbildung und IHK-Prüfung.",
      "Antworte NUR basierend auf dem bereitgestellten Kontext. Erfinde KEINE Informationen.",
      "Wenn du es nicht weißt, sage ehrlich: 'Das kann ich leider nicht beantworten. Wende dich an deinen Ausbilder oder die IHK.'",
      "Antworte immer auf Deutsch, klar und motivierend.",
      `Antwortlänge: ${lengthConfig.instruction}`,
      SOURCE_CITATION_RULE,
      "Gib KEINE rechtlichen oder medizinischen Ratschläge.",
      "Bei Prüfungsangst: Sei empathisch und ermutigend. Verweise bei Bedarf auf professionelle Hilfe.",
      "Nenne KEINE konkreten Prüfungsfragen oder Lösungen aus echten Prüfungen.",
      !contextParts.length ? SUPPORT_CONTEXT_REQUEST : "",
    ].filter(Boolean);

    const systemPrompt = `${guardrailRules.join("\n")}\n\nAntworttyp: ${answerType}${professionContext}${contextStr}${emotionalContext}`;

    // Route through model-routing.ts (support intent)
    const routed = getModel("support");

    const aiResult = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      max_tokens: 500,
    });

    const answer = aiResult.content || "Leider konnte ich keine Antwort generieren. Bitte versuche es erneut.";

    // Log the response
    const guardrailFlags: string[] = [];
    if (isAnxious) guardrailFlags.push("emotional:anxious");
    if (isFrustrated) guardrailFlags.push("emotional:frustrated");
    if (!contextParts.length) guardrailFlags.push("no_ssot_context");

    await adminClient.from("support_ai_responses").insert({
      user_id: userId,
      question,
      answer,
      answer_type: answerType,
      context_course_id: contextCourseId || null,
      context_lesson_id: contextLessonId || null,
      context_competency_id: contextCompetencyId || null,
      model_used: routed.model,
      tokens_used: aiResult.usage?.total_tokens || 0,
      guardrail_flags: guardrailFlags,
    });

    return new Response(JSON.stringify({ 
      answer,
      answerType,
      guardrailFlags,
      emotionalState: isAnxious ? "anxious" : isFrustrated ? "frustrated" : "neutral",
    }), {
      headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("support-ai error:", e);
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    const isRateLimit = errMsg.includes("429") || errMsg.includes("rate");
    return new Response(JSON.stringify({ error: isRateLimit ? "Zu viele Anfragen. Bitte warte kurz." : errMsg }), {
      status: isRateLimit ? 429 : 500, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
    });
  }
});