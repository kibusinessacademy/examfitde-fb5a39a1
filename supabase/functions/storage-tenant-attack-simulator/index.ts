// STORAGE.RLS.REALITY.AUDIT — Phase 2.0
// Tenant-Reality Attacks (synth-only): A cross_tenant_object, B signed_url_replay,
// C path_enumeration, D idor_object_id. Per-class enable + global kill-switch + cleanup-blocker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type ClassKey = "cross_tenant_object" | "signed_url_replay" | "path_enumeration" | "idor_object_id";
type Severity = "info" | "low" | "medium" | "high" | "critical";
const SENSITIVE = new Set(["learner_data", "certificate", "assessment", "exam_content"]);

function escalate(base: Severity, cls: string): Severity {
  if (!SENSITIVE.has(cls)) return base;
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  return order[Math.min(order.indexOf(base) + 1, order.length - 1)];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "missing bearer" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);
  const { data: isAdmin } = await userClient.rpc("has_role", {
    _user_id: userData.user.id, _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const anon = createClient(SUPABASE_URL, ANON_KEY);

  // Global Phase-1 kill-switch (shared policy row) — Phase 2 requires Phase 1 also enabled
  const { data: policy } = await admin
    .from("storage_attack_policies").select("*").limit(1).maybeSingle();
  if (!policy || policy.enabled !== true) {
    return json({ error: "global attack simulation disabled (kill-switch off)" }, 423);
  }

  // Phase 2.0 hard allowlist (server-enforced; never widened from client)
  const HARD_ALLOWLIST_SAFE = new Set<string>(["seo_assets", "media_uploads", "system_assets"]);
  const FORBIDDEN_CLASSES = new Set(["learner_data", "certificate", "assessment", "exam_content"]);

  const synthPrefix: string = policy.synthetic_prefix || "__storage_audit__";

  // Block-Gate from Phase 1.1
  const { data: gate } = await admin.rpc("fn_storage_attack_can_run");
  const gateRow = Array.isArray(gate) ? gate[0] : gate;
  if (gateRow && gateRow.can_run === false) {
    return json({ error: "blocked", reason: gateRow.reason ?? "previous run cleanup mismatch" }, 409);
  }

  // Resolve enabled Phase-2 attack classes
  const { data: classes } = await admin
    .from("storage_attack_classes")
    .select("class_key, enabled, kill_switch, default_severity, phase")
    .eq("phase", "2.0");
  const activeClasses: { key: ClassKey; sev: Severity }[] = (classes ?? [])
    .filter((c: any) => c.enabled === true && c.kill_switch === false)
    .map((c: any) => ({ key: c.class_key as ClassKey, sev: (c.default_severity ?? "high") as Severity }));

  if (activeClasses.length === 0) {
    return json({ error: "no phase-2.0 attack classes enabled" }, 423);
  }

  // Resolve allowed buckets (hard allowlist ∩ registry, non-sensitive only)
  const { data: registry } = await admin
    .from("storage_bucket_registry")
    .select("bucket_id, content_class, is_public, tenant_model");
  const buckets = (registry ?? []).filter((b: any) =>
    b.is_public !== true &&
    HARD_ALLOWLIST_SAFE.has(b.bucket_id) &&
    !FORBIDDEN_CLASSES.has(b.content_class ?? "unknown")
  );

  const log: any[] = [];
  const startedAt = new Date().toISOString();
  const pushLog = (event: string, data: Record<string, unknown> = {}) =>
    log.push({ at: new Date().toISOString(), event, ...data });

  pushLog("phase2_run_started", {
    synthetic_prefix: synthPrefix,
    active_classes: activeClasses.map((c) => c.key),
    allowed_buckets: buckets.map((b: any) => b.bucket_id),
  });

  // Create run
  const { data: runRow, error: runErr } = await admin
    .from("storage_audit_runs")
    .insert({
      triggered_by: userData.user.id,
      source: "admin_ui_attack_phase2",
      status: "running",
      run_kind: "attack_phase2",
      allowed_buckets: buckets.map((b: any) => b.bucket_id),
      excluded_buckets: [],
      run_log: log,
    })
    .select().single();
  if (runErr || !runRow) return json({ error: runErr?.message ?? "run insert failed" }, 500);
  const runId = runRow.id as string;

  let attacksRun = 0;
  let leaks = 0;
  let objectsPlanned = 0;
  const createdObjects: { bucket: string; path: string }[] = [];

  async function record(
    bucket_id: string, attack_class: ClassKey, result: "pass" | "leak" | "error",
    content_class: string, severity: Severity, tenant: string,
    path: string | null, evidence: Record<string, unknown>,
    synthA: string, synthB: string,
  ) {
    await admin.from("storage_attack_run_results").insert({
      run_id: runId, bucket_id,
      attack_type: attack_class, attack_class,
      result, content_class, severity,
      synthetic_tenant: tenant, target_path: path, evidence,
      synth_tenant_a: synthA, synth_tenant_b: synthB,
    });
  }

  try {
    for (const b of buckets) {
      const bucket = b.bucket_id;
      const cls = b.content_class ?? "unknown";
      const tenantA = crypto.randomUUID();
      const tenantB = crypto.randomUUID();

      const pathA = `${synthPrefix}/${runId}/${tenantA}/probe.txt`;
      const pathB = `${synthPrefix}/${runId}/${tenantB}/probe.txt`;
      objectsPlanned += 2;

      // Plant
      for (const [tenant, p] of [[tenantA, pathA], [tenantB, pathB]] as const) {
        const up = await admin.storage.from(bucket).upload(
          p, new Blob([`synth ${runId} ${tenant}`], { type: "text/plain" }),
          { contentType: "text/plain", upsert: true },
        );
        if (up.error) {
          pushLog("plant_failed", { bucket, path: p, error: up.error.message });
        } else {
          createdObjects.push({ bucket, path: p });
        }
      }

      const enabledKeys = new Set(activeClasses.map((c) => c.key));

      // Attack A: Cross-Tenant Object Access (anon tries to read tenant_b path)
      if (enabledKeys.has("cross_tenant_object")) {
        try {
          const dl = await anon.storage.from(bucket).download(pathB);
          const leaked = !dl.error && !!dl.data;
          await record(bucket, "cross_tenant_object", leaked ? "leak" : "pass",
            cls, escalate(leaked ? "critical" : "info", cls),
            tenantA, pathB,
            { error: dl.error?.message ?? null, bytes: leaked ? (dl.data as Blob).size : 0 },
            tenantA, tenantB);
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await record(bucket, "cross_tenant_object", "error", cls, "medium",
            tenantA, pathB, { error: String(e) }, tenantA, tenantB);
        }
      }

      // Attack B: Signed-URL Cross-Context Replay
      if (enabledKeys.has("signed_url_replay")) {
        try {
          const signed = await admin.storage.from(bucket).createSignedUrl(pathA, 60);
          if (signed.error || !signed.data?.signedUrl) {
            await record(bucket, "signed_url_replay", "error", cls, "medium",
              tenantA, pathA, { stage: "sign", error: signed.error?.message ?? "no url" },
              tenantA, tenantB);
          } else {
            // Replay raw URL + spoofed tenant header
            const r1 = await fetch(signed.data.signedUrl, { method: "GET" });
            const r2 = await fetch(signed.data.signedUrl, {
              method: "GET",
              headers: { "x-tenant-id": tenantB, "x-forwarded-tenant": tenantB },
            });
            // Note: signed URLs are intentionally context-free — Leak only if business
            // context is expected to bind tenant. We mark high if either succeeds.
            const leaked = r1.ok || r2.ok;
            await record(bucket, "signed_url_replay", leaked ? "leak" : "pass",
              cls, escalate(leaked ? "high" : "info", cls),
              tenantB, pathA,
              { raw_status: r1.status, spoofed_status: r2.status, signed_url: signed.data.signedUrl },
              tenantA, tenantB);
            attacksRun++; if (leaked) leaks++;
          }
        } catch (e) {
          await record(bucket, "signed_url_replay", "error", cls, "medium",
            tenantB, pathA, { error: String(e) }, tenantA, tenantB);
        }
      }

      // Attack C: Path Enumeration / Listing Drift (anon list of foreign tenant prefix)
      if (enabledKeys.has("path_enumeration")) {
        try {
          const prefix = `${synthPrefix}/${runId}/${tenantB}`;
          const ls = await anon.storage.from(bucket).list(prefix, { limit: 10 });
          const leaked = !ls.error && Array.isArray(ls.data) && ls.data.length > 0;
          await record(bucket, "path_enumeration", leaked ? "leak" : "pass",
            cls, escalate(leaked ? "high" : "info", cls),
            tenantA, prefix,
            { error: ls.error?.message ?? null, entries: leaked ? ls.data!.length : 0 },
            tenantA, tenantB);
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await record(bucket, "path_enumeration", "error", cls, "medium",
            tenantA, null, { error: String(e) }, tenantA, tenantB);
        }
      }

      // Attack D: IDOR — guess deterministic {tenant}/probe.txt with known ID shape
      if (enabledKeys.has("idor_object_id")) {
        // Guess by enumerating the known-shape path of the other tenant
        try {
          const guessed = `${synthPrefix}/${runId}/${tenantB}/probe.txt`;
          const dl = await anon.storage.from(bucket).download(guessed);
          const leaked = !dl.error && !!dl.data;
          await record(bucket, "idor_object_id", leaked ? "leak" : "pass",
            cls, escalate(leaked ? "high" : "info", cls),
            tenantA, guessed,
            { error: dl.error?.message ?? null, bytes: leaked ? (dl.data as Blob).size : 0 },
            tenantA, tenantB);
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await record(bucket, "idor_object_id", "error", cls, "medium",
            tenantA, null, { error: String(e) }, tenantA, tenantB);
        }
      }
    }
  } finally {
    // Guaranteed cleanup
    const byBucket = new Map<string, string[]>();
    for (const o of createdObjects) {
      if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, []);
      byBucket.get(o.bucket)!.push(o.path);
    }
    let cleanupCount = 0;
    const cleanupFailures: { bucket: string; error: string; paths: number }[] = [];
    for (const [bucket, paths] of byBucket) {
      try {
        const rm = await admin.storage.from(bucket).remove(paths);
        if (rm.error) cleanupFailures.push({ bucket, error: rm.error.message, paths: paths.length });
        else cleanupCount += paths.length;
      } catch (e) {
        cleanupFailures.push({ bucket, error: String(e), paths: paths.length });
      }
    }
    const sampled = createdObjects.length;
    const cleanupOk = cleanupCount === sampled && cleanupFailures.length === 0;
    const blockedReason = cleanupOk ? null
      : `cleanup mismatch: sampled=${sampled} cleaned=${cleanupCount} failures=${cleanupFailures.length}`;

    pushLog("cleanup_done", { sampled, cleanup_count: cleanupCount, cleanup_ok: cleanupOk, failures: cleanupFailures });
    pushLog("phase2_run_finished", { attacks_run: attacksRun, leaks });

    await admin.from("storage_audit_runs").update({
      status: "completed",
      buckets_scanned: buckets.length,
      objects_planned: objectsPlanned,
      objects_sampled: sampled,
      cleanup_count: cleanupCount,
      cleanup_ok: cleanupOk,
      blocked_reason: blockedReason,
      findings_count: leaks,
      summary: {
        phase: "2.0",
        active_classes: activeClasses.map((c) => c.key),
        attacks_run: attacksRun, leaks, buckets: buckets.length,
        objects_planned: objectsPlanned, cleanup_count: cleanupCount,
        cleanup_ok: cleanupOk, cleanup_failures: cleanupFailures,
        started_at: startedAt,
      },
      run_log: log,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json({
    run_id: runId, phase: "2.0",
    active_classes: activeClasses.map((c) => c.key),
    buckets: buckets.length, attacks_run: attacksRun, leaks,
    objects_planned: objectsPlanned, cleaned: createdObjects.length,
  });
});
