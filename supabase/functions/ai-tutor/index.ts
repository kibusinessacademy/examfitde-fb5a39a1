import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// AI Tutor Governance Modes (SSOT - erweitert gemäß Projektanweisungen)
const AI_MODES = {
  LEARNING: 'learning',   // Vollständige Tutor-Unterstützung
  PRACTICE: 'practice',   // Feedback nach Antwort
  EXAM: 'exam'            // Nur technische Hilfe
} as const;

// Didaktische Rollen des AI Tutors (SSOT)
const AI_ROLES = {
  EXPLAINER: 'explainer',     // Erklärer - vereinfachte Erklärungen
  COACH: 'coach',             // Coach - Lernstrategie & Tipps
  EXAMINER: 'examiner',       // Prüfer - typische IHK-Fragen
  FEEDBACK: 'feedback'        // Feedback-Geber - nach MiniChecks & Prüfungen
} as const;

type AIMode = typeof AI_MODES[keyof typeof AI_MODES];
type AIRole = typeof AI_ROLES[keyof typeof AI_ROLES];

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
    allowedTopics: ['*'],
    systemPrompt: `Du bist ein hilfreicher Lern-Tutor für Azubis in der dualen Ausbildung.
Du darfst:
- Inhalte erklären und Beispiele geben
- Schritt-für-Schritt-Erklärungen liefern
- Merkhilfen und Visualisierungen vorschlagen
- Lernpfade empfehlen
- Alle Fragen beantworten

Sei freundlich, ermutigend und pädagogisch wertvoll.
WICHTIG: Du erfindest KEINE neuen Inhalte, sondern referenzierst nur das Curriculum.`
  },
  [AI_MODES.PRACTICE]: {
    allowExplanations: true,
    allowHints: true,
    allowSolutions: false,
    allowedTopics: ['feedback', 'hints', 'similar_questions'],
    systemPrompt: `Du bist ein Übungs-Tutor im Trainingsmodus.

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
    systemPrompt: `Du bist ein Prüfungsassistent im STRIKTEN PRÜFUNGSMODUS.

🚨 STRIKT VERBOTEN:
- Lösungen anzeigen oder andeuten
- Hinweise geben
- Erklärungen liefern
- Fragen umschreiben
- Inhaltliche Hilfe jeglicher Art

✅ ERLAUBT (nur diese!):
- Organisatorisches: "Wie viel Zeit habe ich noch?"
- Technisches: "Meine Antwort wurde nicht gespeichert"
- Navigation: "Wie komme ich zur nächsten Frage?"

Bei JEDER inhaltlichen Anfrage antworte:
"Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Bei technischen Problemen helfe ich gerne."`
  }
};

// Role-specific prompts (zusätzlich zum Mode)
const ROLE_PROMPTS: Record<AIRole, string> = {
  [AI_ROLES.EXPLAINER]: `
ROLLE: Erklärer
- Erkläre Konzepte einfach und verständlich
- Nutze Analogien und Beispiele aus dem Alltag
- Zerlege komplexe Themen in kleine Schritte
- Verwende Fachbegriffe, aber erkläre sie
- Prüfe am Ende, ob der Lernende verstanden hat`,

  [AI_ROLES.COACH]: `
ROLLE: Lern-Coach
- Gib Tipps zur effektiven Lernstrategie
- Hilf bei der Priorisierung von Themen
- Motiviere und ermutige bei Schwierigkeiten
- Schlage Wiederholungsintervalle vor
- Identifiziere Lernblockaden und gib Lösungsvorschläge`,

  [AI_ROLES.EXAMINER]: `
ROLLE: Prüfungs-Trainer
- Stelle typische IHK-Prüfungsfragen
- Formuliere wie in echten Prüfungen
- Gib nach Antworten konstruktives Feedback
- Weise auf häufige Prüfungsfallen hin
- Trainiere Zeitmanagement und Prüfungsstrategie`,

  [AI_ROLES.FEEDBACK]: `
ROLLE: Feedback-Geber
- Analysiere die Leistung des Lernenden
- Identifiziere Stärken und Schwächen
- Gib konkrete Verbesserungsvorschläge
- Verknüpfe Fehler mit relevanten Lerneinheiten
- Erstelle einen Lernplan für Schwachstellen`
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
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { 
      message, 
      mode, 
      role = 'explainer',
      sessionId, 
      sessionType = 'learning',
      conversationHistory = [],
      // SSOT Context - Curriculum/Kompetenz-Kontext
      context = {}
    } = await req.json();

    const {
      curriculumId,
      curriculumTitle,
      learningFieldId,
      learningFieldTitle,
      competencyId,
      competencyTitle,
      lessonId,
      lessonTitle,
      lessonStep,
      miniCheckScore,
      examSessionId
    } = context;

    // Validate mode and role
    const validMode = Object.values(AI_MODES).includes(mode) ? mode : AI_MODES.LEARNING;
    const validRole = Object.values(AI_ROLES).includes(role) ? role : AI_ROLES.EXPLAINER;
    const modeRules = MODE_RULES[validMode as AIMode];
    const rolePrompt = ROLE_PROMPTS[validRole as AIRole] || '';

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

      // Build context-aware system prompt
      let contextPrompt = '';
      if (curriculumTitle || competencyTitle || lessonTitle) {
        contextPrompt = `\n\n--- KONTEXT (SSOT) ---`;
        if (curriculumTitle) contextPrompt += `\nCurriculum: ${curriculumTitle}`;
        if (learningFieldTitle) contextPrompt += `\nLernfeld: ${learningFieldTitle}`;
        if (competencyTitle) contextPrompt += `\nKompetenz: ${competencyTitle}`;
        if (lessonTitle) contextPrompt += `\nLektion: ${lessonTitle}`;
        if (lessonStep) contextPrompt += `\nAktueller Schritt: ${lessonStep}`;
        if (miniCheckScore !== undefined) contextPrompt += `\nLetztes MiniCheck-Ergebnis: ${miniCheckScore}%`;
        contextPrompt += `\n\nNutze diesen Kontext für präzise, curriculumbezogene Antworten.`;
      }

      // Build messages with mode + role + context
      const systemPrompt = modeRules.systemPrompt + rolePrompt + contextPrompt;
      
      const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.slice(-10),
        { role: "user", content: message }
      ];

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
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
