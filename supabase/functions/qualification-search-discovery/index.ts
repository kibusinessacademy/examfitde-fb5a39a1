import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function detectContentTypeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".pdf")) return "pdf";
  if (u.includes("verordnung")) return "regulation";
  if (u.includes("pruefungsordnung") || u.includes("prüfungsordnung")) return "regulation";
  return "html";
}

function scoreResult(args: {
  providerFamily?: string | null;
  url: string;
  title?: string | null;
  snippet?: string | null;
}): number {
  const hay = `${args.title || ""} ${args.snippet || ""} ${args.url}`.toLowerCase();
  let score = 0;

  if (args.providerFamily === "ihk" && hay.includes("ihk")) score += 20;
  if (args.providerFamily === "hwk" && hay.includes("hwk")) score += 20;
  if (hay.includes("prüfungsordnung") || hay.includes("pruefungsordnung")) score += 25;
  if (hay.includes("verordnung")) score += 15;
  if (hay.includes(".pdf")) score += 10;
  if (hay.includes("fortbildungsprüfung") || hay.includes("fortbildungspruefung")) score += 10;
  if (hay.includes("meister") || hay.includes("fachwirt") || hay.includes("betriebswirt")) score += 10;

  return Math.min(100, score);
}

function buildSyntheticResults(searchPhrase: string, providerFamily?: string | null) {
  const family = providerFamily || "misc";
  const baseDomains =
    family === "ihk"
      ? ["ihk.de", "wis.ihk.de"]
      : family === "hwk"
      ? ["hwk.de", "handwerkskammer.de"]
      : ["bibb.de", "gesetze-im-internet.de"];

  return baseDomains.map((domain, idx) => {
    const url = `https://${domain}/suche?q=${encodeURIComponent(searchPhrase)}`;
    return {
      rank: idx + 1,
      source_url: url,
      title_raw: `${searchPhrase} – ${domain}`,
      snippet: `Automatisch entdeckte Quelle für ${searchPhrase}`,
      content_type_hint: detectContentTypeFromUrl(url),
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 25), 100);
  const triggerSource = body.trigger_source || "manual";

  const { data: run, error: runErr } = await sb
    .from("qualification_search_runs")
    .insert({
      trigger_source: triggerSource,
      status: "running",
      meta: { body },
    })
    .select("id")
    .single();

  if (runErr) return json(500, { error: runErr.message });

  const runId = run.id;

  const { data: patterns, error: pErr } = await sb
    .from("qualification_discovery_patterns")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .limit(limit);

  if (pErr) {
    await sb.from("qualification_search_runs").update({
      status: "failed",
      error_count: 1,
      finished_at: new Date().toISOString(),
      meta: { error: pErr.message },
    }).eq("id", runId);

    return json(500, { error: pErr.message });
  }

  let resultCount = 0;
  let dedupedCount = 0;

  for (const pattern of patterns || []) {
    const syntheticResults = buildSyntheticResults(pattern.search_phrase, pattern.provider_family);

    for (const result of syntheticResults) {
      const sourceScore = scoreResult({
        providerFamily: pattern.provider_family,
        url: result.source_url,
        title: result.title_raw,
        snippet: result.snippet,
      });

      const { data } = await sb.rpc("register_qualification_search_result", {
        p_run_id: runId,
        p_pattern_id: pattern.id,
        p_provider_family: pattern.provider_family,
        p_search_phrase: pattern.search_phrase,
        p_result_rank: result.rank,
        p_source_url: result.source_url,
        p_title_raw: result.title_raw,
        p_snippet: result.snippet,
        p_content_type_hint: result.content_type_hint,
        p_source_score: sourceScore,
        p_meta: {
          synthetic: true,
          award_type: pattern.award_type,
        },
      });

      resultCount += 1;
      if ((data as any)?.deduped) dedupedCount += 1;

      if ((data as any)?.source_registry_id && !(data as any)?.deduped) {
        await sb.rpc("enqueue_qualification_fetch", {
          p_source_registry_id: (data as any).source_registry_id,
          p_candidate_id: null,
          p_priority: pattern.priority || 5,
          p_payload: {
            search_phrase: pattern.search_phrase,
            award_type: pattern.award_type,
            provider_family: pattern.provider_family,
          },
        });
      }
    }
  }

  await sb.from("qualification_search_runs").update({
    status: "done",
    search_pattern_count: patterns?.length || 0,
    result_count: resultCount,
    deduped_count: dedupedCount,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  return json(200, {
    ok: true,
    run_id: runId,
    patterns: patterns?.length || 0,
    result_count: resultCount,
    deduped_count: dedupedCount,
  });
});
