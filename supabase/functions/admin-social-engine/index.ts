import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type PlatformVariant =
  | "suno"
  | "tasy_generic"
  | "linkedin_pro_b2b"
  | "linkedin_pro_learner"
  | "linkedin_post"
  | "facebook_post"
  | "xing_post"
  | "instagram_post_azubi"
  | "instagram_post_ausbildungsleiter"
  | "instagram_reel_azubi"
  | "instagram_reel_ausbildungsleiter"
  | "instagram_carousel"
  | "email_b2b"
  | "email_learner"
  | "blog_seo"
  | "carousel_linkedin"
  | "thought_leadership"
  | "kpi_video";

type Intent = "prüfungsfalle" | "merksatz" | "minicheck" | "usp_examfit";

type Action =
  | "generate"
  | "plan_week"
  | "generate_bundle"
  | "sequence_generate"
  | "list"
  | "delete";

interface RequestBody {
  action: Action;
  platform_variant?: PlatformVariant;
  intent?: Intent;
  audience?: string;
  funnel_stage?: string;
  campaign_id?: string;
  topic?: string;
  context?: string;
  // plan_week
  week_start?: string;
  platforms?: PlatformVariant[];
  // sequence
  sequence_name?: string;
  steps_count?: number;
  // list
  provider?: string;
  limit?: number;
  // delete
  id?: string;
}

function providerFromVariant(v: PlatformVariant): string {
  if (v === "suno") return "suno";
  if (v === "tasy_generic") return "tasy";
  if (v.startsWith("linkedin")) return "linkedin";
  if (v.startsWith("facebook")) return "facebook";
  if (v.startsWith("xing")) return "xing";
  if (v.startsWith("instagram")) return "instagram";
  if (v.startsWith("email")) return "email";
  if (v === "blog_seo") return "blog";
  if (v.startsWith("carousel")) return "carousel";
  if (v === "thought_leadership") return "thought_leadership";
  if (v === "kpi_video") return "kpi_video";
  return "unknown";
}

// System prompts per provider category
function buildSystemPrompt(variant: PlatformVariant, intent?: string): string {
  const provider = providerFromVariant(variant);

  const baseInstructions: Record<string, string> = {
    suno: "Du bist ein Songwriter für Lernsongs. Erstelle Lyrics + Style-Prompt für einen eingängigen, lehrreichen Song.",
    tasy: "Du bist ein Skript-Autor für Lern-Kurzvideos (TikTok/Reels-Stil). Erstelle einen Brief und ein Skript.",
    linkedin: "Du bist ein B2B-Content-Stratege. Erstelle professionelle LinkedIn-Posts mit Hooks, Value und CTA.",
    facebook: "Du bist ein Social Media Manager. Erstelle engagement-optimierte Facebook-Posts.",
    xing: "Du bist ein DACH-B2B-Marketing-Experte. Erstelle XING-Posts im professionellen DACH-Stil.",
    instagram: "Du bist ein Instagram-Content-Creator für Bildung. Erstelle Captions, Hashtags und visuelle Konzepte.",
    email: "Du bist ein E-Mail-Marketing-Experte. Erstelle konvertierende E-Mail-Sequenzen mit Subject Lines und Body.",
    blog: "Du bist ein SEO-Content-Writer. Erstelle suchmaschinenoptimierte Blog-Artikel mit klarer Struktur.",
    carousel: "Du bist ein Carousel-Designer. Erstelle Slide-für-Slide Content für LinkedIn/Instagram Carousels.",
    thought_leadership: "Du bist ein Thought-Leadership-Ghostwriter. Erstelle tiefgründige Meinungsbeiträge.",
    kpi_video: "Du bist ein Video-Skript-Autor. Erstelle Skripte für KPI/Ergebnis-Präsentationsvideos.",
  };

  let prompt = baseInstructions[provider] || "Du bist ein Content-Ersteller.";

  if (intent) {
    const intentMap: Record<string, string> = {
      prüfungsfalle: "Fokus: Typische Prüfungsfallen aufdecken und erklären.",
      merksatz: "Fokus: Einen einprägsamen Merksatz oder Eselsbrücke erstellen.",
      minicheck: "Fokus: Eine kurze Wissensüberprüfung mit Auflösung erstellen.",
      usp_examfit: "Fokus: Die Vorteile von ExamFit hervorheben (KI-gestütztes Lernen, IHK-Prüfungsvorbereitung).",
    };
    prompt += " " + (intentMap[intent] || "");
  }

  prompt += `\n\nAntworte IMMER als JSON-Objekt. Format je nach Plattform:
- suno: { "lyrics": "...", "style_prompt": "...", "title": "..." }
- tasy: { "brief": "...", "script": "...", "title": "..." }
- posts (linkedin/facebook/xing): { "text": "...", "hashtags": ["..."], "hook": "...", "cta": "..." }
- instagram: { "caption": "...", "hashtags": ["..."], "visual_concept": "...", "format": "post|reel|carousel" }
- email: { "subject": "...", "preview_text": "...", "body": "...", "cta_text": "...", "cta_url": "..." }
- blog: { "title": "...", "meta_description": "...", "body_markdown": "...", "keywords": ["..."] }
- carousel: { "title": "...", "slides": [{ "headline": "...", "body": "...", "visual_note": "..." }] }
- thought_leadership: { "title": "...", "text": "...", "key_insight": "..." }
- kpi_video: { "title": "...", "script": "...", "data_points": ["..."] }`;

  return prompt;
}

