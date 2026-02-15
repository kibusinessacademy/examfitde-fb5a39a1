import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAI } from "../_shared/ai-client.ts";

/**
 * AI-Tutor – GPT-5.2 Deep Thinking + Opus Post-Validation
 * 
 * SSOT-Konform: Context wird serverseitig per IDs geladen,
 * Client-Textfelder werden ignoriert.
 */

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

const MODE_RULES: Record<AIMode, { allowExplanations: boolean; systemPrompt: string }> = {
  [AI_MODES.LEARNING]: {
    allowExplanations: true,
    systemPrompt: `Du bist ein erfahrener IHK-Lern-Tutor für Azubis in der dualen Ausbildung.
Du nutzt Deep Thinking um komplexe Zusammenhänge verständlich zu erklären.
Du darfst: Inhalte erklären, Beispiele geben, Schritt-für-Schritt-Erklärungen, Merkhilfen, Lernpfade empfehlen.
WICHTIG: Du referenzierst NUR das Curriculum. Erfinde KEINE Fakten, Gesetze oder Paragraphen.
Nenne immer die Quelle wenn du Fachbegriffe oder Regelungen erklärst.
Sei freundlich, ermutigend und pädagogisch wertvoll.`
  },
  [AI_MODES.PRACTICE]: {
    allowExplanations: true,
    systemPrompt: `Du bist ein Übungs-Tutor im Trainingsmodus.
REGELN: Gib NIEMALS die Lösung BEVOR der Nutzer geantwortet hat.
Nach Antwort: Gib detailliertes Feedback, erkläre Denkfehler, zeige den korrekten Lösungsweg.
Goldene Regel: Erst Antwort → dann Hilfe`
  },
  [AI_MODES.EXAM]: {
    allowExplanations: false,
    systemPrompt: `Du bist ein Prüfungsassistent im STRIKTEN PRÜFUNGSMODUS.
🚨 STRIKT VERBOTEN: Lösungen, Hinweise, Erklärungen, inhaltliche Hilfe.
✅ ERLAUBT: Organisatorisches, Technisches, Navigation.
Bei JEDER inhaltlichen Anfrage: "Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben."`
  }
};

const ROLE_PROMPTS: Record<AIRole, string> = {
  [AI_ROLES.EXPLAINER]: `\nROLLE: Erklärer – Erkläre Konzepte einfach, nutze Analogien, zerlege komplexe Themen.`,
  [AI_ROLES.COACH]: `\nROLLE: Lern-Coach – Gib Tipps zur Lernstrategie, motiviere, identifiziere Lernblockaden.`,
  [AI_ROLES.EXAMINER]: `\nROLLE: Prüfungs-Trainer – Stelle IHK-Prüfungsfragen, gib Feedback, trainiere Zeitmanagement.`,
  [AI_ROLES.FEEDBACK]: `\nROLLE: Feedback-Geber – Analysiere Leistung, identifiziere Stärken/Schwächen.`
};

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

/**
 * SSOT Context Loader – loads context server-side by IDs
 * Client sends IDs only; all text fields are loaded from DB.
 */
async function loadSSOTContext(
  supabase: ReturnType<typeof createClient>,
  context: Record<string, unknown>
): Promise<{ contextPrompt: string; resolvedContext: Record<string, unknown> }> {
  const { curriculumId, learningFieldId, competencyId, lessonId, lessonStep, miniCheckScore } = context;
  
  const resolved: Record<string, unknown> = {};
  const parts: string[] = [];

  // Load curriculum + profession name
  if (curriculumId) {
    const { data } = await supabase
      .from('curricula')
      .select('id, title, beruf_id')
      .eq('id', curriculumId)
      .single();
    if (data) {
      resolved.curriculum = data;
      parts.push(`Curriculum: ${data.title}`);
      
      // Load profession name from berufe
      let professionName = "";
      if (data.beruf_id) {
        const { data: beruf } = await supabase
          .from('berufe')
          .select('bezeichnung_kurz, bezeichnung_lang')
          .eq('id', data.beruf_id)
          .maybeSingle();
        if (beruf) professionName = beruf.bezeichnung_kurz || beruf.bezeichnung_lang || "";
      }
      if (!professionName && data.title) {
        professionName = data.title.replace(/^Rahmenlehrplan\s+/i, "").trim();
      }
      if (professionName) {
        parts.push(`Beruf: ${professionName}`);
        resolved.professionName = professionName;
      }
    }
  }

  // Load learning field
  if (learningFieldId) {
    const { data } = await supabase
      .from('learning_fields')
      .select('id, title, code, description')
      .eq('id', learningFieldId)
      .single();
    if (data) {
      resolved.learningField = data;
      parts.push(`Lernfeld ${data.code}: ${data.title}`);
      if (data.description) parts.push(`Beschreibung: ${data.description}`);
    }
  }

  // Load competency
  if (competencyId) {
    const { data } = await supabase
      .from('competencies')
      .select('id, title, code, description, taxonomy_level')
      .eq('id', competencyId)
      .single();
    if (data) {
      resolved.competency = data;
      parts.push(`Kompetenz ${data.code}: ${data.title}`);
      if (data.taxonomy_level) parts.push(`Taxonomie: ${data.taxonomy_level}`);
      if (data.description) parts.push(`Beschreibung: ${data.description}`);
    }
  }

  // Load lesson content (actual SSOT content for the tutor to reference)
  if (lessonId) {
    const { data } = await supabase
      .from('lessons')
      .select('id, title, step, content, competency_id')
      .eq('id', lessonId)
      .single();
    if (data) {
      resolved.lesson = { id: data.id, title: data.title, step: data.step };
      parts.push(`Lektion: ${data.title} (Schritt: ${data.step})`);
      // Include lesson objectives for context (not full HTML)
      const content = data.content as Record<string, unknown> | null;
      if (content?.objectives) {
        parts.push(`Lernziele: ${(content.objectives as string[]).join(', ')}`);
      }
    }
  }

  if (lessonStep) {
    parts.push(`Aktueller Schritt: ${lessonStep}`);
    resolved.lessonStep = lessonStep;
  }

  if (miniCheckScore !== undefined && miniCheckScore !== null) {
    parts.push(`MiniCheck-Ergebnis: ${miniCheckScore}%`);
    resolved.miniCheckScore = miniCheckScore;
  }

  const contextPrompt = parts.length > 0
    ? `\n\n--- SSOT-KONTEXT (serverseitig geladen) ---\n${parts.join('\n')}`
    : '';

  return { contextPrompt, resolvedContext: resolved };
}

