import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const GUARDRAIL_RULES = [
  "Du bist ein IHK-Prüfungsassistent. Du antwortest NUR basierend auf dem bereitgestellten Kontext.",
  "Erfinde KEINE Informationen. Wenn du es nicht weißt, sage 'Das kann ich nicht beantworten'.",
  "Antworte immer auf Deutsch, klar und prüfungsnah.",
  "Maximal 3-5 Sätze pro Antwort.",
  "Gib KEINE rechtlichen oder medizinischen Ratschläge.",
  "Bei Prüfungsangst: Sei empathisch, beruhigend, verweise auf professionelle Hilfe wenn nötig.",
  "Nenne KEINE konkreten Prüfungsfragen oder Lösungen aus echten Prüfungen.",
];

const ANSWER_TYPES: Record<string, string> = {
  verstaendnisfrage: "explanation",
  technisch: "technical_help",
  pruefungsangst: "reassurance",
  lernstrategie: "strategy",
  abrechnung: "billing_help",
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    const { question, ticketType, contextCourseId, contextLessonId, contextCompetencyId, userId } = await req.json();

    if (!question || !userId) {
      return new Response(JSON.stringify({ error: "Missing question or userId" }), {
        status: 400, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Load SSOT context server-side
    let contextParts: string[] = [];

    if (contextCourseId) {
      const { data: course } = await adminClient
        .from("courses")
        .select("title, description")
        .eq("id", contextCourseId)
        .maybeSingle();
      if (course) contextParts.push(`Kurs: ${course.title}. ${course.description || ""}`);
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
      emotionalContext = "\n\nWICHTIG: Der Nutzer zeigt Anzeichen von Prüfungsangst. Antworte besonders einfühlsam, beruhigend und ermutigend. Verwende kurze Sätze. Betone, dass Prüfungsangst normal ist.";
    } else if (isFrustrated) {
      emotionalContext = "\n\nWICHTIG: Der Nutzer scheint frustriert. Antworte sachlich, lösungsorientiert und validiere das Gefühl kurz.";
    }

    const answerType = ANSWER_TYPES[ticketType] || "explanation";
    const contextStr = contextParts.length > 0 ? `\n\nKontext aus dem Lernsystem (SSOT):\n${contextParts.join("\n")}` : "";

    const systemPrompt = `${GUARDRAIL_RULES.join("\n")}\n\nAntworttyp: ${answerType}${contextStr}${emotionalContext}`;

    // Call DeepSeek (cost-efficient for support)
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not configured");

    const aiResponse = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        max_tokens: 500,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte versuche es gleich nochmal." }), {
          status: 429, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI-Kontingent erschöpft." }), {
          status: 402, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const answer = aiData.choices?.[0]?.message?.content || "Leider konnte ich keine Antwort generieren.";
    const tokensUsed = aiData.usage?.total_tokens || 0;

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
      model_used: "google/gemini-3-flash-preview",
      tokens_used: tokensUsed,
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
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
    });
  }
});
