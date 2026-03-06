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

type SB = ReturnType<typeof createClient>;

interface PolicyRow {
  id: string;
  policy_key: string;
  enabled: boolean;
  threshold_minutes: number;
  max_per_run: number;
  cooldown_minutes: number;
  config_json: Record<string, unknown>;
  last_run_at: string | null;
}

interface HealResult {
  policy_key: string;
  updated: number;
  affected_ids: string[];
  skipped_reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Missing env" }, 500);

    const sb = createClient(supabaseUrl, serviceKey);

    // Load enabled policies
    const { data: policies, error: polErr } = await sb
      .from("auto_heal_config")
      .select("*")
      .eq("enabled", true);

    if (polErr) throw polErr;
    if (!policies?.length) return json({ ok: true, results: [], message: "No enabled policies" });

    const results: HealResult[] = [];
    const now = new Date();

    for (const policy of policies as PolicyRow[]) {
      // Cooldown check
      if (policy.last_run_at) {
        const lastRun = new Date(policy.last_run_at);
        const cooldownMs = (policy.cooldown_minutes || 5) * 60_000;
        if (now.getTime() - lastRun.getTime() < cooldownMs) {
          results.push({ policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "cooldown" });
          continue;
        }
      }

      let result: HealResult;

      try {
        switch (policy.policy_key) {
          case "requeue_transient_failed":
            result = await healRequeueTransient(sb, policy);
            break;
          case "release_expired_cooldowns":
            result = await healReleaseCooldowns(sb, policy);
            break;
          case "reset_stuck_steps":
            result = await healResetStuck(sb, policy);
            break;
          case "cancel_zombies":
            result = await healCancelZombies(sb, policy);
            break;
          case "flag_seo_gaps":
            result = await healFlagSeoGaps(sb, policy);
            break;
          case "archive_stale_drafts":
            result = await healArchiveStaleDrafts(sb, policy);
            break;
          case "fix_broken_redirects":
            result = await healFixBrokenRedirects(sb, policy);
            break;
          default:
            result = { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "unknown_policy" };
        }
      } catch (e) {
        result = { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: String(e) };
      }

      // Update last_run
      await sb.from("auto_heal_config").update({
        last_run_at: now.toISOString(),
        last_run_result: result as any,
        updated_at: now.toISOString(),
      }).eq("id", policy.id);

      // Audit log
      if (result.updated > 0) {
        await sb.from("admin_actions").insert({
          action: `auto_heal:${policy.policy_key}`,
          payload: { policy_key: policy.policy_key, threshold_minutes: policy.threshold_minutes } as any,
          before_state: null,
          after_state: { updated: result.updated } as any,
          affected_ids: result.affected_ids,
          scope: "auto_heal",
        });
      }

      results.push(result);
    }

