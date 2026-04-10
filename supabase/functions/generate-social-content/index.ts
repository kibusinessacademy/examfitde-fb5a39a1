import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * generate-social-content
 * Generates platform-specific social media content from existing content/results.
 * Supports: TikTok, LinkedIn, Instagram, Facebook, XING
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { source_type, source_id, platform, content_text } = body;

    if (!platform) return json(400, { error: "platform required" });

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return json(500, { error: "LOVABLE_API_KEY not configured" });

    // Load source content if provided
    let sourceContent = content_text ?? "";
    if (source_type === "blog_post" && source_id) {
      const { data } = await sb.from("blog_posts").select("title, content_md, meta_description").eq("id", source_id).single();
      if (data) sourceContent = `Titel: ${data.title}\n${data.meta_description}\n\n${(data.content_md ?? "").substring(0, 1000)}`;
    } else if (source_type === "content_generation_job" && source_id) {
      const { data } = await sb.from("content_generation_jobs").select("draft_content").eq("id", source_id).single();
      if (data?.draft_content) sourceContent = JSON.stringify(data.draft_content).substring(0, 1500);
    }

    const platformPrompts: Record<string, string> = {
      tiktok: "Erstelle ein TikTok-Skript (30-60s). Hook in den ersten 3 Sekunden. Bildungscontent. Deutsch.",
      linkedin: "Erstelle einen LinkedIn-Post. Professionell, lehrreich, mit Takeaway. Deutsch. Max 1300 Zeichen.",
      instagram: "Erstelle eine Instagram-Caption. Emotional, mit Emojis, Call-to-Action. Deutsch. Max 2200 Zeichen.",
      facebook: "Erstelle einen Facebook-Post. Direkt, teilbar, mit Frage am Ende. Deutsch.",
      xing: "Erstelle einen XING-Post. Business-orientiert, Weiterbildungs-Fokus. Deutsch.",
    };

    const systemPrompt = platformPrompts[platform] ?? platformPrompts.linkedin;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: `Du bist ein Social-Media-Content-Creator für ExamFit (Prüfungsvorbereitung). ${systemPrompt}` },
          { role: "user", content: `Erstelle einen Post basierend auf:\n\n${sourceContent}\n\nPlattform: ${platform}\nMarke: ExamFit\nCTA: Prüfungsreife testen auf examfit.de` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "social_post",
            description: "Generated social media post",
            parameters: {
              type: "object",
              properties: {
                hook: { type: "string" },
                body: { type: "string" },
                cta: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                platform: { type: "string" },
              },
              required: ["hook", "body", "cta", "platform"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "social_post" } },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) return json(429, { error: "Rate limited, please try again later." });
      if (res.status === 402) return json(402, { error: "Credits exhausted." });
      return json(500, { error: "AI gateway error" });
    }

    const data = await res.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    let result: any = { platform, content: data.choices?.[0]?.message?.content ?? "" };
    if (tc) {
      try { result = JSON.parse(tc.function.arguments); } catch {}
    }

    return json(200, { ok: true, result });
  } catch (e) {
    console.error("generate-social-content error:", e);
    return json(500, { error: e instanceof Error ? e.message : "unknown" });
  }

  function json(status: number, data: any) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
