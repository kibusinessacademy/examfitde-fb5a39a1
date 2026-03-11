// Deno.serve is built-in
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name, branche } = await req.json();
    if (!name) {
      return new Response(JSON.stringify({ error: "Name ist erforderlich" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const chain = await getModelChainAsync("seo_content");
    const result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generiere die Berufs-DNA für: ${name}${branche ? ` (${branche})` : ""}` },
        ],
      },
    );

    const raw = result.content || "";

    // Parse JSON from response
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON in AI response");

    const dna = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    // Validate structure
    const validated = {
      typische_aufgaben: Array.isArray(dna.typische_aufgaben) ? dna.typische_aufgaben : [],
      dokumenttypen: Array.isArray(dna.dokumenttypen) ? dna.dokumenttypen : [],
      pain_points: Array.isArray(dna.pain_points) ? dna.pain_points : [],
      haftungsrisiken: Array.isArray(dna.haftungsrisiken) ? dna.haftungsrisiken : [],
      seo_keywords: Array.isArray(dna.seo_keywords) ? dna.seo_keywords : [],
    };

    return new Response(JSON.stringify(validated), {
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
