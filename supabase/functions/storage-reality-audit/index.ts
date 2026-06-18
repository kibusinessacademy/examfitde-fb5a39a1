// STORAGE.RLS.REALITY.AUDIT — Phase 0 (read-only)
// Hard gates: no bucket/object/policy/signed-url/upload/delete mutations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const TENANT_REGEX: Record<string, RegExp> = {
  org: /^org\/[0-9a-f-]{36}\//i,
  user: /^user\/[0-9a-f-]{36}\//i,
  flat_uuid: /^[0-9a-f-]{36}\//i,
};

type ContentClass =
  | "exam_content" | "curriculum" | "learner_data" | "assessment"
  | "certificate" | "ai_artifact" | "seo_asset" | "system_asset"
  | "media_upload" | "unknown";

// Heuristic bucket-name → content-class mapping (read-only)
function classifyBucket(id: string): ContentClass {
  const s = id.toLowerCase();
  if (/(certificate|cert-|zertifikat)/.test(s)) return "certificate";
  if (/(oral|voice|audio|trainer-session|exam-recording)/.test(s)) return "learner_data";
  if (/(answer|attempt|submission|response|learner-|progress|export)/.test(s)) return "learner_data";
  if (/(exam|question-pool|prüfungs|pruefung|blueprint|pool)/.test(s)) return "exam_content";
  if (/(curriculum|lehrplan|curricula|syllabus|ssot)/.test(s)) return "curriculum";
  if (/(minicheck|assessment|quiz|readiness)/.test(s)) return "assessment";
  if (/(ai-|tutor|ai_tutor|gen|generated|llm|embedding)/.test(s)) return "ai_artifact";
  if (/(seo|sitemap|llms|og-image|social)/.test(s)) return "seo_asset";
  if (/(upload|media|avatar|cover|image|brand)/.test(s)) return "media_upload";
  if (/(backup|system|ops|log|admin)/.test(s)) return "system_asset";
  return "unknown";
}

type Severity = "info" | "low" | "medium" | "high" | "critical";

function escalate(base: Severity, cls: ContentClass): Severity {
  const sensitive = cls === "learner_data" || cls === "certificate" || cls === "assessment";
  if (!sensitive) return base;
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  const i = order.indexOf(base);
  return order[Math.min(i + 1, order.length - 1)];
}

