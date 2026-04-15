import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json; charset=utf-8" };

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers });
    }

    const body = await req.json();
    const { action, page_type, meta_title, meta_description, keywords, canonical_url } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers });
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "generate_jsonld") {
      systemPrompt = `Du bist ein SEO-Experte für schema.org Structured Data. Erstelle valides JSON-LD für eine Webseite.
Antworte NUR mit dem JSON-LD Objekt, kein Markdown, keine Erklärung. Das JSON muss mit { beginnen und mit } enden.
Verwende immer "@context": "https://schema.org".
Wähle den passenden @type basierend auf dem Seitentyp:
- homepage → WebSite + Organization
- shop/course → Product + Course
- blog → BlogPosting
- landing → WebPage
- legal → WebPage
- about → AboutPage
Füge immer breadcrumb und organization ein wo sinnvoll.
Brand: ExamFit (https://examfit.de) - IHK Prüfungsvorbereitung Plattform.`;

      userPrompt = `Erstelle JSON-LD für folgende Seite:
Seitentyp: ${page_type || "homepage"}
Title: ${meta_title || "ExamFit"}
Description: ${meta_description || ""}
Keywords: ${keywords || ""}
URL: ${canonical_url || "https://examfit.de"}`;
    } else if (action === "generate_meta") {
      systemPrompt = `Du bist ein SEO-Experte. Erstelle optimierte Meta-Tags für eine deutsche IHK-Prüfungsvorbereitungs-Plattform namens ExamFit.
Antworte im JSON-Format: {"meta_title": "...", "meta_description": "..."}
Meta-Title: max 60 Zeichen, Keyword vorne, Brand hinten.
Meta-Description: max 155 Zeichen, Call-to-Action, Keyword enthalten.`;

      userPrompt = `Erstelle Meta-Tags für:
Seitentyp: ${page_type || "homepage"}
Keywords: ${keywords || "IHK, Prüfung"}
Aktuelle URL: ${canonical_url || "https://examfit.de"}`;
    } else if (action === "improve_meta") {
      systemPrompt = `Du bist ein SEO-Experte. Verbessere die gegebenen Meta-Tags für bessere CTR und Rankings.
Antworte im JSON-Format: {"meta_title": "...", "meta_description": "..."}
Meta-Title: max 60 Zeichen. Meta-Description: max 155 Zeichen.`;

      userPrompt = `Verbessere diese Meta-Tags:
Title: ${meta_title}
Description: ${meta_description}
Seitentyp: ${page_type}
Keywords: ${keywords || ""}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit erreicht. Bitte warte kurz." }), { status: 429, headers });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI Credits aufgebraucht." }), { status: 402, headers });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ result: content }), { status: 200, headers });
  } catch (e) {
    console.error("[generate-seo-jsonld] Error:", e);
    return new Response(
      JSON.stringify({ error: String((e as Error)?.message ?? e) }),
      { status: 500, headers }
    );
  }
});
