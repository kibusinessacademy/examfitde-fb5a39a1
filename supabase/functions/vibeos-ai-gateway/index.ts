/**
 * VIBEOS_AI_GATEWAY — OpenAI-compatible proxy (Phase 2 of LOVABLE_API_KEY exit).
 *
 * Endpoint: POST /v1/chat/completions
 * Auth:     Header `Vibeos-Gateway-Key: $VIBEOS_AI_GATEWAY_KEY`
 *           (alt: `Authorization: Bearer …`)
 *
 * Wire-Contract: identisch zu Lovable AI Gateway. Routet anhand des Modell-
 * Prefixes auf den Direct-Provider:
 *   - `openai/…`     → https://api.openai.com/v1/chat/completions   (OPENAI_API_KEY)
 *   - `anthropic/…`  → https://api.anthropic.com/v1/messages        (ANTHROPIC_API_KEY) — body-transform
 *   - `google/…`     → https://generativelanguage.googleapis.com/…  (GOOGLE_AI_API_KEY) — body-transform
 *
 * Telemetrie: fn_emit_audit('vibeos_gateway_route_resolved', {provider, model_in, model_out, ms, status}).
 *
 * Rollback: siehe docs/runbooks/vibeos-ai-gateway-rollback.md
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: any };
type Provider = "openai" | "anthropic" | "google" | "kimi";

const env = (k: string) => Deno.env.get(k) ?? "";
const envBool = (k: string, def = false) => {
  const v = env(k).trim().toLowerCase();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

const KEYS = {
  GATEWAY: env("VIBEOS_AI_GATEWAY_KEY"),
  OPENAI: env("OPENAI_API_KEY"),
  ANTHROPIC: env("ANTHROPIC_API_KEY"),
  GOOGLE: env("GOOGLE_AI_API_KEY"),
  KIMI: env("KIMI_API_KEY"),
};

// Kimi K2 Code-Agent Lane — optional, default OFF.
const KIMI_FLAG_ENABLED = envBool("KIMI_CODE_AGENT_ENABLED", false);
const KIMI_BASE_URL = (env("KIMI_BASE_URL") || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
const KIMI_ALLOWED_LANES = new Set([
  "debug_agent",
  "test_agent",
  "code_planner",
  "code_patch_builder",
]);
// Hard-Block: diese Lanes dürfen Kimi unter keinen Umständen nutzen.
const KIMI_FORBIDDEN_LANES = new Set([
  "ai_tutor", "tutor", "exam", "exam_questions",
  "course", "learning_content",
  "billing", "license", "purchase", "checkout",
  "rls_migration", "db_migration",
]);

function unauthorized(msg: string) {
  return new Response(JSON.stringify({ error: { message: msg, type: "unauthorized" } }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: { message: msg, type: "invalid_request_error" } }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function forbidden(msg: string) {
  return new Response(JSON.stringify({ error: { message: msg, type: "lane_forbidden" } }), {
    status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function bridgeError(status: number, msg: string, raw?: unknown) {
  return new Response(JSON.stringify({ error: { message: msg, type: "upstream_error", raw } }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseModel(model: string): { provider: Provider; modelId: string } | null {
  if (!model || !model.includes("/")) return null;
  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");
  if (provider !== "openai" && provider !== "anthropic" && provider !== "google" && provider !== "kimi") return null;
  return { provider: provider as Provider, modelId };
}

async function audit(actionType: string, payload: Record<string, unknown>) {
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    await sb.rpc("fn_emit_audit", { _action_type: actionType, _payload: payload });
  } catch { /* audit best-effort */ }
}

// ── Kimi K2 (Moonshot, OpenAI-compatible) ─────────────────────────
async function routeKimi(modelId: string, body: any): Promise<Response> {
  if (!KEYS.KIMI) return bridgeError(500, "KIMI_API_KEY not configured");
  const upstream = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEYS.KIMI}`,
    },
    body: JSON.stringify({ ...body, model: modelId }),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

// ── OpenAI passthrough ─────────────────────────────────────────────
async function routeOpenAI(modelId: string, body: any): Promise<Response> {
  if (!KEYS.OPENAI) return bridgeError(500, "OPENAI_API_KEY not configured");
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEYS.OPENAI}`,
    },
    body: JSON.stringify({ ...body, model: modelId }),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

