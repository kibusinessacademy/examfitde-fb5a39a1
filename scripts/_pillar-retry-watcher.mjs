// Polls Spoke-Status for both target curricula and triggers Pillar-Retry when all 3 gates pass.
// Gates: published_spokes >= 6, active_spoke_jobs == 0, recent_failed_spokes (15min) == 0
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SR_KEY || process.env.SR_KEY;
if (!SUPABASE_URL || !SRK) { console.error("Missing SUPABASE_URL or service role key"); process.exit(2); }
const sb = createClient(SUPABASE_URL, SRK, { auth: { persistSession: false } });

const TARGETS = [
  { curriculum_id: "53d13046-88bf-42bf-9a2e-05d5e4a4f272", label: "FISI" },
  { curriculum_id: "055098ff-7cb0-4373-bd87-ff1979afc646", label: "Industriekaufmann" },
];

const MAX_MINUTES = 30;
const INTERVAL_MS = 90_000;
const startedAt = Date.now();
const triggered = new Set();

async function audit(action_type, target_id, result_status, metadata) {
  await sb.from("auto_heal_log").insert({
    action_type, target_type: "curriculum", target_id, result_status, metadata,
    trigger_source: "pillar_retry_watcher",
  });
}

async function gateCheck(curriculum_id) {
  const { data, error } = await sb.rpc("exec_sql_unsafe_wrapper_does_not_exist"); // placeholder unused
  // Use direct SQL via three queries (no custom RPC available)
  const [{ count: pubSpokes }, { count: active }, { count: failed }] = await Promise.all([
    sb.from("seo_content_pages").select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculum_id).eq("page_type", "intent_page").eq("status", "published"),
    sb.from("job_queue").select("id", { count: "exact", head: true })
      .eq("job_type", "seo_intent_page_generate")
      .filter("payload->>curriculum_id", "eq", curriculum_id)
      .in("status", ["pending", "processing", "queued"]),
    sb.from("job_queue").select("id", { count: "exact", head: true })
      .eq("job_type", "seo_intent_page_generate")
      .filter("payload->>curriculum_id", "eq", curriculum_id)
      .eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 15 * 60_000).toISOString()),
  ]);
  return { published_spokes: pubSpokes ?? 0, active_spoke_jobs: active ?? 0, recent_failed_spokes: failed ?? 0 };
}

async function enqueuePillarRetry(curriculum_id, label, gates) {
  const idem = `pillar_retry|${curriculum_id}|${new Date().toISOString().slice(0,10)}`;
  const { data, error } = await sb.from("job_queue").insert({
    job_type: "seo_pillar_page_generate",
    status: "pending",
    priority: 8,
    lane: "control",
    worker_pool: "core",
    payload: { curriculum_id, retry: true, source: "pillar_retry_watcher" },
    idempotency_key: idem,
  }).select("id").maybeSingle();
  if (error) {
    await audit("pillar_retry_enqueue_failed", curriculum_id, "error", { gates, error: error.message, label });
    return { ok: false, error: error.message };
  }
  await audit("pillar_retry_enqueued", curriculum_id, "ok", { gates, job_id: data?.id, label, idempotency_key: idem });
  return { ok: true, job_id: data?.id };
}

async function tick() {
  for (const t of TARGETS) {
    if (triggered.has(t.curriculum_id)) continue;
    const g = await gateCheck(t.curriculum_id);
    const reasons = [];
    if (g.published_spokes < 6) reasons.push("spokes_missing");
    if (g.active_spoke_jobs > 0) reasons.push("active_jobs_present");
    if (g.recent_failed_spokes > 0) reasons.push("recent_failures");
    const ts = new Date().toISOString().slice(11, 19);
    if (reasons.length === 0) {
      console.log(`[${ts}] ${t.label} GATES GREEN`, g, "→ enqueueing pillar retry");
      const res = await enqueuePillarRetry(t.curriculum_id, t.label, g);
      console.log(`[${ts}] ${t.label} enqueue result:`, res);
      triggered.add(t.curriculum_id);
    } else {
      console.log(`[${ts}] ${t.label} deferred [${reasons.join(",")}]`, g);
      await audit("pillar_retry_deferred", t.curriculum_id, "deferred", { gates: g, reasons, label: t.label });
    }
  }
}

console.log("Pillar retry watcher started", { targets: TARGETS.map(t=>t.label), max_minutes: MAX_MINUTES });
await tick();
while (triggered.size < TARGETS.length && (Date.now() - startedAt) < MAX_MINUTES * 60_000) {
  await new Promise(r => setTimeout(r, INTERVAL_MS));
  await tick();
}
if (triggered.size < TARGETS.length) {
  for (const t of TARGETS) {
    if (!triggered.has(t.curriculum_id)) {
      await audit("pillar_retry_watcher_timeout", t.curriculum_id, "timeout", { max_minutes: MAX_MINUTES, label: t.label });
      console.log("TIMEOUT", t.label);
    }
  }
}
console.log("Watcher done. Triggered:", [...triggered]);
