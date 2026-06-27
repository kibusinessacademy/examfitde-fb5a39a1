// STORE.LIFECYCLE.OS.1 — record-store-feedback
// Admin-only. Persists a manual store feedback row + appends a lifecycle event.
// NO Store API call. NO publishing. Append-only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { classifyFeedback } from "../_shared/storeLifecycle/storeFeedback.ts";
import { nextLifecycleState } from "../_shared/storeLifecycle/lifecycleState.ts";
import { buildLifecycleAuditPayload } from "../_shared/storeLifecycle/audit.ts";
import type { LifecycleState, StoreFeedbackInput } from "../_shared/storeLifecycle/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Body = z.object({
  candidate_id: z.string().uuid(),
  manifest_id: z.string().uuid(),
  platform: z.enum(["apple", "google"]),
  store_feedback_type: z.string().min(1),
  store_feedback_status: z.string().min(1),
  external_reference: z.string().nullable().optional(),
  reason_code: z.string().nullable().optional(),
  human_summary: z.string().min(1).max(2000),
  required_action: z.string().nullable().optional(),
  received_at_reference: z.string().datetime(),
  evidence_url: z.string().url().nullable().optional(),
  reviewer: z.string().nullable().optional(),
  payload_hash: z.string().nullable().optional(),
  current_state: z.string().min(1),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gate = await assertAdmin(req, "record-store-feedback");
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: gate.reason }), {
      status: gate.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fb = parsed.data;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const input: StoreFeedbackInput = {
    candidate_id: fb.candidate_id,
    manifest_id: fb.manifest_id,
    platform: fb.platform,
    store_feedback_type: fb.store_feedback_type as StoreFeedbackInput["store_feedback_type"],
    store_feedback_status: fb.store_feedback_status as StoreFeedbackInput["store_feedback_status"],
    external_reference: fb.external_reference ?? null,
    reason_code: fb.reason_code ?? null,
    human_summary: fb.human_summary,
    required_action: fb.required_action ?? null,
    received_at_reference: fb.received_at_reference,
    evidence_url: fb.evidence_url ?? null,
    reviewer: fb.reviewer ?? null,
    payload_hash: fb.payload_hash ?? null,
  };

  const effect = classifyFeedback(input);
  const fromState = fb.current_state as LifecycleState;
  const toState = effect.next_state ?? fromState;

  const { data: fbRow, error: fbErr } = await supabase
    .from("store_lifecycle_feedback")
    .insert({
      candidate_id: fb.candidate_id,
      manifest_id: fb.manifest_id,
      platform: fb.platform,
      store_feedback_type: fb.store_feedback_type,
      store_feedback_status: fb.store_feedback_status,
      external_reference: fb.external_reference ?? null,
      reason_code: fb.reason_code ?? null,
      human_summary: fb.human_summary,
      required_action: fb.required_action ?? null,
      received_at_reference: fb.received_at_reference,
      evidence_url: fb.evidence_url ?? null,
      reviewer: fb.reviewer ?? null,
      payload_hash: fb.payload_hash ?? null,
      recorded_by: gate.userId,
    })
    .select("id")
    .single();
  if (fbErr) {
    return new Response(JSON.stringify({ error: fbErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ev = {
    candidate_id: fb.candidate_id,
    manifest_id: fb.manifest_id,
    platform: fb.platform,
    event_type: effect.next_event,
    from_state: fromState,
    to_state: toState,
    occurred_at_reference: fb.received_at_reference,
    actor_id: gate.userId,
    feedback_ref: fbRow!.id,
    note: fb.human_summary.slice(0, 500),
  };

  const transitionAllowed = nextLifecycleState(fromState, effect.next_event) !== null;

  const { data: evRow, error: evErr } = await supabase
    .from("store_lifecycle_events")
    .insert(ev)
    .select("id")
    .single();
  if (evErr) {
    return new Response(JSON.stringify({ error: evErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("security_events").insert({
    event_type: "store_lifecycle_feedback_recorded",
    decision: "allow",
    reason: effect.next_event,
    meta: buildLifecycleAuditPayload(
      "store_feedback_recorded",
      { ...ev, platform: fb.platform } as any,
      input,
      new Date().toISOString(),
      effect.is_rejection ? "rejection" : effect.is_approval ? "approval" : "neutral",
    ),
  }).catch(() => {});

  return new Response(
    JSON.stringify({
      ok: true,
      feedback_id: fbRow!.id,
      event_id: evRow!.id,
      classified: effect,
      transition_allowed: transitionAllowed,
      from_state: fromState,
      to_state: toState,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
