import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI Tutor Governance Modes (SSOT)
const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

type AIMode = typeof AI_MODES[keyof typeof AI_MODES];

// Mode-specific rules
const MODE_RULES: Record<AIMode, {
  allowExplanations: boolean;
  allowHints: boolean;
  allowSolutions: boolean;
  allowedTopics: string[];
  systemPrompt: string;
}> = {
  [AI_MODES.LEARNING]: {
    allowExplanations: true,
    allowHints: true,
    allowSolutions: true,
    allowedTopics: ['*'], // All topics allowed
    systemPrompt: `Du bist ein hilfreicher Lern-Tutor für Fachinformatiker-Azubis.
Du darfst:
- Inhalte erklären und Beispiele geben
- Schritt-für-Schritt-Erklärungen liefern
- Merkhilfen und Visualisierungen vorschlagen
- Lernpfade empfehlen
- Alle Fragen beantworten

Sei freundlich, ermutigend und pädagogisch wertvoll.`
  },
  [AI_MODES.PRACTICE]: {
    allowExplanations: true,
    allowHints: true,
    allowSolutions: false, // Only after answer
    allowedTopics: ['feedback', 'hints', 'similar_questions'],
    systemPrompt: `Du bist ein Übungs-Tutor für Fachinformatiker-Azubis im Trainingsmodus.

WICHTIGE REGELN:
- Gib NIEMALS die Lösung BEVOR der Nutzer geantwortet hat
- Nach einer Antwort: Gib Feedback und erkläre Denkfehler
- Du darfst auf Lerninhalte verweisen
- Du darfst ähnliche (aber NICHT identische) Übungsfragen vorschlagen
- Analysiere Schwächen und gib Lernempfehlungen

Goldene Regel: Erst Antwort → dann Hilfe`
  },
  [AI_MODES.EXAM]: {
    allowExplanations: false,
    allowHints: false,
    allowSolutions: false,
    allowedTopics: ['meta', 'technical'],
    systemPrompt: `Du bist ein Prüfungsassistent. Du befindest dich im STRIKTEN PRÜFUNGSMODUS.

🚨 STRIKT VERBOTEN:
- Lösungen anzeigen oder andeuten
- Hinweise geben ("Denk mal an...")
- Erklärungen liefern
- Fragen umschreiben oder paraphrasieren
- Inhaltliche Hilfe jeglicher Art

✅ ERLAUBT (nur diese!):
- Organisatorisches: "Wie viel Zeit habe ich noch?"
- Technisches: "Meine Antwort wurde nicht gespeichert"
- Navigation: "Wie komme ich zur nächsten Frage?"

Bei JEDER inhaltlichen Anfrage antworte:
"Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Bei technischen Problemen helfe ich gerne."`
  }
};

// Hash function for audit logging (privacy-preserving)
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if request is allowed in exam mode
function isAllowedInExamMode(message: string): { allowed: boolean; reason?: string } {
  const lowerMessage = message.toLowerCase();
  
  // Technical/meta keywords that ARE allowed
  const allowedPatterns = [
    /zeit|timer|uhr|minuten|sekunden/,
    /speichern|gespeichert|abgeschickt/,
    /nächste|vorherige|frage|navigation/,
    /abbrechen|beenden|pausieren/,
    /technisch|fehler|problem|lädt nicht/,
    /hilfe.*technisch|technisch.*hilfe/,
  ];
  
  for (const pattern of allowedPatterns) {
    if (pattern.test(lowerMessage)) {
      return { allowed: true };
    }
  }
  
  // Content-related keywords that are BLOCKED
  const blockedPatterns = [
    /erkläre?|erklärung/,
    /was ist|was sind|was bedeutet/,
    /wie funktioniert|wie geht/,
    /warum|weshalb|wieso/,
    /lösung|antwort|richtig/,
    /hilf mir|kannst du.*helfen/,
    /beispiel|zeig mir/,
    /unterschied zwischen/,
    /definier|definition/,
  ];
  
  for (const pattern of blockedPatterns) {
    if (pattern.test(lowerMessage)) {
      return { 
        allowed: false, 
        reason: 'Inhaltliche Anfragen sind im Prüfungsmodus nicht erlaubt' 
      };
    }
  }
  
  // Default: allow but with strict response
  return { allowed: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      message, 
      mode, 
      sessionId, 
      sessionType = 'learning',
      conversationHistory = [] 
    } = await req.json();

    // Validate mode
    const validMode = Object.values(AI_MODES).includes(mode) ? mode : AI_MODES.LEARNING;
    const modeRules = MODE_RULES[validMode as AIMode];

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user ID from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SERVER-SIDE ENFORCEMENT: Check if request is allowed
    let wasBlocked = false;
    let blockReason: string | null = null;
    let response = '';

    if (validMode === AI_MODES.EXAM) {
      const examCheck = isAllowedInExamMode(message);
      if (!examCheck.allowed) {
        wasBlocked = true;
        blockReason = examCheck.reason || 'Blocked in exam mode';
        response = 'Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Bei technischen Problemen helfe ich gerne.';
      }
    }

    // If not blocked, call AI
    let tokensUsed = 0;
    if (!wasBlocked) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        throw new Error("LOVABLE_API_KEY is not configured");
      }

      // Build messages with mode-specific system prompt
      const messages = [
        { role: "system", content: modeRules.systemPrompt },
        ...conversationHistory.slice(-10), // Keep last 10 messages for context
        { role: "user", content: message }
      ];

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          max_tokens: 1000,
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Bitte versuche es später erneut." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI-Kontingent erschöpft." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw new Error(`AI gateway error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      response = aiData.choices?.[0]?.message?.content || 'Keine Antwort erhalten.';
      tokensUsed = aiData.usage?.total_tokens || 0;
    }

    // AUDIT LOGGING (AZAV-compliant)
    const promptHash = await sha256(message);
    const responseHash = await sha256(response);

    await supabase.from('ai_tutor_logs').insert({
      user_id: user.id,
      session_id: sessionId || null,
      session_type: sessionType,
      mode: validMode,
      prompt_hash: promptHash,
      response_hash: responseHash,
      prompt_length: message.length,
      response_length: response.length,
      tokens_used: tokensUsed,
      was_blocked: wasBlocked,
      block_reason: blockReason,
      metadata: {
        conversation_length: conversationHistory.length,
      }
    });

    return new Response(
      JSON.stringify({ 
        response,
        mode: validMode,
        wasBlocked,
        blockReason,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AI Tutor error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