type Finding = {
  bucket_id: string;
  finding_type: string;
  severity: Severity;
  content_class: ContentClass;
  path_sample?: string | null;
  evidence: Record<string, unknown>;
  recommendation?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ---- AuthZ: admin only ----
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "missing bearer" }, 401);
    }
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

    const body = await req.json().catch(() => ({}));
    const sampleSize = Math.min(Number(body.sample_size ?? 25), 200);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Create run row (or reuse provided one)
    let runId: string = body.run_id;
    if (!runId) {
      const { data: runRow, error: runErr } = await admin
        .from("storage_audit_runs")
        .insert({ triggered_by: userData.user.id, source: "manual", status: "running" })
        .select("id")
        .single();
      if (runErr) throw runErr;
      runId = runRow!.id;
    } else {
      await admin.from("storage_audit_runs").update({ status: "running" }).eq("id", runId);
    }

    // ---- READ-ONLY: list buckets via storage API ----
    const { data: buckets, error: bErr } = await admin.storage.listBuckets();
    if (bErr) throw bErr;

    const findings: Finding[] = [];
    let totalSampled = 0;

    for (const b of buckets) {
      const cls: ContentClass = classifyBucket(b.id);

      // sample objects (root level + 1 prefix deep) — READ-ONLY list calls
      const sample: { name: string; id?: string | null }[] = [];
      const { data: rootList } = await admin.storage.from(b.id).list("", {
        limit: sampleSize,
        sortBy: { column: "created_at", order: "desc" },
      });
      for (const o of rootList ?? []) sample.push({ name: o.name, id: (o as any).id });
      totalSampled += sample.length;

      // path classification
      const paths = sample.map((s) => s.name).filter(Boolean);
      const matchesOrg = paths.filter((p) => TENANT_REGEX.org.test(p)).length;
      const matchesUser = paths.filter((p) => TENANT_REGEX.user.test(p)).length;
      const matchesUuid = paths.filter((p) => TENANT_REGEX.flat_uuid.test(p)).length;
      const matchedAny = matchesOrg + matchesUser + matchesUuid;

      const inferred =
        matchesOrg > matchesUser && matchesOrg > 0
          ? "org"
          : matchesUser > 0
          ? "user"
          : b.public
          ? "public"
          : "unknown";

      await admin
        .from("storage_bucket_registry")
        .upsert(
          {
            bucket_id: b.id,
            tenant_model: inferred,
            content_class: cls,
            is_public: !!b.public,
            observed_object_count: paths.length,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "bucket_id", ignoreDuplicates: false },
        );

      const push = (f: Omit<Finding, "content_class" | "severity"> & { severity: Severity }) =>
        findings.push({ ...f, content_class: cls, severity: escalate(f.severity, cls) });

      // FINDINGS ---------------------------------------------------------------
      if (b.public) {
        push({
          bucket_id: b.id,
          finding_type: "bucket_is_public",
          severity: "high",
          evidence: { public: true, content_class: cls },
          recommendation:
            "Public buckets bypass RLS. Bei sensitiven Klassen (learner_data, certificate, assessment) sofort prüfen.",
        });
      }

      if (paths.length === 0) {
        push({
          bucket_id: b.id,
          finding_type: "bucket_empty_or_inaccessible",
          severity: "info",
          evidence: { sampled: 0 },
          recommendation: "Keine Objekte am Root beobachtet. Inaktiv — Löschkandidat.",
        });
      } else if (matchedAny === 0) {
        push({
          bucket_id: b.id,
          finding_type: "no_tenant_prefix_detected",
          severity: "high",
          path_sample: paths[0],
          evidence: { sampled: paths.length, examples: paths.slice(0, 5) },
          recommendation:
            "Pfade enthalten kein org/<uuid> oder user/<uuid> Prefix. Tenant-Isolation per Storage-Policy nicht erzwingbar.",
        });
      } else if (matchedAny < paths.length) {
        const offenders = paths.filter(
          (p) =>
            !TENANT_REGEX.org.test(p) &&
            !TENANT_REGEX.user.test(p) &&
            !TENANT_REGEX.flat_uuid.test(p),
        );
        push({
          bucket_id: b.id,
          finding_type: "mixed_path_convention",
          severity: "medium",
          path_sample: offenders[0] ?? null,
          evidence: {
            sampled: paths.length,
            matched: matchedAny,
            unmatched_examples: offenders.slice(0, 5),
          },
          recommendation: "Pfadkonvention uneinheitlich. Legacy-Objekte identifizieren.",
        });
      }

      const flatRoot = paths.filter((p) => !p.includes("/"));
      if (flatRoot.length > 0 && !b.public) {
        push({
          bucket_id: b.id,
          finding_type: "flat_root_objects",
          severity: "medium",
          path_sample: flatRoot[0],
          evidence: { count: flatRoot.length, examples: flatRoot.slice(0, 5) },
          recommendation:
            "Objekte ohne Verzeichnis-Prefix lassen sich nicht per storage.foldername(name)[1] isolieren.",
        });
      }
    }


    if (findings.length > 0) {
      const rows = findings.map((f) => ({ ...f, run_id: runId }));
      await admin.from("storage_rls_audit_findings").insert(rows);
    }

    // finalize run
    await admin
      .from("storage_audit_runs")
      .update({
        status: "completed",
        buckets_scanned: buckets.length,
        objects_sampled: totalSampled,
        findings_count: findings.length,
        summary: {
          buckets: buckets.map((b) => ({ id: b.id, public: b.public })),
          severities: countBy(findings, "severity"),
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return json({
      ok: true,
      run_id: runId,
      buckets_scanned: buckets.length,
      objects_sampled: totalSampled,
      findings: findings.length,
    });
  } catch (e) {
    console.error("storage-reality-audit error", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function countBy<T extends Record<string, any>>(arr: T[], key: keyof T) {
  return arr.reduce<Record<string, number>>((acc, x) => {
    const k = String(x[key]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
