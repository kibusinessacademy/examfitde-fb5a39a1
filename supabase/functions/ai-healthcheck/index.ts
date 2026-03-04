import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * ai-healthcheck — Provider/Proxy diagnostic + Circuit Breaker
 *
 * Proves whether the Lovable AI proxy is broken for:
 *   1) Plain text completion
 *   2) Tool-calling / structured output
 *   3) Plain JSON fallback
 *
 * If tool-calling is broken but plain works → automatically sets
 * pipeline_settings.ai_tool_mode.enabled = false (Circuit Breaker).
 *
 * Results are logged to pipeline_health_events for SSOT.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

interface ProbeResult {
  name: string;
  ok: boolean;
  latency_ms: number;
  content_length: number;
  has_tool_calls: boolean;
  raw_sample?: string;
  error?: string;
}

async function probe(
  name: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const latency = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { name, ok: false, latency_ms: latency, content_length: 0, has_tool_calls: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const data = await resp.json();
    const choice = data.choices?.[0]?.message;
    const content = choice?.content || "";
    const toolCalls = choice?.tool_calls || [];

    return {
      name,
      ok: true,
      latency_ms: latency,
      content_length: content.length,
      has_tool_calls: toolCalls.length > 0,
      raw_sample: content.slice(0, 500) || (toolCalls.length > 0 ? JSON.stringify(toolCalls[0]).slice(0, 500) : "(empty)"),
    };
  } catch (e) {
    return {
      name,
      ok: false,
      latency_ms: Date.now() - start,
      content_length: 0,
      has_tool_calls: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ ok: false, error: "LOVABLE_API_KEY not set" }, 500);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const model = "google/gemini-2.5-flash";

  // Probe 1: Plain text completion
  const p1 = probe("plain_text", apiKey, {
    model,
    messages: [
      { role: "system", content: "Return exactly the word OK and nothing else." },
      { role: "user", content: "health check" },
    ],
    max_completion_tokens: 10,
  });

  // Probe 2: Tool-calling (structured output)
  const p2 = probe("tool_call", apiKey, {
    model,
    messages: [
      { role: "system", content: "You are a test assistant." },
      { role: "user", content: "Return a test lesson with title 'Test' and html '<p>Hello</p>'" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "create_lesson_content",
        description: "Create lesson content",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            html: { type: "string" },
          },
          required: ["title", "html"],
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "create_lesson_content" } },
    max_completion_tokens: 200,
  });

  // Probe 3: Plain text JSON (fallback mode)
  const p3 = probe("plain_json_fallback", apiKey, {
    model,
    messages: [
      { role: "system", content: "Return ONLY valid JSON: {\"title\": \"Test\", \"html\": \"<p>Hello</p>\"}. No prose." },
      { role: "user", content: "Generate a test lesson." },
    ],
    max_completion_tokens: 200,
  });

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  // Diagnosis
  const plainOk = r1.ok && r1.content_length > 0;
  const toolOk = r2.ok && (r2.has_tool_calls || r2.content_length > 0);
  const fallbackOk = r3.ok && r3.content_length > 0;

  let diagnosis: string;
  let kind: string;
  let severity: string;

  if (plainOk && toolOk && fallbackOk) {
    diagnosis = "ALL_HEALTHY — proxy + tool-calling + fallback all working";
    kind = "provider_ok";
    severity = "P2";
  } else if (plainOk && !toolOk) {
    diagnosis = "TOOL_CALLING_BROKEN — plain text works but tool-calling returns empty. Use plain-text JSON fallback.";
    kind = "provider_tool_empty";
    severity = "P1";
  } else if (!plainOk && !toolOk && !fallbackOk) {
    diagnosis = "PROXY_DOWN — all probes failed. Check LOVABLE_API_KEY, rate limits, or provider outage.";
    kind = "provider_down";
    severity = "P0";
  } else if (r1.content_length === 0 && r2.content_length === 0 && r3.content_length === 0) {
    diagnosis = "ALL_EMPTY — proxy returns 200 but empty content on all modes. Provider-level issue.";
    kind = "provider_all_empty";
    severity = "P0";
  } else {
    diagnosis = `PARTIAL — plain=${plainOk}, tool=${toolOk}, fallback=${fallbackOk}`;
    kind = "provider_partial";
    severity = "P1";
  }

  // ── Log to pipeline_health_events (SSOT) ──
  await sb.rpc("log_pipeline_health_event" as string, {
    p_severity: severity,
    p_kind: kind,
    p_package_id: null,
    p_step_key: null,
    p_meta: {
      diagnosis,
      model,
      probes: {
        plain: { ok: plainOk, latency: r1.latency_ms, sample: r1.raw_sample?.slice(0, 120), error: r1.error },
        tool: { ok: toolOk, latency: r2.latency_ms, has_tool_calls: r2.has_tool_calls, sample: r2.raw_sample?.slice(0, 120), error: r2.error },
        fallback: { ok: fallbackOk, latency: r3.latency_ms, sample: r3.raw_sample?.slice(0, 120), error: r3.error },
      },
    },
  });

  // ── Circuit Breaker: if tool is broken but plain OK → disable tool mode ──
  if (plainOk && !toolOk) {
    await sb.rpc("set_pipeline_setting" as string, {
      p_key: "ai_tool_mode",
      p_value: {
        enabled: false,
        reason: "provider_tool_empty",
        diagnosis,
        updated_by: "ai-healthcheck",
        at: new Date().toISOString(),
      },
    });
    console.warn(`[ai-healthcheck] 🔴 Circuit breaker OPEN: tool-calling broken → tool mode disabled`);
  } else if (plainOk && toolOk) {
    // Re-enable if it was previously disabled by healthcheck
    const { data: currentSetting } = await sb
      .from("pipeline_settings")
      .select("value")
      .eq("key", "ai_tool_mode")
      .maybeSingle();

    const current = (currentSetting?.value ?? {}) as Record<string, unknown>;
    if (
      current.enabled === false &&
      (current.updated_by === "ai-healthcheck" || current.updated_by === "pipeline-stall-guard")
    ) {
      await sb.rpc("set_pipeline_setting" as string, {
        p_key: "ai_tool_mode",
        p_value: {
          enabled: true,
          reason: "auto_recovered",
          updated_by: "ai-healthcheck",
          at: new Date().toISOString(),
        },
      });
      console.log(`[ai-healthcheck] 🟢 Circuit breaker CLOSED: tool-calling recovered → tool mode re-enabled`);
    }
  }

  const report = {
    diagnosis,
    kind,
    severity,
    probes: { plain_text: r1, tool_call: r2, plain_json_fallback: r3 },
    timestamp: new Date().toISOString(),
  };

  console.log(`[ai-healthcheck] ${JSON.stringify(report)}`);
  return json(report);
});
