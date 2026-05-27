import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(d: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(d), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function fmtNum(n: unknown): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  return Number.isInteger(num) ? num.toLocaleString("de-DE") : num.toFixed(1);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function buildMarkdown(b: any, v: any, history: any[]): string {
  const bc = obj(b.business_case);
  const kpis = arr(b.kpi_impact);
  const risks = arr(b.risk_register);
  const roadmap = arr(b.roadmap);
  const rollback = obj(b.rollback_plan);
  const topKpis = kpis.slice(0, 3).map((m: any) =>
    `${m?.metric ?? "?"}: ${fmtNum(m?.baseline)} → ${fmtNum(m?.target)} ${m?.unit ?? ""}`
  ).join(" · ");

  const lines: string[] = [];
  lines.push(`# Executive Brief — ${b.outcome_goal}`);
  lines.push("");
  lines.push(`**Branche:** ${v?.name ?? b.vertical_key}  `);
  lines.push(`**Status:** ${b.review_status} · **Risk-Tier:** ${b.risk_tier ?? "—"}  `);
  lines.push(`**Completeness:** ${fmtNum(b.completeness_pct)}% · **Confidence:** ${fmtNum(b.confidence)}  `);
  lines.push(`**Agent-Team:** ${arr(b.agent_team).length} Rollen  `);
  lines.push(`**Top-KPIs:** ${topKpis || "—"}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Business Case");
  lines.push(`- **Problem:** ${bc.problem ?? "—"}`);
  lines.push(`- **Opportunity:** ${bc.opportunity ?? "—"}`);
  lines.push(`- **Estimated Value:** € ${fmtNum(bc.estimated_value_eur)}`);
  lines.push(`- **Payback:** ${fmtNum(bc.payback_months)} Monate`);
  lines.push(`- **Sponsor:** ${bc.sponsor ?? "—"}`);
  lines.push("");
  lines.push("## 2. KPI Impact");
  if (kpis.length === 0) { lines.push("_Keine KPI-Daten._"); }
  else {
    lines.push("| Metrik | Baseline | Target | Delta | Horizont |");
    lines.push("|---|---:|---:|---:|---|");
    kpis.forEach((m: any) => {
      const delta = (m?.baseline != null && m?.target != null) ? `${fmtNum(Number(m.target) - Number(m.baseline))} ${m.unit ?? ""}` : "—";
      lines.push(`| ${m?.metric ?? "?"} | ${fmtNum(m?.baseline)} ${m?.unit ?? ""} | ${fmtNum(m?.target)} ${m?.unit ?? ""} | ${delta} | ${m?.horizon ?? "—"} |`);
    });
  }
  lines.push("");
  lines.push("## 3. Roadmap");
  if (roadmap.length === 0) { lines.push("_Keine Roadmap-Phasen._"); }
  else roadmap.forEach((p: any) => {
    lines.push(`- **${p?.phase ?? "?"} (${p?.duration ?? "?"}):** ${p?.goal ?? "—"}`);
  });
  lines.push("");
  lines.push("## 4. Risiken");
  if (risks.length === 0) { lines.push("_Keine Risiken erfasst._"); }
  else risks.forEach((r: any) => {
    lines.push(`- **[${(r?.severity ?? "—").toUpperCase()}] ${r?.title ?? "?"}** — ${r?.mitigation ?? "—"}`);
  });
  lines.push("");
  lines.push("## 5. Rollback Plan");
  lines.push(`- **Trigger:** ${rollback.trigger ?? "—"}`);
  lines.push(`- **SLA:** ${fmtNum(rollback.sla_minutes)} Minuten`);
  if (Array.isArray(rollback.steps)) {
    rollback.steps.forEach((s: unknown, i: number) => lines.push(`  ${i + 1}. ${s}`));
  }
  lines.push("");
  lines.push("## 6. Audit-Trail (HITL-Entscheidungen)");
  if (history.length === 0) { lines.push("_Keine Entscheidungen erfasst._"); }
  else history.forEach((h: any) => {
    lines.push(`- \`${new Date(h.created_at).toISOString()}\` **${h.decision}** — ${h.reason ?? "—"}`);
  });
  lines.push("");
  lines.push("---");
  lines.push(`_Generiert am ${new Date().toISOString()} · BerufAgentOS Executive Brief v1_`);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, { status: 401 });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userRes.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Forbidden — admin role required" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const bundleId = body?.bundle_id as string | undefined;
    if (!bundleId) return json({ error: "bundle_id required" }, { status: 400 });

    const { data: bundle, error: bErr } = await admin
      .from("agent_outcome_bundles").select("*").eq("id", bundleId).maybeSingle();
    if (bErr || !bundle) return json({ error: "Bundle not found" }, { status: 404 });

    const { data: vertical } = await admin
      .from("vertical_dna").select("*").eq("industry_key", bundle.vertical_key).maybeSingle();

    const { data: historyData } = await admin.rpc("admin_get_bundle_decision_history", { _bundle_id: bundleId });
    const history = Array.isArray(historyData) ? historyData : [];

    const markdown = buildMarkdown(bundle, vertical ?? {}, history);
    const filename = `executive-brief-${bundle.vertical_key}-${bundleId.slice(0, 8)}.md`;
    const byte_size = new TextEncoder().encode(markdown).length;

    await admin.from("auto_heal_log").insert({
      action_type: "outcome_bundle_exported",
      target_type: "agent_outcome_bundle",
      target_id: bundleId,
      result_status: "ok",
      metadata: { bundle_id: bundleId, format: "markdown", exported_by: userRes.user.id, byte_size },
    });

    return json({ markdown, filename, byte_size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, { status: 500 });
  }
});
