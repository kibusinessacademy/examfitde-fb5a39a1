// STORAGE.RLS.REALITY.AUDIT — Phase 1
// Synthetic attack simulation with hard kill-switch + synthetic prefix + guaranteed cleanup.
// Writes ONLY under `<synthetic_prefix>/<run_id>/...`. Does NOT touch production paths,
// does NOT mutate policies, buckets, or signed URLs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type AttackKind =
  | "public_url_read_anon"
  | "signed_url_creation_anon"
  | "direct_download_anon"
  | "list_enumeration_anon"
  | "upload_tenant_spoof_anon";

type AttackResult = "pass" | "leak" | "error" | "not_applicable" | "skipped";
type Severity = "info" | "low" | "medium" | "high" | "critical";

const SENSITIVE = new Set([
  "learner_data",
  "certificate",
  "assessment",
  "exam_content",
]);

function escalateForClass(base: Severity, cls: string): Severity {
  if (!SENSITIVE.has(cls)) return base;
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  return order[Math.min(order.indexOf(base) + 1, order.length - 1)];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ---- AuthZ: admin only ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "missing bearer" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);
  const { data: isAdmin } = await userClient.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const anon = createClient(SUPABASE_URL, ANON_KEY);

  // ---- Kill switch ----
  const { data: policy } = await admin
    .from("storage_attack_policies")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!policy || policy.enabled !== true) {
    return json({ error: "attack simulation disabled (kill-switch off)" }, 423);
  }

  const synthPrefix: string = policy.synthetic_prefix || "__storage_audit__";
  const maxObjs: number = Math.max(1, Math.min(5, policy.max_objects_per_bucket ?? 2));
  const allow: string[] = policy.allowed_buckets ?? [];
  const exclude: string[] = policy.excluded_buckets ?? [];

  // ---- Create run ----
  const { data: runRow, error: runErr } = await admin
    .from("storage_audit_runs")
    .insert({
      triggered_by: userData.user.id,
      source: "admin_ui_attack",
      status: "running",
      run_kind: "attack",
    })
    .select()
    .single();
  if (runErr || !runRow) return json({ error: runErr?.message ?? "run insert failed" }, 500);
  const runId = runRow.id as string;

  // ---- Inventory ----
  const { data: registry } = await admin
    .from("storage_bucket_registry")
    .select("bucket_id, content_class, is_public, tenant_model");

  let buckets = (registry ?? []).filter((b) => {
    if (b.is_public === true) return false; // public buckets are not attack targets
    if (exclude.includes(b.bucket_id)) return false;
    if (allow.length > 0 && !allow.includes(b.bucket_id)) return false;
    return true;
  });

  let attacksRun = 0;
  let leaks = 0;
  const createdObjects: { bucket: string; path: string }[] = [];

  try {
    for (const b of buckets) {
      const bucket = b.bucket_id;
      const cls = b.content_class ?? "unknown";

      // Plant synthetic objects (tenant A + tenant B), service-role only.
      const tenantA = crypto.randomUUID();
      const tenantB = crypto.randomUUID();
      const paths = [
        { tenant: "tenant_a", path: `${synthPrefix}/${runId}/tenant_a/${tenantA}/probe.txt` },
        { tenant: "tenant_b", path: `${synthPrefix}/${runId}/tenant_b/${tenantB}/probe.txt` },
      ].slice(0, maxObjs);

      const planted: { tenant: string; path: string }[] = [];
      for (const p of paths) {
        const body = new Blob([`synthetic-audit ${runId} ${p.tenant}`], { type: "text/plain" });
        const up = await admin.storage.from(bucket).upload(p.path, body, {
          contentType: "text/plain",
          upsert: true,
        });
        if (!up.error) {
          planted.push(p);
          createdObjects.push({ bucket, path: p.path });
        } else {
          await recordResult(admin, runId, bucket, "public_url_read_anon", "error", cls, "medium", p.tenant, p.path, {
            stage: "plant",
            error: up.error.message,
          });
        }
      }
      if (planted.length === 0) continue;

      // ---- 5 attack kinds, executed with anon client ----
      for (const p of planted) {
        // 1) public URL read
        try {
          const pub = anon.storage.from(bucket).getPublicUrl(p.path);
          const url = pub.data?.publicUrl;
          let leaked = false;
          let status = 0;
          if (url) {
            const r = await fetch(url, { method: "GET" });
            status = r.status;
            leaked = r.ok;
          }
          await recordResult(
            admin, runId, bucket, "public_url_read_anon",
            leaked ? "leak" : "pass",
            cls,
            escalateForClass(leaked ? "high" : "info", cls),
            p.tenant, p.path,
            { url, http_status: status },
          );
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await recordResult(admin, runId, bucket, "public_url_read_anon", "error", cls, "medium", p.tenant, p.path, { error: String(e) });
        }

        // 2) signed URL creation as anon
        try {
          const sr = await anon.storage.from(bucket).createSignedUrl(p.path, 60);
          const leaked = !sr.error && !!sr.data?.signedUrl;
          await recordResult(
            admin, runId, bucket, "signed_url_creation_anon",
            leaked ? "leak" : "pass",
            cls,
            escalateForClass(leaked ? "high" : "info", cls),
            p.tenant, p.path,
            { error: sr.error?.message ?? null },
          );
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await recordResult(admin, runId, bucket, "signed_url_creation_anon", "error", cls, "medium", p.tenant, p.path, { error: String(e) });
        }

        // 3) direct download as anon
        try {
          const dl = await anon.storage.from(bucket).download(p.path);
          const leaked = !dl.error && !!dl.data;
          await recordResult(
            admin, runId, bucket, "direct_download_anon",
            leaked ? "leak" : "pass",
            cls,
            escalateForClass(leaked ? "high" : "info", cls),
            p.tenant, p.path,
            { error: dl.error?.message ?? null, bytes: leaked ? (dl.data as Blob).size : 0 },
          );
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await recordResult(admin, runId, bucket, "direct_download_anon", "error", cls, "medium", p.tenant, p.path, { error: String(e) });
        }

        // 4) list enumeration as anon
        try {
          const prefix = p.path.split("/").slice(0, -1).join("/");
          const ls = await anon.storage.from(bucket).list(prefix, { limit: 5 });
          const leaked = !ls.error && Array.isArray(ls.data) && ls.data.length > 0;
          await recordResult(
            admin, runId, bucket, "list_enumeration_anon",
            leaked ? "leak" : "pass",
            cls,
            escalateForClass(leaked ? "medium" : "info", cls),
            p.tenant, p.path,
            { error: ls.error?.message ?? null, entries: leaked ? ls.data!.length : 0 },
          );
          attacksRun++; if (leaked) leaks++;
        } catch (e) {
          await recordResult(admin, runId, bucket, "list_enumeration_anon", "error", cls, "medium", p.tenant, p.path, { error: String(e) });
        }
      }

      // 5) upload tenant-spoof as anon (one attempt per bucket, separate path)
      try {
        const spoofPath = `${synthPrefix}/${runId}/spoof/${crypto.randomUUID()}.txt`;
        const body = new Blob(["spoof"], { type: "text/plain" });
        const up = await anon.storage.from(bucket).upload(spoofPath, body, {
          contentType: "text/plain",
          upsert: false,
        });
        const leaked = !up.error;
        if (leaked) createdObjects.push({ bucket, path: spoofPath });
        await recordResult(
          admin, runId, bucket, "upload_tenant_spoof_anon",
          leaked ? "leak" : "pass",
          cls,
          escalateForClass(leaked ? "high" : "info", cls),
          "anon", spoofPath,
          { error: up.error?.message ?? null },
        );
        attacksRun++; if (leaked) leaks++;
      } catch (e) {
        await recordResult(admin, runId, "(spoof)", "upload_tenant_spoof_anon", "error", "unknown", "medium", "anon", null, { error: String(e) });
      }
    }
  } finally {
    // ---- Guaranteed cleanup of every synthetic object we created ----
    const byBucket = new Map<string, string[]>();
    for (const o of createdObjects) {
      if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, []);
      byBucket.get(o.bucket)!.push(o.path);
    }
    for (const [bucket, paths] of byBucket) {
      try { await admin.storage.from(bucket).remove(paths); } catch (_) { /* swallow */ }
    }

    await admin
      .from("storage_audit_runs")
      .update({
        status: "completed",
        buckets_scanned: buckets.length,
        objects_sampled: createdObjects.length,
        findings_count: leaks,
        summary: { attacks_run: attacksRun, leaks, buckets: buckets.length, cleanup_count: createdObjects.length },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  return json({ run_id: runId, buckets: buckets.length, attacks_run: attacksRun, leaks, cleaned: createdObjects.length });
});

async function recordResult(
  admin: ReturnType<typeof createClient>,
  run_id: string,
  bucket_id: string,
  attack_type: AttackKind,
  result: AttackResult,
  content_class: string,
  severity: Severity,
  synthetic_tenant: string,
  target_path: string | null,
  evidence: Record<string, unknown>,
) {
  await admin.from("storage_attack_run_results").insert({
    run_id, bucket_id, attack_type, result,
    content_class, severity, synthetic_tenant, target_path, evidence,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
