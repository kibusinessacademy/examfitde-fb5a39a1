import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAPPING_PROMPT = `Du bist ein Experte für IHK-Prüfungsstrukturen.

Gegeben: Eine Liste von Curriculum-Topics und eine Liste von Blueprint-Domains.

Ordne jedes Topic dem passenden Domain zu. Antworte NUR mit validem JSON:
{
  "mappings": [
    {
      "topic_id": "uuid",
      "domain_key": "string",
      "confidence": 0.0-1.0,
      "reasoning": "kurze Begründung"
    }
  ]
}

Regeln:
- Jedes Topic MUSS genau einem Domain zugeordnet werden
- confidence >= 0.8 = sicher, 0.5-0.8 = unsicher, < 0.5 = unklar
- Nur Topics mit confidence >= 0.7 als "mapped" markieren
- Reasoning max 20 Wörter`;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error)
      : unauthorizedResponse(auth.error);
  }

  try {
    const { certification_id } = await req.json();
    if (!certification_id) {
      return new Response(JSON.stringify({ error: "certification_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load unmapped topics
    const { data: topics } = await sb.from("curriculum_topics")
      .select("id, topic_name, topic_code, description")
      .eq("certification_id", certification_id)
      .is("parent_topic_id", null);

    if (!topics || topics.length === 0) {
      return new Response(JSON.stringify({ error: "No topics found", mapped: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load blueprint domains
    const { data: blueprints } = await sb.from("dom_blueprints")
      .select("id").eq("certification_id", certification_id).limit(1);
    
    const blueprintId = blueprints?.[0]?.id;
    if (!blueprintId) {
      return new Response(JSON.stringify({ error: "No blueprint found for certification" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: parts } = await sb.from("dom_blueprint_parts")
      .select("id").eq("blueprint_id", blueprintId);
    const partIds = (parts || []).map((p: any) => p.id);

    const { data: domains } = await sb.from("dom_blueprint_domains")
      .select("id, domain_key, domain_name")
      .in("part_id", partIds);

    if (!domains || domains.length === 0) {
      return new Response(JSON.stringify({ error: "No domains in blueprint" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch topics in chunks of 30
    const BATCH_SIZE = 30;
    let totalMapped = 0;
    let totalUnsure = 0;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    for (let i = 0; i < topics.length; i += BATCH_SIZE) {
      const batch = topics.slice(i, i + BATCH_SIZE);
      
      const userContent = JSON.stringify({
        topics: batch.map(t => ({ id: t.id, name: t.topic_name, code: t.topic_code, desc: t.description })),
        domains: domains.map(d => ({ key: d.domain_key, name: d.domain_name })),
      });

      const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: MAPPING_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      });

      if (!aiResp.ok) continue;

      const aiData = await aiResp.json();
      const raw = aiData.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      let result;
      try { result = JSON.parse(cleaned); } catch { continue; }

      for (const m of (result.mappings || [])) {
        const isMapped = m.confidence >= 0.7;
        const domainMatch = domains.find((d: any) => d.domain_key === m.domain_key);

        await sb.from("curriculum_topic_coverage").upsert({
          certification_id,
          topic_id: m.topic_id,
          blueprint_domain_id: domainMatch?.id || null,
          blueprint_domain_key: m.domain_key,
          mapped: isMapped,
          confidence: m.confidence,
          mapped_to: { domain_key: m.domain_key, reasoning: m.reasoning, confidence: m.confidence },
          coverage_weight: 1.0,
        }, { onConflict: "certification_id,topic_id" });

        if (isMapped) totalMapped++;
        else totalUnsure++;
      }
    }

    // Recompute coverage
    const { data: coverageResult } = await sb.rpc("compute_curriculum_coverage", { p_certification_id: certification_id });
    await sb.rpc("set_curriculum_hold_if_needed", { p_certification_id: certification_id });

    return new Response(JSON.stringify({
      success: true,
      total_topics: topics.length,
      mapped: totalMapped,
      unsure: totalUnsure,
      coverage: coverageResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Auto-map error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
