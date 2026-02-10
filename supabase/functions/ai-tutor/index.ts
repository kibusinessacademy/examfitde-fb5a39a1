import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// AI Tutor Governance Modes (SSOT)
const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

const AI_ROLES = {
  EXPLAINER: 'explainer',
  COACH: 'coach',
  EXAMINER: 'examiner',
  FEEDBACK: 'feedback'
} as const;

type AIMode = typeof AI_MODES[keyof typeof AI_MODES];
type AIRole = typeof AI_ROLES[keyof typeof AI_ROLES];

// Mode-specific rules
const MODE_RULES: Record<AIMode, { allowExplanations: boolean; systemPrompt: string }> = {
  [AI_MODES.LEARNING]: {
    allowExplanations: true,
    systemPrompt: `Du bist ein hilfreicher Lern-Tutor für Azubis in der dualen Ausbildung.
Du darfst: Inhalte erklären, Beispiele geben, Schritt-für-Schritt-Erklärungen liefern, Merkhilfen vorschlagen, Lernpfade empfehlen.
Sei freundlich, ermutigend und pädagogisch wertvoll.
WICHTIG: Du erfindest KEINE neuen Inhalte, sondern referenzierst nur das Curriculum.`
  },
  [AI_MODES.PRACTICE]: {
    allowExplanations: true,
    systemPrompt: `Du bist ein Übungs-Tutor im Trainingsmodus.
WICHTIGE REGELN: Gib NIEMALS die Lösung BEVOR der Nutzer geantwortet hat.
Nach einer Antwort: Gib Feedback und erkläre Denkfehler.
Goldene Regel: Erst Antwort → dann Hilfe`
  },
  [AI_MODES.EXAM]: {
    allowExplanations: false,
    systemPrompt: `Du bist ein Prüfungsassistent im STRIKTEN PRÜFUNGSMODUS.
🚨 STRIKT VERBOTEN: Lösungen, Hinweise, Erklärungen, inhaltliche Hilfe jeglicher Art.
✅ ERLAUBT: Organisatorisches, Technisches, Navigation.
Bei JEDER inhaltlichen Anfrage antworte: "Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben."`
  }
};

const ROLE_PROMPTS: Record<AIRole, string> = {
  [AI_ROLES.EXPLAINER]: `\nROLLE: Erklärer – Erkläre Konzepte einfach, nutze Analogien, zerlege komplexe Themen.`,
  [AI_ROLES.COACH]: `\nROLLE: Lern-Coach – Gib Tipps zur Lernstrategie, motiviere, identifiziere Lernblockaden.`,
  [AI_ROLES.EXAMINER]: `\nROLLE: Prüfungs-Trainer – Stelle IHK-Prüfungsfragen, gib Feedback, trainiere Zeitmanagement.`,
  [AI_ROLES.FEEDBACK]: `\nROLLE: Feedback-Geber – Analysiere Leistung, identifiziere Stärken/Schwächen, gib Verbesserungsvorschläge.`
};

// Exam mode content filter
function isAllowedInExamMode(message: string): boolean {
  const lower = message.toLowerCase();
  const allowed = [/zeit|timer|uhr|minuten/, /speichern|gespeichert/, /nächste|vorherige|navigation/, /technisch|fehler|problem|lädt nicht/];
  for (const p of allowed) if (p.test(lower)) return true;
  const blocked = [/erkläre?|erklärung/, /was ist|was sind|was bedeutet/, /wie funktioniert/, /warum|weshalb/, /lösung|antwort|richtig/, /hilf mir/, /beispiel|zeig mir/];
  for (const p of blocked) if (p.test(lower)) return false;
  return true;
}

async function sha256(message: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { message, mode, role = 'explainer', sessionId, sessionType = 'learning', conversationHistory = [], context = {} } = await req.json();
    const { curriculumTitle, learningFieldTitle, competencyTitle, lessonTitle, lessonStep, miniCheckScore } = context;

    const validMode = Object.values(AI_MODES).includes(mode) ? mode : AI_MODES.LEARNING;
    const validRole = Object.values(AI_ROLES).includes(role) ? role : AI_ROLES.EXPLAINER;
    const modeRules = MODE_RULES[validMode as AIMode];
    const rolePrompt = ROLE_PROMPTS[validRole as AIRole] || '';

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Exam mode check
    if (validMode === AI_MODES.EXAM && !isAllowedInExamMode(message)) {
      const blocked = 'Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Bei technischen Problemen helfe ich gerne.';
      await logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, blocked, 0, true, 'Inhaltliche Anfrage im Prüfungsmodus', conversationHistory.length);
      return new Response(JSON.stringify({ response: blocked, mode: validMode, wasBlocked: true, blockReason: 'exam_mode' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build prompt
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let contextPrompt = '';
    if (curriculumTitle || competencyTitle || lessonTitle) {
      contextPrompt = `\n\n--- KONTEXT ---`;
      if (curriculumTitle) contextPrompt += `\nCurriculum: ${curriculumTitle}`;
      if (learningFieldTitle) contextPrompt += `\nLernfeld: ${learningFieldTitle}`;
      if (competencyTitle) contextPrompt += `\nKompetenz: ${competencyTitle}`;
      if (lessonTitle) contextPrompt += `\nLektion: ${lessonTitle}`;
      if (lessonStep) contextPrompt += `\nSchritt: ${lessonStep}`;
      if (miniCheckScore !== undefined) contextPrompt += `\nMiniCheck: ${miniCheckScore}%`;
    }

    const systemPrompt = modeRules.systemPrompt + rolePrompt + contextPrompt;
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: "user", content: message }
    ];

    // Stream from GPT-5.2 via Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-5.2", messages, stream: true }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Bitte später erneut versuchen." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI-Kontingent erschöpft." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    // Collect full response for audit logging, then stream to client
    // We use a TransformStream to tee: pass SSE through + collect text
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = aiResponse.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let fullResponse = "";

    (async () => {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          // Pass through SSE directly
          await writer.write(encoder.encode(chunk));

          // Extract text for logging
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) fullResponse += content;
            } catch { /* partial */ }
          }
        }
      } catch (e) {
        console.error("[ai-tutor] stream error:", e);
      } finally {
        writer.close();
        // Background audit logging
        logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, fullResponse, 0, false, null, conversationHistory.length).catch(console.error);
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (error) {
    console.error("AI Tutor error:", error);
    const origin = req.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logInteraction(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sessionId: string | null,
  sessionType: string,
  mode: string,
  prompt: string,
  response: string,
  tokensUsed: number,
  wasBlocked: boolean,
  blockReason: string | null,
  conversationLength: number
) {
  const [promptHash, responseHash] = await Promise.all([sha256(prompt), sha256(response)]);
  await supabase.from('ai_tutor_logs').insert({
    user_id: userId,
    session_id: sessionId || null,
    session_type: sessionType,
    mode,
    prompt_hash: promptHash,
    response_hash: responseHash,
    prompt_length: prompt.length,
    response_length: response.length,
    tokens_used: tokensUsed,
    was_blocked: wasBlocked,
    block_reason: blockReason,
    metadata: { conversation_length: conversationLength },
  });
}
