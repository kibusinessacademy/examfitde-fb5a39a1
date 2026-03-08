import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name, branche } = await req.json();
    if (!name) {
      return new Response(JSON.stringify({ error: "Name ist erforderlich" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Du bist ein Experte für deutsche Ausbildungsberufe und KI-Workflows im Berufsalltag.
Deine Aufgabe: Generiere eine vollständige "Berufs-DNA" für den Beruf "${name}"${branche ? ` (Branche: ${branche})` : ""}.

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown, keine Erklärung):
{
  "typische_aufgaben": ["Aufgabe1", "Aufgabe2", ...],
  "dokumenttypen": ["Typ1", "Typ2", ...],
  "pain_points": ["Pain1", "Pain2", ...],
  "haftungsrisiken": ["Risiko1", "Risiko2", ...],
  "seo_keywords": ["keyword1", "keyword2", ...]
}

Regeln:
- 6-10 typische_aufgaben: Konkrete Tätigkeiten im Arbeitsalltag
- 5-8 dokumenttypen: Typische Dokumente, die in diesem Beruf erstellt/bearbeitet werden
- 5-8 pain_points: Konkrete Schmerzpunkte im Arbeitsalltag, bei denen KI helfen kann
- 4-6 haftungsrisiken: Relevante rechtliche/regulatorische Risiken
- 8-12 seo_keywords: Suchbegriffe für KI-Tools + Beruf (z.B. "KI Kaufmann E-Commerce", "ChatGPT Buchhaltung")
- Alle Einträge auf Deutsch
- Spezifisch für den Beruf, keine generischen Einträge`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generiere die Berufs-DNA für: ${name}${branche ? ` (${branche})` : ""}` },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit – bitte kurz warten." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits aufgebraucht." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const raw = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON in AI response");

    const dna = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    // Validate structure
    const result = {
      typische_aufgaben: Array.isArray(dna.typische_aufgaben) ? dna.typische_aufgaben : [],
      dokumenttypen: Array.isArray(dna.dokumenttypen) ? dna.dokumenttypen : [],
      pain_points: Array.isArray(dna.pain_points) ? dna.pain_points : [],
      haftungsrisiken: Array.isArray(dna.haftungsrisiken) ? dna.haftungsrisiken : [],
      seo_keywords: Array.isArray(dna.seo_keywords) ? dna.seo_keywords : [],
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("work-generate-dna error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
