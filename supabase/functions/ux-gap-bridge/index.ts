/**
 * ux-gap-bridge — Edge Function
 * ──────────────────────────────
 * Receives a batch of UxGapFinding rows produced by `scripts/ux-gap-scan.mjs`
 * and forwards each one into the existing P18 idempotency ledger via the
 * SECURITY DEFINER RPC `admin_p18_record_detection`.
 *
 * NO new ledger, NO new tables — pure architecture bridge over the existing
 * P18 surface, mapping `drift_type='ux_gap'`.
 *
 * Auth: requires a logged-in admin (JWT). Uses the caller's bearer token so
 * the RPC's has_role(auth.uid(),'admin') check applies.
 */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UxGapSeverity = "P0" | "P1" | "P2";
type UxGapSource =
  | "pre-customer-reality"
  | "learner-reality"
  | "static-surface-scan"
  | "entry-fallback-signal";

interface UxGapFinding {
  id: string;
  surface: string;
  message: string;
  severity: UxGapSeverity;
  source: UxGapSource;
  detected_at: string;
  matched_systems?: string[];
  recommended_action?: string;
}

const POLICY_VERSION = "ux-gap-bridge-v1";
const SEV_MAP: Record<UxGapSeverity, "block" | "warn" | "info"> = {
  P0: "block", P1: "warn", P2: "info",
};
const TRIGGER_MAP: Record<UxGapSource, string> = {
  "pre-customer-reality": "architecture-review-done",
  "learner-reality": "architecture-review-done",
  "static-surface-scan": "static-guard-failed",
  "entry-fallback-signal": "runtime-anomaly-detected",
};

function fingerprint(f: UxGapFinding) {
  return `ux:${f.surface}:${f.id}`.replace(/[^a-zA-Z0-9:_\-/]/g, "_").slice(0, 200);
}

function toPayload(f: UxGapFinding) {
  const target = fingerprint(f);
  return {
    idempotency_key: `p18:ux_gap:${target}:${POLICY_VERSION}:${f.detected_at.slice(0, 10)}`,
    drift_type: "ux_gap",
    trigger_source: TRIGGER_MAP[f.source] ?? "architecture-review-done",
    target_fingerprint: target,
    policy_version: POLICY_VERSION,
    time_bucket: f.detected_at.slice(0, 10),
    severity: SEV_MAP[f.severity] ?? "info",
    verdict: f.severity === "P0" ? "review_required" : f.severity === "P1" ? "review" : "observe",
    finding_count: 1,
    matched_system_ids: (f.matched_systems ?? [f.surface]).slice(0, 12),
    allowed_actions: ["EMIT_GOVERNANCE_AUDIT"],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => null);
    const findings: UxGapFinding[] = Array.isArray(body?.findings) ? body.findings : [];
    if (findings.length === 0) {
      return new Response(JSON.stringify({ error: "no findings[]" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CI-mode: when caller presents the service-role key as bearer (used by the
    // daily customer-reality-gate workflow), we run the RPC with the service
    // client and bypass the admin user check. Otherwise we forward the caller's
    // JWT and rely on has_role(auth.uid(),'admin') inside the RPC.
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    const isCiServiceCall = bearer === SERVICE_KEY;
    const supabase = isCiServiceCall
      ? createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY)
      : createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } },
        );

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const f of findings.slice(0, 200)) {
      try {
        const { error } = await supabase.rpc("admin_p18_record_detection", { p_drift: toPayload(f) });
        if (error) results.push({ id: f.id, ok: false, error: error.message });
        else results.push({ id: f.id, ok: true });
      } catch (e) {
        results.push({ id: f.id, ok: false, error: (e as Error).message });
      }
    }

    const ok_count = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({
      received: findings.length,
      recorded: ok_count,
      failed: results.length - ok_count,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
