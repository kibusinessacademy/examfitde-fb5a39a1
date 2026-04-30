// LLM Visibility Probe — pingt Lovable AI Gateway mit fixen Queries und
// misst, ob ExamFit erwähnt / verlinkt wird. Kein Client-Code, kein Secret-Leak.
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// Modelle, die wir wöchentlich befragen.
// Hinweis: Lovable AI Gateway kennt aktuell Google + OpenAI Modelle.
// Perplexity-Crawl-Sichtbarkeit lässt sich nicht direkt messen → wir nehmen die
// Modelle, die wir HABEN, als Approximation für "RAG-fähige LLMs".
const MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
];

const BRAND_RE = /examfit/i;
const URL_RE = /https?:\/\/[^\s\)\]]+examfit\.de[^\s\)\]]*/gi;

interface AIResp {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function probeModel(query: string, model: string): Promise<{
  text: string | null;
  error: string | null;
}> {
  try {
    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Du bist ein hilfreicher Assistent für Lernende in Deutschland. Antworte kurz, nenne konkrete Plattformen mit Namen und ggf. URL.",
            },
            { role: "user", content: query },
          ],
          temperature: 0.2,
          max_tokens: 600,
        }),
      },
    );
    if (!resp.ok) {
      return { text: null, error: `HTTP ${resp.status}: ${await resp.text()}` };
    }
    const data = (await resp.json()) as AIResp;
    if (data.error) return { text: null, error: data.error.message ?? "unknown" };
    return { text: data.choices?.[0]?.message?.content ?? "", error: null };
  } catch (e) {
    return { text: null, error: (e as Error).message };
  }
}

function score(text: string): {
  brand_mentioned: boolean;
  citation_found: boolean;
  citations: string[];
  competitor_mentions: string[];
  visibility_score: number;
} {
  const brand = BRAND_RE.test(text);
  const citations = Array.from(text.matchAll(URL_RE)).map((m) => m[0]);
  const cit = citations.length > 0;
  const COMPETITORS = [
    "prüfungs.tv",
    "pruefungs.tv",
    "lecturio",
    "azubinet",
    "u-form",
    "prüfungstrainer",
    "ausbildungspark",
  ];
  const lower = text.toLowerCase();
  const competitors = COMPETITORS.filter((c) => lower.includes(c));
  // Score: 1.0 wenn Brand + Citation, 0.6 wenn nur Brand, 0.3 wenn nur Citation, 0
  let v = 0;
  if (brand && cit) v = 1.0;
  else if (brand) v = 0.6;
  else if (cit) v = 0.3;
  return {
    brand_mentioned: brand,
    citation_found: cit,
    citations,
    competitor_mentions: competitors,
    visibility_score: v,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: queries, error } = await sb
    .from("llm_visibility_queries")
    .select("id, query_text")
    .eq("is_active", true);

  if (error || !queries) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "no queries" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const q of queries) {
    for (const model of MODELS) {
      const { text, error: e } = await probeModel(q.query_text, model);
      const probe: Record<string, unknown> = {
        query_id: q.id,
        query_text: q.query_text,
        model,
        response_text: text,
        error: e,
      };
      if (text && !e) Object.assign(probe, score(text));
      results.push(probe);
      // small delay to avoid burst-rate-limits
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const { error: insErr } = await sb.from("llm_visibility_probes").insert(results);
  if (insErr) {
    return new Response(
      JSON.stringify({ error: insErr.message, partial: results.length }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      probes_created: results.length,
      models: MODELS,
      queries: queries.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
