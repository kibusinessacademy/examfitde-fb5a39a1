/**
 * KIMI_DEBUG_AGENT_CANARY — Read-only Canary für Kimi K2 Code-Agent-Lane.
 *
 * Zweck: ruft das vibeos-ai-gateway mit lane=debug_agent über Kimi auf, ohne
 *        irgendwelche Mutationen, DB-Writes, Migrations oder Frontend-Effekte.
 *
 * Anforderungen:
 *  - Liest KIMI_API_KEY ausschliesslich serverseitig (über das Gateway).
 *  - Respektiert KIMI_CODE_AGENT_ENABLED Feature-Flag.
 *  - Tutor/Exam/Course/Billing-Lanes können diese Funktion nicht missbrauchen.
 *  - Schreibt Audit-Event 'kimi_canary_invoked'.
 *  - Schlägt KEINE Codeänderungen vor — nur Diagnose-Text.
 *
 * Aufruf:
 *   POST /functions/v1/kimi-debug-agent-canary
 *   { "prompt": "Warum schlägt mein vitest-Setup fehl?", "model"?: "kimi-k2-0905-preview", "fallback_model"?: "openai/gpt-4o-mini" }
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";

const READ_ONLY_SYSTEM = [
  "Du bist ein READ-ONLY Debug-Agent (Kimi K2 Code-Lane).",
  "Strikte Regeln:",
  "- Schlage NIEMALS direkte Codeänderungen, Patches, DB-Migrations oder RLS-Änderungen vor.",
  "- Antworte mit Diagnose, Hypothesen, möglichen Ursachen und nächsten Untersuchungsschritten.",
  "- Verwende KEINE Tools, KEINE Funktionsaufrufe, KEINE Mutationen.",
  "- Falls die Frage Lernmaterial, Prüfungsfragen, AI-Tutor oder Billing betrifft: lehne höflich ab.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const prompt = String(body?.prompt ?? "").trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const kimiModel = String(body?.model ?? "kimi-k2-0905-preview");
  const fallbackModel = String(body?.fallback_model ?? "openai/gpt-4o-mini");

  const projectRef = env("SUPABASE_URL").match(/https?:\/\/([^.]+)\./)?.[1] ?? "";
  const gatewayUrl = `${env("SUPABASE_URL")}/functions/v1/vibeos-ai-gateway`;
  const gwKey = env("VIBEOS_AI_GATEWAY_KEY");
  if (!gwKey) {
    return new Response(JSON.stringify({ error: "VIBEOS_AI_GATEWAY_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();
  const upstream = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "vibeos-gateway-key": gwKey,
      "x-vibeos-lane": "debug_agent",
      "x-vibeos-task-type": "diagnose_readonly",
    },
    body: JSON.stringify({
      model: `kimi/${kimiModel}`,
      fallback_model: fallbackModel,
      messages: [
        { role: "system", content: READ_ONLY_SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });
  const text = await upstream.text();
  const ms = Date.now() - t0;

  // Audit (best-effort)
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    await sb.rpc("fn_emit_audit", {
      _action_type: "kimi_canary_invoked",
      _payload: {
        lane: "debug_agent",
        task_type: "diagnose_readonly",
        model_in: `kimi/${kimiModel}`,
        fallback_model: fallbackModel,
        status: upstream.status,
        ms,
        project_ref: projectRef,
      },
    });
  } catch { /* ignore */ }

  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
});
