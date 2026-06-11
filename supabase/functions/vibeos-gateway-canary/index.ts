/**
 * VIBEOS_AI_GATEWAY — Canary Runner (temporary, Phase 2.1)
 *
 * Internal-only function. Liest VIBEOS_AI_GATEWAY_URL/KEY aus Secrets,
 * feuert 10 fixierte Prompts (5 Standard + 5 Edge-Cases) gegen den Proxy,
 * sammelt {status, ms, model, error_code, output_len} und schreibt einen
 * Audit-Report. KEIN Schreibzugriff auf produktive Tabellen.
 *
 * Auth: assertAdmin (Service-Role oder Admin-JWT oder EDGE_INTERNAL_SHARED_SECRET).
 *
 * Trigger:
 *   POST /functions/v1/vibeos-gateway-canary
 *   Body (optional): { model?: "openai/gpt-5.2-mini" }
 *
 * Nach grünem Canary: entfernen oder disabled lassen.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";

const FN_NAME = "vibeos-gateway-canary";
const DEFAULT_MODEL = "openai/gpt-5.2-mini";

const STANDARD_PROMPTS = [
  "Write a 5-word SEO slug for: Bürokauffrau Ausbildung Prüfungsvorbereitung",
  "Generate a short marketing tagline (<=10 words) for an AI tutor app.",
  "Translate to English in one sentence: 'Lerne effizient mit KI-Unterstützung.'",
  "Summarize in one sentence: The quick brown fox jumps over the lazy dog.",
  "Give a 3-bullet list of benefits of spaced repetition learning.",
];

const EDGE_CASE_PROMPTS = [
  // Umlaute
  "Erzeuge einen URL-tauglichen Slug aus: 'Prüfungsvorbereitung für Köche & Bäcker — Übungsaufgaben'",
  // Sehr langer Titel
  `Fasse in einem Satz zusammen: ${"sehr ".repeat(120)}langer Titel mit vielen Wiederholungen über die Geschichte der Berufsausbildung in Deutschland seit 1969.`,
  // Sonderzeichen
  "Bereinige diesen String für SEO: '## **Mathe?!** — 100% Erfolg <script>alert(1)</script> @home #2026'",
  // Englisch/Deutsch gemischt
  "Erzeuge einen Slug: 'Best practices für moderne React apps mit TypeScript & Vite (2026 edition)'",
  // Leerer/kurzer Input
  "Erzeuge einen sinnvollen Fallback-Slug, wenn der Eingabe-Titel leer ist: ''",
];

interface RunResult {
  idx: number;
  kind: "standard" | "edge";
  prompt_preview: string;
  status: number;
  ms: number;
  model_in: string;
  ok: boolean;
  error_code: string | null;
  output_len: number;
  output_preview: string;
}

async function runOne(
  idx: number,
  kind: "standard" | "edge",
  prompt: string,
  url: string,
  key: string,
  model: string,
): Promise<RunResult> {
  const t0 = Date.now();
  let status = 0;
  let ok = false;
  let error_code: string | null = null;
  let output = "";
  try {
    const platformKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Vibeos-Gateway-Key": key,
        // Supabase edge router requires apikey for edge-to-edge calls.
        // We intentionally do NOT set Authorization here, because the gateway
        // prefers Authorization over Vibeos-Gateway-Key and would mis-read the
        // platform JWT as the gateway key.
        "apikey": platformKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a concise assistant. Respond briefly." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
    });
    status = res.status;
    const text = await res.text();
    if (!res.ok) {
      error_code = `http_${res.status}`;
    } else {
      try {
        const j = JSON.parse(text);
        output = j?.choices?.[0]?.message?.content ?? "";
        if (!output || typeof output !== "string") {
          error_code = "malformed_response";
        } else {
          ok = true;
        }
      } catch {
        error_code = "malformed_response";
      }
    }
  } catch (e: any) {
    error_code = "fetch_exception";
    status = 0;
    output = String(e?.message ?? e);
  }
  return {
    idx,
    kind,
    prompt_preview: prompt.slice(0, 80),
    status,
    ms: Date.now() - t0,
    model_in: model,
    ok,
    error_code,
    output_len: output.length,
    output_preview: output.slice(0, 120),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await assertAdmin(req, FN_NAME);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const URL_ = Deno.env.get("VIBEOS_AI_GATEWAY_URL") ?? "";
  const KEY_ = Deno.env.get("VIBEOS_AI_GATEWAY_KEY") ?? "";
  if (!URL_ || !KEY_) {
    return new Response(JSON.stringify({
      error: "missing_secrets",
      details: { has_url: Boolean(URL_), has_key: Boolean(KEY_) },
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* optional */ }
  const model = typeof body?.model === "string" && body.model.includes("/") ? body.model : DEFAULT_MODEL;
  // Proxy expects /v1/chat/completions suffix (Lovable Gateway parity)
  const target = URL_.endsWith("/v1/chat/completions") ? URL_ : `${URL_.replace(/\/$/, "")}/v1/chat/completions`;

  const results: RunResult[] = [];
  let i = 0;
  for (const p of STANDARD_PROMPTS) {
    results.push(await runOne(++i, "standard", p, target, KEY_, model));
  }
  for (const p of EDGE_CASE_PROMPTS) {
    results.push(await runOne(++i, "edge", p, target, KEY_, model));
  }

  const ok_count = results.filter((r) => r.ok).length;
  const fail_count = results.length - ok_count;
  const auth_errors = results.filter((r) => r.status === 401 || r.status === 403).length;
  const provider_errors = results.filter((r) => r.status >= 500).length;
  const timeouts = results.filter((r) => r.error_code === "fetch_exception").length;
  const malformed = results.filter((r) => r.error_code === "malformed_response").length;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const verdict =
    ok_count === results.length &&
    auth_errors === 0 &&
    provider_errors === 0 &&
    timeouts === 0 &&
    malformed === 0
      ? "GREEN"
      : "RED";

  const report = {
    canary: FN_NAME,
    model,
    target,
    total: results.length,
    ok_count,
    fail_count,
    auth_errors,
    provider_errors,
    timeouts,
    malformed,
    p50_ms: p50,
    p95_ms: p95,
    verdict,
    started_by_mode: auth.mode,
    results,
  };

  // Best-effort audit
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await sb.rpc("fn_emit_audit", {
      _action_type: "vibeos_gateway_canary_report",
      _payload: {
        caller: FN_NAME,
        model,
        total: report.total,
        ok_count,
        fail_count,
        auth_errors,
        provider_errors,
        timeouts,
        malformed,
        p50_ms: p50,
        p95_ms: p95,
        verdict,
        // Slim per-run record (no full output bodies, no key)
        runs: results.map((r) => ({
          idx: r.idx,
          kind: r.kind,
          status: r.status,
          ms: r.ms,
          ok: r.ok,
          error_code: r.error_code,
          output_len: r.output_len,
        })),
      },
    });
  } catch (_e) { /* best-effort */ }

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