// ── Anthropic body-transform (chat → messages) ─────────────────────
async function routeAnthropic(modelId: string, body: any): Promise<Response> {
  if (!KEYS.ANTHROPIC) return bridgeError(500, "ANTHROPIC_API_KEY not configured");
  const messages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const sys = messages.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEYS.ANTHROPIC,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: body.max_tokens ?? 4096,
      temperature: body.temperature,
      system: sys || undefined,
      messages: turns,
    }),
  });
  if (!upstream.ok) {
    const t = await upstream.text();
    return bridgeError(upstream.status, "anthropic upstream", t);
  }
  const data = await upstream.json();
  // Map back to OpenAI chat.completion shape (minimal)
  const content = Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? "").join("") : "";
  return new Response(JSON.stringify({
    id: data.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: data.stop_reason ?? "stop" }],
    usage: data.usage,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Google Gemini body-transform ───────────────────────────────────
async function routeGoogle(modelId: string, body: any): Promise<Response> {
  if (!KEYS.GOOGLE) return bridgeError(500, "GOOGLE_AI_API_KEY not configured");
  const messages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${KEYS.GOOGLE}`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: {
        temperature: body.temperature,
        maxOutputTokens: body.max_tokens,
      },
    }),
  });
  if (!upstream.ok) {
    const t = await upstream.text();
    return bridgeError(upstream.status, "google upstream", t);
  }
  const data = await upstream.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  return new Response(JSON.stringify({
    id: `vibeos-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() ?? "stop" }],
    usage: data?.usageMetadata,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Health
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({
      ok: true,
      providers: {
        openai: Boolean(KEYS.OPENAI),
        anthropic: Boolean(KEYS.ANTHROPIC),
        google: Boolean(KEYS.GOOGLE),
        kimi: Boolean(KEYS.KIMI),
      },
      kimi_code_agent_enabled: KIMI_FLAG_ENABLED,
      kimi_allowed_lanes: Array.from(KIMI_ALLOWED_LANES),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return badRequest("method not allowed");

  // Auth
  const auth = req.headers.get("vibeos-gateway-key")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  if (!KEYS.GATEWAY) return bridgeError(500, "VIBEOS_AI_GATEWAY_KEY not configured");
  const a = new TextEncoder().encode(auth);
  const b = new TextEncoder().encode(KEYS.GATEWAY);
  if (a.length !== b.length) return unauthorized("invalid gateway key");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return unauthorized("invalid gateway key");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("invalid json"); }

  // Lane / task_type metadata (header oder body — header gewinnt)
  const lane = (req.headers.get("x-vibeos-lane") || body?.lane || body?.x_lane || "").toString().trim();
  const taskType = (req.headers.get("x-vibeos-task-type") || body?.task_type || "").toString().trim();
  const fallbackModel = (body?.fallback_model || "").toString().trim();

  const parsed = parseModel(body?.model ?? "");
  if (!parsed) return badRequest("model must be '<provider>/<model_id>' with provider in {openai,anthropic,google,kimi}");

  // ── Kimi-Gate ─────────────────────────────────────────────────────
  let effective = parsed;
  let kimiDowngraded = false;
  let kimiDowngradeReason: string | null = null;

  if (parsed.provider === "kimi") {
    // Hard-Block für verbotene Lanes — auch wenn Flag jemals on ist.
    if (lane && KIMI_FORBIDDEN_LANES.has(lane)) {
      await audit("kimi_route_blocked", {
        reason: "lane_forbidden", lane, task_type: taskType, model_in: body?.model,
      });
      return forbidden(`Kimi darf für lane='${lane}' nicht genutzt werden`);
    }
    if (!lane || !KIMI_ALLOWED_LANES.has(lane)) {
      await audit("kimi_route_blocked", {
        reason: "lane_not_allowed", lane: lane || null, task_type: taskType, model_in: body?.model,
      });
      return forbidden(`Kimi nur für Code-Lanes: ${Array.from(KIMI_ALLOWED_LANES).join(", ")}`);
    }
    if (!KIMI_FLAG_ENABLED) {
      // Fallback auf bestehenden Provider
      const fb = parseModel(fallbackModel);
      if (!fb || fb.provider === "kimi") {
        await audit("kimi_route_blocked", {
          reason: "flag_disabled_no_fallback", lane, task_type: taskType, model_in: body?.model,
        });
        return bridgeError(503, "Kimi disabled (KIMI_CODE_AGENT_ENABLED=false) and no valid fallback_model provided");
      }
      kimiDowngraded = true;
      kimiDowngradeReason = "flag_disabled";
      effective = fb;
      await audit("kimi_route_fallback", {
        lane, task_type: taskType, model_in: body?.model, fallback_to: fallbackModel,
      });
    }
  }

  const t0 = Date.now();
  let res: Response;
  try {
    if (effective.provider === "openai") res = await routeOpenAI(effective.modelId, body);
    else if (effective.provider === "anthropic") res = await routeAnthropic(effective.modelId, body);
    else if (effective.provider === "google") res = await routeGoogle(effective.modelId, body);
    else res = await routeKimi(effective.modelId, body);
  } catch (e: any) {
    res = bridgeError(502, "proxy exception", String(e?.message ?? e));
  }
  const ms = Date.now() - t0;

  // Audit: route_resolved (alle Provider)
  audit("vibeos_gateway_route_resolved", {
    provider: effective.provider,
    model_in: body?.model,
    model_out: effective.modelId,
    lane: lane || null,
    task_type: taskType || null,
    ms,
    status: res.status,
    kimi_downgraded: kimiDowngraded,
    kimi_downgrade_reason: kimiDowngradeReason,
  });

  // Kimi-spezifischer Audit-Event mit Token/Cost (best-effort, body wird konsumiert via clone)
  if (effective.provider === "kimi") {
    let usage: any = null;
    try {
      const clone = res.clone();
      const data = await clone.json();
      usage = data?.usage ?? null;
    } catch { /* nicht-JSON oder Stream → ignore */ }
    audit("kimi_route_invoked", {
      lane, task_type: taskType || null,
      model: effective.modelId,
      success: res.status >= 200 && res.status < 300,
      status: res.status,
      ms,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
    });
  }
  return res;
});

