import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RunRequest {
  agent_slug: string;
  input: { prompt: string; context?: Record<string, unknown> };
  organization_id?: string;
  profession_id?: string;
  workflow_slug?: string;
  required_tier?: "standard" | "pro" | "enterprise";
}

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

    const body = (await req.json()) as RunRequest;
    if (!body?.agent_slug || !body?.input?.prompt) {
      return new Response(JSON.stringify({ error: "agent_slug and input.prompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agent, error: agentErr } = await admin
      .from("berufs_ki_agents")
      .select("*")
      .eq("slug", body.agent_slug)
      .eq("is_active", true)
      .maybeSingle();
    if (agentErr || !agent) {
      return new Response(JSON.stringify({ error: "agent not found or inactive" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PROFESSION GUARD (fail-closed if organization_id given) ──
    if (body.organization_id) {
      const { data: guard, error: guardErr } = await admin.rpc("check_profession_agent_access", {
        _organization_id: body.organization_id,
        _agent_slug: body.agent_slug,
        _workflow_slug: body.workflow_slug ?? null,
        _profession_id: body.profession_id ?? null,
        _required_tier: body.required_tier ?? "standard",
      });
      if (guardErr) {
        return new Response(JSON.stringify({ error: "guard_error", detail: guardErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const g = guard as { allowed: boolean; reason: string | null };
      if (!g?.allowed) {
        return new Response(JSON.stringify({ error: "profession_guard_denied", reason: g?.reason ?? "unknown" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const t0 = Date.now();
    const { data: runRow, error: runErr } = await admin
      .from("berufs_ki_agent_runs")
      .insert({
        agent_id: agent.id,
        user_id: userId,
        input: body.input,
        status: "running",
        approval_required: agent.requires_human_approval,
      })
      .select("id")
      .single();
    if (runErr || !runRow) throw new Error(runErr?.message ?? "could not create run");

    // Build system prompt from agent contract
    const systemPrompt = [
      `Du bist der ${agent.name} (${agent.role}, Kategorie: ${agent.category}).`,
      agent.description ?? "",
      `Governance-Pflichten: ${JSON.stringify(agent.governance_rules ?? {})}.`,
      `Blockierte Aktionen: ${(agent.blocked_actions ?? []).join(", ") || "keine"}.`,
      `Antworte präzise, strukturiert, im Berufskontext. Markiere Unsicherheiten explizit.`,
    ].join("\n");

    const model = (agent.runtime_profile?.model as string) ?? "google/gemini-3-flash-preview";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.input.prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      await admin.from("berufs_ki_agent_runs").update({
        status: "failed", error_message: txt, duration_ms: Date.now() - t0,
      }).eq("id", runRow.id);
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      return new Response(JSON.stringify({ error: "ai_gateway_error", detail: txt }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const text = aiJson?.choices?.[0]?.message?.content ?? "";

    // Heuristic confidence: long answer + no uncertainty markers => higher
    const lower = String(text).toLowerCase();
    const uncertain = /(unsicher|nicht sicher|keine information|kann nicht|i don't know)/.test(lower);
    const confidence = Math.min(0.95, Math.max(0.3, (text.length / 2000) + (uncertain ? -0.2 : 0.4)));

    const needsApproval = agent.requires_human_approval || confidence < (agent.confidence_threshold ?? 0.7);
    const finalStatus = needsApproval ? "awaiting_approval" : "completed";

    await admin.from("berufs_ki_agent_runs").update({
      output: { text, raw: aiJson },
      confidence_score: Number(confidence.toFixed(3)),
      status: finalStatus,
      duration_ms: Date.now() - t0,
      audit_trail: [{ event: "executed", at: new Date().toISOString(), model }],
    }).eq("id", runRow.id);

    return new Response(JSON.stringify({
      run_id: runRow.id,
      status: finalStatus,
      confidence,
      output: text,
      requires_approval: needsApproval,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("agent-run error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
