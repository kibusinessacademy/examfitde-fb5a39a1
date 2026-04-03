// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

type Action = "list" | "create" | "update_status" | "assign" | "track" | "stats";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const body = await req.json().catch(() => ({}));
    const action: Action = body.action;
    if (!action) return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers });

    // track is user-accessible, others are admin
    const requireAdmin = action !== "track" && action !== "assign";
    const auth = await validateAuth(req, requireAdmin);
    if (auth.error) return unauthorizedResponse(auth.error, origin ?? undefined);
    if (!auth.user) return unauthorizedResponse("Not authenticated", origin ?? undefined);

    const admin = createClient(supabaseUrl, serviceKey);

    if (action === "list") {
      const { data, error } = await admin.from("experiments").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return new Response(JSON.stringify({ experiments: data }), { headers });
    }

    if (action === "create") {
      const { councilId, type, name, hypothesis, kpiName, variants, allocation, stopRules } = body;
      if (!councilId || !type || !name) {
        return new Response(JSON.stringify({ error: "councilId, type, name required" }), { status: 400, headers });
      }
      const { data, error } = await admin.from("experiments").insert({
        council_id: councilId,
        type,
        name,
        hypothesis: hypothesis ?? null,
        kpi_name: kpiName ?? null,
        variants: variants ?? { A: {}, B: {} },
        allocation: allocation ?? { A: 50, B: 50 },
        stop_rules: stopRules ?? {},
        status: "draft",
      }).select("*").single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, experiment: data }), { headers });
    }

    if (action === "update_status") {
      const { experimentId, status } = body;
      if (!experimentId || !status) return new Response(JSON.stringify({ error: "experimentId + status required" }), { status: 400, headers });
      const patch: Record<string, unknown> = { status };
      if (status === "running") patch.start_at = new Date().toISOString();
      if (status === "ended") patch.end_at = new Date().toISOString();
      const { error } = await admin.from("experiments").update(patch).eq("id", experimentId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (action === "assign") {
      const { experimentId } = body;
      if (!experimentId) return new Response(JSON.stringify({ error: "experimentId required" }), { status: 400, headers });

      // Check existing assignment
      const { data: existing } = await admin.from("experiment_assignments")
        .select("variant")
        .eq("experiment_id", experimentId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (existing) return new Response(JSON.stringify({ variant: existing.variant }), { headers });

      // Get experiment allocation to support N variants
      const { data: experiment } = await admin.from("experiments")
        .select("allocation")
        .eq("id", experimentId)
        .single();

      let variant = "A";
      if (experiment?.allocation) {
        const alloc = experiment.allocation as Record<string, number>;
        const entries = Object.entries(alloc);
        const hash = Array.from(auth.user.id).reduce((s, c) => s + c.charCodeAt(0), 0);
        const total = entries.reduce((sum, [, pct]) => sum + pct, 0);
        const roll = hash % total;
        let cumulative = 0;
        for (const [key, pct] of entries) {
          cumulative += pct;
          if (roll < cumulative) { variant = key; break; }
        }
      }

      await admin.from("experiment_assignments").insert({
        experiment_id: experimentId,
        user_id: auth.user.id,
        variant,
      });
      return new Response(JSON.stringify({ variant }), { headers });
    }

    if (action === "track") {
      const { experimentId, eventType, value, metadata } = body;
      if (!experimentId || !eventType) return new Response(JSON.stringify({ error: "experimentId + eventType required" }), { status: 400, headers });
      await admin.from("experiment_events").insert({
        experiment_id: experimentId,
        user_id: auth.user.id,
        event_type: eventType,
        value: value ?? null,
        metadata: metadata ?? {},
      });
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (action === "stats") {
      const { experimentId } = body;
      if (!experimentId) return new Response(JSON.stringify({ error: "experimentId required" }), { status: 400, headers });

      const [{ data: assignments }, { data: events }] = await Promise.all([
        admin.from("experiment_assignments").select("variant").eq("experiment_id", experimentId),
        admin.from("experiment_events").select("event_type, value, user_id").eq("experiment_id", experimentId),
      ]);

      const aCount = (assignments || []).filter((a: { variant: string }) => a.variant === "A").length;
      const bCount = (assignments || []).filter((a: { variant: string }) => a.variant === "B").length;

      // Get user→variant map
      const { data: allAssignments } = await admin.from("experiment_assignments")
        .select("user_id, variant").eq("experiment_id", experimentId);
      const variantMap = new Map((allAssignments || []).map((a: { user_id: string; variant: string }) => [a.user_id, a.variant]));

      const eventsByVariant: Record<string, Record<string, number>> = { A: {}, B: {} };
      for (const ev of (events || []) as Array<{ event_type: string; user_id: string | null; value: number | null }>) {
        const v = variantMap.get(ev.user_id || "") || "A";
        eventsByVariant[v][ev.event_type] = (eventsByVariant[v][ev.event_type] || 0) + 1;
      }

      return new Response(JSON.stringify({
        participants: { A: aCount, B: bCount },
        events: eventsByVariant,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (e) {
    console.error("[experiment-api] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
