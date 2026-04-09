import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL") || `${SUPABASE_URL}/functions/v1/ai-gateway`;

const HOOK_TEMPLATES = [
  "90% fallen bei dieser Frage durch…",
  "Diese {exam}-Falle kostet dich Punkte",
  "Wenn du DAS nicht verstehst, fällst du durch",
  "Typischer Fehler in der {exam}-Prüfung",
  "Wusstest du? Diese Frage kommt fast IMMER dran",
  "Die meisten Prüflinge machen hier den gleichen Fehler",
  "Stopp! Kannst du DAS erklären? Die meisten können es nicht",
  "Prüfer lieben diese Frage – du auch?",
  "Diese Frage trennt Bestehen von Durchfallen",
  "3 Sekunden – und du weißt, ob du bestehst",
];

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify partner
    const { data: partner } = await admin
      .from("partner_accounts")
      .select("id, partner_type, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!partner) {
      return new Response(JSON.stringify({ error: "No active partner account" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { blueprint_id, question_id, competency_id, content_type, platform, tone, target_group } = body;

    if (!content_type || !platform) {
      return new Response(JSON.stringify({ error: "content_type and platform required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!blueprint_id && !question_id && !competency_id) {
      return new Response(JSON.stringify({ error: "blueprint_id, question_id, or competency_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create pending job
    const { data: job, error: jobErr } = await admin
      .from("partner_content_jobs")
      .insert({
        partner_id: partner.id,
        blueprint_id, question_id, competency_id,
        content_type, platform,
        status: "generating",
      })
      .select()
      .single();

    if (jobErr) throw jobErr;

    // Load SSOT data
    let contextData: any = {};

    if (question_id) {
      const { data: q } = await admin
        .from("exam_questions")
        .select("question_text, explanation, trap_type, difficulty, options, curricula(title)")
        .eq("id", question_id)
        .single();
      if (q) contextData = { type: "question", ...q, exam_name: (q as any).curricula?.title };
    } else if (blueprint_id) {
      const { data: bp } = await admin
        .from("question_blueprints")
        .select("topic, subtopic, cognitive_level, typical_errors, curricula(title)")
        .eq("id", blueprint_id)
        .single();
      if (bp) contextData = { type: "blueprint", ...bp, exam_name: (bp as any).curricula?.title };
    } else if (competency_id) {
      const { data: comp } = await admin
        .from("competencies")
        .select("title, description, curricula(title)")
        .eq("id", competency_id)
        .single();
      if (comp) contextData = { type: "competency", ...comp, exam_name: (comp as any).curricula?.title };
    }

    // Select random hook
    const hook = HOOK_TEMPLATES[Math.floor(Math.random() * HOOK_TEMPLATES.length)]
      .replace("{exam}", contextData.exam_name || "IHK");

    // Build prompt based on content type
    const prompt = buildPrompt(content_type, platform, contextData, hook, tone, target_group);

    // Call AI Gateway
    try {
      const aiResponse = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Du bist ein Performance-Marketing-Experte für Bildungsprodukte. Du erstellst conversion-optimierten Content für Social Media, Ads und E-Mail-Marketing. Antworte ausschließlich mit strukturiertem JSON." },
            { role: "user", content: prompt },
          ],
          temperature: 0.8,
          max_tokens: 2000,
        }),
      });

      const aiResult = await aiResponse.json();
      const content = aiResult.choices?.[0]?.message?.content || aiResult.content || "";

      // Parse JSON from response
      let output: any;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        output = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: content };
      } catch {
        output = { raw: content };
      }

      // Update job
      await admin
        .from("partner_content_jobs")
        .update({
          status: "completed",
          hook,
          output,
          usage: aiResult.usage || null,
        })
        .eq("id", job.id);

      return new Response(JSON.stringify({
        ok: true,
        job_id: job.id,
        hook,
        output,
        content_type,
        platform,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (aiError) {
      await admin
        .from("partner_content_jobs")
        .update({ status: "failed" })
        .eq("id", job.id);
      throw aiError;
    }
  } catch (e) {
    console.error("[generate-partner-content] Error:", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildPrompt(
  contentType: string,
  platform: string,
  context: any,
  hook: string,
  tone?: string,
  targetGroup?: string
): string {
  const examName = context.exam_name || "Prüfung";
  const toneHint = tone ? `Tonalität: ${tone}.` : "Tonalität: motivierend, direkt, leicht provokant.";
  const targetHint = targetGroup ? `Zielgruppe: ${targetGroup}.` : "Zielgruppe: Prüflinge (Azubis, Studierende).";
  
  let contextBlock = "";
  if (context.type === "question") {
    contextBlock = `
PRÜFUNGSFRAGE: "${context.question_text}"
ERKLÄRUNG: "${context.explanation || 'Keine Erklärung verfügbar'}"
TYPISCHE FALLE: "${context.trap_type || 'Keine'}"
SCHWIERIGKEIT: ${context.difficulty || 'mittel'}`;
  } else if (context.type === "blueprint") {
    contextBlock = `
THEMA: "${context.topic}"
UNTERTHEMA: "${context.subtopic || ''}"
KOGNITIVE STUFE: ${context.cognitive_level || ''}
TYPISCHE FEHLER: ${JSON.stringify(context.typical_errors || [])}`;
  } else if (context.type === "competency") {
    contextBlock = `
KOMPETENZ: "${context.title}"
BESCHREIBUNG: "${context.description || ''}"`;
  }

  const structureMap: Record<string, string> = {
    tiktok_video: `Erstelle ein TikTok/Reels-Skript. JSON-Format:
{ "hook_0_3s": "...", "problem_3_8s": "...", "trap_reveal_8_15s": "...", "solution_15_25s": "...", "cta_25_30s": "...", "hashtags": ["..."], "caption": "..." }`,
    instagram_reel: `Erstelle ein Instagram-Reel-Skript. JSON-Format:
{ "hook": "...", "problem": "...", "reveal": "...", "solution": "...", "cta": "...", "caption": "...", "hashtags": ["..."] }`,
    ad_copy: `Erstelle Anzeigentexte für ${platform}. JSON-Format:
{ "headline_1": "...", "headline_2": "...", "primary_text": "...", "cta": "...", "pain_point": "...", "benefit": "...", "variant_b_headline": "...", "variant_b_primary": "..." }`,
    email_sequence: `Erstelle eine 3-E-Mail-Sequenz. JSON-Format:
{ "email_1": { "subject": "...", "preview": "...", "body": "..." }, "email_2": { "subject": "...", "preview": "...", "body": "..." }, "email_3": { "subject": "...", "preview": "...", "body": "..." } }`,
    landingpage: `Erstelle Landingpage-Texte. JSON-Format:
{ "headline": "...", "subheadline": "...", "hero_text": "...", "benefits": ["..."], "social_proof": "...", "cta_primary": "...", "cta_secondary": "...", "faq": [{"q":"...","a":"..."}] }`,
    hook_generator: `Erstelle 10 verschiedene Hooks. JSON-Format:
{ "hooks": [{ "text": "...", "style": "...", "platform_best": "..." }] }`,
    fehleranalyse_post: `Erstelle einen Fehleranalyse-Post. JSON-Format:
{ "title": "...", "hook": "...", "error_description": "...", "why_wrong": "...", "correct_answer": "...", "takeaway": "...", "cta": "...", "hashtags": ["..."] }`,
  };

  return `
KONTEXT:
Prüfung: ${examName}
${contextBlock}

HOOK: "${hook}"
${toneHint}
${targetHint}
Plattform: ${platform}
Produkt: ExamFit Prüfungstraining (einmalig 24,90€, 12 Monate Zugang)
CTA-Link: https://examfit.de/shop

AUFGABE:
${structureMap[contentType] || "Erstelle conversion-optimierten Marketing-Content als JSON."}

Antworte NUR mit dem JSON-Objekt, kein Markdown.`;
}
