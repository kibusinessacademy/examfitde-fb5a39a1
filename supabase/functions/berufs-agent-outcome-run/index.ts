// BerufAgentOS — Outcome Run Orchestrator
// Sequentially runs the outcome agent team and aggregates results into agent_outcome_bundles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RunReq {
  outcome_goal: string;
  vertical_key: string;
  agent_team?: string[];      // slugs; default = all 10 outcome-*
  context?: Record<string, unknown>;
  curriculum_id?: string;
}

const DEFAULT_TEAM = [
  "outcome-strategy","outcome-product","outcome-workflow","outcome-build",
  "outcome-ux","outcome-seo-authority","outcome-growth",
  "outcome-security","outcome-compliance","outcome-executive",
];

const CONTRACT_TO_FIELDS: Record<string, string[]> = {
  business_case: ["business_case"],
  process_model: ["process_model"],
  kpi_impact: ["kpi_impact"],
  workflow_graph: ["workflow_graph"],
  risk_register: ["risk_register"],
  sops: ["sops"],
  roadmap: ["roadmap"],
  rollout_plan: ["rollout_plan"],
  dashboard_spec: ["dashboard_spec"],
  test_matrix: ["test_matrix"],
  rollback_plan: ["rollback_plan"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult } = await userClient.auth.getUser();
    if (!userResult?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userResult.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = (await req.json()) as RunReq;

    if (!body?.outcome_goal || body.outcome_goal.trim().length < 8) {
      return new Response(JSON.stringify({ error: "outcome_goal required (min 8 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body?.vertical_key) {
      return new Response(JSON.stringify({ error: "vertical_key required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Vertical DNA
    const { data: vertical, error: vErr } = await admin
      .from("vertical_dna").select("*").eq("industry_key", body.vertical_key).eq("is_active", true).maybeSingle();
    if (vErr || !vertical) {
      return new Response(JSON.stringify({ error: "vertical_not_found", key: body.vertical_key }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load agents
    const teamSlugs = body.agent_team?.length ? body.agent_team : DEFAULT_TEAM;
    const { data: agents } = await admin
      .from("berufs_ki_agents").select("*").in("slug", teamSlugs).eq("is_active", true);
    if (!agents?.length) {
      return new Response(JSON.stringify({ error: "no_active_agents" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregation buckets
    const agg = {
      business_case: {} as Record<string, unknown>,
      process_model: {} as Record<string, unknown>,
      kpi_impact: [] as unknown[],
      workflow_graph: {} as Record<string, unknown>,
      risk_register: [] as unknown[],
      sops: [] as unknown[],
      roadmap: [] as unknown[],
      rollout_plan: {} as Record<string, unknown>,
      dashboard_spec: {} as Record<string, unknown>,
      test_matrix: [] as unknown[],
      rollback_plan: {} as Record<string, unknown>,
    };
    const agentOutputs: Record<string, unknown> = {};
    const confidences: number[] = [];

    // Sequential agent run with Vertical-DNA injection
    for (const agent of agents) {
      const contract: string[] = agent.governance_rules?.outcome_contract ?? [];
      const systemPrompt = [
        `Du bist der ${agent.name} (${agent.role}).`,
        `BERUFAGENTOS-MISSION: Berufs- und Branchenwissen in messbare Projektergebnisse verwandeln.`,
        ``,
        `BRANCHE: ${vertical.name}`,
        `Rollen: ${(vertical.roles ?? []).join(", ")}`,
        `KPIs: ${JSON.stringify(vertical.kpis)}`,
        `Risiken: ${JSON.stringify(vertical.risks)}`,
        `Pain-Points: ${JSON.stringify(vertical.pain_points)}`,
        `Regulatorik: ${JSON.stringify(vertical.regulatory_context)}`,
        ``,
        `OUTCOME-ZIEL: ${body.outcome_goal}`,
        ``,
        `Deine Verantwortung: produziere AUSSCHLIESSLICH folgende Bundle-Sektion(en) als JSON-Objekt:`,
        contract.map((c) => `- ${c}`).join("\n"),
        ``,
        `Antwortformat: STRENG JSON, Top-Level-Keys exakt aus der obigen Liste, sonst nichts.`,
        `Keine Erklärungstexte, keine Markdown-Wrapper.`,
      ].join("\n");

      const model = (agent.runtime_profile?.model as string) ?? "google/gemini-3.5-flash";
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Liefere die Sektion(en) ${contract.join(", ")} für: ${body.outcome_goal}` },
          ],
        }),
      });

      if (!aiResp.ok) {
        agentOutputs[agent.slug] = { error: `gateway_${aiResp.status}` };
        continue;
      }
      const aiJson = await aiResp.json();
      const text = aiJson?.choices?.[0]?.message?.content ?? "{}";
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
      agentOutputs[agent.slug] = parsed;

      // Merge into aggregation buckets per contract
      for (const key of contract) {
        const v = parsed[key];
        if (v === undefined || v === null) continue;
        const target = (agg as Record<string, unknown>)[key];
        if (Array.isArray(target) && Array.isArray(v)) {
          (target as unknown[]).push(...v);
        } else if (typeof target === "object" && !Array.isArray(target) && typeof v === "object" && !Array.isArray(v)) {
          (agg as Record<string, unknown>)[key] = { ...(target as object), ...(v as object) };
        }
      }
      confidences.push(0.75);

      // Log child run for audit lineage
      await admin.from("berufs_ki_agent_runs").insert({
        agent_id: agent.id,
        user_id: userId,
        input: { outcome_goal: body.outcome_goal, vertical_key: body.vertical_key, contract },
        output: parsed,
        confidence_score: 0.75,
        status: "completed",
        approval_required: false,
        audit_trail: [{ event: "outcome_run_child", at: new Date().toISOString(), model }],
      });
    }

    // Persist bundle (kpi_impact guarantee if workflow_graph has nodes)
    if (
      (agg.workflow_graph as Record<string, unknown>)?.nodes &&
      Array.isArray((agg.workflow_graph as Record<string, unknown>).nodes) &&
      ((agg.workflow_graph as Record<string, unknown>).nodes as unknown[]).length > 0 &&
      agg.kpi_impact.length === 0
    ) {
      agg.kpi_impact.push({ key: "outcome_throughput", label: "Outcome-Throughput", target: 1, source: "fallback" });
    }

    const { data: bundle, error: bErr } = await admin.from("agent_outcome_bundles").insert({
      user_id: userId,
      outcome_goal: body.outcome_goal,
      vertical_key: body.vertical_key,
      curriculum_id: body.curriculum_id ?? null,
      ...agg,
      agent_team: agents.map((a) => a.slug),
      agent_outputs: agentOutputs,
      confidence: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)) : null,
      review_status: "proposed",
    }).select("id, completeness_pct, review_status, confidence").single();

    if (bErr || !bundle) throw new Error(bErr?.message ?? "bundle_insert_failed");

    // Audit
    await admin.rpc("fn_emit_audit", {
      _action_type: "outcome_bundle_created",
      _payload: { bundle_id: bundle.id, vertical_key: body.vertical_key, agent_count: agents.length },
    }).then(() => undefined).catch(async () => {
      await admin.from("auto_heal_log").insert({
        action_type: "outcome_bundle_created",
        target_type: "agent_outcome_bundle",
        result_status: "success",
        metadata: { bundle_id: bundle.id, vertical_key: body.vertical_key },
      });
    });

    return new Response(JSON.stringify({
      bundle_id: bundle.id,
      review_status: bundle.review_status,
      completeness_pct: bundle.completeness_pct,
      confidence: bundle.confidence,
      agent_team: agents.map((a) => a.slug),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("outcome-run error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