    return json({ ok: true, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/* ── Heal: Requeue transient failed jobs ── */
async function healRequeueTransient(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const thresholdMs = (policy.threshold_minutes || 5) * 60_000;
  const since = new Date(Date.now() - thresholdMs).toISOString();
  const transientPatterns = ['503', '504', 'timeout', 'rate_limit', 'rate-limit', 'ECONNRESET', 'ops_empty_response'];

  const { data: jobs, error } = await sb
    .from("job_queue")
    .select("id, last_error")
    .eq("status", "failed")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!jobs?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  // Filter to transient errors only
  const transient = jobs.filter((j: any) => {
    const err = String(j.last_error || "").toLowerCase();
    return transientPatterns.some(p => err.includes(p));
  });

  if (!transient.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const ids = transient.map((j: any) => j.id);
  const { error: updErr } = await sb
    .from("job_queue")
    .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) throw updErr;
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Release expired cooldowns ── */
async function healReleaseCooldowns(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("llm_provider_cooldowns")
    .update({ cooldown_until: new Date(0).toISOString(), updated_at: now })
    .lt("cooldown_until", now)
    .gt("cooldown_until", new Date(0).toISOString())
    .select("id")
    .limit(policy.max_per_run);

  if (error) throw error;
  const ids = (data || []).map((r: any) => r.id);
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Reset stuck steps ── */
async function healResetStuck(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const { data: rows, error } = await sb
    .from("ops_package_steps_stuck")
    .select("package_id, step_key, minutes_stuck, stall_minutes")
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!rows?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const threshold = policy.threshold_minutes || 60;
  const affected: string[] = [];

  for (const row of rows as any[]) {
    const stallMin = row.minutes_stuck ?? row.stall_minutes ?? 0;
    if (stallMin < threshold) continue;
    if (!row.package_id || !row.step_key) continue;

    const { error: updErr } = await sb
      .from("package_steps")
      .update({ status: "queued", started_at: null, finished_at: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("package_id", row.package_id)
      .eq("step_key", row.step_key);

    if (!updErr) affected.push(`${row.package_id}:${row.step_key}`);
  }

  return { policy_key: policy.policy_key, updated: affected.length, affected_ids: affected };
}

/* ── Heal: Cancel zombie packages ── */
async function healCancelZombies(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const { data: zombies, error } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id")
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!zombies?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const ids = (zombies as any[]).map(z => z.package_id).filter(Boolean);
  if (!ids.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const { error: updErr } = await sb
    .from("course_packages")
    .update({ status: "blocked", blocked_reason: "auto_heal_zombie", updated_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) throw updErr;
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Flag SEO gaps and create notifications ── */
async function healFlagSeoGaps(sb: SB, policy: PolicyRow): Promise<HealResult> {
  // Find published content_pages missing meta_title or meta_description
  const { data: pages } = await sb
    .from("content_pages")
    .select("id, title, slug")
    .eq("status", "published")
    .or("meta_title.is.null,meta_description.is.null")
    .limit(policy.max_per_run);

  // Find published blog_posts missing meta
  const { data: blogs } = await sb
    .from("blog_posts")
    .select("id, title, slug")
    .eq("status", "published")
    .or("meta_title.is.null,meta_description.is.null")
    .limit(policy.max_per_run);

  const allGaps = [...(pages || []), ...(blogs || [])];
  if (!allGaps.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  // Create admin notification for the gaps
  await sb.from("admin_notifications").insert({
    title: `SEO-Lücken: ${allGaps.length} veröffentlichte Inhalte ohne Meta-Daten`,
    body: `Betroffene: ${allGaps.slice(0, 5).map(g => g.title || g.slug).join(', ')}${allGaps.length > 5 ? ` und ${allGaps.length - 5} weitere` : ''}`,
    severity: allGaps.length > 10 ? 'critical' : 'warning',
    category: 'seo',
    entity_type: 'content',
    metadata: { gap_count: allGaps.length, sample_ids: allGaps.slice(0, 10).map(g => g.id) } as any,
  });

  return { policy_key: policy.policy_key, updated: allGaps.length, affected_ids: allGaps.map(g => g.id) };
}

/* ── Heal: Archive stale drafts ── */
async function healArchiveStaleDrafts(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const thresholdDays = policy.threshold_minutes || 30; // reuse threshold_minutes as days for this policy
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60_000).toISOString();

  // Find draft pages not updated in threshold days
  const { data: stalePages } = await sb
    .from("content_pages")
    .select("id, title")
    .eq("status", "draft")
    .lt("updated_at", cutoff)
    .limit(policy.max_per_run);

  if (!stalePages?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const ids = stalePages.map(p => p.id);

  // Don't auto-archive, just notify (safe approach)
  await sb.from("admin_notifications").insert({
    title: `${ids.length} Seiten-Entwürfe seit ${thresholdDays}+ Tagen unverändert`,
    body: `Erwäge Archivierung: ${stalePages.slice(0, 5).map(p => p.title).join(', ')}`,
    severity: 'info',
    category: 'content',
    entity_type: 'content_pages',
    metadata: { stale_count: ids.length, stale_ids: ids.slice(0, 20) } as any,
  });

  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Deactivate broken redirects ── */
async function healFixBrokenRedirects(sb: SB, policy: PolicyRow): Promise<HealResult> {
  // Find redirects with empty or missing to_path
  const { data: broken } = await sb
    .from("seo_redirects")
    .select("id, from_path, to_path")
    .eq("is_active", true)
    .or("to_path.is.null,to_path.eq.")
    .limit(policy.max_per_run);

  if (!broken?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const ids = broken.map(r => r.id);

  // Deactivate broken redirects
  const { error } = await sb
    .from("seo_redirects")
    .update({ is_active: false, notes: "Auto-deactivated: missing target path", updated_at: new Date().toISOString() })
    .in("id", ids);

  if (error) throw error;

  // Notify
  await sb.from("admin_notifications").insert({
    title: `${ids.length} kaputte Redirects deaktiviert`,
    body: `Betroffene Pfade: ${broken.slice(0, 5).map(r => r.from_path).join(', ')}`,
    severity: 'warning',
    category: 'seo',
    entity_type: 'seo_redirects',
    metadata: { deactivated_ids: ids } as any,
  });

  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}