async function callAI(systemPrompt: string, userMessage: string): Promise<unknown> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth guard
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user is admin
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body: RequestBody = await req.json();
    const { action } = body;

    // ── LIST ──
    if (action === "list") {
      let query = supabase.from("social_content_items").select("*").order("created_at", { ascending: false });
      if (body.provider) query = query.eq("provider", body.provider);
      if (body.limit) query = query.limit(body.limit);
      else query = query.limit(50);

      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ items: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── DELETE ──
    if (action === "delete") {
      if (!body.id) throw new Error("id required for delete");
      const { error } = await supabase.from("social_content_items").delete().eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GENERATE (single content) ──
    if (action === "generate") {
      if (!body.platform_variant) throw new Error("platform_variant required");

      const systemPrompt = buildSystemPrompt(body.platform_variant, body.intent);
      const userMessage = [
        body.topic ? `Thema: ${body.topic}` : "",
        body.context ? `Kontext: ${body.context}` : "",
        body.audience ? `Zielgruppe: ${body.audience}` : "",
        body.funnel_stage ? `Funnel-Stage: ${body.funnel_stage}` : "",
      ].filter(Boolean).join("\n");

      const payload = await callAI(systemPrompt, userMessage || "Erstelle kreativen Content.");

      const { data, error } = await supabase.from("social_content_items").insert({
        provider: providerFromVariant(body.platform_variant),
        platform_variant: body.platform_variant,
        intent: body.intent,
        audience: body.audience,
        funnel_stage: body.funnel_stage,
        campaign_id: body.campaign_id || null,
        title: (payload as Record<string, unknown>).title as string || body.topic || body.platform_variant,
        payload,
        created_by: user.id,
      }).select().single();

      if (error) throw error;
      return new Response(JSON.stringify({ item: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── PLAN_WEEK ──
    if (action === "plan_week") {
      const platforms = body.platforms || ["linkedin_post", "instagram_post_azubi", "email_b2b"] as PlatformVariant[];
      const results = [];

      for (const variant of platforms) {
        const systemPrompt = buildSystemPrompt(variant as PlatformVariant, body.intent);
        const userMsg = `Wochenplanung ab ${body.week_start || "nächste Woche"}. Thema: ${body.topic || "Prüfungsvorbereitung"}. Erstelle 1 Content-Stück.`;

        const payload = await callAI(systemPrompt, userMsg);

        const { data, error } = await supabase.from("social_content_items").insert({
          provider: providerFromVariant(variant as PlatformVariant),
          platform_variant: variant,
          intent: body.intent,
          audience: body.audience,
          campaign_id: body.campaign_id || null,
          title: (payload as Record<string, unknown>).title as string || `Week Plan: ${variant}`,
          payload,
          created_by: user.id,
        }).select().single();

        if (error) throw error;
        results.push(data);
      }

      return new Response(JSON.stringify({ items: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GENERATE_BUNDLE ──
    if (action === "generate_bundle") {
      const variants: PlatformVariant[] = [
        "linkedin_post", "facebook_post", "instagram_post_azubi", "email_b2b", "blog_seo"
      ];
      const results = [];

      for (const variant of variants) {
        const systemPrompt = buildSystemPrompt(variant, body.intent);
        const userMsg = `Thema: ${body.topic || "ExamFit Prüfungsvorbereitung"}. ${body.context || ""}`;

        const payload = await callAI(systemPrompt, userMsg);

        const { data, error } = await supabase.from("social_content_items").insert({
          provider: providerFromVariant(variant),
          platform_variant: variant,
          intent: body.intent,
          audience: body.audience,
          campaign_id: body.campaign_id || null,
          title: (payload as Record<string, unknown>).title as string || `Bundle: ${variant}`,
          payload,
          created_by: user.id,
        }).select().single();

        if (error) throw error;
        results.push(data);
      }

      return new Response(JSON.stringify({ items: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SEQUENCE_GENERATE ──
    if (action === "sequence_generate") {
      const seqName = body.sequence_name || "Neue Nurture-Sequenz";
      const stepsCount = body.steps_count || 5;

      const { data: seq, error: seqErr } = await supabase.from("social_nurture_sequences")
        .insert({ name: seqName }).select().single();
      if (seqErr) throw seqErr;

      const steps = [];
      for (let i = 1; i <= stepsCount; i++) {
        const prompt = buildSystemPrompt("email_b2b", body.intent);
        const userMsg = `E-Mail ${i}/${stepsCount} einer Nurture-Sequenz "${seqName}". Thema: ${body.topic || "Prüfungsvorbereitung"}. Ziel: Lead zu Kauf konvertieren.`;

        const payload = await callAI(prompt, userMsg) as Record<string, unknown>;

        const { data: step, error: stepErr } = await supabase.from("social_nurture_steps").insert({
          sequence_id: seq.id,
          step_order: i,
          subject: payload.subject as string || `Step ${i}`,
          body: payload.body as string || "",
        }).select().single();
        if (stepErr) throw stepErr;
        steps.push(step);
      }

      return new Response(JSON.stringify({ sequence: seq, steps }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Social Engine error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
