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
 * Reliability:
 *   - per-finding try/catch — one bad finding never blocks the batch
 *   - exponential-backoff retry (3 attempts, 250ms→1s→3s) on RPC errors
 *   - structured JSON logs (`{lvl, evt, finding_id, attempt, err}`) → edge logs
 *   - bounded batch size (200 findings/request)
 *   - always returns 200 with per-row results so the caller can decide
 *
 * Auth:
 *   - logged-in admin via JWT (uses caller's bearer)  → has_role check
 *   - CI: service-role bearer (used by daily customer-reality-gate workflow)
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

const MAX_BATCH = 200;
const RETRY_DELAYS_MS = [250, 1000, 3000];

function log(lvl: "info" | "warn" | "error", evt: string, ctx: Record<string, unknown> = {}) {
  try {
    const line = JSON.stringify({ lvl, evt, ts: new Date().toISOString(), ...ctx });
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  } catch { /* noop */ }
}

function fingerprint(f: UxGapFinding) {
  return `ux:${f.surface}:${f.id}`.replace(/[^a-zA-Z0-9:_\-/]/g, "_").slice(0, 200);
}

function isValidFinding(f: any): f is UxGapFinding {
  return f && typeof f.id === "string" && typeof f.surface === "string"
    && typeof f.message === "string" && typeof f.detected_at === "string"
    && (f.severity === "P0" || f.severity === "P1" || f.severity === "P2")
    && typeof f.source === "string";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recordWithRetry(
  supabase: any,
  f: UxGapFinding,
): Promise<{ id: string; ok: boolean; attempts: number; error?: string }> {
  const payload = toPayload(f);
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const { error } = await supabase.rpc("admin_p18_record_detection", { p_drift: payload });
      if (!error) {
        log("info", "ux_gap_bridge_recorded", { finding_id: f.id, attempt, key: payload.idempotency_key });
        return { id: f.id, ok: true, attempts: attempt };
      }
      lastErr = error.message ?? String(error);
      log("warn", "ux_gap_bridge_rpc_error", { finding_id: f.id, attempt, err: lastErr });
    } catch (e) {
      lastErr = (e as Error).message ?? String(e);
      log("warn", "ux_gap_bridge_exception", { finding_id: f.id, attempt, err: lastErr });
    }
    if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  log("error", "ux_gap_bridge_failed", { finding_id: f.id, attempts: RETRY_DELAYS_MS.length + 1, err: lastErr });
  return { id: f.id, ok: false, attempts: RETRY_DELAYS_MS.length + 1, error: lastErr };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => null);
    const rawFindings = Array.isArray(body?.findings) ? body.findings : [];
    if (rawFindings.length === 0) {
      return new Response(JSON.stringify({ error: "no findings[]" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid: UxGapFinding[] = [];
    const invalid: Array<{ id: string; error: string }> = [];
    for (const f of rawFindings) {
      if (isValidFinding(f)) valid.push(f);
      else invalid.push({ id: String(f?.id ?? "?"), error: "schema_invalid" });
    }
    for (const inv of invalid) {
      log("warn", "ux_gap_bridge_invalid_finding", { finding_id: inv.id });
    }

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

    log("info", "ux_gap_bridge_start", {
      received: rawFindings.length, valid: valid.length, invalid: invalid.length,
      ci: isCiServiceCall,
    });

    const results: Array<{ id: string; ok: boolean; attempts?: number; error?: string }> = [];
    for (const f of valid.slice(0, MAX_BATCH)) {
      // per-finding isolation — never let one bad row throw the whole batch
      try {
        results.push(await recordWithRetry(supabase, f));
      } catch (e) {
        results.push({ id: f.id, ok: false, error: (e as Error).message });
        log("error", "ux_gap_bridge_unhandled", { finding_id: f.id, err: (e as Error).message });
      }
    }
    for (const inv of invalid) results.push({ id: inv.id, ok: false, error: inv.error });

    const ok_count = results.filter((r) => r.ok).length;
    const failed = results.length - ok_count;
    log(failed === 0 ? "info" : "warn", "ux_gap_bridge_done", {
      received: rawFindings.length, recorded: ok_count, failed, ms: Date.now() - startedAt,
    });

    return new Response(JSON.stringify({
      received: rawFindings.length,
      valid: valid.length,
      invalid: invalid.length,
      recorded: ok_count,
      failed,
      duration_ms: Date.now() - startedAt,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    log("error", "ux_gap_bridge_fatal", { err: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
