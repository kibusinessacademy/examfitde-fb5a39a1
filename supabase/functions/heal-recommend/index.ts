// heal-recommend — AI-Empfehlung für wiederkehrendes Heal-Pattern
// Input:  { pattern_key: string, force?: boolean }
// Output: { ok, recommendation: { id, root_cause, heal_plan, permanent_fix_suggestion, confidence } }
//
// Sicherheit: erfordert authentifizierten Admin (User-JWT wird gegen has_role('admin') geprüft).
// Persistenz: schreibt in heal_pattern_recommendations und supersedet vorherige aktive Empfehlung.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface SignalBundle {
  pattern_key: string;
  cluster: string;
  package_id: string | null;
  package_title: string | null;
  package_status: string | null;
  package_track: string | null;
  blocked_reason: string | null;
  package_last_error: string | null;
  severity_score: number;
  recurrence_24h: number;
  recurrence_7d: number;
  escalation_rate_pct: number;
  dominant_error: string | null;
  recent_heal_attempts: Array<{
    action: string;
    status: string;
    detail: string;
    at: string;
  }> | null;
  failed_steps: Array<{ step_key: string; status: string }> | null;
  error?: string;
}

const SYSTEM_PROMPT = `Du bist Senior Site-Reliability-Engineer für eine Lerncontent-Pipeline.
Deine Aufgabe: Analysiere ein wiederkehrendes Heal-Cluster und liefere eine präzise Diagnose
+ konkreten Heal-Plan + Vorschlag für einen permanenten Fix (Trigger/Guard/Code-Änderung).

Antworte ausschließlich über das tool 'submit_heal_recommendation'. Keine freie Prosa.

Kontext-Cluster (action_type aus auto_heal_log):
- dag_guard_block: Step verstößt gegen DAG-Vorbedingung (z.B. fehlt vorgelagertes Artefakt).
- guardian_stale_fail: Guardian markiert Step als stale (locked aber kein Fortschritt).
- progress_guard_shadow_stalled: Progress-Guard sieht keinen Fortschritt trotz running.
- enqueue_phantom_blocked: Versuch, Step für published Paket zu enqueuen (Phantom).
- repair_exam_pool_quality: Quality-Repair läuft erneut, Pool unter Schwellwert.
- requeue_loop_mitigation: Job wird zu oft requeued.
- hot_loop_mitigation: Job läuft Endlosschleife.
- stale_lock_hard_kill: Lock zu lange gehalten, hart freigegeben.
- zombie_detected_hard_stalled: Job läuft lange ohne Heartbeat.

Bewerte streng nach Datenlage. Wenn die Signale keinen klaren Root-Cause hergeben, sage das ehrlich
und gib niedrige Confidence (<0.5).`;