/**
 * Post-hoc Opus Validation
 */
async function postValidateTutorResponse(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
  response: string,
  resolvedContext: Record<string, unknown>,
  generationId: string,
) {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) return;

  try {
    const startTime = Date.now();
    const valResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Du prüfst eine KI-Tutor-Antwort auf fachliche Korrektheit. SCHNELL und PRÄZISE.
Kontext: ${JSON.stringify(resolvedContext)}

PRÜFE:
1. Alle Fakten korrekt?
2. Keine erfundenen Gesetze/Paragraphen/Normen?
3. Fachbegriffe korrekt verwendet?

Antworte NUR mit JSON:
{"score": 0-100, "decision": "approve|revise|reject", "correction_needed": bool, "correction": "string|null", "issues": []}`,
        messages: [{ role: "user", content: `FRAGE: ${prompt}\n\nTUTOR-ANTWORT: ${response}` }],
      }),
    });

    const latencyMs = Date.now() - startTime;
    if (!valResp.ok) return;

    const valData = await valResp.json();
    const rawText = valData.content?.[0]?.text || "";
    
    let result;
    try {
      result = JSON.parse(rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch { return; }

    await supabase.from("ai_validations").insert({
      generation_id: generationId,
      validator_model: "claude-sonnet-4-20250514",
      validation_mode: "automatic",
      overall_score: result.score || 0,
      decision: result.decision || "approve",
      dimension_scores: { fachlichkeit: result.score || 0 },
      critical_issues: result.issues || [],
      suggested_fixes: result.correction_needed ? [{ type: "correction", reason: result.correction }] : [],
      corrected_content: result.correction_needed ? { correction: result.correction } : null,
      input_tokens: valData.usage?.input_tokens || 0,
      output_tokens: valData.usage?.output_tokens || 0,
      cost_eur: 0,
      latency_ms: latencyMs,
    });

    await supabase.from("ai_generations").update({
      validation_decision: result.decision,
      validation_score: result.score,
      status: result.decision === "approve" ? "validated" : "draft",
    }).eq("id", generationId);

    if (result.correction_needed && result.correction) {
      console.log(`[Tutor PostVal] Correction needed for generation ${generationId}: ${result.correction}`);
    }
  } catch (err) {
    console.error("[Tutor PostVal] Error:", err);
  }
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { message, mode, role = 'explainer', sessionId, sessionType = 'learning', conversationHistory = [], context = {} } = await req.json();

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

    // Exam mode block
    if (validMode === AI_MODES.EXAM && !isAllowedInExamMode(message)) {
      const blocked = 'Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Bei technischen Problemen helfe ich gerne.';
      await logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, blocked, 0, true, 'Inhaltliche Anfrage im Prüfungsmodus', conversationHistory.length);
      return new Response(JSON.stringify({ response: blocked, mode: validMode, wasBlocked: true, blockReason: 'exam_mode' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── SSOT Context Loader (server-side) ──
    // Client sends IDs: curriculumId, learningFieldId, competencyId, lessonId
    // Server loads actual data from DB → prevents client manipulation
    const { contextPrompt, resolvedContext } = await loadSSOTContext(supabase, context);

    const systemPrompt = modeRules.systemPrompt + rolePrompt + contextPrompt;
    const aiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...conversationHistory.slice(-10).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message }
    ];

    // Create generation record BEFORE streaming
    const { data: genRecord } = await supabase.from("ai_generations").insert({
      entity_type: "tutor_response",
      generator_model: "openai/gpt-4.1",
      input_context: { mode: validMode, role: validRole, context: resolvedContext, prompt: message },
      output_content: {},
      status: "generated",
      created_by: user.id,
    }).select("id").single();

    const generationId = genRecord?.id;

    // Stream from OpenAI directly
    const { raw: aiResponse, ok, status } = await callAI({
      provider: "openai",
      messages: aiMessages,
      stream: true,
    });

    if (!ok) {
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Bitte später erneut versuchen." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI-Kontingent erschöpft." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      throw new Error(`OpenAI API error: ${status}`);
    }

    // Stream through + collect for post-validation
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
          await writer.write(encoder.encode(chunk));

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

        if (generationId) {
          await supabase.from("ai_generations").update({
            output_content: { response: fullResponse },
          }).eq("id", generationId);
        }

        logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, fullResponse, 0, false, null, conversationHistory.length).catch(console.error);

        if (generationId && validMode !== AI_MODES.EXAM) {
          postValidateTutorResponse(supabase, user.id, message, fullResponse, resolvedContext, generationId).catch(console.error);
        }
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
    metadata: { conversation_length: conversationLength, generator: "openai/gpt-5.2", validation: "async_opus" },
  });
}
