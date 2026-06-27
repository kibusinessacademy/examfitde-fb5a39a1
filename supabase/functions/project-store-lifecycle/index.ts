// STORE.LIFECYCLE.OS.1 — project-store-lifecycle
// Admin-only. Read-only projection across candidates, feedback, and lifecycle events.
// NO publishing. NO Store API.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { projectLifecycle } from "../_shared/storeLifecycle/lifecycleProjection.ts";
import type {
  CandidateSnapshot,
  LifecycleEvent,
  LifecycleState,
  StoreFeedbackInput,
} from "../_shared/storeLifecycle/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Body = z.object({
  manifest_id: z.string().uuid(),
});

function rowToCandidate(r: any): CandidateSnapshot {
  return {
    candidate_id: r.id,
    manifest_id: r.manifest_id,
    product_id: r.product_id ?? null,
    curriculum_id: r.curriculum_id ?? null,
    course_id: r.course_id ?? null,
    version: r.version ?? "0.0.0",
    build_number: r.build_number ?? null,
    manifest_hash: r.manifest_hash ?? null,
    listing_hash: r.listing_hash ?? null,
    package_hash: r.package_hash ?? null,
    build_hash: r.build_hash ?? null,
    approved_externally: r.status === "approved" || r.status === "approved_for_submission" || r.status === "released",
    released_externally: r.status === "released",
    retired: r.status === "invalidated" || r.status === "retired" || r.status === "cancelled",
    created_at_reference: r.created_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = await assertAdmin(req, "project-store-lifecycle");
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
  const { manifest_id } = parsed.data;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: candidates, error: cErr } = await supabase
    .from("store_release_candidates")
    .select("*")
    .eq("manifest_id", manifest_id)
    .order("created_at", { ascending: false });
  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const snapshots = (candidates ?? []).map(rowToCandidate);
  const current = snapshots[0] ?? null;
  const history = snapshots.slice(1);

  const { data: events } = await supabase
    .from("store_lifecycle_events")
    .select("*")
    .eq("manifest_id", manifest_id)
    .order("created_at", { ascending: true });

  const { data: feedback } = await supabase
    .from("store_lifecycle_feedback")
    .select("*")
    .eq("manifest_id", manifest_id)
    .order("received_at_reference", { ascending: true });

  const evList: LifecycleEvent[] = (events ?? []).map((r: any) => ({
    candidate_id: r.candidate_id,
    manifest_id: r.manifest_id,
    platform: r.platform,
    event_type: r.event_type,
    from_state: r.from_state,
    to_state: r.to_state,
    occurred_at_reference: r.occurred_at_reference,
    actor_id: r.actor_id,
    feedback_ref: r.feedback_ref,
    note: r.note,
  }));

  const fbList: StoreFeedbackInput[] = (feedback ?? []).map((r: any) => ({
    candidate_id: r.candidate_id,
    manifest_id: r.manifest_id,
    platform: r.platform,
    store_feedback_type: r.store_feedback_type,
    store_feedback_status: r.store_feedback_status,
    external_reference: r.external_reference,
    reason_code: r.reason_code,
    human_summary: r.human_summary,
    required_action: r.required_action,
    received_at_reference: r.received_at_reference,
    evidence_url: r.evidence_url,
    reviewer: r.reviewer,
    payload_hash: r.payload_hash,
  }));

  // Derive current_state from latest event's to_state, else not_submitted.
  const currentState: LifecycleState =
    (evList[evList.length - 1]?.to_state as LifecycleState | undefined) ?? "not_submitted";

  const projection = projectLifecycle({
    current_candidate: current,
    history,
    current_state: currentState,
    events: evList,
    feedback: fbList,
    explicitly_blocked: false,
  });

  return new Response(JSON.stringify({ ok: true, projection, candidates_total: snapshots.length }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
