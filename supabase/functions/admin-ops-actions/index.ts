import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JsonRow = Record<string, unknown>;

async function assertAdmin(sb: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("FORBIDDEN");
  }
}

async function auditLog(
  sb: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  payload: JsonRow,
  result: JsonRow,
) {
  await sb.from("admin_actions").insert({
    user_id: userId,
    action,
    payload: { ...payload, result } as any,
  }).then(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: "Missing env configuration" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);

    // Admin role guard
    try {
      await assertAdmin(sb, user.id);
    } catch {
      return json({ error: "Forbidden – admin role required" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as JsonRow;
    const action = String(body.action || "");

    let result: JsonRow;

    switch (action) {
      case "requeue_failed_jobs":
        result = await requeueFailedJobs(sb, body);
        break;
      case "release_provider_cooldowns":
        result = await releaseProviderCooldowns(sb, body);
        break;
      case "reset_stalled_steps":
        result = await resetStalledSteps(sb, body);
        break;
      case "cancel_zombie_packages":
        result = await cancelZombiePackages(sb, body);
        break;
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }

    // Audit log (fire-and-forget)
    auditLog(sb, user.id, action, body, result);

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function requeueFailedJobs(sb: ReturnType<typeof createClient>, body: JsonRow) {
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;

  const { data: jobs, error: fetchErr } = await sb
    .from("job_queue")
    .select("id")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (fetchErr) throw fetchErr;
  if (!jobs?.length) return { ok: true, updated: 0 };

  const ids = jobs.map((j: any) => j.id);
  const { error: updErr } = await sb
    .from("job_queue")
    .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) throw updErr;
  return { ok: true, updated: ids.length };
}

async function releaseProviderCooldowns(sb: ReturnType<typeof createClient>, body: JsonRow) {
  const provider = typeof body.provider === "string" ? body.provider : null;

  let query = sb
    .from("llm_provider_cooldowns")
    .update({ cooldown_until: new Date(0).toISOString(), updated_at: new Date().toISOString() });

  if (provider) query = query.eq("provider", provider);

  const { data, error } = await query.select("id");
  if (error) throw error;
  return { ok: true, updated: data?.length ?? 0 };
}

async function resetStalledSteps(sb: ReturnType<typeof createClient>, body: JsonRow) {
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;

  const { data: rows, error: fetchErr } = await sb
    .from("ops_package_steps_stuck")
    .select("package_id,step_key")
    .limit(limit);

  if (fetchErr) throw fetchErr;
  if (!rows?.length) return { ok: true, updated: 0 };

  let updated = 0;
  for (const row of rows as any[]) {
    if (!row.package_id || !row.step_key) continue;
    const { error } = await sb
      .from("package_steps")
      .update({ status: "queued", started_at: null, finished_at: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("package_id", row.package_id)
      .eq("step_key", row.step_key);
    if (!error) updated += 1;
  }
  return { ok: true, updated };
}

async function cancelZombiePackages(sb: ReturnType<typeof createClient>, body: JsonRow) {
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;

  const { data: zombies, error: fetchErr } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id")
    .limit(limit);

  if (fetchErr) throw fetchErr;
  if (!zombies?.length) return { ok: true, updated: 0 };

  const ids = (zombies as any[]).map((z) => z.package_id).filter(Boolean);
  if (!ids.length) return { ok: true, updated: 0 };

  const { error } = await sb
    .from("course_packages")
    .update({ status: "blocked", blocked_reason: "admin_phase3_cancelled_zombie", updated_at: new Date().toISOString() })
    .in("id", ids);

  if (error) throw error;
  return { ok: true, updated: ids.length };
}
