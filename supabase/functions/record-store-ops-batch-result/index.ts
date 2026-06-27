// STORE.OPS.BATCH.OS.1 — record-store-ops-batch-result (admin-only)
// Records a single item's outcome (succeeded/failed/skipped/blocked) and
// re-projects the batch state. No publish, no rollout.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { deriveStateFromItems } from "../_shared/storeOpsBatch/batchState.ts";
import { isAllowedAction } from "../_shared/storeOpsBatch/batchPolicy.ts";
import type {
  BatchActionType,
  BatchItem,
  BatchItemStatus,
} from "../_shared/storeOpsBatch/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_STATUSES: BatchItemStatus[] = [
  "skipped",
  "planned",
  "running",
  "succeeded",
  "failed",
  "blocked",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await assertAdmin(req, "record-store-ops-batch-result");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  let body: {
    batch_id?: string;
    manifest_id?: string;
    action_type?: string;
    status?: BatchItemStatus;
    blockers?: Array<{ code: string; message: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { batch_id, manifest_id, action_type, status } = body;
  if (!batch_id || !manifest_id || !action_type || !status) {
    return json({ error: "missing_fields" }, 400);
  }
  if (!isAllowedAction(action_type)) return json({ error: "forbidden_action" }, 400);
  if (!VALID_STATUSES.includes(status)) return json({ error: "invalid_status" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Append-only: insert a new item row representing the latest outcome.
  const insertItem = await supabase.from("store_ops_batch_items").insert({
    batch_id,
    manifest_id,
    action_type: action_type as BatchActionType,
    status,
    blockers: body.blockers ?? [],
  });
  if (insertItem.error) return json({ error: "insert_failed", details: insertItem.error.message }, 500);

  // Recompute state from latest-per-(manifest, action) rows.
  const { data: all, error: loadErr } = await supabase
    .from("store_ops_batch_items")
    .select("manifest_id, action_type, status, blockers, recorded_at")
    .eq("batch_id", batch_id)
    .order("recorded_at", { ascending: true });
  if (loadErr) return json({ error: "load_failed", details: loadErr.message }, 500);

  const latest = new Map<string, BatchItem>();
  for (const row of all ?? []) {
    latest.set(`${row.manifest_id}::${row.action_type}`, {
      manifest_id: row.manifest_id as string,
      action_type: row.action_type as BatchActionType,
      status: row.status as BatchItemStatus,
      blockers: (row.blockers as any) ?? [],
    });
  }
  const items = [...latest.values()];
  const newState = deriveStateFromItems(items);

  const succeeded = items.filter((i) => i.status === "succeeded").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const skipped = items.filter((i) => i.status === "skipped").length;

  const upd = await supabase
    .from("store_ops_batches")
    .update({ state: newState, succeeded, failed, blocked, skipped, updated_at: new Date().toISOString() })
    .eq("id", batch_id);
  if (upd.error) return json({ error: "update_failed", details: upd.error.message }, 500);

  await supabase.from("security_events").insert({
    event_type: "store_ops_batch_item_completed",
    severity: "info",
    user_id: gate.userId,
    metadata: { batch_id, manifest_id, action_type, status, new_state: newState },
  });

  return json({ batch_id, state: newState, total: items.length, succeeded, failed, blocked, skipped });
});