async function callLovableAI(signal: SignalBundle) {
  const userPayload = JSON.stringify(signal, null, 2);
  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Analysiere folgendes Heal-Pattern und liefere Diagnose + Heal-Plan:\n\n` +
          userPayload,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "submit_heal_recommendation",
          description: "Liefert strukturierte Diagnose und Heal-Plan.",
          parameters: {
            type: "object",
            properties: {
              root_cause: {
                type: "string",
                description:
                  "Klare 1-3 Satz Diagnose der wahrscheinlichsten Ursache.",
              },
              heal_plan: {
                type: "object",
                properties: {
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        action: {
                          type: "string",
                          description:
                            "Konkrete Heal-Aktion (z.B. soft_reentry, hard_heal, mark_content_gap, force_depublish_rebuild, reset_to_step, manual_review).",
                        },
                        params: {
                          type: "object",
                          additionalProperties: true,
                        },
                        why: { type: "string" },
                      },
                      required: ["action", "why"],
                      additionalProperties: false,
                    },
                  },
                  expected_outcome: { type: "string" },
                },
                required: ["steps", "expected_outcome"],
                additionalProperties: false,
              },
              permanent_fix_suggestion: {
                type: "string",
                description:
                  "Konkreter Vorschlag für dauerhaften Fix (Trigger, Guard, Code-Pfad). Wenn keiner sinnvoll: leerer String.",
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "0.0 bis 1.0",
              },
            },
            required: [
              "root_cause",
              "heal_plan",
              "permanent_fix_suggestion",
              "confidence",
            ],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: "submit_heal_recommendation" },
    },
  };

  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (resp.status === 429) {
    throw new Error("rate_limited");
  }
  if (resp.status === 402) {
    throw new Error("payment_required");
  }
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`ai_gateway_error_${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  const args = tc?.function?.arguments;
  if (!args) {
    throw new Error("no_tool_call_returned");
  }
  return {
    parsed: JSON.parse(args),
    usage: data?.usage,
    model: data?.model ?? "google/gemini-2.5-flash",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("[heal-recommend] start");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Admin-Auth via User-JWT (RLS + has_role-Check via RPC)
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      console.error("[heal-recommend] auth failed", userErr);
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = userData.user.id;
    console.log("[heal-recommend] uid=", uid);

    const { data: hasAdmin, error: roleErr } = await userClient.rpc(
      "has_role",
      { _user_id: uid, _role: "admin" },
    );
    if (roleErr || !hasAdmin) {
      console.error("[heal-recommend] role check failed", { roleErr, hasAdmin });
      return new Response(JSON.stringify({ error: "forbidden", detail: roleErr?.message ?? "no_admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Input
    const body = await req.json().catch(() => ({}));
    const pattern_key: string | undefined = body?.pattern_key;
    const force: boolean = !!body?.force;
    console.log("[heal-recommend] pattern_key=", pattern_key, "force=", force);
    if (!pattern_key || typeof pattern_key !== "string") {
      return new Response(JSON.stringify({ error: "pattern_key_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Signal-Bundle laden (User-RPC, definer hardened)
    const { data: bundle, error: sigErr } = await userClient.rpc(
      "admin_heal_pattern_signal_bundle",
      { p_pattern_key: pattern_key },
    );
    if (sigErr) {
      console.error("[heal-recommend] signal bundle error", sigErr);
      throw sigErr;
    }
    console.log("[heal-recommend] bundle=", JSON.stringify(bundle)?.slice(0, 300));
    const signal = bundle as SignalBundle;
    if (!signal || (signal as any).error) {
      return new Response(
        JSON.stringify({ error: "pattern_not_found", detail: (signal as any)?.error }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4) Cache: existierende aktive Empfehlung wiederverwenden, wenn nicht force
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!force) {
      const { data: existing } = await adminClient
        .from("heal_pattern_recommendations")
        .select("id, root_cause, heal_plan, permanent_fix_suggestion, confidence, valid_until, model")
        .eq("pattern_key", pattern_key)
        .eq("status", "active")
        .gt("valid_until", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return new Response(
          JSON.stringify({ ok: true, cached: true, recommendation: existing }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // 5) AI-Call
    const { parsed, usage, model } = await callLovableAI(signal);

    // 6) Vorherige aktive Empfehlung superseden
    await adminClient
      .from("heal_pattern_recommendations")
      .update({ status: "superseded" })
      .eq("pattern_key", pattern_key)
      .eq("status", "active");

    // 7) Persistenz
    const { data: inserted, error: insErr } = await adminClient
      .from("heal_pattern_recommendations")
      .insert({
        pattern_key,
        cluster: signal.cluster,
        package_id: signal.package_id,
        target_id:
          signal.package_id ?? pattern_key, // fallback if no pkg
        target_type: signal.package_id ? "package" : "pattern",
        recurrence_7d: signal.recurrence_7d ?? 0,
        recurrence_24h: signal.recurrence_24h ?? 0,
        severity_score: signal.severity_score ?? 0,
        root_cause: parsed.root_cause,
        heal_plan: parsed.heal_plan,
        permanent_fix_suggestion: parsed.permanent_fix_suggestion ?? null,
        confidence: parsed.confidence ?? null,
        model,
        prompt_tokens: usage?.prompt_tokens ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
      })
      .select(
        "id, root_cause, heal_plan, permanent_fix_suggestion, confidence, valid_until, model",
      )
      .single();

    if (insErr) throw insErr;

    // 8) Audit
    await adminClient.from("auto_heal_log").insert({
      action_type: "heal_pattern_recommendation_generated",
      trigger_source: "admin",
      target_id: signal.package_id ?? pattern_key,
      target_type: signal.package_id ? "package" : "pattern",
      result_status: "success",
      result_detail: `confidence=${parsed.confidence}`,
      metadata: {
        pattern_key,
        cluster: signal.cluster,
        recommendation_id: inserted.id,
        admin_uid: uid,
        usage,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, cached: false, recommendation: inserted }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    const stack = e instanceof Error ? e.stack : null;
    const status = msg === "rate_limited"
      ? 429
      : msg === "payment_required"
      ? 402
      : 500;
    console.error("heal-recommend error:", msg, stack, JSON.stringify(e));
    return new Response(JSON.stringify({ error: msg, detail: String(e) }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
